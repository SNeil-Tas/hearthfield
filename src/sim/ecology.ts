import { BUILDINGS, DAY_TICKS } from './definitions';
import type { Animal, AnimalSpecies, AnimalStage, Pawn, Point, Terrain, World } from './types';
import { nextId, tileKey } from './world';
import type { DiagnosticLog } from './diagnostics';
import { inflictInjury } from './health';
import { emit } from './events';

export interface AnimalDefinition {
  name: string;
  plural: string;
  predator: boolean;
  color: string;
  accent: string;
  maturityTicks: number;
  elderTicks: number;
  maxAgeTicks: number;
  breedCooldown: number;
  litter: readonly [number, number];
  moveInterval: number;
  metabolism: number;
  foodValue: number;
  prey: readonly AnimalSpecies[];
  initial: number;
  minimum: number;
  capacity: number;
  maxHealth: number;
  attack?: {
    damage: readonly [number, number];
    interval: number;
    colonistHuntRange: number;
  };
}

export const ANIMALS: Record<AnimalSpecies, AnimalDefinition> = {
  rabbit: {
    name: 'Rabbit',
    plural: 'Rabbits',
    predator: false,
    color: '#b7a58b',
    accent: '#ded0b8',
    maturityTicks: 1800,
    elderTicks: 26000,
    maxAgeTicks: 36000,
    breedCooldown: 3600,
    litter: [2, 3],
    moveInterval: 20,
    metabolism: 0.09,
    foodValue: 24,
    prey: [],
    initial: 14,
    minimum: 4,
    capacity: 32,
    maxHealth: 18,
  },
  deer: {
    name: 'Deer',
    plural: 'Deer',
    predator: false,
    color: '#a97850',
    accent: '#e0c39a',
    maturityTicks: 4200,
    elderTicks: 50000,
    maxAgeTicks: 66000,
    breedCooldown: 9000,
    litter: [1, 2],
    moveInterval: 30,
    metabolism: 0.12,
    foodValue: 58,
    prey: [],
    initial: 7,
    minimum: 3,
    capacity: 18,
    maxHealth: 45,
  },
  boar: {
    name: 'Wild boar',
    plural: 'Wild boars',
    predator: false,
    color: '#66584a',
    accent: '#c6af8d',
    maturityTicks: 3600,
    elderTicks: 42000,
    maxAgeTicks: 56000,
    breedCooldown: 7200,
    litter: [1, 2],
    moveInterval: 35,
    metabolism: 0.13,
    foodValue: 48,
    prey: [],
    initial: 6,
    minimum: 3,
    capacity: 16,
    maxHealth: 55,
  },
  bison: {
    name: 'Bison',
    plural: 'Bison',
    predator: false,
    color: '#594839',
    accent: '#c0a783',
    maturityTicks: 6000,
    elderTicks: 66000,
    maxAgeTicks: 84000,
    breedCooldown: 12000,
    litter: [1, 1],
    moveInterval: 45,
    metabolism: 0.16,
    foodValue: 82,
    prey: [],
    initial: 4,
    minimum: 2,
    capacity: 10,
    maxHealth: 90,
  },
  fox: {
    name: 'Fox',
    plural: 'Foxes',
    predator: true,
    color: '#bd7041',
    accent: '#ead2ae',
    maturityTicks: 3000,
    elderTicks: 39000,
    maxAgeTicks: 50000,
    breedCooldown: 9000,
    litter: [1, 2],
    moveInterval: 20,
    metabolism: 0.14,
    foodValue: 36,
    prey: ['rabbit'],
    initial: 4,
    minimum: 2,
    capacity: 9,
    maxHealth: 32,
    attack: { damage: [4, 7], interval: 600, colonistHuntRange: 7 },
  },
  wolf: {
    name: 'Wolf',
    plural: 'Wolves',
    predator: true,
    color: '#6f7777',
    accent: '#d1d2c7',
    maturityTicks: 4200,
    elderTicks: 48000,
    maxAgeTicks: 62000,
    breedCooldown: 11000,
    litter: [1, 2],
    moveInterval: 25,
    metabolism: 0.17,
    foodValue: 54,
    prey: ['rabbit', 'deer', 'boar'],
    initial: 4,
    minimum: 2,
    capacity: 10,
    maxHealth: 70,
    attack: { damage: [8, 14], interval: 500, colonistHuntRange: 9 },
  },
};

