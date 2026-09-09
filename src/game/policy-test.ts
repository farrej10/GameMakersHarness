import { getEnemyVelocity, isVictory } from '@generated/rules';

if (!import.meta.env.MODE.startsWith('test')) {
  throw new Error('The policy test entry is available only in test mode.');
}

window.ruleTestApi = { getEnemyVelocity, isVictory };
