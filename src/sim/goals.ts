import { roomTopology } from './topology';
import type { ColonyGoalId, World } from './types';
import { usefulResourceTotal } from './world';

export interface ColonyGoal {
  id: ColonyGoalId;
  title: string;
  detail: string;
  completedText: string;
  progress: (world: World) => { value: number; target: number; label: string };
  achieved: (world: World) => boolean;
}

const eventIncludes = (world: World, text: string) =>
  world.events.some((event) => event.text.toLowerCase().includes(text));
const pantryTarget = (world: World) => Math.max(80, Math.ceil((world.pawns.length * 80) / 3));

export const COLONY_GOALS: readonly ColonyGoal[] = [
  {
    id: 'first-bed',
    title: 'Rest easy',
    detail: 'Complete a bed so one settler can recover properly.',
    completedText: 'The colony has its first proper bed.',
    progress: (world) => {
      const value = world.buildings.filter((building) => building.kind === 'bed').length;
      return { value, target: 1, label: `${Math.min(value, 1)} / 1 bed` };
    },
    achieved: (world) => world.buildings.some((building) => building.kind === 'bed'),
  },
  {
    id: 'food-buffer',
    title: 'A stocked pantry',
    detail: 'Build a fresh food reserve sized for the colony before supplies run thin.',
    completedText: 'There is enough food to breathe a little easier.',
    progress: (world) => {
      const value = Math.floor(usefulResourceTotal(world, 'food'));
      const target = pantryTarget(world);
      return { value, target, label: `${Math.min(value, target)} / ${target} food` };
    },
    achieved: (world) => usefulResourceTotal(world, 'food') >= pantryTarget(world),
  },
  {
    id: 'first-field',
    title: 'Plant tomorrow',
    detail: 'Grow a small field of four crops.',
    completedText: 'Four young crops are in the ground.',
    progress: (world) => {
      const value = world.crops.length;
      return { value, target: 4, label: `${Math.min(value, 4)} / 4 crops` };
    },
    achieved: (world) => world.crops.length >= 4,
  },
  {
    id: 'first-harvest',
    title: 'First harvest',
    detail: 'Keep the field healthy until a crop is harvested.',
    completedText: 'The first home-grown food is safely gathered.',
    progress: (world) => {
      const mature = world.crops.filter((crop) => crop.growth >= 1).length;
      return { value: mature, target: 1, label: mature ? 'Ready to gather' : 'Crops are growing' };
    },
    achieved: (world) => eventIncludes(world, ' harvested '),
  },
  {
    id: 'cooking-fire',
    title: 'Build a hearth',
    detail: 'Complete a cooking station for proper meals.',
    completedText: 'The colony has a place to prepare warm food.',
    progress: (world) => {
      const value = world.buildings.filter((building) => building.kind === 'cooking').length;
      return { value, target: 1, label: `${Math.min(value, 1)} / 1 station` };
    },
    achieved: (world) => world.buildings.some((building) => building.kind === 'cooking'),
  },
  {
    id: 'first-meal',
    title: 'Something warm',
    detail: 'Prepare the colony’s first simple meal.',
    completedText: 'The first warm meal lifts everyone’s spirits.',
    progress: (world) => {
      const ready = world.items.some(
        (item) => item.resource === 'food' && item.foodType === 'meal',
      );
      return { value: Number(ready), target: 1, label: ready ? 'Meal ready' : 'Awaiting a cook' };
    },
    achieved: (world) =>
      world.items.some((item) => item.resource === 'food' && item.foodType === 'meal') ||
      eventIncludes(world, 'prepared a simple meal'),
  },
  {
    id: 'first-home',
    title: 'A place called home',
    detail: 'Enclose and roof a room around a completed bed.',
    completedText: 'A sheltered bedroom turns the camp into a home.',
    progress: (world) => {
      const beds = world.buildings.filter((building) => building.kind === 'bed');
      const indoors = beds.filter((bed) => roomTopology(world).isIndoors(bed)).length;
      return {
        value: indoors,
        target: 1,
        label: beds.length
          ? indoors
            ? 'Bedroom sheltered'
            : 'Bed still outdoors'
          : 'Build a bed first',
      };
    },
    achieved: (world) =>
      world.buildings.some(
        (building) => building.kind === 'bed' && roomTopology(world).isIndoors(building),
      ),
  },
] as const;

export function completedGoalIds(world: World) {
  return new Set(world.completedGoals ?? []);
}

export function currentColonyGoal(world: World) {
  const completed = completedGoalIds(world);
  return COLONY_GOALS.find((goal) => !completed.has(goal.id));
}

export function completeColonyGoals(world: World) {
  const completed = completedGoalIds(world);
  const newlyCompleted = COLONY_GOALS.filter(
    (goal) => !completed.has(goal.id) && goal.achieved(world),
  );
  if (!newlyCompleted.length) return [];
  world.completedGoals ??= [];
  world.completedGoals.push(...newlyCompleted.map((goal) => goal.id));
  return newlyCompleted;
}
