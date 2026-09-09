import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadToolkitConfig } from './config';
import { approveSpecRun, proposeSpecRun, safeRunRoot } from './cli';
import { OpenRouterClient, RequestBudget } from './openrouter';
import { generateRun } from './orchestrator';
import { startStaticServer, type StaticServer } from './serve';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/u;

type ControlActions = {
  propose(prompt: string, seed: number): Promise<{ runId: string; hash: string; spec: unknown }>;
  approve(runId: string, hash: string): Promise<void>;
  generate(runId: string): Promise<void>;
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
    generate: async (runId) => {
      await generateRun({ runId, runsRoot });
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

function page(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Agentic Game Maker</title><style>body{font:16px system-ui;max-width:1000px;margin:auto;padding:2rem;background:#eef5ef;color:#15251c}textarea,pre{width:100%;box-sizing:border-box;padding:1rem}button{padding:.6rem 1rem;margin:.4rem}.row{display:flex;gap:1rem;align-items:center}iframe{width:100%;height:760px;border:1px solid #789}#status{font-weight:700}</style></head><body><h1>Agentic Game Maker</h1><p>Describe a top-down collection/survival game. Review and approve its exact specification before generation.</p><form id="spec-form"><textarea id="prompt" rows="5" maxlength="4000" required></textarea><div class="row"><label>Seed <input id="seed" type="number" min="0" max="2147483647" value="42"></label><button>Create specification</button></div></form><h2>Specification</h2><pre id="spec">No proposal yet.</pre><button id="approve" disabled>Approve exact spec</button><button id="generate" disabled>Generate and verify</button><p id="status">Idle</p><p><a id="report" hidden>Execution report</a></p><iframe id="game" title="Verified game" hidden></iframe><script type="module">let current=null;const status=document.querySelector('#status');const spec=document.querySelector('#spec');const approve=document.querySelector('#approve');const generate=document.querySelector('#generate');async function call(url,body){const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error||'Request failed');return value}document.querySelector('#spec-form').addEventListener('submit',async event=>{event.preventDefault();status.textContent='Creating specification…';try{current=await call('/api/spec',{prompt:document.querySelector('#prompt').value,seed:Number(document.querySelector('#seed').value)});spec.textContent=JSON.stringify(current.spec,null,2);approve.disabled=false;generate.disabled=true;status.textContent='Review the specification, then approve.'}catch(error){status.textContent=error.message}});approve.addEventListener('click',async()=>{try{await call('/api/approve',{runId:current.runId,hash:current.hash});approve.disabled=true;generate.disabled=false;status.textContent='Approved.'}catch(error){status.textContent=error.message}});generate.addEventListener('click',async()=>{try{await call('/api/generate',{runId:current.runId});generate.disabled=true;status.textContent='Generating and verifying…';const poll=setInterval(async()=>{const response=await fetch('/api/run/'+current.runId);const run=await response.json();status.textContent=run.state;if(run.state==='verified'||run.state==='stopped'){clearInterval(poll);const report=document.querySelector('#report');report.href='/report/'+current.runId;report.hidden=false;if(run.state==='verified'){const play=await call('/api/play',{runId:current.runId});const frame=document.querySelector('#game');frame.src=play.origin;frame.hidden=false}}},1000)}catch(error){status.textContent=error.message}});</script></body></html>`;
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
        response.end(page());
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
        jsonResponse(response, 200, JSON.parse(readFileSync(path.join(root, 'status.json'), 'utf8')));
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
        if (active.has(body.runId)) throw new Error('This run is already active.');
        active.add(body.runId);
        void actions
          .generate(body.runId)
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