const FORAGE_CAPACITY: Record<Terrain, number> = { fertile: 100, soil: 72, rock: 24, water: 0 };
const COLONIST_HUNT_ENERGY = 28;
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const animalNumber = (animal: Animal) => Number(animal.id.split('-')[1]) || 0;
const deterministic = (world: World, salt: number) => {
  let value =
    (world.seed ^ Math.imul(world.tick + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967296;
};

export const forageCapacity = (world: World, key: number) =>
  FORAGE_CAPACITY[world.terrain[key] ?? 'water'];

export function initializeWildForage(world: World) {
  world.wildForage = world.terrain.map((terrain, key) => {
    const capacity = FORAGE_CAPACITY[terrain];
    const variation = 0.72 + (((key * 1103515245 + world.seed) >>> 0) % 29) / 100;
    return Math.round(capacity * variation * 10) / 10;
  });
}

export function animalStage(animal: Animal): AnimalStage {
  const def = ANIMALS[animal.species];
  if (animal.ageTicks < def.maturityTicks) return 'juvenile';
  return animal.ageTicks >= def.elderTicks ? 'elder' : 'adult';
}

export function animalPassable(world: World, point: Point) {
  const x = Math.round(point.x),
    y = Math.round(point.y);
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  if (world.terrain[y * world.width + x] === 'water') return false;
  return !world.buildings.some(
    (building) =>
      Math.round(building.x) === x &&
      Math.round(building.y) === y &&
      BUILDINGS[building.kind].blocks,
  );
}

function habitatScore(world: World, species: AnimalSpecies, point: Point) {
  const forage = world.wildForage[tileKey(world, point)] ?? 0;
  const fromColony = Math.hypot(point.x - world.width / 2, point.y - world.height / 2);
  return forage + fromColony * (ANIMALS[species].predator ? 0.2 : 0.55);
}

function makeAnimal(
  world: World,
  species: AnimalSpecies,
  point: Point,
  sex: Animal['sex'],
  ageTicks: number,
): Animal {
  return {
    id: nextId(world, 'animal'),
    species,
    sex,
    x: Math.round(point.x),
    y: Math.round(point.y),
    ageTicks,
    energy: 65 + deterministic(world, world.nextId * 13) * 25,
    health: ANIMALS[species].maxHealth,
    state: 'roaming',
    nextMoveAt: world.tick,
    nextBreedAt: world.tick + Math.floor(ANIMALS[species].breedCooldown * 0.5),
    nextAttackAt: world.tick,
  };
}

export function seedWildlife(world: World, random: () => number) {
  if (!world.wildForage?.length) initializeWildForage(world);
  world.animals ??= [];
  for (const species of Object.keys(ANIMALS) as AnimalSpecies[]) {
    const def = ANIMALS[species];
    for (let index = 0; index < def.initial; index++) {
      let best: Point | undefined,
        bestScore = -Infinity;
      for (let attempt = 0; attempt < 40; attempt++) {
        const point = {
          x: 2 + Math.floor(random() * (world.width - 4)),
          y: 2 + Math.floor(random() * (world.height - 4)),
        };
        if (
          !animalPassable(world, point) ||
          world.animals.some((animal) => animal.x === point.x && animal.y === point.y)
        )
          continue;
        const score = habitatScore(world, species, point) + random() * 20;
        if (score > bestScore) {
          best = point;
          bestScore = score;
        }
      }
      if (best)
        world.animals.push(
          makeAnimal(
            world,
            species,
            best,
            index % 2 ? 'male' : 'female',
            Math.floor(random() * def.elderTicks * 0.75),
          ),
        );
    }
  }
}

const cardinal = (animal: Animal) => [
  { x: animal.x + 1, y: animal.y },
  { x: animal.x - 1, y: animal.y },
  { x: animal.x, y: animal.y + 1 },
  { x: animal.x, y: animal.y - 1 },
];

function stepToward(world: World, animal: Animal, target: Point, away = false) {
  const options = cardinal(animal).filter((point) => animalPassable(world, point));
  const score = (point: Point) => Math.abs(point.x - target.x) + Math.abs(point.y - target.y);
  options.sort((a, b) => (away ? score(b) - score(a) : score(a) - score(b)));
  if (options[0]) {
    animal.x = options[0].x;
    animal.y = options[0].y;
  }
}

function nearestPredator(world: World, animal: Animal) {
  return world.animals
    .filter(
      (candidate) =>
        ANIMALS[candidate.species].predator &&
        ANIMALS[candidate.species].prey.includes(animal.species),
    )
    .map((candidate) => ({
      animal: candidate,
      distance: Math.abs(candidate.x - animal.x) + Math.abs(candidate.y - animal.y),
    }))
    .filter((entry) => entry.distance <= 5)
    .sort((a, b) => a.distance - b.distance)[0]?.animal;
}

function distance(a: Point, b: Point) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function huntTarget(world: World, predator: Animal, dead: ReadonlySet<string>) {
  const def = ANIMALS[predator.species];
  const wildlife = world.animals
    .filter((candidate) => !dead.has(candidate.id) && def.prey.includes(candidate.species))
    .map((candidate) => ({
      target: candidate as Animal | Pawn,
      distance: distance(candidate, predator),
      juvenile: animalStage(candidate) === 'juvenile',
    }))
    .filter((entry) => entry.distance <= 14);
  if (wildlife.length) {
    return wildlife.sort(
      (a, b) => a.distance - b.distance || Number(!a.juvenile) - Number(!b.juvenile),
    )[0]?.target;
  }
  const colonists =
    def.attack && animalStage(predator) !== 'juvenile' && predator.energy <= COLONIST_HUNT_ENERGY
      ? world.pawns
          .filter((pawn) => pawn.health > 0)
          .map((pawn) => ({
            target: pawn as Animal | Pawn,
            distance: distance(pawn, predator),
            juvenile: false,
          }))
          .filter((entry) => entry.distance <= def.attack!.colonistHuntRange)
      : [];
  return colonists.sort((a, b) => a.distance - b.distance)[0]?.target;
}

function isAnimal(target: Animal | Pawn): target is Animal {
  return target.id.startsWith('animal-');
}

function attackColonist(
  world: World,
  predator: Animal,
  colonist: Pawn,
  dead: Set<string>,
  diagnostics?: DiagnosticLog,
) {
  const def = ANIMALS[predator.species],
    attack = def.attack;
  if (!attack || world.tick < predator.nextAttackAt) return;
  const [minimum, maximum] = attack.damage;
  const severity =
    minimum +
    Math.floor(
      deterministic(world, animalNumber(predator) * 103 + colonist.id.length) *
        (maximum - minimum + 1),
    );
  const detail = deterministic(world, animalNumber(predator) * 211 + colonist.id.length);
  const kind = detail < 0.72 ? 'cut' : 'bruise';
  const bodyParts: Array<'head' | 'torso' | 'arm' | 'leg'> = ['head', 'torso', 'arm', 'leg'];
  inflictInjury(
    world,
    colonist,
    kind,
    bodyParts[Math.floor(((detail * 7) % 1) * bodyParts.length)]!,
    severity,
    `a ${def.name.toLowerCase()}`,
  );
  predator.nextAttackAt = world.tick + attack.interval;
  diagnostics?.record(world, 'PREDATOR_ATTACKED_COLONIST', {
    entityId: predator.id,
    targetId: colonist.id,
    reason: predator.species,
    position: predator,
    values: { damage: severity, colonistHealth: colonist.health },
  });

  if (colonist.health <= 0) {
    predator.energy = clamp(predator.energy + 45);
    predator.huntTargetId = undefined;
    predator.state = 'feeding';
    return;
  }

  // Colonists defend themselves instinctively, but bare hands are a poor weapon against predators.
  const counterDamage = 1 + Math.floor(deterministic(world, animalNumber(predator) * 307) * 3);
  predator.health = Math.max(0, predator.health - counterDamage);
  diagnostics?.record(world, 'COLONIST_COUNTERATTACKED_PREDATOR', {
    entityId: colonist.id,
    entityName: colonist.name,
    targetId: predator.id,
    reason: 'unarmed self-defence',
    position: colonist,
    values: { damage: counterDamage, predatorHealth: predator.health },
  });
  if (predator.health <= 0) {
    dead.add(predator.id);
    emitCombatVictory(world, colonist, def.name.toLowerCase());
    diagnostics?.record(world, 'PREDATOR_KILLED_BY_COLONIST', {
      entityId: colonist.id,
      entityName: colonist.name,
      targetId: predator.id,
      reason: 'unarmed self-defence',
      position: colonist,
    });
  }
}

function emitCombatVictory(world: World, colonist: Pawn, predatorName: string) {
  emit(
    world,
    `${colonist.name} fought off and killed a ${predatorName} with their bare hands.`,
    'success',
  );
}

function roam(world: World, animal: Animal) {
  const options = cardinal(animal).filter((point) => animalPassable(world, point));
  const salt = animalNumber(animal) + world.tick;
  options.sort((a, b) =>
    ANIMALS[animal.species].predator
      ? deterministic(world, salt + tileKey(world, a)) -
        deterministic(world, salt + tileKey(world, b))
      : (world.wildForage[tileKey(world, b)] ?? 0) - (world.wildForage[tileKey(world, a)] ?? 0) ||
        deterministic(world, salt + tileKey(world, a)) -
          deterministic(world, salt + tileKey(world, b)),
  );
  if (options[0]) {
    animal.x = options[0].x;
    animal.y = options[0].y;
  }
}

function reproduce(world: World, mother: Animal, newborns: Animal[]) {
  const def = ANIMALS[mother.species];
  if (
    mother.sex !== 'female' ||
    animalStage(mother) !== 'adult' ||
    mother.energy < 72 ||
    mother.nextBreedAt > world.tick ||
    world.animals.filter((animal) => animal.species === mother.species).length +
      newborns.filter((animal) => animal.species === mother.species).length >=
      def.capacity
  )
    return;
  if (
    !world.animals.some(
      (animal) =>
        animal.species === mother.species &&
        animal.sex === 'male' &&
        animalStage(animal) === 'adult' &&
        animal.energy >= 55 &&
        Math.abs(animal.x - mother.x) + Math.abs(animal.y - mother.y) <= 6,
    )
  )
    return;
  const litter =
    def.litter[0] +
    Math.floor(deterministic(world, animalNumber(mother)) * (def.litter[1] - def.litter[0] + 1));
  const spaces = cardinal(mother).filter((point) => animalPassable(world, point));
  const availableSlots = Math.max(
    0,
    def.capacity -
      world.animals.filter((animal) => animal.species === mother.species).length -
      newborns.filter((animal) => animal.species === mother.species).length,
  );
  const born = Math.min(litter, availableSlots);
  for (let index = 0; index < born && spaces.length; index++)
    newborns.push(
      makeAnimal(
        world,
        mother.species,
        spaces[index % spaces.length]!,
        deterministic(world, animalNumber(mother) + index * 31) < 0.5 ? 'female' : 'male',
        0,
      ),
    );
  if (born && spaces.length) {
    mother.energy -= 24;
    mother.nextBreedAt = world.tick + def.breedCooldown;
  }
}

function migrateMinimumPopulations(world: World, diagnostics?: DiagnosticLog) {
  if (!world.tick || world.tick % DAY_TICKS !== 0) return;
  for (const species of Object.keys(ANIMALS) as AnimalSpecies[]) {
    const def = ANIMALS[species],
      count = world.animals.filter((animal) => animal.species === species).length;
    if (count >= def.minimum) continue;
    const candidates: Point[] = [];
    for (let x = 1; x < world.width - 1; x++)
      candidates.push({ x, y: 1 }, { x, y: world.height - 2 });
    for (let y = 2; y < world.height - 2; y++)
      candidates.push({ x: 1, y }, { x: world.width - 2, y });
    const start = Math.floor(deterministic(world, species.length * 97) * candidates.length);
    const point = [...candidates.slice(start), ...candidates.slice(0, start)].find((candidate) =>
      animalPassable(world, candidate),
    );
    if (!point) continue;
    const animal = makeAnimal(
      world,
      species,
      point,
      count % 2 ? 'female' : 'male',
      def.maturityTicks,
    );
    world.animals.push(animal);
    diagnostics?.record(world, 'WILDLIFE_MIGRATED', {
      entityId: animal.id,
      reason: species,
      position: point,
      values: { populationBefore: count },
    });
  }
}

export function advanceEcology(world: World, elapsedTicks = 10, diagnostics?: DiagnosticLog) {
  for (let key = 0; key < world.wildForage.length; key++) {
    const capacity = forageCapacity(world, key),
      current = world.wildForage[key] ?? 0;
    if (capacity > 0)
      world.wildForage[key] = Math.min(
        capacity,
        current + 0.012 * elapsedTicks * (1 + (capacity - current) / capacity),
      );
  }
  const newborns: Animal[] = [],
    dead = new Set<string>();
  for (const animal of world.animals) {
    if (dead.has(animal.id)) continue;
    const def = ANIMALS[animal.species];
    animal.ageTicks += elapsedTicks;
    animal.energy = clamp(animal.energy - def.metabolism * (elapsedTicks / 10));
    if (animal.ageTicks >= def.maxAgeTicks || animal.energy <= 0 || animal.health <= 0) {
      dead.add(animal.id);
      diagnostics?.record(world, 'WILDLIFE_DIED', {
        entityId: animal.id,
        reason: animal.health <= 0 ? 'injuries' : animal.energy <= 0 ? 'starvation' : 'old age',
        position: animal,
        values: { species: animal.species, ageTicks: animal.ageTicks },
      });
      continue;
    }
    if (!def.predator) {
      const threat = nearestPredator(world, animal);
      if (threat) {
        animal.state = 'fleeing';
        animal.huntTargetId = undefined;
        if (world.tick >= animal.nextMoveAt) {
          stepToward(world, animal, threat, true);
          animal.nextMoveAt = world.tick + def.moveInterval;
        }
      } else {
        const key = tileKey(world, animal),
          available = world.wildForage[key] ?? 0;
        if (animal.energy < 82 && available >= 1) {
          const bite = Math.min(available, animal.species === 'bison' ? 4.5 : 3);
          world.wildForage[key] = Math.max(0, available - bite);
          animal.energy = clamp(animal.energy + bite * (animal.species === 'rabbit' ? 3.2 : 2.4));
          animal.state = 'foraging';
        } else if (world.tick >= animal.nextMoveAt) {
          animal.state = 'roaming';
          roam(world, animal);
          animal.nextMoveAt = world.tick + def.moveInterval;
        } else animal.state = 'resting';
      }
    } else {
      let prey: Animal | Pawn | undefined = animal.huntTargetId
        ? (world.animals.find((candidate) => candidate.id === animal.huntTargetId) ??
          world.pawns.find((candidate) => candidate.id === animal.huntTargetId))
        : undefined;
      if (
        !prey ||
        dead.has(prey.id) ||
        prey.health <= 0 ||
        (isAnimal(prey)
          ? !def.prey.includes(prey.species)
          : !def.attack ||
            animal.energy > COLONIST_HUNT_ENERGY ||
            distance(prey, animal) > def.attack.colonistHuntRange)
      )
        prey = huntTarget(world, animal, dead);
      if (animal.energy < 78 && prey) {
        animal.state = 'hunting';
        animal.huntTargetId = prey.id;
        const range = distance(prey, animal);
        if (range <= 1) {
          if (isAnimal(prey)) {
            dead.add(prey.id);
            animal.energy = clamp(animal.energy + ANIMALS[prey.species].foodValue);
            animal.huntTargetId = undefined;
            animal.state = 'feeding';
            diagnostics?.record(world, 'WILDLIFE_PREDATION', {
              entityId: animal.id,
              targetId: prey.id,
              reason: `${animal.species} hunted ${prey.species}`,
              position: animal,
            });
          } else attackColonist(world, animal, prey, dead, diagnostics);
        } else if (world.tick >= animal.nextMoveAt) {
          stepToward(world, animal, prey);
          animal.nextMoveAt = world.tick + def.moveInterval;
        }
      } else {
        animal.huntTargetId = undefined;
        animal.state = world.tick >= animal.nextMoveAt ? 'roaming' : 'resting';
        if (world.tick >= animal.nextMoveAt) {
          roam(world, animal);
          animal.nextMoveAt = world.tick + def.moveInterval;
        }
      }
    }
    if (!dead.has(animal.id)) reproduce(world, animal, newborns);
  }
  world.animals = [...world.animals.filter((animal) => !dead.has(animal.id)), ...newborns];
  for (const animal of world.animals)
    if (animal.huntTargetId && dead.has(animal.huntTargetId)) {
      animal.huntTargetId = undefined;
      if (animal.state === 'hunting') animal.state = 'roaming';
    }
  for (const animal of newborns)
    diagnostics?.record(world, 'WILDLIFE_BORN', {
      entityId: animal.id,
      reason: animal.species,
      position: animal,
    });
  migrateMinimumPopulations(world, diagnostics);
}

export function ecosystemCounts(world: World) {
  return Object.fromEntries(
    (Object.keys(ANIMALS) as AnimalSpecies[]).map((species) => [
      species,
      world.animals.filter((animal) => animal.species === species).length,
    ]),
  ) as Record<AnimalSpecies, number>;
}
