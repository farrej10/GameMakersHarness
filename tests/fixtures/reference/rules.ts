import type { EnemyContext, VictoryContext, Vec2 } from './rule-types';

export function getEnemyVelocity(context: EnemyContext): Vec2 {
  if (context.behavior === 'chase') {
    const dx = context.player.x - context.enemy.x;
    const dy = context.player.y - context.enemy.y;
    const distance = Math.hypot(dx, dy);

    if (distance === 0) {
      return { x: 0, y: 0 };
    }

    return {
      x: (dx / distance) * context.speed,
      y: (dy / distance) * context.speed,
    };
  }

  if (context.enemy.x >= context.bounds.maxX) {
    return { x: -context.speed, y: 0 };
  }

  if (context.enemy.x <= context.bounds.minX) {
    return { x: context.speed, y: 0 };
  }

  const direction = context.enemy.vx < 0 ? -1 : 1;
  return { x: direction * context.speed, y: 0 };
}

export function isVictory(context: VictoryContext): boolean {
  const hasTargetScore = context.score >= context.target;
  return context.mode === 'collect-all'
    ? hasTargetScore
    : hasTargetScore && context.atExit;
}
