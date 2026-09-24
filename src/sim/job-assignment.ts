import type { Pawn, World } from './types';
import { findPath } from './pathfinding';
import { needCandidates, rankCandidate, type Candidate } from './job-board';
import { Reservations } from './reservations';
import { DiagnosticLog, point } from './diagnostics';
import { foodType, freshPoints, requiresFoodSeparation } from './world';
import { COOKING_INPUT } from './definitions';

export function assignJob(
  w: World,
  pawn: Pawn,
  board: Candidate[],
  reservations: Reservations,
  grid: Uint8Array,
  retries: Map<string, number>,
  diagnostics?: DiagnosticLog,
) {
  const tier = (c: Candidate) =>
    c.work
      ? 4
      : c.kind === 'eat'
        ? w.items.find((i) => i.id === c.sourceId)?.foodType === 'meal'
          ? 0
          : 1
        : c.personalFoodPlan || c.kind === 'gather'
          ? 2
          : 3;
  const candidates = [...needCandidates(w, pawn), ...board]
    .map((c) => ({ candidate: c, rank: rankCandidate(pawn, c) }))
    .filter(
      ({ candidate, rank }) =>
        Number.isFinite(rank) &&
        (candidate.sourceKind === 'water' ||
          !candidate.sourceId ||
          w.items.some((item) => {
            if (item.id !== candidate.sourceId || item.quantity <= 1e-6) return false;
            if (item.resource !== 'food' || foodType(item) !== 'raw') return true;
            if (candidate.kind === 'separate') return requiresFoodSeparation(item);
            return (
              freshPoints(item) > 1e-6 &&
              (candidate.personalFoodPlan || !requiresFoodSeparation(item))
            );
          })) &&
        reservations.available(candidate.keys, pawn.id) &&
        (retries.get(`${pawn.id}:${candidate.keys.join(',')}`) ?? 0) <= w.tick,
    )
    .sort((a, b) => tier(a.candidate) - tier(b.candidate) || a.rank - b.rank);
  let workAttempts = 0;
  const attempted = new Set<string>();
  const feasibleStations = new Map<string, boolean>();
  for (const { candidate: c } of candidates) {
    const identity = c.keys.join(',');
    if (attempted.has(identity)) continue;
    attempted.add(identity);
    if (c.work && workAttempts++ >= 2) continue;
    if (c.kind === 'cook' && pawn.hunger < 38) {
      if (!feasibleStations.has(c.targetId!)) {
        const station = w.buildings.find((b) => b.id === c.targetId)!;
        const reachableFresh = w.items
          .filter(
            (item) =>
              item.resource === 'food' &&
              foodType(item) === 'raw' &&
              reservations.available([item.id], pawn.id) &&
              findPath(w, pawn, item, true, grid) !== null &&
              findPath(w, item, station, true, grid) !== null,
          )
          .reduce((n, item) => n + freshPoints(item), station.ingredientFresh ?? 0);
        feasibleStations.set(c.targetId!, reachableFresh >= COOKING_INPUT);
      }
      if (!feasibleStations.get(c.targetId!)) continue;
    }
    diagnostics?.record(w, 'JOB_CANDIDATE_CHOSEN', {
      entityId: pawn.id,
      entityName: pawn.name,
      targetId: c.targetId ?? c.sourceId,
      jobType: c.kind,
      position: point(pawn),
      values: { score: rankCandidate(pawn, c) },
    });
    const path = findPath(w, pawn, c.source ?? c.destination, c.adjacent, grid);
    const onward = c.source ? findPath(w, c.source, c.destination, c.adjacent, grid) : [];
    if (path === null || onward === null) {
      retries.set(`${pawn.id}:${c.keys.join(',')}`, w.tick + 100);
      diagnostics?.record(w, 'PATH_FAILED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: c.targetId ?? c.sourceId,
        jobType: c.kind,
        reason: 'unreachable',
        position: point(pawn),
      });
      diagnostics?.record(w, 'JOB_RETRY_COOLDOWN', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: c.targetId ?? c.sourceId,
        jobType: c.kind,
        reason: 'unreachable',
        values: { untilTick: w.tick + 100 },
      });
      continue;
    }
    if (!reservations.claim(c.keys, pawn.id)) {
      diagnostics?.record(w, 'RESERVATION_DENIED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: c.targetId ?? c.sourceId,
        jobType: c.kind,
        reason: 'owned by another entity',
      });
      continue;
    }
    pawn.job = {
      kind: c.kind,
      sourceId: c.sourceId,
      sourceKind: c.sourceKind,
      targetId: c.targetId,
      destination: { x: c.destination.x, y: c.destination.y },
      path,
      phase: c.source ? 'source' : 'target',
      progress: 0,
      keys: c.keys,
      amount: c.amount,
      personalFoodPlan: c.personalFoodPlan || (c.kind === 'cook' && pawn.hunger < 38),
      cookTransactionId: c.kind === 'cook' ? `${pawn.id}:${c.targetId}:${w.tick}` : undefined,
    };
    if (c.kind === 'cook') {
      const station = w.buildings.find((b) => b.id === c.targetId);
      if (station) station.reservedBy = pawn.id;
    }
    if (!c.work)
      diagnostics?.record(w, 'FOOD_SELFCARE_EVALUATED', {
        entityId: pawn.id,
        values: {
          hunger: pawn.hunger,
          selectedPlan: c.kind,
          preparedMealAvailable: c.kind === 'eat' && tier(c) === 0,
          emergencyFoodAvailable: tier(c) === 0 ? null : c.kind === 'eat' && tier(c) === 1,
          cookingFeasible: c.kind === 'cook' ? true : null,
        },
      });
    if (c.kind === 'eat' && tier(c) === 0)
      diagnostics?.record(w, 'FOOD_PLAN_MEAL_SELECTED', {
        entityId: pawn.id,
        targetId: c.sourceId,
        values: { hunger: pawn.hunger, pathCost: path.length },
      });
    diagnostics?.record(w, 'JOB_ASSIGNED', {
      entityId: pawn.id,
      entityName: pawn.name,
      targetId: c.targetId ?? c.sourceId,
      jobType: c.kind,
      phase: pawn.job.phase,
      position: point(pawn),
    });
    if (c.kind === 'eat')
      diagnostics?.record(w, 'FOOD_PLAN_EAT_SELECTED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: c.sourceId,
        jobType: 'eat',
        phase: 'eat',
        position: point(pawn),
      });
    if (c.kind === 'cook')
      diagnostics?.record(w, 'FOOD_PLAN_COOK_SELECTED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: c.targetId,
        jobType: 'cook',
        position: point(pawn),
      });
    if (c.kind === 'separate')
      diagnostics?.record(w, 'FOOD_SEPARATION_REQUIRED', {
        entityId: pawn.id,
        entityName: pawn.name,
        targetId: c.sourceId,
        jobType: 'separate',
        position: point(pawn),
      });
    return;
  }
}
