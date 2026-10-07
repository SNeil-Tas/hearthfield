import { TICK_SECONDS } from './definitions';
import { isAdult } from './health';
import type { Candidate } from './job-board';
import { needImportance, recordConversation, remember, sharesSocialSpace } from './psychology';
import { roomTopology } from './topology';
import type { CopingActivity, Pawn, World } from './types';
import { distance, inside, tileKey } from './world';

export const COPING_LABELS: Record<CopingActivity, string> = {
  company: 'Seeking company',
  recreation: 'Taking recreation',
  solitude: 'Finding quiet time',
};
export const COPING_DURATION = 30;
export const COPING_COOLDOWN = 900;

/** Optional care sits below food/rest, and uses the same path and reservation checks as work. */
export function psychologicalCareCandidates(w: World, pawn: Pawn, grid: Uint8Array): Candidate[] {
  const p = pawn.psychology;
  if (
    !isAdult(pawn) ||
    pawn.hunger < 45 ||
    pawn.rest < 40 ||
    pawn.health < 35 ||
    p.nextCopingAt > w.tick
  )
    return [];
  const choices = (['belonging', 'recreation', 'privacy'] as const)
    .map((need) => ({ need, pressure: (45 - p.needs[need]) * needImportance(pawn, need) }))
    .sort((a, b) => b.pressure - a.pressure);
  if (choices[0]!.pressure <= 10 && p.stress < 60) return [];
  const need = choices[0]!.pressure > 10 ? choices[0]!.need : 'recreation';
  const mode: CopingActivity =
    need === 'belonging' ? 'company' : need === 'privacy' ? 'solitude' : 'recreation';
  if (mode === 'company') {
    return w.pawns
      .filter(
        (other) =>
          other.id !== pawn.id &&
          other.health > 0 &&
          other.job?.kind !== 'sleep' &&
          distance(pawn, other) <= 12 &&
          (pawn.relationships.find((r) => r.targetId === other.id)?.opinion ?? 0) > -20,
      )
      .map((other): Candidate => ({
        kind: 'relax',
        copingActivity: mode,
        targetId: other.id,
        destination: { x: Math.round(other.x), y: Math.round(other.y) },
        adjacent: true,
        keys: [`company:${other.id}`],
        score:
          distance(pawn, other) -
          (pawn.relationships.find((r) => r.targetId === other.id)?.opinion ?? 0) / 8,
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 3);
  }
  const candidates: Candidate[] = [];
  const nearby = w.pawns.filter((other) => other.id !== pawn.id && distance(pawn, other) <= 16);
  const topology = roomTopology(w);
  for (let dx = -6; dx <= 6; dx += 2)
    for (let dy = -6; dy <= 6; dy += 2) {
      const point = { x: Math.round(pawn.x) + dx, y: Math.round(pawn.y) + dy };
      if (
        !inside(w, point) ||
        !grid[tileKey(w, point)] ||
        w.blueprints.some((b) => b.x === point.x && b.y === point.y)
      )
        continue;
      if (w.animals.some((a) => a.huntTargetId && distance(a, point) <= 6)) continue;
      const crowd = nearby.filter(
        (other) => distance(other, point) <= 4 && sharesSocialSpace(w, point, other),
      ).length;
      if (mode === 'solitude' && crowd > 1) continue;
      const sheltered = topology.isIndoors(point);
      candidates.push({
        kind: 'relax',
        copingActivity: mode,
        destination: point,
        adjacent: false,
        keys: [`leisure:${tileKey(w, point)}`],
        score:
          distance(pawn, point) +
          (mode === 'solitude' ? crowd * 8 : crowd) -
          (sheltered ? 4 : 0) +
          (w.weather !== 'clear' && !sheltered ? 15 : 0),
      });
    }
  return candidates.sort((a, b) => a.score - b.score).slice(0, 3);
}

/** Called only after arriving. Company cannot be satisfied by an absent or sleeping target. */
export function advancePsychologicalCare(w: World, pawn: Pawn): 'continue' | 'complete' | 'cancel' {
  const job = pawn.job!,
    p = pawn.psychology,
    mode = job.copingActivity;
  if (!mode || pawn.hunger < 38 || pawn.rest < 28) return 'cancel';
  const company =
    mode === 'company' ? w.pawns.find((other) => other.id === job.targetId) : undefined;
  if (
    mode === 'company' &&
    (!company ||
      company.health <= 0 ||
      company.job?.kind === 'sleep' ||
      !sharesSocialSpace(w, pawn, company) ||
      distance(pawn, company) > 4)
  )
    return 'cancel';
  const crowded =
    w.pawns.filter(
      (other) =>
        other.id !== pawn.id && distance(pawn, other) <= 4 && sharesSocialSpace(w, pawn, other),
    ).length > 1;
  if (mode === 'solitude' && crowded) return 'cancel';
  const need = mode === 'solitude' ? 'privacy' : 'recreation';
  if (mode !== 'company') p.needs[need] = Math.min(100, p.needs[need] + TICK_SECONDS * 1.6);
  p.stress = Math.max(0, p.stress - TICK_SECONDS * 0.3);
  if (job.progress < COPING_DURATION) return 'continue';
  if (company) {
    recordConversation(w, pawn, company, 1);
    recordConversation(w, company, pawn, 1);
    p.needs.belonging = Math.min(100, p.needs.belonging + 18);
  } else
    remember(
      w,
      pawn,
      'respite',
      mode === 'solitude' ? 'Had some space to think' : 'Enjoyed a little free time',
      3,
    );
  return 'complete';
}
