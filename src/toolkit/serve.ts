import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export type StaticServer = {
  origin: string;
  close(): Promise<void>;
};

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function startStaticServer(
  requestedRoot: string,
  port: number,
): Promise<StaticServer> {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Port must be an integer from 0 through 65535.');
  }
  const root = realpathSync(path.resolve(requestedRoot));
  if (!statSync(root).isDirectory()) throw new Error('Static root must be a directory.');

  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.includes('\0') || decoded.split('/').includes('..')) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
      const candidate = path.resolve(root, relative);
      if (!isInside(root, candidate)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const realCandidate = realpathSync(candidate);
      if (!isInside(root, realCandidate) || !statSync(realCandidate).isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': CONTENT_TYPES[path.extname(realCandidate).toLowerCase()] ??
          'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      createReadStream(realCandidate).pipe(response);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const selectedPort = typeof address === 'object' && address ? address.port : port;
  return {
    origin: `http://127.0.0.1:${selectedPort}`,
    close: () => closeServer(server),
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const root = argument('--root');
  const rawPort = argument('--port');
  if (!root || !rawPort) throw new Error('Usage: serve --root <directory> --port <port>');
  const server = await startStaticServer(root, Number(rawPort));
  process.stdout.write(`Serving ${path.resolve(root)} at ${server.origin}\n`);
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
