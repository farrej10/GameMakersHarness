import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolkitConfig } from './config';
import { getValidationErrors, validateArtOutput, validateGameSpec, type Approval, type ArtOutput, type GameSpec } from '../contracts/index';
import { approveSpecRun, proposeSpecRun, safeRunRoot, sha256, stableJson } from './cli';
import { OpenRouterClient, RequestBudget } from './openrouter';
import { generateRun } from './orchestrator';
import { EventWriter, readEvents } from './events';
import { startStaticServer, type StaticServer } from './serve';
import { artPreviewData, readReviewArtifacts, replaceReviewSprite, reviseReviewArtifact, type ReviewRole } from './review';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/u;

type ControlActions = {
  propose(prompt: string, seed: number): Promise<{ runId: string; hash: string; spec: unknown }>;
  approve(runId: string, hash: string): Promise<void>;
  generate(runId: string, options?: { demoFault?: 'logic-victory'; pauseForReview?: boolean; resumeReview?: boolean }): Promise<void>;
};

export type ControlServer = {
  origin: string;
  close(): Promise<void>;
};

function defaultActions(runsRoot: string): ControlActions {
  return {
    propose: async (prompt, seed) => {
      const config = loadToolkitConfig({ cwd: projectRoot });
      const budget = new RequestBudget(
        config.limits.maxRequests,
        Date.now() + config.limits.activeBudgetMs,
      );
      const client = new OpenRouterClient({
        apiKey: config.apiKey,
        budget,
        requestTimeoutMs: config.limits.requestTimeoutMs,
        contextLimitBytes: config.limits.contextBytes,
        schemaLimitBytes: config.limits.schemaBytes,
      });
      return proposeSpecRun({ prompt, seed, config, client, budget, runsRoot });
    },
    approve: async (runId, hash) => {
      approveSpecRun({ runId, hash, runsRoot });
    },
    generate: async (runId, options) => {
      await generateRun({ runId, runsRoot, ...options });
    },
  };
}

function jsonResponse(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 2_000_000) throw new Error('Request body exceeds 2000000 bytes.');
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('JSON request body must be an object.');
  }
  return value as Record<string, unknown>;
}

function runProgress(runRoot: string): Record<string, unknown> {
  const status = JSON.parse(readFileSync(path.join(runRoot, 'status.json'), 'utf8')) as Record<string, unknown>;
  const events = readEvents(path.join(runRoot, 'events.jsonl'));
  const workers = ['logic', 'level', 'art'].map((role) => {
    const relevant = events.filter(
      (event) => event.role === role && (
        event.type === 'worker.started' ||
        event.type === 'worker.completed' ||
        event.type === 'worker.failed'
      ),
    );
    const latest = relevant.at(-1);
    return {
      role,
      status: latest?.type === 'worker.completed'
        ? 'completed'
        : latest?.type === 'worker.failed'
          ? 'failed'
          : latest?.type === 'worker.started'
            ? 'running'
            : 'waiting',
      startedAt: relevant.find((event) => event.type === 'worker.started')?.at ?? null,
      finishedAt: relevant.findLast(
        (event) => event.type === 'worker.completed' || event.type === 'worker.failed',
      )?.at ?? null,
    };
  });
  const repairEvents = events.filter(
    (event) =>
      event.type === 'repair.started' ||
      event.type === 'repair.completed' ||
      (event.type === 'artifact.rejected' && event.role === 'repair'),
  );
  const latestRepair = repairEvents.at(-1);
  const repairData = latestRepair?.data as { owner?: string; artifact?: string } | undefined;
  const repair = latestRepair
    ? {
        status: latestRepair.type === 'repair.completed'
          ? 'completed'
          : latestRepair.type === 'artifact.rejected'
            ? 'failed'
            : 'running',
        owner: repairData?.owner ?? repairData?.artifact ?? 'unknown',
        attempt: latestRepair.attempt,
      }
    : null;
  return { ...status, workers, repair };
}

function reviseSpec(runRoot: string, runId: string, value: unknown): { hash: string; spec: GameSpec } {
  const status = JSON.parse(readFileSync(path.join(runRoot, 'status.json'), 'utf8')) as { state?: string };
  if (status.state !== 'awaiting-approval') throw new Error('The specification can only be edited before approval.');
  if (!validateGameSpec(value)) {
    throw new Error(`Specification is invalid: ${JSON.stringify(getValidationErrors(validateGameSpec))}`);
  }
  const revisionsRoot = path.join(runRoot, 'workers', 'spec', 'manual-revisions');
  mkdirSync(revisionsRoot, { recursive: true });
  const revision = readdirSync(revisionsRoot).filter((name) => /^revision-\d+\.json$/u.test(name)).length + 1;
  const relative = `workers/spec/manual-revisions/revision-${revision}.json`;
  const serialized = stableJson(value);
  writeFileSync(path.join(runRoot, relative), serialized);
  writeFileSync(path.join(runRoot, 'game-spec.json'), serialized);
  const hash = sha256(serialized);
  new EventWriter(runId, path.join(runRoot, 'events.jsonl')).append({
    type: 'spec.revised', role: 'spec', attempt: revision,
    data: { specPath: relative, specSha256: hash, revision },
  });
  return { hash, spec: value as GameSpec };
}

