import type { Pawn } from './types';
export function updateNeeds(pawn: Pawn) {
  pawn.hunger = Math.max(0, pawn.hunger - 0.22);
  if (pawn.job?.kind !== 'sleep') pawn.rest = Math.max(0, pawn.rest - 0.14);
  if (pawn.hunger <= 0) pawn.health = Math.max(1, pawn.health - 0.25);
  else if (pawn.hunger > 55 && pawn.rest > 50) pawn.health = Math.min(100, pawn.health + 0.08);
  pawn.mood = Math.round(pawn.hunger * 0.45 + pawn.rest * 0.4 + pawn.health * 0.15);
}
export function shouldInterrupt(pawn: Pawn) {
  if (!pawn.job) return false;
  if (pawn.hunger < 18 && !['eat', 'gather'].includes(pawn.job.kind)) return true;
  return pawn.rest < 12 && !['sleep', 'eat', 'gather'].includes(pawn.job.kind) && pawn.hunger > 18;
}
