import type { Pawn, World, ActivityKind } from './types';
import { distance } from './world';
import { wetnessMoodPenalty } from './weather';
const costs: Record<ActivityKind, [number, number]> = {
  sleeping: [0.22, 0],
  resting: [0.32, 0.05],
  walking: [0.42, 0.12],
  'light-work': [0.55, 0.18],
  working: [0.68, 0.25],
  'heavy-work': [0.82, 0.34],
  hauling: [0.95, 0.4],
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
  const moodMetabolism = pawn.mood < 30 ? 1.22 : pawn.mood < 60 ? 1.1 : 1;
  pawn.productivity = Math.max(
    0.55,
    (pawn.mood < 30 ? 0.8 : pawn.mood < 60 ? 0.9 : 1) *
      (pawn.rest < 30 ? 0.78 : pawn.rest < 55 ? 0.92 : 1) *
      (ill ? 0.78 : 1) *
      (pawn.hunger < 35 ? 0.9 : 1),
  );
  pawn.hunger = Math.max(0, pawn.hunger - hungerCost * 0.1 * moodMetabolism);
  if (activity !== 'sleeping') pawn.rest = Math.max(0, pawn.rest - restCost * 0.1);
  if (pawn.hunger <= 0) pawn.health = Math.max(1, pawn.health - 0.25);
  else if (pawn.hunger > 55 && pawn.rest > 50) pawn.health = Math.min(100, pawn.health + 0.08);
  const nearbyRot = w.items
    .filter((item) => item.resource === 'waste' && distance(item, pawn) <= 5)
    .reduce((total, item) => total + item.quantity, 0);
  pawn.rotExposure = Math.max(
    0,
    Math.min(100, (pawn.rotExposure ?? 0) + (nearbyRot > 0 ? Math.min(6, nearbyRot / 10) : -3)),
  );
  const exposurePenalty = pawn.rotExposure >= 60 ? -4 : pawn.rotExposure >= 20 ? -2 : 0;
  const handledPenalty =
    pawn.rotHandledUntil && pawn.rotHandledUntil > w.tick ? -(pawn.rotHandledPenalty ?? 2) : 0;
  pawn.mood = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        pawn.hunger * 0.45 +
          pawn.rest * 0.4 +
          pawn.health * 0.15 +
          (pawn.moodBias ?? 0) +
          exposurePenalty +
          handledPenalty +
          wetnessMoodPenalty(pawn) +
          (ill ? -8 : 0),
      ),
    ),
  );
}
export function shouldInterrupt(pawn: Pawn) {
  if (!pawn.job) return false;
  if (
    pawn.hunger < 20 &&
    !['eat', 'gather', 'cook', 'separate'].includes(pawn.job.kind) &&
    !(pawn.job.kind === 'harvest' && pawn.job.personalFoodPlan)
  )
    return true;
  return (
    pawn.rest < 12 &&
    !['sleep', 'eat', 'gather'].includes(pawn.job.kind) &&
    !(pawn.job.kind === 'cook' && pawn.hunger < 35) &&
    pawn.hunger > 18
  );
}
