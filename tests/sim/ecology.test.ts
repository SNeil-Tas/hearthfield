import { describe, expect, it } from 'vitest';
import { checksum, decode, encode } from '../../src/persistence/serialization';
import { DiagnosticLog } from '../../src/sim/diagnostics';
import { ANIMALS, advanceEcology, animalStage, ecosystemCounts } from '../../src/sim/ecology';
import { generateWorld } from '../../src/sim/generate';
import { findPath } from '../../src/sim/pathfinding';
import type { Animal } from '../../src/sim/types';
import { nextId } from '../../src/sim/world';
import { flatWorld } from './fixtures';

const animal = (
  world: ReturnType<typeof flatWorld>,
  species: Animal['species'],
  x: number,
  y: number,
  overrides: Partial<Animal> = {},
): Animal => ({
  id: nextId(world, 'animal'),
  species,
  sex: 'female',
  x,
  y,
  ageTicks: ANIMALS[species].maturityTicks,
  energy: 70,
  health: ANIMALS[species].maxHealth,
  state: 'roaming',
  nextMoveAt: world.tick,
  nextBreedAt: world.tick + 1000,
  nextAttackAt: world.tick,
  ...overrides,
});

describe('wildlife ecology', () => {
  it('seeds four herbivores and two predators deterministically', () => {
    const first = generateWorld(441);
    const second = generateWorld(441);
    expect(first.animals).toEqual(second.animals);
    expect(Object.keys(ecosystemCounts(first))).toEqual([
      'rabbit',
      'deer',
      'boar',
      'bison',
      'fox',
      'wolf',
    ]);
    expect(first.animals.filter((entry) => ANIMALS[entry.species].predator)).toHaveLength(8);
    expect(first.animals.filter((entry) => !ANIMALS[entry.species].predator)).toHaveLength(31);
  });

  it('lets herbivores graze and reproduce through juvenile, adult and elder stages', () => {
    const world = flatWorld();
    const female = animal(world, 'rabbit', 5, 5, {
      sex: 'female',
      energy: 75,
      nextBreedAt: 0,
    });
    const male = animal(world, 'rabbit', 6, 5, { sex: 'male', energy: 90 });
    world.animals.push(female, male);
    const forageBefore = world.wildForage[5 * world.width + 5]!;

    advanceEcology(world);

    expect(female.energy).toBeGreaterThan(50);
    expect(female.nextBreedAt).toBe(ANIMALS.rabbit.breedCooldown);
    expect(world.wildForage[5 * world.width + 5]!).toBeLessThan(forageBefore);
    const young = world.animals.filter((entry) => entry.ageTicks === 0);
    expect(young.length).toBeGreaterThanOrEqual(2);
    expect(young.every((entry) => animalStage(entry) === 'juvenile')).toBe(true);
    female.ageTicks = ANIMALS.rabbit.elderTicks;
    expect(animalStage(female)).toBe('elder');
  });

  it('allows predators to hunt only wildlife', () => {
    const world = flatWorld();
    const rabbit = animal(world, 'rabbit', 4, 4);
    const wolf = animal(world, 'wolf', 5, 4, { sex: 'male', energy: 10 });
    world.animals.push(rabbit, wolf);
    const colonyBefore = JSON.stringify({
      pawns: world.pawns,
      crops: world.crops,
      items: world.items,
      buildings: world.buildings,
    });
    const diagnostics = new DiagnosticLog();

    for (let step = 0; step < 10 && world.animals.some((entry) => entry.id === rabbit.id); step++) {
      world.tick += 10;
      advanceEcology(world, 10, diagnostics);
    }

    expect(world.animals.some((entry) => entry.id === rabbit.id)).toBe(false);
    expect(wolf.energy).toBeGreaterThan(10);
    expect(diagnostics.snapshot().some((event) => event.type === 'WILDLIFE_PREDATION')).toBe(true);
    expect(
      JSON.stringify({
        pawns: world.pawns,
        crops: world.crops,
        items: world.items,
        buildings: world.buildings,
      }),
    ).toBe(colonyBefore);
  });

  it('lets hungry adult predators stalk and injure nearby colonists who fight back', () => {
    const world = flatWorld();
    world.pawns = [world.pawns[0]!];
    const colonist = world.pawns[0]!;
    colonist.x = 3;
    colonist.y = 3;
    const wolf = animal(world, 'wolf', 4, 3, { energy: 20 });
    world.animals.push(wolf);
    const diagnostics = new DiagnosticLog();

    world.tick = 10;
    advanceEcology(world, 10, diagnostics);

    expect(colonist.health).toBeLessThan(100);
    expect(colonist.injuries).toHaveLength(1);
    expect(wolf.health).toBeLessThan(ANIMALS.wolf.maxHealth);
    expect(wolf.health).toBeGreaterThanOrEqual(ANIMALS.wolf.maxHealth - 3);
    expect(wolf.huntTargetId).toBe(colonist.id);
    expect(world.events.at(-1)?.text).toContain('attacked by a wolf');
    expect(diagnostics.snapshot().map((event) => event.type)).toEqual(
      expect.arrayContaining(['PREDATOR_ATTACKED_COLONIST', 'COLONIST_COUNTERATTACKED_PREDATOR']),
    );
  });

  it('allows a colonist to kill a weakened predator in unarmed self-defence', () => {
    const world = flatWorld();
    world.pawns = [world.pawns[0]!];
    const colonist = world.pawns[0]!;
    colonist.x = 3;
    colonist.y = 3;
    const fox = animal(world, 'fox', 4, 3, { energy: 20, health: 1 });
    world.animals.push(fox);

    world.tick = 10;
    advanceEcology(world);

    expect(world.animals).not.toContainEqual(expect.objectContaining({ id: fox.id }));
    expect(world.events.some((event) => event.text.includes('bare hands'))).toBe(true);
  });

  it('does not block colonist navigation or enter the job system', () => {
    const world = flatWorld();
    world.animals.push(animal(world, 'bison', 4, 3));
    expect(findPath(world, { x: 2, y: 3 }, { x: 6, y: 3 })).toHaveLength(4);
  });

  it('keeps populations finite through several ecological days', () => {
    const world = generateWorld(9127);
    for (let tick = 0; tick < 3 * 6000; tick += 10) {
      world.tick += 10;
      advanceEcology(world);
    }
    const counts = ecosystemCounts(world);
    expect(world.animals.length).toBeGreaterThan(0);
    for (const species of Object.keys(ANIMALS) as Array<keyof typeof ANIMALS>) {
      expect(counts[species]).toBeLessThanOrEqual(ANIMALS[species].capacity);
      expect(counts[species]).toBeGreaterThan(0);
    }
    expect(world.animals.every((entry) => Number.isFinite(entry.energy))).toBe(true);
    expect(world.wildForage.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  });

  it('roundtrips ecology and seeds wildlife into older saves', () => {
    const world = generateWorld(872);
    expect(decode(encode(world)).world.animals).toEqual(world.animals);

    const envelope = encode(world);
    const legacy = JSON.parse(envelope.payload);
    delete legacy.animals;
    delete legacy.wildForage;
    const payload = JSON.stringify(legacy);
    const loaded = decode({ ...envelope, payload, checksum: checksum(payload) }).world;
    expect(new Set(loaded.animals.map((entry) => entry.species))).toEqual(
      new Set(Object.keys(ANIMALS)),
    );
    expect(loaded.wildForage).toHaveLength(loaded.width * loaded.height);
  });

  it('migrates animal combat health and cooldowns in existing saves', () => {
    const world = generateWorld(873);
    const envelope = encode(world);
    const legacy = JSON.parse(envelope.payload);
    for (const entry of legacy.animals) {
      delete entry.health;
      delete entry.nextAttackAt;
    }
    const payload = JSON.stringify(legacy);

    const loaded = decode({ ...envelope, payload, checksum: checksum(payload) }).world;

    expect(
      loaded.animals.every(
        (entry) =>
          entry.health === ANIMALS[entry.species].maxHealth && entry.nextAttackAt === loaded.tick,
      ),
    ).toBe(true);
  });
});