function reviewPayload(runRoot: string): Record<string, unknown> {
  const spec = JSON.parse(readFileSync(path.join(runRoot, 'game-spec.json'), 'utf8')) as GameSpec;
  const artifacts = readReviewArtifacts(runRoot);
  return {
    prompt: readFileSync(path.join(runRoot, 'prompt.txt'), 'utf8'),
    spec,
    artifacts,
    previews: artPreviewData(artifacts.art, spec.theme.palette),
  };
}

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function runOutputs(runRoot: string): Record<string, unknown> {
  const events = readEvents(path.join(runRoot, 'events.jsonl'));
  const spec = readJsonFile(path.join(runRoot, 'game-spec.json')) as GameSpec | null;
  const requestRoot = path.join(runRoot, 'requests');
  const requests = existsSync(requestRoot)
    ? readdirSync(requestRoot)
        .filter((name) => name.endsWith('.json'))
        .map((name) => ({ name, value: readJsonFile(path.join(requestRoot, name)) }))
        .filter((item) => item.value !== null)
    : [];
  const workers = ['spec', 'logic', 'level', 'art'].map((role) => {
    const roleEvents = events.filter((event) => event.role === role);
    const completed = roleEvents.findLast((event) => event.type === 'worker.completed');
    const completedData = completed?.data as { artifactPath?: string } | undefined;
    const accepted = completedData?.artifactPath
      ? readJsonFile(path.join(runRoot, completedData.artifactPath))
      : role === 'spec' ? spec : null;
    const attempts = requests
      .filter(({ value }) => (value?.request as { role?: unknown } | undefined)?.role === role)
      .map(({ name, value }) => {
        const request = value?.request as { requestId?: string; model?: string } | undefined;
        const envelope = (value?.response ?? value?.result) as { content?: unknown; returnedModel?: string } | undefined;
        return {
          requestId: request?.requestId ?? name.replace(/\.json$/u, ''),
          model: envelope?.returnedModel ?? request?.model ?? 'unknown',
          output: envelope?.content ?? null,
        };
      });
    const errors = roleEvents.flatMap((event) => {
      if (event.type === 'worker.failed') return [(event.data as { message: string }).message];
      if (event.type === 'artifact.rejected') return (event.data as { errors: string[] }).errors;
      return [];
    });
    return { role, accepted, attempts, errors };
  });
  const art = workers.find(({ role }) => role === 'art')?.accepted;
  let previews: Record<string, string> = {};
  if (spec && art && validateArtOutput(art)) {
    previews = artPreviewData(art as ArtOutput, spec.theme.palette);
  }
  return { workers, previews };
}

function runSession(runRoot: string): Record<string, unknown> {
  const status = readJsonFile(path.join(runRoot, 'status.json'));
  const spec = readJsonFile(path.join(runRoot, 'game-spec.json'));
  const specText = spec ? stableJson(spec) : '';
  const approval = readJsonFile(path.join(runRoot, 'approval.json')) as Approval | null;
  return {
    ...status,
    prompt: existsSync(path.join(runRoot, 'prompt.txt')) ? readFileSync(path.join(runRoot, 'prompt.txt'), 'utf8') : '',
    spec,
    hash: spec ? sha256(specText) : null,
    approved: Boolean(spec && approval?.specSha256 === sha256(specText)),
  };
}

function retryStoppedRun(runsRoot: string, sourceRunId: string): { runId: string; hash: string; spec: GameSpec } {
  const sourceRoot = safeRunRoot(runsRoot, sourceRunId);
  const sourceStatus = readJsonFile(path.join(sourceRoot, 'status.json'));
  if (sourceStatus?.state !== 'stopped') throw new Error('Only a stopped run can be retried.');
  const spec = readJsonFile(path.join(sourceRoot, 'game-spec.json'));
  if (!validateGameSpec(spec)) throw new Error('The stopped run does not contain a valid specification.');
  const specText = stableJson(spec);
  const hash = sha256(specText);
  const sourceApproval = readJsonFile(path.join(sourceRoot, 'approval.json')) as Approval | null;
  if (sourceApproval?.specSha256 !== hash) throw new Error('The stopped run specification no longer matches its approval.');
  let runId: string;
  let runRoot: string;
  do {
    runId = `${new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/u, 'Z')}-${randomBytes(4).toString('hex')}`;
    runRoot = path.join(runsRoot, runId);
  } while (existsSync(runRoot));
  mkdirSync(path.join(runRoot, 'workers', 'spec', 'attempt-0'), { recursive: true });
  mkdirSync(path.join(runRoot, 'requests'), { recursive: true });
  writeFileSync(path.join(runRoot, 'prompt.txt'), readFileSync(path.join(sourceRoot, 'prompt.txt')));
  writeFileSync(path.join(runRoot, 'config.json'), readFileSync(path.join(sourceRoot, 'config.json')));
  writeFileSync(path.join(runRoot, 'game-spec.json'), specText);
  writeFileSync(path.join(runRoot, 'workers', 'spec', 'attempt-0', 'output.json'), specText);
  writeFileSync(path.join(runRoot, 'approval.json'), stableJson({
    schemaVersion: 1,
    specSha256: hash,
    approvedAt: new Date().toISOString(),
  } satisfies Approval));
  writeFileSync(path.join(runRoot, 'status.json'), stableJson({
    schemaVersion: 1,
    runId,
    state: 'awaiting-approval',
    requestCount: 0,
    activeElapsedMs: 0,
    reasonCode: null,
    message: null,
  }));
  const events = new EventWriter(runId, path.join(runRoot, 'events.jsonl'));
  events.append({ type: 'run.created', role: null, attempt: null, data: { promptPath: 'prompt.txt', configPath: 'config.json' } });
  events.append({ type: 'spec.proposed', role: 'spec', attempt: null, data: { specPath: 'game-spec.json', specSha256: hash } });
  events.append({ type: 'spec.approved', role: null, attempt: null, data: { specSha256: hash } });
  events.append({ type: 'run.retried', role: null, attempt: null, data: { sourceRunId } });
  return { runId, hash, spec };
}

