import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolkitConfig } from './config';
import { approveSpecRun, proposeSpecRun, safeRunRoot } from './cli';
import { OpenRouterClient, RequestBudget } from './openrouter';
import { generateRun } from './orchestrator';
import { readEvents } from './events';
import { startStaticServer, type StaticServer } from './serve';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/u;

type ControlActions = {
  propose(prompt: string, seed: number): Promise<{ runId: string; hash: string; spec: unknown }>;
  approve(runId: string, hash: string): Promise<void>;
  generate(runId: string, demoFault?: 'logic-victory'): Promise<void>;
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
    generate: async (runId, demoFault) => {
      await generateRun({ runId, runsRoot, demoFault });
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
    if (size > 16_384) throw new Error('Request body exceeds 16384 bytes.');
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
        response.end(enhancedPage());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/runs') {
        const runs = existsSync(runsRoot)
          ? readdirSync(runsRoot, { withFileTypes: true })
              .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
              .map((entry) => JSON.parse(readFileSync(path.join(runsRoot, entry.name, 'status.json'), 'utf8')))
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
        void actions
          .generate(body.runId, body.demoFault as 'logic-victory' | undefined)
          .catch(() => undefined)
          .finally(() => active.delete(body.runId as string));
        jsonResponse(response, 202, { accepted: true });
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
