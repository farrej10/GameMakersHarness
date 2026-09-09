export const PLAYER_RADIUS = 12;
export const ENEMY_RADIUS = 12;
export const COLLECTIBLE_RADIUS = 8;
export const EXIT_RADIUS = 20;

export type Circle = Readonly<{
  x: number;
  y: number;
  radius: number;
}>;

export function circlesOverlap(first: Circle, second: Circle): boolean {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  const combinedRadius = first.radius + second.radius;
  return dx * dx + dy * dy <= combinedRadius * combinedRadius;
}

export function clampCenter(
  value: number,
  radius: number,
  extent: number,
): number {
  return Math.min(Math.max(value, radius), extent - radius);
}
