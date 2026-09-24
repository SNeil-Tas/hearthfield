import { writeFileSync, mkdirSync } from 'node:fs';
import { Simulation } from '../../src/sim/simulation';
import { foodType, freshPoints, isFoodSpoiled } from '../../src/sim/world';
import { findPath } from '../../src/sim/pathfinding';
import { needCandidates, rankCandidate, workCandidates } from '../../src/sim/job-board';
import { COOKING_INPUT, NODES } from '../../src/sim/definitions';

// Audit-only instrumentation: count ticks, retain decisions only at transitions.
export function observeSurvival(sim: Simulation, name: string) {
  const w = sim.world;
  const labour = w.pawns.map(() => ({}) as Record<string, number>);
  const jobs = w.pawns.map(() => ({}) as Record<string, number>);
  const events: { type: string; [key: string]: unknown }[] = [];
  const transitionCounts = new Map<string, number>();
  const cookingWait = w.pawns.map(() => 0);
  const counts: Record<string, number> = {};
  const zero = new Set<string>();
  const minHunger = w.pawns.map((p) => p.hunger);
  const mass = () =>
    [...w.items, ...w.pawns.flatMap((p) => (p.carrying ? [p.carrying] : []))].reduce(
      (n, i) =>
        n +
        (i.resource === 'food'
          ? foodType(i) === 'meal'
            ? 80 * i.quantity
            : i.quantity
          : i.resource === 'waste'
            ? i.quantity
            : 0),
      0,
    ) + w.buildings.reduce((n, b) => n + (b.ingredientFresh ?? 0), 0);
  const ledger = {
    initial: mass(),
    externalInput: 0,
    harvested: 0,
    gathered: 0,
    consumed: 0,
    conversionLoss: 0,
    expired: 0,
    maxError: 0,
  };
  const mealsByPawn = w.pawns.map(() => 0);
  const harvestTiles = new Map<string, number>();
  const snapshot = (id: string) => {
    const p = w.pawns.find((p) => p.id === id)!;
    const raw = w.items.filter((i) => i.resource === 'food' && foodType(i) === 'raw');
    const meals = w.items.filter(
      (i) => i.resource === 'food' && foodType(i) === 'meal' && !isFoodSpoiled(w, i),
    );
    const accessible = (i: (typeof w.items)[number]) =>
      sim.reservations.available([i.id], id) && findPath(w, p, i, true) !== null;
    return {
      tick: w.tick,
      pawn: p.name,
      hunger: p.hunger,
      rest: p.rest,
      job: p.job ? structuredClone(p.job) : null,
      raw: raw.reduce((n, i) => n + freshPoints(i), 0),
      reachableRaw: raw.filter(accessible).reduce((n, i) => n + freshPoints(i), 0),
      meals: meals.reduce((n, i) => n + i.quantity, 0),
      reachableMeals: meals.filter(accessible).reduce((n, i) => n + i.quantity, 0),
      rawFlaggedSpoiled: raw.filter((i) => isFoodSpoiled(w, i)).length,
      reservedFood: [...raw, ...meals]
        .filter((i) => !sim.reservations.available([i.id], id))
        .map((i) => ({ id: i.id, owner: sim.reservations.owner(i.id) })),
      priorities: { ...p.priorities },
      stations: w.buildings
        .filter((b) => b.kind === 'cooking')
        .map((b) => {
          const reachableIngredients = raw
            .filter((i) => accessible(i) && findPath(w, i, b, true) !== null)
            .reduce((n, i) => n + freshPoints(i), b.ingredientFresh ?? 0);
          return {
            buffer: b.ingredientFresh,
            owner: b.reservedBy,
            reachableIngredients,
            recipePossible: reachableIngredients >= COOKING_INPUT,
            reason: b.reservedBy
              ? 'reserved'
              : reachableIngredients < COOKING_INPUT
                ? 'insufficient reachable ingredients'
                : 'eligible',
          };
        }),
      candidates: [
        ...needCandidates(w, p).slice(0, 8),
        ...workCandidates(w)
          .sort((a, b) => rankCandidate(p, a) - rankCandidate(p, b))
          .slice(0, 4),
      ]
        .map((c) => ({
          kind: c.kind,
          rank: rankCandidate(p, c),
          available: sim.reservations.available(c.keys, id),
        }))
        .slice(0, 12),
    };
  };
  const record = sim.diagnostics.record.bind(sim.diagnostics);
  sim.diagnostics.record = (world, type, data = {}) => {
    if (type === 'CROP_HARVEST') {
      ledger.harvested += Number(data.values!.produced);
      const key = JSON.stringify(data.position);
      harvestTiles.set(key, (harvestTiles.get(key) ?? 0) + 1);
    }
    if (type === 'WILD_SEED_ACQUIRED') ledger.gathered += NODES.berries.yield;
    if (type === 'FOOD_CONSUMED') {
      ledger.consumed += Number(data.values!.consumedPoints);
      if (data.values!.foodType === 'meal')
        mealsByPawn[w.pawns.findIndex((p) => p.id === data.entityId)]!++;
    }
    if (type === 'COOKING_COMPLETED') ledger.conversionLoss += Number(data.values!.conversionLoss);
    counts[type] = (counts[type] ?? 0) + 1;
    if (
      [
        'HUNGER_THRESHOLD_CROSSED',
        'FOOD_CONSUMED',
        'COOK_SOURCE_EXHAUSTED',
        'COOKING_COMPLETED',
        'SELFCARE_PREEMPTED_JOB',
        'PATH_FAILED',
        'FOOD_SELFCARE_EVALUATED',
        'COOK_TO_EAT_TRANSITION',
      ].includes(type)
    )
      events.push({ type, ...data, state: data.entityId ? snapshot(data.entityId) : undefined });
    if (type === 'JOB_INTERRUPTED') {
      const key = `${data.entityId}:${data.jobType}:${data.reason}`;
      const count = (transitionCounts.get(key) ?? 0) + 1;
      transitionCounts.set(key, count);
      if (count <= 3)
        events.push({ type, ...data, state: data.entityId ? snapshot(data.entityId) : undefined });
    }
    record(world, type, data);
  };
  return {
    addInput(amount: number) {
      ledger.externalInput += amount;
    },
    step() {
      ledger.maxError = Math.max(
        ledger.maxError,
        Math.abs(
          mass() -
            (ledger.initial +
              ledger.externalInput +
              ledger.harvested +
              ledger.gathered -
              ledger.consumed -
              ledger.conversionLoss -
              ledger.expired),
        ),
      );
      if (w.tick % 100 === 99)
        ledger.expired += w.items
          .filter((i) => i.resource === 'waste')
          .flatMap((i) => i.expiryBatches ?? [])
          .filter((b) => b.expiresAt <= w.tick + 1)
          .reduce((n, b) => n + b.quantity, 0);
      w.pawns.forEach((p, i) => {
        const job = p.job?.kind ?? 'idle';
        if (p.job?.kind === 'cook' && p.job.waitingForSource) cookingWait[i]!++;
        const category = p.job?.path.length ? 'walking' : job;
        labour[i]![category] = (labour[i]![category] ?? 0) + 1;
        jobs[i]![job] = (jobs[i]![job] ?? 0) + 1;
        minHunger[i] = Math.min(minHunger[i]!, p.hunger);
        if (p.hunger === 0 && !zero.has(p.id)) {
          zero.add(p.id);
          events.push({ type: 'FIRST_ZERO', state: snapshot(p.id) });
        }
      });
    },
    finish() {
      const result = {
        name,
        ticks: w.tick,
        counts,
        ledger,
        mealsByPawn,
        repeatedHarvestTiles: [...harvestTiles.values()].filter((n) => n > 1).length,
        minHunger,
        hunger: w.pawns.map((p) => p.hunger),
        health: w.pawns.map((p) => p.health),
        labour,
        jobs,
        cookingWait,
        interruptions: Object.fromEntries(transitionCounts),
        firstZero: events.filter((e) => e.type === 'FIRST_ZERO'),
      };
      mkdirSync('audit-results/survival', { recursive: true });
      writeFileSync(
        `audit-results/survival/${name}.json`,
        JSON.stringify({ ...result, events }, null, 2),
      );
      console.log('SURVIVAL', JSON.stringify(result));
      return result;
    },
  };
}
