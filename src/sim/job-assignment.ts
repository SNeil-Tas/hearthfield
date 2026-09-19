import type { Pawn, World } from './types';
import { findPath } from './pathfinding';
import { needCandidates, rankCandidate, type Candidate } from './job-board';
import { Reservations } from './reservations';
import { DiagnosticLog, point } from './diagnostics';

export function assignJob(
  w: World,
  pawn: Pawn,
  board: Candidate[],
  reservations: Reservations,
  grid: Uint8Array,
  retries: Map<string, number>,
  diagnostics?: DiagnosticLog,
) {
  const candidates = [...needCandidates(w, pawn), ...board]
    .map((c) => ({ candidate: c, rank: rankCandidate(pawn, c) }))
    .filter(
      ({ candidate, rank }) =>
        Number.isFinite(rank) &&
        (!candidate.sourceId ||
          w.items.some(
            (item) =>
              item.id === candidate.sourceId &&
              item.quantity > 1e-6 &&
              (candidate.kind !== 'cook' ||
                item.freshPoints === undefined ||
                item.freshPoints >= 1),
          )) &&
        reservations.available(candidate.keys, pawn.id) &&
        (retries.get(`${pawn.id}:${candidate.keys.join(',')}`) ?? 0) <= w.tick,
    )
    .sort((a, b) => a.rank - b.rank);
  // Solid item clutter creates more unreachable logistics candidates. Keep the
  // bounded scan small so a congested map cannot turn assignment into a full
  // world search every second.
  for (const { candidate: c } of candidates.slice(0, 2)) {
    diagnostics?.record(w, 'JOB_CANDIDATE_CHOSEN', {
      entityId: pawn.id,
      entityName: pawn.name,
      targetId: c.targetId ?? c.sourceId,
      jobType: c.kind,
      position: point(pawn),
      values: { score: rankCandidate(pawn, c) },
    });
    const path = findPath(
      w,
      pawn,
      c.source ?? c.destination,
      c.source ? c.adjacent : c.adjacent,
      grid,
    );
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
      targetId: c.targetId,
      destination: { x: c.destination.x, y: c.destination.y },
      path,
      phase: c.source ? 'source' : 'target',
      progress: 0,
      keys: c.keys,
      amount: c.amount,
    };
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
