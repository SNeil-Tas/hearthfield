import { rankCandidate, resolveCandidateForPawn, type Candidate } from './job-board';
import type { Pawn, PostedJob, World } from './types';
import { distance, nextId } from './world';
import type { Reservations } from './reservations';

export const JOB_POST_LIMIT = 30;
export const JOB_NOTICE_RANGE = 16;
export const JOB_POST_COOLDOWN = 60;

export function candidatePostKey(candidate: Candidate) {
  return [
    candidate.kind,
    candidate.sourceId ?? '',
    candidate.targetId ?? '',
    Math.round(candidate.destination.x),
    Math.round(candidate.destination.y),
  ].join(':');
}

export function synchronizeJobPosts(world: World, candidates: readonly Candidate[]) {
  const available = new Set(candidates.map(candidatePostKey));
  const activeClaims = new Map(
    world.pawns.flatMap((pawn) =>
      pawn.job?.postedJobId ? ([[pawn.job.postedJobId, pawn.id]] as const) : [],
    ),
  );
  world.jobPosts = world.jobPosts.filter((post) => {
    const activePawn = activeClaims.get(post.id);
    if (activePawn) {
      post.claimedBy = activePawn;
      return true;
    }
    post.claimedBy = undefined;
    return available.has(post.key);
  });
}

export function linkJobPosts(world: World, candidates: readonly Candidate[]) {
  const posts = new Map(
    world.jobPosts.filter((post) => !post.claimedBy).map((post) => [post.key, post]),
  );
  return candidates.map((candidate) => {
    const post = posts.get(candidatePostKey(candidate));
    return post ? { ...candidate, postId: post.id, score: candidate.score - 25 } : candidate;
  });
}

export function postSeenWork(
  world: World,
  pawn: Pawn,
  candidates: readonly Candidate[],
  reservations: Reservations,
) {
  if (!pawn.job || world.jobPosts.length >= JOB_POST_LIMIT) return undefined;
  const existing = new Set(world.jobPosts.map((post) => post.key));
  const candidate = candidates
    .flatMap((raw) => {
      if (!raw.work || pawn.priorities[raw.work] === 0) return [];
      if (raw.keys.some((key) => pawn.job!.keys.includes(key))) return [];
      const resolved = resolveCandidateForPawn(pawn, raw);
      if (!resolved || existing.has(candidatePostKey(raw))) return [];
      const noticePoint = resolved.source ?? resolved.destination;
      if (distance(pawn, noticePoint) > JOB_NOTICE_RANGE) return [];
      if (!reservations.available(resolved.keys, pawn.id)) return [];
      const rank = rankCandidate(pawn, resolved);
      return Number.isFinite(rank) ? [{ raw, rank }] : [];
    })
    .sort((a, b) => a.rank - b.rank)[0]?.raw;
  if (!candidate?.work) return undefined;
  const post: PostedJob = {
    id: nextId(world, 'post'),
    key: candidatePostKey(candidate),
    kind: candidate.kind,
    work: candidate.work,
    sourceId: candidate.sourceId,
    targetId: candidate.targetId,
    destination: { x: candidate.destination.x, y: candidate.destination.y },
    postedBy: pawn.id,
    postedAt: world.tick,
  };
  world.jobPosts.push(post);
  return post;
}

export function claimJobPost(world: World, postId: string | undefined, pawnId: string) {
  if (!postId) return;
  const post = world.jobPosts.find((candidate) => candidate.id === postId);
  if (post) post.claimedBy = pawnId;
}
