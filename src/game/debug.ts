import type { GameDebug, GameSnapshot, ScenarioId } from '../contracts/index';
import type { GameScene } from './GameScene';

const SCENARIO_IDS = new Set<ScenarioId>([
  'movement',
  'dash',
  'collection',
  'damage',
  'win',
  'loss',
  'tie',
]);

export function installDebugInterface(scene: GameScene): () => void {
  const testMode = import.meta.env.MODE.startsWith('test');
  const enabled = import.meta.env.DEV || testMode;
  if (!enabled) {
    return () => undefined;
  }

  const manualClock =
    testMode &&
    new URLSearchParams(window.location.search).get('clock') === 'manual';

  const debug: GameDebug = {
    snapshot(): GameSnapshot {
      return scene.getSnapshot();
    },
    visuals() {
      return scene.getVisualState();
    },
    loadScenario(id: ScenarioId): void {
      if (!SCENARIO_IDS.has(id)) {
        throw new RangeError(`Unknown debug scenario: ${String(id)}`);
      }
      scene.loadDebugScenario(id);
    },
    advanceTicks(count: number): void {
      if (!manualClock) {
        throw new Error('Manual ticks require test mode and ?clock=manual.');
      }
      if (!Number.isInteger(count) || count < 1 || count > 600) {
        throw new RangeError('Tick count must be an integer from 1 through 600.');
      }
      scene.advanceDebugTicks(count);
    },
  };

  window.gameDebug = debug;
  return () => {
    delete window.gameDebug;
  };
}
