import type { Pawn, World, ActivityKind } from './types';
const costs: Record<ActivityKind, [number, number]> = {
  sleeping: [0.16, 0],
  resting: [0.22, 0.05],
  walking: [0.28, 0.12],
  'light-work': [0.34, 0.18],
  working: [0.42, 0.25],
  'heavy-work': [0.52, 0.34],
  hauling: [0.6, 0.4],
};
export function updateNeeds(w: World, pawn: Pawn) {
  const kind = pawn.job?.kind;
  const activity: ActivityKind = pawn.carrying
    ? 'hauling'
    : kind === 'sleep'
      ? 'sleeping'
      : !kind
        ? 'resting'
        : ['build', 'deconstruct', 'chop'].includes(kind)
          ? 'heavy-work'
          : ['gather', 'harvest', 'sow', 'cook'].includes(kind)
            ? 'working'
            : 'walking';
  const [hungerCost, restCost] = costs[activity];
  const ill = pawn.illnessUntil !== undefined && pawn.illnessUntil > w.tick;
  pawn.activity = activity;
  pawn.productivity = Math.max(
    0.55,
    (pawn.hunger < 35 ? 0.9 : 1) *
      (pawn.rest < 30 ? 0.78 : pawn.rest < 55 ? 0.92 : 1) *
      (ill ? 0.78 : 1) *
      (pawn.mood < 35 ? 0.92 : 1),
  );
  pawn.hunger = Math.max(0, pawn.hunger - hungerCost * 0.1);
  if (activity !== 'sleeping') pawn.rest = Math.max(0, pawn.rest - restCost * 0.1);
  if (pawn.hunger <= 0) pawn.health = Math.max(1, pawn.health - 0.25);
  else if (pawn.hunger > 55 && pawn.rest > 50) pawn.health = Math.min(100, pawn.health + 0.08);
  pawn.mood = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        pawn.hunger * 0.45 +
          pawn.rest * 0.4 +
          pawn.health * 0.15 +
          (pawn.moodBias ?? 0) +
          (ill ? -8 : 0),
      ),
    ),
  );
}
export function shouldInterrupt(pawn: Pawn) {
  if (!pawn.job) return false;
  if (pawn.hunger < 18 && !['eat', 'gather'].includes(pawn.job.kind)) return true;
  return pawn.rest < 12 && !['sleep', 'eat', 'gather'].includes(pawn.job.kind) && pawn.hunger > 18;
}
