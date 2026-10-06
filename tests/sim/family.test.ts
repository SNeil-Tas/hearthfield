import { describe, expect, it } from 'vitest';
import { checksum, decode, encode, validateWorld } from '../../src/persistence/serialization';
import { DAY_TICKS } from '../../src/sim/definitions';
import {
  advanceFamilies,
  assignCareJob,
  BIRTH_SPACING_TICKS,
  canPartner,
  GESTATION_TICKS,
  updateChildNeeds,
} from '../../src/sim/family';
import { generateWorld } from '../../src/sim/generate';
import {
  agingMovementMultiplier,
  agingProgress,
  agingWorkMultiplier,
  isAdult,
  lifeStage,
  lifeStageScale,
  YEAR_TICKS,
} from '../../src/sim/health';
import { assignJob } from '../../src/sim/job-assignment';
import { advanceJob, interruptJob } from '../../src/sim/jobs';
import { updateNeeds } from '../../src/sim/needs';
import { navigationGrid } from '../../src/sim/pathfinding';
import { ensureRelationships, relationshipBetween } from '../../src/sim/relationships';
import { Reservations } from '../../src/sim/reservations';
import { Simulation } from '../../src/sim/simulation';
import { roomTopology } from '../../src/sim/topology';
import { dropFood, nextId, resourceTotal } from '../../src/sim/world';
import { flatWorld } from './fixtures';

function couple() {
  const w = flatWorld();
  const [father, mother] = w.pawns;
  father!.sex = 'male';
  mother!.sex = 'female';
  father!.orientation = mother!.orientation = 'heterosexual';
  father!.ageTicks = mother!.ageTicks = 25 * YEAR_TICKS;
  ensureRelationships(w);
  for (const [a, b] of [
    [father!, mother!],
    [mother!, father!],
  ] as const) {
    const r = relationshipBetween(a, b.id)!;
    r.opinion = r.familiarity = 90;
    r.tier = 'close-friend';
  }
  return { w, father: father!, mother: mother! };
}
function room(w: ReturnType<typeof flatWorld>) {
  for (let x = 7; x <= 10; x++)
    for (let y = 2; y <= 6; y++)
      if (x === 7 || x === 10 || y === 2 || y === 6)
        w.buildings.push({
          id: nextId(w, 'building'),
          x,
          y,
          kind: x === 7 && y === 4 ? 'door' : 'wall',
        });
  roomTopology(w).invalidate('test room');
}

