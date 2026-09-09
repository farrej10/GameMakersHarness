declare module '@generated/spec' {
  const spec: import('./contracts/index').GameSpec;
  export default spec;
}

declare module '@generated/level' {
  const level: import('./contracts/index').LevelOutput;
  export default level;
}

declare module '@generated/rules' {
  export function getEnemyVelocity(
    context: import('./contracts/index').EnemyContext,
  ): import('./contracts/index').Vec2;
  export function isVictory(
    context: import('./contracts/index').VictoryContext,
  ): boolean;
}

interface Window {
  gameDebug?: import('./contracts/index').GameDebug;
  ruleTestApi?: {
    getEnemyVelocity(
      context: import('./contracts/index').EnemyContext,
    ): import('./contracts/index').Vec2;
    isVictory(context: import('./contracts/index').VictoryContext): boolean;
  };
}

declare const __USE_PIXEL_ASSETS__: boolean;
