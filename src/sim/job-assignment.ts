import type { Pawn, World } from './types';
import { findPath } from './pathfinding';
import { needCandidates, rankCandidate, type Candidate } from './job-board';
import { Reservations } from './reservations';

export function assignJob(
  w: World,
  pawn: Pawn,
  board: Candidate[],
  reservations: Reservations,
  grid: Uint8Array,
  retries: Map<string, number>,
) {
  const candidates = [...needCandidates(w, pawn), ...board]
    .map((c) => ({ candidate: c, rank: rankCandidate(pawn, c) }))
    .filter(
      ({ candidate, rank }) =>
        Number.isFinite(rank) &&
        reservations.available(candidate.keys, pawn.id) &&
        (retries.get(`${pawn.id}:${candidate.keys.join(',')}`) ?? 0) <= w.tick,
    )
    .sort((a, b) => a.rank - b.rank);
  for (const { candidate: c } of candidates.slice(0, 24)) {
    const path = findPath(w, pawn, c.source ?? c.destination, c.source ? false : c.adjacent, grid);
    const onward = c.source ? findPath(w, c.source, c.destination, c.adjacent, grid) : [];
    if (path === null || onward === null) {
      retries.set(`${pawn.id}:${c.keys.join(',')}`, w.tick + 100);
      continue;
    }
    if (!reservations.claim(c.keys, pawn.id)) continue;
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
    return;
  }
}
