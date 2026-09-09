import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const browserRoot = path.join(projectRoot, 'src', 'game');
const toolkitRoot = path.join(projectRoot, 'src', 'toolkit');
const referenceRoot = path.join(projectRoot, 'tests', 'fixtures', 'reference');

function normalize(filePath: string): string {
  return path.resolve(filePath).replaceAll('\\', '/');
}

function enforceBrowserBoundary(): Plugin {
  return {
    name: 'enforce-browser-boundary',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !normalize(importer).startsWith(normalize(browserRoot))) {
        return null;
      }

      const resolvedSource = source.startsWith('.')
        ? path.resolve(path.dirname(importer), source)
        : source;
      const importsToolkit =
        normalize(resolvedSource).startsWith(normalize(toolkitRoot)) ||
        /(^|[/\\])toolkit([/\\]|$)/u.test(source);

      if (importsToolkit) {
        throw new Error(
          `Browser module ${path.relative(projectRoot, importer)} cannot import Node toolkit module ${source}.`,
        );
      }

      return null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [enforceBrowserBoundary()],
  publicDir: process.env.GAME_PUBLIC_DIR || false,
  define: {
    __USE_PIXEL_ASSETS__: JSON.stringify(Boolean(process.env.GAME_PUBLIC_DIR)),
  },
  resolve: {
    alias: {
      '@generated/spec': path.join(
        process.env.GAME_INTEGRATION_ROOT || referenceRoot,
        process.env.GAME_INTEGRATION_ROOT ? 'generated/game-spec.json' : 'game-spec.json',
      ),
      '@generated/level': path.join(
        process.env.GAME_INTEGRATION_ROOT || referenceRoot,
        process.env.GAME_INTEGRATION_ROOT ? 'generated/level.json' : 'level.json',
      ),
      '@generated/rules': path.join(
        process.env.GAME_INTEGRATION_ROOT || referenceRoot,
        process.env.GAME_INTEGRATION_ROOT
          ? 'generated/rules.ts'
          : mode === 'test-broken-rules'
            ? 'rules-broken.ts'
            : 'rules.ts',
      ),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: mode.startsWith('test')
      ? {
          input: {
            game: path.join(projectRoot, 'index.html'),
            policy: path.join(projectRoot, 'policy-test.html'),
          },
        }
      : undefined,
  },
}));
