import Phaser from 'phaser';
import type { InputState } from '../contracts/index';

export class KeyboardInput {
  private readonly trackedKeys: Phaser.Input.Keyboard.Key[];
  private readonly up: Phaser.Input.Keyboard.Key;
  private readonly down: Phaser.Input.Keyboard.Key;
  private readonly left: Phaser.Input.Keyboard.Key;
  private readonly right: Phaser.Input.Keyboard.Key;
  private readonly w: Phaser.Input.Keyboard.Key;
  private readonly a: Phaser.Input.Keyboard.Key;
  private readonly s: Phaser.Input.Keyboard.Key;
  private readonly d: Phaser.Input.Keyboard.Key;
  public readonly start: Phaser.Input.Keyboard.Key;
  public readonly restart: Phaser.Input.Keyboard.Key;

  public constructor(private readonly keyboard: Phaser.Input.Keyboard.KeyboardPlugin) {
    this.up = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.down = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.left = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.right = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.w = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.a = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.s = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.d = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.start = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.restart = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.trackedKeys = [
      this.up,
      this.down,
      this.left,
      this.right,
      this.w,
      this.a,
      this.s,
      this.d,
      this.start,
      this.restart,
    ];
    window.addEventListener('blur', this.clear);
  }

  public read(): InputState {
    return {
      up: this.up.isDown || this.w.isDown,
      down: this.down.isDown || this.s.isDown,
      left: this.left.isDown || this.a.isDown,
      right: this.right.isDown || this.d.isDown,
    };
  }

  public readonly clear = (): void => {
    for (const key of this.trackedKeys) {
      key.reset();
    }
    this.keyboard.resetKeys();
  };

  public destroy(): void {
    window.removeEventListener('blur', this.clear);
    this.clear();
  }
}
