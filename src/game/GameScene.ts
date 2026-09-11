import Phaser from 'phaser';
import generatedLevel from '@generated/level';
import * as generatedRules from '@generated/rules';
import generatedSpec from '@generated/spec';
import type {
  GameSnapshot,
  GameSpec,
  LevelOutput,
  PlayerAnimationState,
  RuleFunctions,
  ScenarioId,
  VisualDebugState,
  VisualEffectType,
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
import { animationTicks, resolvedAnimationProfile } from './animation';

const STEP_MS = FIXED_STEP_SECONDS * 1_000;
const MAX_BACKLOG_STEPS = 5;

type EffectView =
  | Phaser.GameObjects.Arc
  | Phaser.GameObjects.Image
  | Phaser.GameObjects.Rectangle;

type ActiveEffect = {
  type: VisualEffectType;
  style: string;
  startedAtTick: number;
  endsAtTick: number;
  views: EffectView[];
};

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
  private effectLayer!: Phaser.GameObjects.Container;
  private entityLayer!: Phaser.GameObjects.Container;
  private playerView!: Phaser.GameObjects.Arc | Phaser.GameObjects.Image;
  private exitView!: Phaser.GameObjects.Arc | Phaser.GameObjects.Image;
  private enemyViews = new Map<string, Phaser.GameObjects.Arc | Phaser.GameObjects.Image>();
  private collectibleViews = new Map<string, Phaser.GameObjects.Arc | Phaser.GameObjects.Image>();
  private collectibleLabels = new Map<string, Phaser.GameObjects.Text>();
  private activeEffects: ActiveEffect[] = [];
  private dashUntilTick = 0;
  private dashAngle = 0;
  private hurtUntilTick = 0;
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
    const layout = this.currentSpec.world?.layout ?? 'open';
    const cellWidth = layout === 'lanes' ? 200 : layout === 'perimeter' ? 80 : 40;
    const cellHeight = layout === 'lanes' ? 75 : layout === 'perimeter' ? 80 : 40;
    this.add.grid(400, 300, 800, 600, cellWidth, cellHeight, 0xffffff, 0, 0x88c070, 0.1);
    if (layout === 'quadrants') {
      this.add.rectangle(400, 300, 4, 600, color(this.currentSpec.theme.palette[2], 0x88c070), 0.22);
      this.add.rectangle(400, 300, 800, 4, color(this.currentSpec.theme.palette[2], 0x88c070), 0.22);
    } else if (layout === 'perimeter') {
      this.add.rectangle(400, 300, 720, 520, 0x000000, 0).setStrokeStyle(3, color(this.currentSpec.theme.palette[2], 0x88c070), 0.3);
    }
    this.effectLayer = this.add.container(0, 0);
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
        this.advanceOneStep(this.keyboard.read());
        this.accumulatorMs -= STEP_MS;
      }
    }

    this.renderState();
  }

  public getSnapshot(): GameSnapshot {
    return cloneSnapshot(this.state);
  }

  public getVisualState(): VisualDebugState {
    return {
      playerAnimation: this.playerAnimationState(),
      invulnerable:
        this.state.player.nextDamageTick > 0 &&
        this.state.tick < this.state.player.nextDamageTick,
      activeEffects: this.activeEffects
        .filter(({ endsAtTick }) => endsAtTick > this.state.tick)
        .map(({ type, style, endsAtTick }) => ({
          type,
          style,
          remainingTicks: endsAtTick - this.state.tick,
        })),
    };
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
      this.advanceOneStep(this.keyboard.read());
    }
    this.renderState();
  }

  private advanceOneStep(input: GameSnapshot['input']): void {
    const before = this.state;
    const after = stepGame(before, input, this.rules, this.currentSpec);
    this.observeVisualTransitions(before, after);
    this.state = after;
  }

  private observeVisualTransitions(before: GameSnapshot, after: GameSnapshot): void {
    if (after.tick === before.tick) return;
    const profile = resolvedAnimationProfile(this.currentSpec);
    const dashTriggered =
      (after.player.nextDashTick ?? 0) > (before.player.nextDashTick ?? 0);
    if (dashTriggered) {
      this.dashUntilTick = after.tick + animationTicks(profile.dash.durationMs);
      this.dashAngle = Math.atan2(
        after.player.y - before.player.y,
        after.player.x - before.player.x,
      );
      this.createDashEffect(before, after, profile.dash.style, profile.dash.color);
    }
    if (after.player.health < before.player.health) {
      this.hurtUntilTick = after.tick + animationTicks(profile.damage.durationMs);
      this.createDamageEffect(after, profile.damage.style, profile.damage.color);
      if (!this.manualClock && profile.damage.cameraShake > 0) {
        this.cameras.main.shake(profile.damage.durationMs, profile.damage.cameraShake);
      }
    }
    if (after.score > before.score) {
      const remaining = new Set(after.collectibles.map(({ id }) => id));
      for (const collected of before.collectibles.filter(({ id }) => !remaining.has(id))) {
        this.createCollectionEffect(
          collected.x,
          collected.y,
          after.tick,
          profile.collection.style,
          profile.collection.color,
        );
      }
    }
  }

  private addEffect(effect: ActiveEffect): void {
    this.activeEffects.push(effect);
    this.effectLayer.add(effect.views);
  }

  private createDashEffect(
    before: GameSnapshot,
    after: GameSnapshot,
    style: string,
    hex: string,
  ): void {
    const duration = animationTicks(resolvedAnimationProfile(this.currentSpec).dash.durationMs);
    const views: EffectView[] = [];
    const dx = after.player.x - before.player.x;
    const dy = after.player.y - before.player.y;
    if (style === 'afterimage') {
      for (const fraction of [0.15, 0.35, 0.55, 0.75]) {
        const x = before.player.x + dx * fraction;
        const y = before.player.y + dy * fraction;
        const ghost = __USE_PIXEL_ASSETS__
          ? this.add.image(x, y, 'player').setAlpha(0.42)
          : this.add.circle(x, y, PLAYER_RADIUS, color(hex, 0x7de2d1), 0.42);
        views.push(ghost);
      }
    } else if (style === 'streak') {
      const streak = this.add
        .rectangle(
          before.player.x + dx / 2,
          before.player.y + dy / 2,
          Math.max(40, Math.hypot(dx, dy)),
          10,
          color(hex, 0x7de2d1),
          0.55,
        )
        .setRotation(Math.atan2(dy, dx));
      views.push(streak);
    } else {
      views.push(
        this.add
          .circle(before.player.x, before.player.y, PLAYER_RADIUS + 5, 0x000000, 0)
          .setStrokeStyle(5, color(hex, 0x7de2d1), 0.8),
      );
    }
    this.addEffect({
      type: 'dash-trail',
      style,
      startedAtTick: after.tick,
      endsAtTick: after.tick + duration,
      views,
    });
  }

  private createDamageEffect(
    state: GameSnapshot,
    style: string,
    hex: string,
  ): void {
    const duration = animationTicks(resolvedAnimationProfile(this.currentSpec).damage.durationMs);
    const ring = this.add
      .circle(state.player.x, state.player.y, PLAYER_RADIUS + 25, 0x000000, 0)
      .setStrokeStyle(style === 'shockwave' ? 6 : 4, color(hex, 0xff5c5c), 0.95);
    this.addEffect({
      type: 'damage-flash',
      style,
      startedAtTick: state.tick,
      endsAtTick: state.tick + duration,
      views: [ring],
    });
  }

  private createCollectionEffect(
    x: number,
    y: number,
    tick: number,
    style: string,
    hex: string,
  ): void {
    const duration = animationTicks(resolvedAnimationProfile(this.currentSpec).collection.durationMs);
    const effectColor = color(hex, 0xffd166);
    const views: EffectView[] = style === 'spark'
      ? [
          this.add.rectangle(x - 13, y, 8, 4, effectColor),
          this.add.rectangle(x + 13, y, 8, 4, effectColor),
          this.add.rectangle(x, y - 13, 4, 8, effectColor),
          this.add.rectangle(x, y + 13, 4, 8, effectColor),
        ]
      : [
          this.add
            .circle(x, y, COLLECTIBLE_RADIUS + 4, 0x000000, 0)
            .setStrokeStyle(style === 'pulse' ? 5 : 3, effectColor, 0.9),
        ];
    this.addEffect({
      type: 'collect-burst',
      style,
      startedAtTick: tick,
      endsAtTick: tick + duration,
      views,
    });
  }

  private playerAnimationState(): PlayerAnimationState {
    if (this.state.tick < this.hurtUntilTick) return 'hurt';
    if (this.state.tick < this.dashUntilTick) return 'dashing';
    if (
      this.state.state === 'playing' &&
      (this.state.input.up ||
        this.state.input.down ||
        this.state.input.left ||
        this.state.input.right)
    ) {
      return 'moving';
    }
    return 'idle';
  }

  private renderVisualEffects(): void {
    const retained: ActiveEffect[] = [];
    for (const effect of this.activeEffects) {
      if (effect.endsAtTick <= this.state.tick) {
        for (const view of effect.views) view.destroy();
        continue;
      }
      const length = effect.endsAtTick - effect.startedAtTick;
      const progress = length === 0 ? 1 : (this.state.tick - effect.startedAtTick) / length;
      for (const view of effect.views) {
        view.setAlpha(Math.max(0, 0.9 * (1 - progress)));
        if (effect.type === 'damage-flash' && effect.style === 'shockwave') {
          view.setScale(1 + progress * 1.8);
          view.setPosition(this.state.player.x, this.state.player.y);
        } else if (effect.type === 'damage-flash') {
          view.setPosition(this.state.player.x, this.state.player.y);
        } else if (effect.type === 'collect-burst') {
          view.setScale(0.7 + progress * 1.5);
        } else if (effect.type === 'dash-trail' && effect.style === 'burst') {
          view.setScale(1 + progress * 1.4);
        }
      }
      retained.push(effect);
    }
    this.activeEffects = retained;
  }

  private rebuildViews(): void {
    this.effectLayer.removeAll(true);
    this.activeEffects = [];
    this.dashUntilTick = 0;
    this.dashAngle = 0;
    this.hurtUntilTick = 0;
    this.entityLayer.removeAll(true);
    this.enemyViews.clear();
    this.collectibleViews.clear();
    this.collectibleLabels.clear();

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
      if (this.currentSpec.collectibles.interaction === 'ordered') {
        const label = this.add.text(collectible.x + 18, collectible.y - 28, collectible.id.slice(1), {
          color: '#ffffff',
          backgroundColor: '#111827',
          fontFamily: 'system-ui, sans-serif',
          fontSize: '15px',
          fontStyle: 'bold',
          padding: { x: 5, y: 2 },
        }).setOrigin(0.5).setStroke('#000000', 2);
        this.collectibleLabels.set(collectible.id, label);
        this.entityLayer.add(label);
      }
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
      this.collectibleLabels.get(id)?.setVisible(activeCollectibles.has(id));
    }

    this.renderVisualEffects();
    const playerAnimation = this.playerAnimationState();
    if (playerAnimation === 'dashing') {
      this.playerView
        .setRotation(this.dashAngle)
        .setScale(1.28, 0.78)
        .setAlpha(0.92);
    } else if (playerAnimation === 'hurt') {
      this.playerView
        .setRotation(0)
        .setScale(1.08)
        .setAlpha(this.state.tick % 4 < 2 ? 0.35 : 1);
    } else if (playerAnimation === 'moving') {
      const bob = this.state.tick % 16 < 8 ? 1.04 : 0.98;
      this.playerView.setRotation(0).setScale(bob).setAlpha(1);
    } else {
      this.playerView.setRotation(0).setScale(1).setAlpha(1);
    }

    requiredElement('[data-testid="game-title"]').textContent =
      this.currentSpec.title;
    const movement = this.currentSpec.player.movement?.mode ?? 'standard';
    const mechanicHint = movement === 'sprint'
      ? ' Hold Shift to sprint.'
      : movement === 'dash'
        ? ' Press Space to dash.'
        : '';
    const orderHint = this.currentSpec.collectibles.interaction === 'ordered'
      ? ' Collect targets in numbered order.'
      : '';
    requiredElement('[data-testid="game-objective"]').textContent =
      `${this.currentSpec.description}${mechanicHint}${orderHint}`;
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