describe('families and life stages', () => {
  it('starts 15 healthy adults on distinct walkable tiles with scaled food', () => {
    const w = generateWorld(42),
      grid = navigationGrid(w);
    expect(w.pawns).toHaveLength(15);
    expect(new Set(w.pawns.map((p) => `${p.x},${p.y}`)).size).toBe(15);
    expect(
      w.pawns.every((p) => isAdult(p) && p.hunger > 50 && p.rest > 50 && grid[p.y * w.width + p.x]),
    ).toBe(true);
    expect(resourceTotal(w, 'food')).toBe(240);
    new Simulation(w);
    expect(() => validateWorld(w)).not.toThrow();
  });
  it('forms mutual adult partnerships, including same-sex compatible partners', () => {
    const { w, father, mother } = couple();
    w.tick = 300;
    advanceFamilies(w);
    expect(father.partnerId).toBe(mother.id);
    expect(mother.partnerId).toBe(father.id);
    father.partnerId = mother.partnerId = undefined;
    father.sex = 'female';
    father.orientation = mother.orientation = 'homosexual';
    advanceFamilies(w);
    expect(mother.partnerId).toBe(father.id);
    for (let day = 1; day < 100; day++) {
      w.tick = day * DAY_TICKS;
      advanceFamilies(w);
    }
    expect(w.pawns).toHaveLength(3);
    expect(mother.pregnancy).toBeUndefined();
  });
  it('excludes minors, incompatible attraction, existing partners, and close relatives', () => {
    const { father, mother } = couple();
    expect(canPartner(father, mother)).toBe(true);
    mother.ageTicks = 17 * YEAR_TICKS;
    expect(canPartner(father, mother)).toBe(false);
    mother.ageTicks = 25 * YEAR_TICKS;
    mother.orientation = 'homosexual';
    expect(canPartner(father, mother)).toBe(false);
    mother.orientation = 'heterosexual';
    father.partnerId = 'pawn-999';
    expect(canPartner(father, mother)).toBe(false);
    father.partnerId = undefined;
    father.ancestorIds = mother.ancestorIds = ['pawn-999'];
    expect(canPartner(father, mother)).toBe(false);
  });
  it('conceives deterministically, waits for gestation, and births one dependent child', () => {
    const { w, father, mother } = couple();
    w.tick = 300;
    advanceFamilies(w);
    for (let day = 1; day <= 100 && !mother.pregnancy; day++) {
      w.tick = day * DAY_TICKS;
      advanceFamilies(w);
    }
    expect(mother.pregnancy).toBeDefined();
    const due = mother.pregnancy!.dueAt;
    expect(due - mother.pregnancy!.conceivedAt).toBe(GESTATION_TICKS);
    w.tick = due - 1;
    advanceFamilies(w);
    expect(w.pawns).toHaveLength(3);
    w.tick = due;
    advanceFamilies(w);
    const child = w.pawns.at(-1)!;
    expect(w.pawns).toHaveLength(4);
    expect(child.parentIds).toEqual([mother.id, father.id]);
    expect(lifeStage(child)).toBe('infancy');
    expect(child.caregiverId).toBe(mother.id);
    expect(mother.nextConceptionAt).toBe(due + BIRTH_SPACING_TICKS);
    expect(mother.pregnancy).toBeUndefined();
    advanceFamilies(w);
    expect(w.pawns).toHaveLength(4);
    w.weatherUntil = w.tick + 1800;
    expect(decode(encode(w)).world.pawns.at(-1)!.parentIds).toEqual(child.parentIds);
  });
  it('crosses every life stage and allows work only at adulthood', () => {
    const w = flatWorld(),
      p = w.pawns[0]!,
      reservations = new Reservations();
    for (const [age, stage] of [
      [0, 'infancy'],
      [2, 'early-childhood'],
      [10, 'pubescence'],
      [14, 'post-pubescence'],
      [18, 'adulthood'],
    ] as const) {
      p.ageTicks = age * YEAR_TICKS;
      expect(lifeStage(p)).toBe(stage);
      expect(isAdult(p)).toBe(age >= 18);
      if (age < 18) {
        p.hunger = 1;
        assignJob(w, p, [], reservations, navigationGrid(w), new Map());
        expect(p.job).toBeNull();
      }
    }
    p.ageTicks = 18 * YEAR_TICKS - 10;
    w.tick = 9;
    new Simulation(w).step();
    expect(isAdult(p)).toBe(true);
    expect(w.events.some((e) => e.text.includes('reached adulthood'))).toBe(true);
  });
  it('physically fetches food, cares for an infant, and brings them indoors', () => {
    const w = flatWorld();
    w.pawns = w.pawns.slice(0, 2);
    const [adult, child] = w.pawns;
    child!.ageTicks = 0;
    child!.hunger = 20;
    child!.care = 10;
    child!.x = 5;
    room(w);
    dropFood(w, { x: 3, y: 5 }, 3, 'meal');
    const sim = new Simulation(w);
    for (let i = 0; i < 350; i++) sim.step();
    expect(child!.hunger).toBeGreaterThan(60);
    expect(child!.care).toBeGreaterThan(60);
    expect(child!.caregiverId).toBe(adult!.id);
    expect(roomTopology(w).isIndoors(child!)).toBe(true);
    expect(resourceTotal(w, 'food')).toBe(2);
    expect(child!.job).toBeNull();
    expect(() => validateWorld(w)).not.toThrow();
  });
  it('does not care or feed through walls, and releases food on interruption', () => {
    const w = flatWorld();
    w.pawns = w.pawns.slice(0, 2);
    const [adult, child] = w.pawns;
    child!.ageTicks = 0;
    child!.hunger = 20;
    child!.care = 0;
    child!.x = 8;
    for (let y = 0; y < w.height; y++)
      w.buildings.push({ id: nextId(w, 'building'), kind: 'wall', x: 6, y });
    dropFood(w, adult!, 3, 'meal');
    const reservations = new Reservations();
    expect(assignCareJob(w, adult!, reservations, navigationGrid(w))).toBe(false);
    expect(child!.care).toBe(0);
    expect(resourceTotal(w, 'food')).toBe(3);
    w.buildings = [];
    roomTopology(w).invalidate('wall removed');
    const grid = navigationGrid(w);
    expect(assignCareJob(w, adult!, reservations, grid)).toBe(true);
    for (let i = 0; i < 20 && !adult!.carrying; i++) advanceJob(w, adult!, reservations, grid);
    expect(adult!.carrying?.quantity).toBe(1);
    interruptJob(w, adult!, reservations);
    expect(resourceTotal(w, 'food')).toBe(3);
    expect(reservations.available([`care:${child!.id}`], 'someone')).toBe(true);
  });
  it('sorts partially spoiled food before feeding and leaves adults free to gather when food is absent', () => {
    const w = flatWorld();
    w.pawns = w.pawns.slice(0, 2);
    const adult = w.pawns[0]!,
      child = w.pawns[1]!;
    child.ageTicks = 0;
    child.hunger = 20;
    child.care = 100;
    const reservations = new Reservations(),
      grid = navigationGrid(w);
    expect(assignCareJob(w, adult, reservations, grid)).toBe(false);
    dropFood(w, adult, 4, 'raw');
    const food = w.items[0]!;
    food.quantity = 5;
    food.freshPoints = 4;
    food.spoiledPoints = 1;
    expect(assignCareJob(w, adult, reservations, grid)).toBe(true);
    for (let i = 0; i < 200 && adult.job; i++) advanceJob(w, adult, reservations, grid);
    expect(child.hunger).toBe(85);
    expect(
      w.items
        .filter((i) => i.resource === 'food')
        .reduce((sum, i) => sum + (i.freshPoints ?? 0), 0),
    ).toBe(3);
    expect(resourceTotal(w, 'waste')).toBe(1);
  });
  it('preserves a pending pregnancy through saves and births after the other parent dies', () => {
    const { w, father, mother } = couple();
    mother.partnerId = father.id;
    father.partnerId = mother.id;
    mother.pregnancy = { partnerId: father.id, conceivedAt: 0, dueAt: GESTATION_TICKS };
    const loaded = decode(encode(w)).world;
    expect(loaded.pawns[1]!.pregnancy).toEqual(mother.pregnancy);
    loaded.pawns[0]!.health = 0;
    new Simulation(loaded).step();
    loaded.tick = GESTATION_TICKS;
    advanceFamilies(loaded);
    expect(loaded.pawns.at(-1)!.parentIds).toContain(father.id);
    expect(loaded.pawns.at(-1)!.ageTicks).toBe(0);
  });
  it('makes shelter and care functional health requirements throughout childhood', () => {
    const w = flatWorld(),
      child = w.pawns[0]!;
    room(w);
    for (const age of [0, 5, 12, 16]) {
      child.ageTicks = age * YEAR_TICKS;
      child.health = 100;
      child.care = 0;
      for (let i = 0; i < 50; i++) {
        updateNeeds(w, child);
        updateChildNeeds(w, child);
      }
      expect(child.health).toBeLessThan(100);
    }
    child.x = 8;
    child.y = 4;
    child.care = 100;
    child.hunger = child.rest = 100;
    const before = child.health;
    updateNeeds(w, child);
    updateChildNeeds(w, child);
    expect(child.health).toBeGreaterThan(before);
  });
  it('reassigns orphans and clears dead partners while retaining ancestry', () => {
    const { w, father, mother } = couple();
    mother.partnerId = father.id;
    father.partnerId = mother.id;
    const child = w.pawns[2]!;
    child.ageTicks = 0;
    child.parentIds = child.ancestorIds = [father.id];
    child.caregiverId = father.id;
    child.care = 0;
    father.health = 0;
    const sim = new Simulation(w);
    for (let i = 0; i < 150; i++) sim.step();
    expect(mother.partnerId).toBeUndefined();
    expect(child.caregiverId).toBe(mother.id);
    expect(child.ancestorIds).toContain(father.id);
    expect(child.care).toBeGreaterThan(0);
  });
  it('progressively changes appearance, work, and movement from age 55, with an adjustable onset', () => {
    const p = flatWorld().pawns[0]!;
    p.ageTicks = 55 * YEAR_TICKS;
    expect(agingProgress(p)).toBe(0);
    p.ageTicks = 65 * YEAR_TICKS;
    const middle = agingWorkMultiplier(p);
    expect(middle).toBeLessThan(1);
    expect(agingMovementMultiplier(p)).toBeLessThan(1);
    p.ageTicks = 85 * YEAR_TICKS;
    expect(agingWorkMultiplier(p)).toBeLessThan(middle);
    p.agingOnsetYears = 90;
    expect(agingProgress(p)).toBe(0);
    p.ageTicks = 0;
    expect(lifeStageScale(p)).toBeLessThan(1);
  });
  it('migrates old saves without growing the population and rejects malformed new family state', () => {
    const w = flatWorld();
    new Simulation(w);
    const raw = JSON.parse(encode(w).payload);
    for (const p of raw.pawns)
      for (const key of [
        'sex',
        'orientation',
        'agingOnsetYears',
        'parentIds',
        'ancestorIds',
        'care',
        'nextConceptionAt',
      ])
        delete p[key];
    const payload = JSON.stringify(raw);
    const loaded = decode({ version: 8, payload, checksum: checksum(payload), savedAt: 1 }).world;
    expect(loaded.pawns).toHaveLength(3);
    expect(loaded.pawns.every((p) => p.agingOnsetYears === 55)).toBe(true);
    expect(() => decode({ version: 9, payload, checksum: checksum(payload), savedAt: 1 })).toThrow(
      'family',
    );
    loaded.pawns[0]!.partnerId = loaded.pawns[1]!.id;
    expect(() => validateWorld(loaded)).toThrow('partnership');
  });
});
