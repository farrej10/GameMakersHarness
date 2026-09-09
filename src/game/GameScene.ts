import Phaser from 'phaser';
import generatedLevel from '@generated/level';
import * as generatedRules from '@generated/rules';
import generatedSpec from '@generated/spec';
import type {
  GameSnapshot,
  GameSpec,
  LevelOutput,
  RuleFunctions,
  ScenarioId,
} from '../contracts/index';
import { createScenario } from '../../tests/fixtures/scenarios/index';
import { installDebugInterface } from './debug';
import { KeyboardInput } from '../runtime/input';
import {
  COLLECTIBLE_RADIUS,
  ENEMY_RADIUS,
  EXIT_RADIUS,
  PLAYER_RADIUS,
} from '../runtime/geometry';
import {
  cloneSnapshot,
  createInitialState,
  restartGame,
  startGame,
} from '../runtime/state';
import { FIXED_STEP_SECONDS, stepGame } from '../runtime/step';

const STEP_MS = FIXED_STEP_SECONDS * 1_000;
const MAX_BACKLOG_STEPS = 5;

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required UI element is missing: ${selector}`);
  }
  return element;
}

function color(hex: string | undefined, fallback: number): number {
  return hex ? Number.parseInt(hex.slice(1), 16) : fallback;
}

export class GameScene extends Phaser.Scene {
  private currentSpec: GameSpec = structuredClone(generatedSpec);
  private currentLevel: LevelOutput = structuredClone(generatedLevel);
  private state!: GameSnapshot;
  private keyboard!: KeyboardInput;
  private accumulatorMs = 0;
  private manualClock = false;
  private cleanupDebug: () => void = () => undefined;
  private readonly rules: RuleFunctions = generatedRules;
  private entityLayer!: Phaser.GameObjects.Container;
  private playerView!: Phaser.GameObjects.Arc | Phaser.GameObjects.Image;
  private exitView!: Phaser.GameObjects.Arc | Phaser.GameObjects.Image;
  private enemyViews = new Map<string, Phaser.GameObjects.Arc | Phaser.GameObjects.Image>();
  private collectibleViews = new Map<string, Phaser.GameObjects.Arc | Phaser.GameObjects.Image>();
  private lastLoggedErrorCount = 0;

  private readonly startButton = () => {
    this.keyboard.clear();
    this.state = startGame(this.state);
    this.renderState();
  };

  private readonly restartButton = () => {
    if (this.state.state !== 'won' && this.state.state !== 'lost') {
      return;
    }
    this.keyboard.clear();
    this.state = restartGame(this.currentSpec, this.currentLevel);
    this.rebuildViews();
    this.renderState();
  };

  public constructor() {
    super('game');
  }

  public preload(): void {
    if (__USE_PIXEL_ASSETS__) {
      for (const id of ['player', 'collectible', 'enemy', 'exit']) {
        this.load.image(id, `assets/${id}.png`);
      }
    }
  }

  public create(): void {
    if (!this.input.keyboard) {
      throw new Error('Keyboard input is unavailable.');
    }

    this.manualClock =
      import.meta.env.MODE.startsWith('test') &&
      new URLSearchParams(window.location.search).get('clock') === 'manual';
    this.keyboard = new KeyboardInput(this.input.keyboard);
    this.state = createInitialState(this.currentSpec, this.currentLevel);

    this.cameras.main.setBackgroundColor(
      color(this.currentSpec.theme.palette[0], 0x14231d),
    );
    this.add.grid(400, 300, 800, 600, 40, 40, 0xffffff, 0, 0x88c070, 0.1);
    this.entityLayer = this.add.container(0, 0);
    this.rebuildViews();

    requiredElement<HTMLButtonElement>('[data-testid="start-button"]').addEventListener(
      'click',
      this.startButton,
    );
    requiredElement<HTMLButtonElement>(
      '[data-testid="restart-button"]',
    ).addEventListener('click', this.restartButton);

    this.cleanupDebug = installDebugInterface(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.renderState();
  }

  public override update(_time: number, delta: number): void {
    const input = this.keyboard.read();
    this.state = { ...this.state, input };

    if (Phaser.Input.Keyboard.JustDown(this.keyboard.start)) {
      this.startButton();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyboard.restart)) {
      this.restartButton();
    }

    if (!this.manualClock) {
      this.accumulatorMs = Math.min(
        this.accumulatorMs + delta,
        STEP_MS * MAX_BACKLOG_STEPS,
      );
      while (this.accumulatorMs >= STEP_MS) {
        this.state = stepGame(
          this.state,
          this.keyboard.read(),
          this.rules,
          this.currentSpec,
        );
        this.accumulatorMs -= STEP_MS;
      }
    }

    this.renderState();
  }

  public getSnapshot(): GameSnapshot {
    return cloneSnapshot(this.state);
  }

  public loadDebugScenario(id: ScenarioId): void {
    const scenario = createScenario(id, generatedSpec);
    this.currentSpec = scenario.spec;
    this.currentLevel = scenario.level;
    this.keyboard.clear();
    this.accumulatorMs = 0;
    this.lastLoggedErrorCount = 0;
    this.state = createInitialState(this.currentSpec, this.currentLevel);
    if (scenario.initial.score !== undefined) {
      this.state.score = scenario.initial.score;
    }
    if (scenario.initial.player) {
      this.state.player = { ...this.state.player, ...scenario.initial.player };
    }
    this.rebuildViews();
    this.renderState();
  }

  public advanceDebugTicks(count: number): void {
    for (let tick = 0; tick < count; tick += 1) {
      this.state = stepGame(
        this.state,
        this.keyboard.read(),
        this.rules,
        this.currentSpec,
      );
    }
    this.renderState();
  }

  private rebuildViews(): void {
    this.entityLayer.removeAll(true);
    this.enemyViews.clear();
    this.collectibleViews.clear();

    const palette = this.currentSpec.theme.palette;
    this.exitView = __USE_PIXEL_ASSETS__
      ? this.add.image(this.state.exit.x, this.state.exit.y, 'exit')
      : this.add
          .circle(
            this.state.exit.x,
            this.state.exit.y,
            EXIT_RADIUS,
            color(palette[1], 0x376b4b),
            0.35,
          )
          .setStrokeStyle(4, color(palette[2], 0x88c070));
    this.entityLayer.add(this.exitView);

    for (const collectible of this.state.collectibles) {
      const view = __USE_PIXEL_ASSETS__
        ? this.add.image(collectible.x, collectible.y, 'collectible')
        : this.add
            .circle(
              collectible.x,
              collectible.y,
              COLLECTIBLE_RADIUS,
              color(palette[3], 0xf2c14e),
            )
            .setStrokeStyle(2, 0xffffff);
      this.collectibleViews.set(collectible.id, view);
      this.entityLayer.add(view);
    }

    for (const enemy of this.state.enemies) {
      const view = __USE_PIXEL_ASSETS__
        ? this.add.image(enemy.x, enemy.y, 'enemy')
        : this.add
            .circle(enemy.x, enemy.y, ENEMY_RADIUS, 0xe25252)
            .setStrokeStyle(3, color(palette[3], 0xf2c14e));
      this.enemyViews.set(enemy.id, view);
      this.entityLayer.add(view);
    }

    this.playerView = __USE_PIXEL_ASSETS__
      ? this.add.image(this.state.player.x, this.state.player.y, 'player')
      : this.add
          .circle(
            this.state.player.x,
            this.state.player.y,
            PLAYER_RADIUS,
            color(palette[2], 0x88c070),
          )
          .setStrokeStyle(3, 0xffffff);
    this.entityLayer.add(this.playerView);
  }

  private renderState(): void {
    this.playerView.setPosition(this.state.player.x, this.state.player.y);
    this.exitView.setPosition(this.state.exit.x, this.state.exit.y);

    for (const enemy of this.state.enemies) {
      this.enemyViews.get(enemy.id)?.setPosition(enemy.x, enemy.y);
    }

    const activeCollectibles = new Set(
      this.state.collectibles.map(({ id }) => id),
    );
    for (const [id, view] of this.collectibleViews) {
      view.setVisible(activeCollectibles.has(id));
    }

    requiredElement('[data-testid="game-title"]').textContent =
      this.currentSpec.title;
    requiredElement('[data-testid="game-objective"]').textContent =
      this.currentSpec.description;
    requiredElement('[data-testid="game-score"]').textContent =
      `Score: ${this.state.score}/${this.currentSpec.collectibles.count}`;
    requiredElement('[data-testid="game-health"]').textContent =
      `Health: ${this.state.player.health}/${this.currentSpec.player.health}`;
    requiredElement('[data-testid="game-state"]').textContent =
      this.state.state.toUpperCase();

    const start = requiredElement<HTMLButtonElement>(
      '[data-testid="start-button"]',
    );
    const restart = requiredElement<HTMLButtonElement>(
      '[data-testid="restart-button"]',
    );
    start.disabled = this.state.state !== 'ready';
    restart.disabled = this.state.state !== 'won' && this.state.state !== 'lost';

    const overlay = requiredElement('[data-testid="game-overlay"]');
    overlay.textContent =
      this.state.state === 'won'
        ? 'YOU WIN'
        : this.state.state === 'lost'
          ? 'GAME OVER'
          : '';
    overlay.classList.toggle(
      'visible',
      this.state.state === 'won' || this.state.state === 'lost',
    );

    const errorPanel = requiredElement('[data-testid="game-error"]');
    errorPanel.textContent = this.state.errors.at(-1) ?? '';
    errorPanel.hidden = this.state.errors.length === 0;
    if (this.state.errors.length > this.lastLoggedErrorCount) {
      console.error(this.state.errors.at(-1));
      this.lastLoggedErrorCount = this.state.errors.length;
    }
  }

  private cleanup(): void {
    this.cleanupDebug();
    this.keyboard.destroy();
    requiredElement<HTMLButtonElement>('[data-testid="start-button"]').removeEventListener(
      'click',
      this.startButton,
    );
    requiredElement<HTMLButtonElement>(
      '[data-testid="restart-button"]',
    ).removeEventListener('click', this.restartButton);
  }
}
