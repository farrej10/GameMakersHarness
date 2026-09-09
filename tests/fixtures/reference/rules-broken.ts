import type { EnemyContext, VictoryContext, Vec2 } from './rule-types';

// Deliberately incorrect fixture used only to prove policy tests apply back pressure.
export function getEnemyVelocity(context: EnemyContext): Vec2 {
  if (context.behavior === 'chase') {
    return {
      x: Math.sign(context.player.x - context.enemy.x) * context.speed,
      y: Math.sign(context.player.y - context.enemy.y) * context.speed,
    };
  }
  return { x: context.speed, y: 0 };
}

export function isVictory(context: VictoryContext): boolean {
  return context.score >= context.target;
}
