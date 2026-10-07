import { describe, expect, it } from 'vitest';
import { checksum, decode, encode, validateWorld } from '../../src/persistence/serialization';
import { DAY_TICKS } from '../../src/sim/definitions';
import { generateWorld } from '../../src/sim/generate';
import { assignJob } from '../../src/sim/job-assignment';
import { rankCandidate, type Candidate } from '../../src/sim/job-board';
import { advanceJob } from '../../src/sim/jobs';
import { shouldInterrupt, updateNeeds } from '../../src/sim/needs';
import { navigationGrid } from '../../src/sim/pathfinding';
import {
  createPsychology,
  EMOTIONAL_NEEDS,
  memoryEffect,
  MEMORY_LIMIT,
  psychologicalMood,
  recordConversation,
  recordLoss,
  remember,
  sharesSocialSpace,
  updatePsychology,
} from '../../src/sim/psychology';
import {
  advancePsychologicalCare,
  psychologicalCareCandidates,
} from '../../src/sim/psychology-care';
import { ensureRelationships } from '../../src/sim/relationships';
import { Reservations } from '../../src/sim/reservations';
import { Simulation } from '../../src/sim/simulation';
import { flatWorld } from './fixtures';

describe('psychological profiles', () => {
  it('generates distinct, deterministic identities without tying traits to sex or skills', () => {
    const world = generateWorld(72),
      replay = generateWorld(72);
    expect(world.pawns.map((p) => p.psychology)).toEqual(replay.pawns.map((p) => p.psychology));
    expect(new Set(world.pawns.map((p) => JSON.stringify(p.psychology.traits))).size).toBe(15);
    expect(createPsychology(72, 'pawn-1')).not.toEqual(createPsychology(72, 'pawn-2'));
  });

  it('makes outgoing colonists lose belonging faster and reserved colonists tire of crowds', () => {
    const w = flatWorld();
    const outgoing = w.pawns[0]!,
      reserved = w.pawns[1]!;
    w.pawns.push({ ...structuredClone(w.pawns[2]!), id: 'pawn-999' });
    outgoing.psychology = createPsychology(42, 'same');
    reserved.psychology = createPsychology(42, 'same');
    outgoing.psychology.traits.sociability = 100;
    reserved.psychology.traits.sociability = 0;
    for (let i = 0; i < 100; i++) {
      updatePsychology(w, outgoing);
      updatePsychology(w, reserved);
    }
    expect(outgoing.psychology.needs.belonging).toBeLessThan(reserved.psychology.needs.belonging);
    expect(reserved.psychology.needs.privacy).toBeLessThan(outgoing.psychology.needs.privacy);
  });

  it('counts nearby colonists as a crowd only when they share the same room', () => {
    const w = flatWorld();
    const rows = ['#######', '#..#..#', '#..D..#', '#..#..#', '#######'];
    for (const [y, row] of rows.entries())
      for (const [x, tile] of [...row].entries())
        if (tile === '#' || tile === 'D')
          w.buildings.push({
            id: `privacy-wall-${x}-${y}`,
            x: x + 1,
            y: y + 1,
            kind: tile === 'D' ? 'door' : 'wall',
          });
    const resting = w.pawns[0]!;
    w.pawns.push({ ...structuredClone(w.pawns[1]!), id: 'privacy-neighbour' });
    resting.x = 3;
    resting.y = 3;
    for (const [index, pawn] of w.pawns.slice(1).entries()) {
      pawn.x = 5 + (index % 2);
      pawn.y = 2 + Math.floor(index / 2);
      expect(sharesSocialSpace(w, resting, pawn)).toBe(false);
    }
    const before = resting.psychology.needs.privacy;
    for (let i = 0; i < 100; i++) updatePsychology(w, resting);
    expect(resting.psychology.needs.privacy).toBeGreaterThan(before);
    for (const [index, pawn] of w.pawns.slice(1).entries()) {
      pawn.x = 2 + (index % 2);
      pawn.y = 2 + Math.floor(index / 2);
      expect(sharesSocialSpace(w, resting, pawn)).toBe(true);
    }
    for (let i = 0; i < 100; i++) updatePsychology(w, resting);
    expect(resting.psychology.needs.privacy).toBeLessThan(before + 10);
  });

  it('builds stress gradually, makes resilience matter, and recovers with hysteresis', () => {
    const w = flatWorld(),
      fragile = w.pawns[0]!,
      resilient = w.pawns[1]!;
    for (const pawn of [fragile, resilient]) {
      pawn.psychology = createPsychology(42, 'same');
      pawn.psychology.stress = 0;
      pawn.hunger = pawn.rest = 5;
    }
    fragile.psychology.traits.resilience = 0;
    resilient.psychology.traits.resilience = 100;
    for (let i = 0; i < 550; i++)
      for (const pawn of [fragile, resilient]) {
        for (const need of EMOTIONAL_NEEDS) pawn.psychology.needs[need] = 0;
        updatePsychology(w, pawn);
      }
    expect(fragile.psychology.stress).toBeGreaterThan(resilient.psychology.stress);
    expect(fragile.psychology.overwhelmed).toBe(true);
    fragile.psychology.stress = 60;
    fragile.hunger = fragile.rest = 100;
    for (const need of EMOTIONAL_NEEDS) fragile.psychology.needs[need] = 100;
    updatePsychology(w, fragile);
    expect(fragile.psychology.overwhelmed).toBe(true);
    for (let i = 0; i < 400; i++) updatePsychology(w, fragile);
    expect(fragile.psychology.stress).toBeLessThan(40);
    expect(fragile.psychology.overwhelmed).toBe(false);
  });

  it('keeps experiences bounded, refreshes duplicates and fades memories to zero', () => {
    const w = flatWorld(),
      p = w.pawns[0]!;
    for (let i = 0; i < 30; i++) remember(w, p, 'meal', 'Warm meal', 3, 100);
    expect(p.psychology.memories).toHaveLength(1);
    expect(memoryEffect(p.psychology.memories[0]!, 50)).toBe(1.5);
    w.tick = 100;
    updatePsychology(w, p);
    expect(p.psychology.memories).toHaveLength(0);
    remember(w, p, 'loss', 'A lasting loss', -16, DAY_TICKS * 4);
    for (let i = 0; i < 30; i++) remember(w, p, `event:${i}`, 'Small moment', 2);
    expect(p.psychology.memories).toHaveLength(MEMORY_LIMIT);
    expect(p.psychology.memories.some((m) => m.key === 'loss')).toBe(true);
    expect(psychologicalMood(w, p)).toBeLessThanOrEqual(20);
  });

  it('seeks real company and cannot satisfy a social need from an absent target', () => {
    const w = flatWorld(),
      p = w.pawns[0]!,
      other = w.pawns[1]!;
    ensureRelationships(w);
    p.psychology.needs.belonging = 0;
    const reservations = new Reservations(),
      grid = navigationGrid(w);
    assignJob(w, p, [], reservations, grid, new Map());
    expect(p.job?.copingActivity).toBe('company');
    p.job!.targetId = other.id;
    p.job!.path = [];
    p.job!.progress = 30;
    other.x = 11;
    other.y = 11;
    expect(advancePsychologicalCare(w, p)).toBe('cancel');
    expect(p.psychology.needs.belonging).toBe(0);
    other.x = p.x + 1;
    other.y = p.y;
    expect(advancePsychologicalCare(w, p)).toBe('complete');
    expect(p.psychology.needs.belonging).toBeGreaterThan(20);
    expect(other.psychology.memories.some((m) => m.key === 'conversation')).toBe(true);
  });

  it('takes finite recreation breaks, releases claims and respects the cooldown', () => {
    const w = flatWorld(),
      p = w.pawns[0]!;
    w.pawns = [p];
    p.psychology.needs.recreation = 0;
    const reservations = new Reservations(),
      grid = navigationGrid(w);
    assignJob(w, p, [], reservations, grid, new Map());
    expect(p.job?.copingActivity).toBe('recreation');
    const key = p.job!.keys[0]!;
    for (let i = 0; i < 450; i++) {
      w.tick++;
      advanceJob(w, p, reservations, grid);
    }
    expect(p.job).toBeNull();
    expect(p.psychology.needs.recreation).toBeGreaterThan(45);
    expect(reservations.available([key], 'another')).toBe(true);
    expect(psychologicalCareCandidates(w, p, grid)).toHaveLength(0);
  });

  it('does not choose unreachable breaks and lets hunger interrupt recreation', () => {
    const w = flatWorld(),
      p = w.pawns[0]!;
    w.pawns = [p];
    p.psychology.needs.recreation = 0;
    const grid = navigationGrid(w);
    assignJob(w, p, [], new Reservations(), grid, new Map());
    expect(p.job?.kind).toBe('relax');
    p.hunger = 37;
    expect(shouldInterrupt(p)).toBe(true);
    expect(psychologicalCareCandidates(w, p, grid)).toHaveLength(0);
    p.hunger = 100;
    p.job = null;
    p.psychology.nextCopingAt = 0;
    grid.fill(0);
    assignJob(w, p, [], new Reservations(), grid, new Map());
    expect(p.job).toBeNull();
  });

  it('gives preferred work a modest advantage while preserving disabled priorities', () => {
    const p = flatWorld().pawns[0]!;
    p.psychology.preferredWork = 'build';
    const c: Candidate = {
      kind: 'build',
      work: 'build',
      destination: p,
      adjacent: true,
      keys: ['test'],
      score: 0,
    };
    const preferred = rankCandidate(p, c);
    p.psychology.preferredWork = 'cook';
    expect(preferred).toBeLessThan(rankCandidate(p, c));
    p.priorities.build = 0;
    expect(rankCandidate(p, c)).toBe(Infinity);
  });

  it('makes care support children without giving them adult leisure jobs', () => {
    const w = flatWorld(),
      child = w.pawns[0]!;
    child.ageTicks = 0;
    child.care = 100;
    const before = child.psychology.needs.belonging;
    updatePsychology(w, child);
    expect(child.psychology.needs.belonging).toBeGreaterThan(before);
    child.psychology.needs.recreation = 0;
    expect(psychologicalCareCandidates(w, child, navigationGrid(w))).toHaveLength(0);
  });

  it('remembers a loved one after the deceased and their relationship are removed', () => {
    const w = flatWorld(),
      p = w.pawns[0]!,
      loved = w.pawns[1]!;
    ensureRelationships(w);
    p.parentIds = [loved.id];
    recordLoss(w, loved);
    w.pawns = w.pawns.filter((other) => other.id !== loved.id);
    ensureRelationships(w);
    expect(p.psychology.memories.find((m) => m.key === `loss:${loved.id}`)?.impact).toBe(-16);
    expect(p.psychology.needs.belonging).toBe(47);
  });

  it('lets positive company soothe stress and negative encounters leave a thought', () => {
    const w = flatWorld(),
      p = w.pawns[0]!,
      other = w.pawns[1]!;
    p.psychology.stress = 30;
    recordConversation(w, p, other, 2);
    expect(p.psychology.stress).toBeLessThan(30);
    recordConversation(w, p, other, -2);
    expect(p.psychology.memories.some((m) => m.key === 'argument' && m.impact < 0)).toBe(true);
  });

  it('round-trips needs, stress, traits, cooldowns and memories and deterministically migrates v10', () => {
    const w = flatWorld();
    ensureRelationships(w);
    const p = w.pawns[0]!;
    p.psychology.stress = 82;
    p.psychology.overwhelmed = true;
    p.psychology.nextCopingAt = 500;
    remember(w, p, 'test', 'Remembered experience', -5);
    expect(decode(encode(w)).world.pawns[0]!.psychology).toEqual(p.psychology);
    const legacy = structuredClone(w) as any;
    for (const pawn of legacy.pawns) {
      delete pawn.psychology;
      pawn.moodBias = -300;
    }
    const payload = JSON.stringify(legacy);
    const envelope = { version: 10, savedAt: 1, payload, checksum: checksum(payload) };
    const first = decode(envelope).world,
      second = decode(envelope).world;
    expect(first.pawns[0]!.psychology).toEqual(second.pawns[0]!.psychology);
    expect(first.pawns[0]!.moodBias).toBe(-15);
    updateNeeds(first, first.pawns[0]!);
    expect(first.pawns[0]!.moodBias).toBeGreaterThan(-15);
  });

  it.each(['trait', 'need', 'stress', 'memory', 'missing'])(
    'rejects corrupt current psychological data: %s',
    (part) => {
      const w = flatWorld();
      ensureRelationships(w);
      const p = w.pawns[0]!.psychology;
      if (part === 'trait') p.traits.empathy = 101;
      if (part === 'need') p.needs.comfort = -1;
      if (part === 'stress') p.stress = NaN;
      if (part === 'memory')
        p.memories.push({ key: 'bad', text: 'bad', impact: -3, createdAt: 0, expiresAt: 0 });
      if (part === 'missing') delete (w.pawns[0] as any).psychology;
      expect(() => decode(encode(w))).toThrow();
    },
  );

  it('keeps a deterministic simulation bounded over a full day', () => {
    const a = flatWorld(),
      b = structuredClone(a);
    const first = new Simulation(a),
      second = new Simulation(b);
    for (let i = 0; i < DAY_TICKS; i++) {
      first.step();
      second.step();
    }
    expect(a).toEqual(b);
    for (const pawn of a.pawns) {
      expect(pawn.psychology.memories.length).toBeLessThanOrEqual(MEMORY_LIMIT);
      for (const need of EMOTIONAL_NEEDS)
        expect(pawn.psychology.needs[need]).toBeGreaterThanOrEqual(0);
    }
    expect(() => validateWorld(a)).not.toThrow();
  });
});