function page(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Agentic Game Maker</title><style>body{font:16px system-ui;max-width:1000px;margin:auto;padding:2rem;background:#eef5ef;color:#15251c}textarea,pre{width:100%;box-sizing:border-box;padding:1rem}button{padding:.6rem 1rem;margin:.4rem}.row{display:flex;gap:1rem;align-items:center}iframe{width:100%;height:760px;border:1px solid #789}#status{font-weight:700}</style></head><body><h1>Agentic Game Maker</h1><p>Describe a top-down collection/survival game. Review and approve its exact specification before generation.</p><form id="spec-form"><textarea id="prompt" rows="5" maxlength="4000" required></textarea><div class="row"><label>Seed <input id="seed" type="number" min="0" max="2147483647" value="42"></label><button>Create specification</button></div></form><h2>Specification</h2><pre id="spec">No proposal yet.</pre><button id="approve" disabled>Approve exact spec</button><button id="generate" disabled>Generate and verify</button><p id="status">Idle</p><p><a id="report" hidden>Execution report</a></p><iframe id="game" title="Verified game" hidden></iframe><script type="module">let current=null;const status=document.querySelector('#status');const spec=document.querySelector('#spec');const approve=document.querySelector('#approve');const generate=document.querySelector('#generate');async function call(url,body){const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error||'Request failed');return value}document.querySelector('#spec-form').addEventListener('submit',async event=>{event.preventDefault();status.textContent='Creating specification…';try{current=await call('/api/spec',{prompt:document.querySelector('#prompt').value,seed:Number(document.querySelector('#seed').value)});spec.textContent=JSON.stringify(current.spec,null,2);approve.disabled=false;generate.disabled=true;status.textContent='Review the specification, then approve.'}catch(error){status.textContent=error.message}});approve.addEventListener('click',async()=>{try{await call('/api/approve',{runId:current.runId,hash:current.hash});approve.disabled=true;generate.disabled=false;status.textContent='Approved.'}catch(error){status.textContent=error.message}});generate.addEventListener('click',async()=>{try{await call('/api/generate',{runId:current.runId});generate.disabled=true;status.textContent='Generating and verifying…';const poll=setInterval(async()=>{const response=await fetch('/api/run/'+current.runId);const run=await response.json();status.textContent=run.state;if(run.state==='verified'||run.state==='stopped'){clearInterval(poll);const report=document.querySelector('#report');report.href='/report/'+current.runId;report.hidden=false;if(run.state==='verified'){const play=await call('/api/play',{runId:current.runId});const frame=document.querySelector('#game');frame.src=play.origin;frame.hidden=false}}},1000)}catch(error){status.textContent=error.message}});</script></body></html>`;
}

function enhancedPage(): string {
  const enhancement = String.raw`<script>(()=>{const nativeFetch=window.fetch.bind(window);const mechanics=document.createElement('div');mechanics.id='mechanics';mechanics.className='mechanics';mechanics.innerHTML='<span class="chip">No proposal yet</span>';const heading=document.querySelector('h2');heading.textContent='Design summary';heading.after(mechanics);const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Exact specification';const spec=document.querySelector('#spec');details.append(summary,spec);mechanics.after(details);const agents=document.createElement('div');agents.id='agents';agents.className='agents';const status=document.querySelector('#status');const progressHeading=document.createElement('h2');progressHeading.textContent='Agent progress';status.before(progressHeading,agents);const checkbox=document.createElement('label');checkbox.className='demo';checkbox.title='Transparent demonstration mode: inject a known logic defect after generation so the real repair worker and harness must recover.';checkbox.innerHTML='<input id="demo-fault" type="checkbox"> Demonstrate autonomous repair';document.querySelector('#generate').after(checkbox);function chip(text){const node=document.createElement('span');node.className='chip';node.textContent=text;return node}function renderSpec(value){mechanics.replaceChildren();const values=[value.identity.fantasy,'Movement: '+value.player.movement.mode,'Collection: '+value.collectibles.interaction,'Enemies: '+value.enemies.behavior,'Objective: '+value.objective.mode,'Layout: '+value.world.layout,'Pressure: '+value.world.pressure];for(const value of values)mechanics.append(chip(value))}function renderProgress(run){agents.replaceChildren();for(const item of run.workers||[]){const card=document.createElement('div');card.className='agent '+item.status;const title=document.createElement('strong');title.textContent=item.role;const state=document.createElement('span');state.textContent=item.status;card.append(title,state);agents.append(card)}if(run.repair){const card=document.createElement('div');card.className='agent '+run.repair.status;const title=document.createElement('strong');title.textContent='repair → '+run.repair.owner;const state=document.createElement('span');state.textContent=run.repair.status+' · attempt '+run.repair.attempt;card.append(title,state);agents.append(card)}}for(const role of ['logic','level','art']){agents.insertAdjacentHTML('beforeend','<div class="agent waiting"><strong>'+role+'</strong><span>waiting</span></div>')}window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;if(url==='/api/generate'&&init?.body){const body=JSON.parse(String(init.body));body.demoFault=document.querySelector('#demo-fault').checked?'logic-victory':null;init={...init,body:JSON.stringify(body)}}const response=await nativeFetch(input,init);if(url==='/api/spec'&&response.ok)response.clone().json().then(value=>renderSpec(value.spec));if(url.startsWith('/api/run/')&&response.ok)response.clone().json().then(renderProgress);return response}})();</script>`;
  return page()
    .replace(
      '</style>',
      '.mechanics,.agents{display:flex;flex-wrap:wrap;gap:.6rem;margin:1rem 0}.chip,.agent{padding:.6rem .8rem;border:1px solid #789;border-radius:.5rem;background:#fff}.agent{min-width:120px}.agent strong,.agent span{display:block}.agent.waiting{opacity:.55}.agent.running{border-color:#c48a00;background:#fff8df}.agent.completed{border-color:#27864d;background:#eafff0}.agent.failed{border-color:#b52d2d;background:#fff0f0}.demo{display:inline-block;margin:.6rem}details{margin-bottom:1rem}</style>',
    )
    .replace('</body>', `${enhancement}</body>`);
}

function workbenchPage(): string {
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Agentic Game Maker</title><style>
body{font:16px system-ui;max-width:1100px;margin:auto;padding:2rem;background:#eef5ef;color:#15251c}textarea{width:100%;box-sizing:border-box;padding:.8rem;font:14px ui-monospace,monospace}button{padding:.65rem 1rem;margin:.35rem}.row,.agents,.sprites{display:flex;gap:.8rem;align-items:center;flex-wrap:wrap}.card{padding:1rem;margin:1rem 0;border:1px solid #789;border-radius:.6rem;background:#fff}.agent{padding:.6rem .8rem;border:1px solid #789;border-radius:.5rem;cursor:pointer}.completed{background:#eafff0}.running{background:#fff8df}.failed{background:#fff0f0}.sprites figure{margin:.4rem;padding:.6rem;border:1px solid #9ab;border-radius:.5rem}.sprites img{display:block;width:128px;height:128px;image-rendering:pixelated;background:#ccd}iframe{width:100%;height:760px;border:1px solid #789}#status{font-weight:700}.help{color:#496356}details{margin:.7rem 0}input[type=number]{width:9rem;padding:.4rem}.spinner{display:inline-block;width:1rem;height:1rem;margin-right:.45rem;border:3px solid #b8c9bd;border-top-color:#287548;border-radius:50%;vertical-align:-.2rem;animation:spin .75s linear infinite}.spinner[hidden]{display:none}.agent.running::before{content:'';display:inline-block;width:.7rem;height:.7rem;margin-right:.4rem;border:2px solid #c9ad64;border-top-color:#6d510c;border-radius:50%;animation:spin .75s linear infinite}.output{border-left:4px solid #789;padding:.7rem;margin:.7rem 0}.output pre{max-height:26rem;overflow:auto;white-space:pre-wrap;background:#f2f5f3;padding:.8rem}.error-text{color:#9d2020}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body>
<h1>Agentic Game Maker</h1><p>Edit the description at any time to start another iteration. The optional review gate pauses after the agents finish so every artifact can be changed before the build.</p>
<section class="card"><label for="runs"><strong>Open an existing run</strong></label><div class="row"><select id="runs"><option value="">Loading runs…</option></select><button id="load-run">Open run</button></div></section>
<form id="spec-form" class="card"><label for="prompt"><strong>Game description</strong></label><textarea id="prompt" rows="6" maxlength="4000" required></textarea><div class="row"><label>Seed <input id="seed" type="number" min="0" max="2147483647" value="42"></label><button>Create specification</button></div></form>
<section class="card"><h2>Design summary</h2><div id="mechanics">No proposal yet.</div><details open><summary>Editable specification JSON</summary><textarea id="spec" rows="20" disabled></textarea></details><button id="save-spec" disabled>Validate and save spec edits</button><button id="approve" disabled>Approve exact spec</button></section>
<section class="card"><h2>Agent progress</h2><p class="help">Select an agent to inspect its accepted output, raw attempts, and validation errors.</p><div id="agents" class="agents"></div><label><input id="review-gate" type="checkbox"> Pause to review agent outputs before building</label><br><label><input id="demo-fault" type="checkbox"> Demonstrate autonomous repair</label><br><button id="generate" disabled>Generate and verify</button><p><span id="spinner" class="spinner" hidden aria-hidden="true"></span><span id="status">Idle</span></p></section>
<section id="outputs" class="card" hidden><h2>Agent outputs and errors</h2><div id="output-list"></div><button id="retry" hidden>Retry failed run</button></section>
<section id="review" class="card" hidden><h2>Agent output review</h2><p class="help">Each save creates a numbered revision. Original agent outputs remain in the run evidence.</p><details open><summary>Game logic agent</summary><textarea id="logic" rows="22"></textarea><button data-save="logic">Validate and save logic</button></details><details><summary>Level agent</summary><textarea id="level" rows="18"></textarea><button data-save="level">Validate and save level</button></details><details open><summary>Art agent</summary><div id="sprites" class="sprites"></div><details><summary>Editable art contract JSON</summary><textarea id="art" rows="14"></textarea><button data-save="art">Validate and save art contract</button></details></details><button id="continue">Build and verify selected revisions</button></section>
<p><a id="report" hidden>Execution report</a></p><iframe id="game" title="Verified game" hidden></iframe>
<script type="module">
let current=null,pollTimer=null;const q=s=>document.querySelector(s),status=q('#status'),spinner=q('#spinner');
async function call(url,body){const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error||'Request failed');return value}
function setBusy(message,busy=true){status.textContent=message;spinner.hidden=!busy}
function shortMessage(value){const text=String(value||'');return text.length>220?text.slice(0,220)+'…':text}
function renderSpec(v){q('#spec').value=JSON.stringify(v,null,2);const parts=[];if(v.identity)parts.push(v.identity.fantasy);if(v.player)parts.push('Movement: '+v.player.movement.mode);if(v.objective)parts.push('Objective: '+v.objective.mode);if(v.timer)parts.push('Timer: '+v.timer.mode);q('#mechanics').textContent=parts.join(' · ')||v.title||'Specification ready.'}
function renderProgress(run){q('#agents').replaceChildren(...(run.workers||[]).map(item=>{const n=document.createElement('button');n.type='button';n.className='agent '+item.status;n.textContent=item.role+': '+item.status;n.title='Inspect '+item.role+' output';n.addEventListener('click',()=>void loadOutputs(item.role).catch(e=>setBusy(e.message,false)));return n}))}
function outputBlock(title,value,className=''){const box=document.createElement('div'),heading=document.createElement('h4'),pre=document.createElement('pre');box.className='output '+className;heading.textContent=title;pre.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);box.append(heading,pre);return box}
async function loadOutputs(openRole){setBusy('Loading agent outputs…');const response=await fetch('/api/run/'+current.runId+'/outputs'),data=await response.json();if(!response.ok)throw new Error(data.error);const list=q('#output-list');list.replaceChildren();for(const worker of data.workers){const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');details.open=!openRole||worker.role===openRole||worker.errors.length>0;summary.textContent=worker.role+' agent';if(worker.errors.length)body.append(outputBlock('Validation and worker errors',worker.errors.join('\n\n'),'error-text'));if(worker.accepted)body.append(outputBlock('Accepted output',worker.accepted));for(const attempt of worker.attempts)body.append(outputBlock('Raw model attempt '+attempt.requestId+' · '+attempt.model,attempt.output));if(!worker.accepted&&!worker.attempts.length&&!worker.errors.length)body.textContent='No output was recorded.';details.append(summary,body);list.append(details)}if(Object.keys(data.previews||{}).length){const heading=document.createElement('h3'),images=document.createElement('div');heading.textContent='Rendered art output';images.className='sprites';for(const [id,src] of Object.entries(data.previews)){const fig=document.createElement('figure'),img=document.createElement('img'),cap=document.createElement('figcaption');img.src=src;img.alt=id+' sprite';cap.textContent=id;fig.append(img,cap);images.append(fig)}list.append(heading,images)}q('#outputs').hidden=false;setBusy('Outputs loaded.',false)}
async function loadReview(){setBusy('Loading review artifacts…');const response=await fetch('/api/run/'+current.runId+'/artifacts'),r=await response.json();if(!response.ok)throw new Error(r.error);q('#logic').value=r.artifacts.logic.source;q('#level').value=JSON.stringify(r.artifacts.level,null,2);q('#art').value=JSON.stringify(r.artifacts.art,null,2);const box=q('#sprites');box.replaceChildren();for(const [id,src] of Object.entries(r.previews)){const fig=document.createElement('figure'),img=document.createElement('img'),cap=document.createElement('figcaption'),input=document.createElement('input');img.src=src;img.alt=id+' sprite';cap.textContent=id;input.type='file';input.accept='image/png';input.addEventListener('change',async()=>{const file=input.files&&input.files[0];if(!file)return;try{setBusy('Uploading '+id+' sprite…');const base64=await new Promise(ok=>{const reader=new FileReader();reader.onload=()=>ok(String(reader.result).split(',')[1]);reader.readAsDataURL(file)});await call('/api/art/upload',{runId:current.runId,assetId:id,pngBase64:base64});await loadReview();setBusy('Saved new '+id+' art revision.',false)}catch(e){setBusy(e.message,false)}});fig.append(img,cap,input);box.append(fig)}q('#review').hidden=false;setBusy('Review agent outputs, edit them, then continue.',false)}
async function poll(){try{const response=await fetch('/api/run/'+current.runId),run=await response.json();if(!response.ok)throw new Error(run.error);renderProgress(run);const active=['generating','integrating','verifying','repairing'].includes(run.state);setBusy(run.state+(run.message?' · '+shortMessage(run.message):''),active);if(run.state==='reviewing'){clearInterval(pollTimer);await Promise.all([loadReview(),loadOutputs()])}if(run.state==='verified'||run.state==='stopped'){clearInterval(pollTimer);q('#report').href='/report/'+current.runId;q('#report').hidden=false;await loadOutputs();q('#retry').hidden=run.state!=='stopped';if(run.state==='verified'){setBusy('Starting verified game preview…');const play=await call('/api/play',{runId:current.runId});q('#game').src=play.origin;q('#game').hidden=false;setBusy('Verified.',false)}else setBusy('Stopped · '+shortMessage(run.message||'Inspect the agent output, then retry.'),false)}}catch(e){clearInterval(pollTimer);setBusy(e.message,false)}}
function beginPoll(){clearInterval(pollTimer);pollTimer=setInterval(()=>void poll(),800);void poll()}
async function refreshRuns(){const response=await fetch('/api/runs'),data=await response.json();if(!response.ok)throw new Error(data.error);const select=q('#runs');select.replaceChildren();for(const run of data.runs){const option=document.createElement('option');option.value=run.runId;option.textContent=(run.title||run.runId)+' · '+run.state+' · '+run.runId;select.append(option)}if(!data.runs.length){const option=document.createElement('option');option.textContent='No runs yet';option.value='';select.append(option)}}
async function openRun(runId){if(!runId)return;setBusy('Loading run…');const response=await fetch('/api/run/'+runId+'/session'),session=await response.json();if(!response.ok)throw new Error(session.error);current={runId:session.runId,hash:session.hash,spec:session.spec};q('#prompt').value=session.prompt||'';q('#seed').value=session.spec?.seed??42;if(session.spec)renderSpec(session.spec);const editable=session.state==='awaiting-approval'&&!session.approved;q('#spec').disabled=!editable;q('#save-spec').disabled=!editable;q('#approve').disabled=!editable;q('#generate').disabled=!(session.state==='awaiting-approval'&&session.approved);q('#review').hidden=true;q('#outputs').hidden=true;q('#report').hidden=true;q('#game').hidden=true;beginPoll()}
q('#load-run').addEventListener('click',()=>void openRun(q('#runs').value).catch(e=>setBusy(e.message,false)));
q('#spec-form').addEventListener('submit',async e=>{e.preventDefault();try{setBusy('Creating specification…');current=await call('/api/spec',{prompt:q('#prompt').value,seed:Number(q('#seed').value)});renderSpec(current.spec);q('#spec').disabled=false;q('#save-spec').disabled=false;q('#approve').disabled=false;q('#generate').disabled=true;q('#review').hidden=true;q('#outputs').hidden=true;await refreshRuns();q('#runs').value=current.runId;setBusy('Edit the JSON if needed, then approve.',false)}catch(e){setBusy(e.message,false)}});
q('#save-spec').addEventListener('click',async()=>{try{setBusy('Validating specification edits…');const r=await call('/api/spec/edit',{runId:current.runId,spec:JSON.parse(q('#spec').value)});current.hash=r.hash;current.spec=r.spec;renderSpec(r.spec);setBusy('Specification revision saved.',false)}catch(e){setBusy(e.message,false)}});
q('#approve').addEventListener('click',async()=>{try{setBusy('Approving specification…');await call('/api/approve',{runId:current.runId,hash:current.hash});q('#approve').disabled=true;q('#save-spec').disabled=true;q('#spec').disabled=true;q('#generate').disabled=false;setBusy('Approved.',false)}catch(e){setBusy(e.message,false)}});
q('#generate').addEventListener('click',async()=>{try{setBusy('Starting parallel agents…');await call('/api/generate',{runId:current.runId,pauseForReview:q('#review-gate').checked,demoFault:q('#demo-fault').checked?'logic-victory':null});q('#generate').disabled=true;beginPoll()}catch(e){setBusy(e.message,false)}});
for(const b of document.querySelectorAll('[data-save]'))b.addEventListener('click',async()=>{const role=b.dataset.save;try{setBusy('Validating '+role+' revision…');const artifact=role==='logic'?{schemaVersion:1,source:q('#logic').value}:JSON.parse(q('#'+role).value);const r=await call('/api/artifact/edit',{runId:current.runId,role,artifact});await loadReview();setBusy('Saved '+role+' revision '+r.revision+'.',false)}catch(e){setBusy(e.message,false)}});
q('#continue').addEventListener('click',async()=>{try{setBusy('Starting build and verification…');await call('/api/continue',{runId:current.runId});q('#review').hidden=true;beginPoll()}catch(e){setBusy(e.message,false)}});
q('#retry').addEventListener('click',async()=>{try{setBusy('Creating retry run…');const retried=await call('/api/retry',{runId:current.runId,pauseForReview:q('#review-gate').checked});current=retried;renderSpec(current.spec);q('#retry').hidden=true;q('#outputs').hidden=true;q('#report').hidden=true;q('#game').hidden=true;await refreshRuns();q('#runs').value=current.runId;beginPoll()}catch(e){setBusy(e.message,false)}});
void refreshRuns().catch(e=>setBusy(e.message,false));
</script></body></html>`;
}

function closeHttp(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export async function startControlServer(options: {
  port?: number;
  gamePort?: number;
  runsRoot?: string;
  actions?: ControlActions;
} = {}): Promise<ControlServer> {
  const runsRoot = path.resolve(options.runsRoot ?? path.join(projectRoot, 'runs'));
  const actions = options.actions ?? defaultActions(runsRoot);
  const active = new Set<string>();
  let gameServer: StaticServer | undefined;
  let origin = '';
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(workbenchPage());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/runs') {
        const runs = existsSync(runsRoot)
          ? readdirSync(runsRoot, { withFileTypes: true })
              .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
              .map((entry) => {
                const root = path.join(runsRoot, entry.name);
                const status = JSON.parse(readFileSync(path.join(root, 'status.json'), 'utf8')) as Record<string, unknown>;
                const spec = readJsonFile(path.join(root, 'game-spec.json'));
                return { ...status, title: typeof spec?.title === 'string' ? spec.title : entry.name } as Record<string, unknown>;
              })
              .sort((first, second) => String(second.runId).localeCompare(String(first.runId)))
          : [];
        jsonResponse(response, 200, { runs });
        return;
      }
      const runMatch = url.pathname.match(/^\/api\/run\/(\d{8}T\d{6}Z-[0-9a-f]{8})$/u);
      if (request.method === 'GET' && runMatch) {
        const root = safeRunRoot(runsRoot, runMatch[1]!);
        jsonResponse(response, 200, runProgress(root));
        return;
      }
      const sessionMatch = url.pathname.match(/^\/api\/run\/(\d{8}T\d{6}Z-[0-9a-f]{8})\/session$/u);
      if (request.method === 'GET' && sessionMatch) {
        jsonResponse(response, 200, runSession(safeRunRoot(runsRoot, sessionMatch[1]!)));
        return;
      }
      const artifactMatch = url.pathname.match(/^\/api\/run\/(\d{8}T\d{6}Z-[0-9a-f]{8})\/artifacts$/u);
      if (request.method === 'GET' && artifactMatch) {
        const root = safeRunRoot(runsRoot, artifactMatch[1]!);
        const status = JSON.parse(readFileSync(path.join(root, 'status.json'), 'utf8')) as { state?: string };
        if (status.state !== 'reviewing') throw new Error('Artifacts are available while a run is awaiting review.');
        jsonResponse(response, 200, reviewPayload(root));
        return;
      }
      const outputsMatch = url.pathname.match(/^\/api\/run\/(\d{8}T\d{6}Z-[0-9a-f]{8})\/outputs$/u);
      if (request.method === 'GET' && outputsMatch) {
        jsonResponse(response, 200, runOutputs(safeRunRoot(runsRoot, outputsMatch[1]!)));
        return;
      }
      const reportMatch = url.pathname.match(/^\/report\/(\d{8}T\d{6}Z-[0-9a-f]{8})$/u);
      if (request.method === 'GET' && reportMatch) {
        const root = safeRunRoot(runsRoot, reportMatch[1]!);
        const reportPath = path.join(root, 'report.html');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(readFileSync(reportPath));
        return;
      }
      if (request.method !== 'POST') {
        jsonResponse(response, 404, { error: 'Not found.' });
        return;
      }
      if (request.headers.origin !== origin) {
        jsonResponse(response, 403, { error: 'Mutation requests require the control-page origin.' });
        return;
      }
      const body = await readJsonBody(request);
      if (url.pathname === '/api/spec') {
        if (typeof body.prompt !== 'string' || !Number.isInteger(body.seed)) throw new Error('prompt and integer seed are required.');
        jsonResponse(response, 201, await actions.propose(body.prompt, body.seed as number));
        return;
      }
      if (url.pathname === '/api/spec/edit') {
        if (typeof body.runId !== 'string' || !RUN_ID.test(body.runId) || body.spec === undefined) {
          throw new Error('A valid runId and spec are required.');
        }
        jsonResponse(response, 200, reviseSpec(safeRunRoot(runsRoot, body.runId), body.runId, body.spec));
        return;
      }
      if (url.pathname === '/api/approve') {
        if (typeof body.runId !== 'string' || typeof body.hash !== 'string') throw new Error('runId and hash are required.');
        await actions.approve(body.runId, body.hash);
        jsonResponse(response, 200, { approved: true });
        return;
      }
      if (url.pathname === '/api/generate') {
        if (typeof body.runId !== 'string' || !RUN_ID.test(body.runId)) throw new Error('A valid runId is required.');
        if (body.demoFault !== null && body.demoFault !== undefined && body.demoFault !== 'logic-victory') {
          throw new Error('Unsupported demo fault.');
        }
        if (active.has(body.runId)) throw new Error('This run is already active.');
        active.add(body.runId);
        if (body.pauseForReview !== undefined && typeof body.pauseForReview !== 'boolean') {
          throw new Error('pauseForReview must be a boolean.');
        }
        void actions
          .generate(body.runId, {
            demoFault: body.demoFault as 'logic-victory' | undefined,
            pauseForReview: body.pauseForReview === true,
          })
          .catch(() => undefined)
          .finally(() => active.delete(body.runId as string));
        jsonResponse(response, 202, { accepted: true });
        return;
      }
      if (url.pathname === '/api/artifact/edit') {
        if (typeof body.runId !== 'string' || !RUN_ID.test(body.runId)) throw new Error('A valid runId is required.');
        if (body.role !== 'logic' && body.role !== 'level' && body.role !== 'art') throw new Error('role must be logic, level, or art.');
        const root = safeRunRoot(runsRoot, body.runId);
        const status = JSON.parse(readFileSync(path.join(root, 'status.json'), 'utf8')) as { state?: string };
        if (status.state !== 'reviewing') throw new Error('Artifacts can only be edited during review.');
        const spec = JSON.parse(readFileSync(path.join(root, 'game-spec.json'), 'utf8')) as GameSpec;
        const revised = reviseReviewArtifact(root, body.role as ReviewRole, body.artifact, spec);
        new EventWriter(body.runId, path.join(root, 'events.jsonl')).append({
          type: 'artifact.revised', role: body.role, attempt: revised.revision,
          data: { artifact: body.role, artifactPath: revised.artifactPath, revision: revised.revision },
        });
        jsonResponse(response, 200, revised);
        return;
      }
      if (url.pathname === '/api/art/upload') {
        if (typeof body.runId !== 'string' || !RUN_ID.test(body.runId)) throw new Error('A valid runId is required.');
        if (body.assetId !== 'player' && body.assetId !== 'collectible' && body.assetId !== 'enemy' && body.assetId !== 'exit') throw new Error('A valid assetId is required.');
        if (typeof body.pngBase64 !== 'string') throw new Error('pngBase64 is required.');
        const root = safeRunRoot(runsRoot, body.runId);
        const status = JSON.parse(readFileSync(path.join(root, 'status.json'), 'utf8')) as { state?: string };
        if (status.state !== 'reviewing') throw new Error('Art can only be edited during review.');
        const spec = JSON.parse(readFileSync(path.join(root, 'game-spec.json'), 'utf8')) as GameSpec;
        const revised = replaceReviewSprite(root, body.assetId, Buffer.from(body.pngBase64, 'base64'), spec);
        new EventWriter(body.runId, path.join(root, 'events.jsonl')).append({
          type: 'artifact.revised', role: 'art', attempt: revised.revision,
          data: { artifact: 'art', artifactPath: revised.artifactPath, revision: revised.revision },
        });
        jsonResponse(response, 200, revised);
        return;
      }
      if (url.pathname === '/api/continue') {
        if (typeof body.runId !== 'string' || !RUN_ID.test(body.runId)) throw new Error('A valid runId is required.');
        if (active.has(body.runId)) throw new Error('This run is already active.');
        active.add(body.runId);
        void actions.generate(body.runId, { resumeReview: true })
          .catch(() => undefined)
          .finally(() => active.delete(body.runId as string));
        jsonResponse(response, 202, { accepted: true });
        return;
      }
      if (url.pathname === '/api/retry') {
        if (typeof body.runId !== 'string' || !RUN_ID.test(body.runId)) throw new Error('A valid runId is required.');
        if (body.pauseForReview !== undefined && typeof body.pauseForReview !== 'boolean') throw new Error('pauseForReview must be a boolean.');
        const retried = retryStoppedRun(runsRoot, body.runId);
        active.add(retried.runId);
        void actions.generate(retried.runId, { pauseForReview: body.pauseForReview !== false })
          .catch(() => undefined)
          .finally(() => active.delete(retried.runId));
        jsonResponse(response, 202, retried);
        return;
      }
      if (url.pathname === '/api/play') {
        if (typeof body.runId !== 'string' || !RUN_ID.test(body.runId)) throw new Error('A valid runId is required.');
        const root = safeRunRoot(runsRoot, body.runId);
        if (lstatSync(root).isSymbolicLink()) throw new Error('Symlinked runs are not allowed.');
        const status = JSON.parse(readFileSync(path.join(root, 'status.json'), 'utf8')) as { state?: string };
        if (status.state !== 'verified') throw new Error('Only a verified run can be served.');
        await gameServer?.close();
        gameServer = await startStaticServer(path.join(root, 'build'), options.gamePort ?? 4301);
        jsonResponse(response, 200, { origin: gameServer.origin });
        return;
      }
      jsonResponse(response, 404, { error: 'Not found.' });
    } catch (error) {
      jsonResponse(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4300, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port ?? 4300;
  origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    close: async () => {
      await gameServer?.close();
      await closeHttp(server);
    },
  };
}

async function main(): Promise<void> {
  const server = await startControlServer();
  process.stdout.write(`Control page: ${server.origin}\n`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
