import { it, expect } from 'vitest';
import { generateWorld } from '../../src/sim/generate';
import { Simulation } from '../../src/sim/simulation';
import { ensureAgricultureTile } from '../../src/sim/agriculture';
import { dropFood, nextId, tileKey, freshPoints } from '../../src/sim/world';
import { observeSurvival } from './survival-observer';

for (const abundant of [false, true])
  it(
    `investigates ${abundant ? 'C abundant' : 'B new colony'}`,
    () => {
      const w = generateWorld(42);
      // Preserve real terrain, nodes, supplies, needs, skills and default priorities.
      // Establish the ordinary survival infrastructure once; no intervention thereafter.
      w.buildings.push({ id: nextId(w, 'building'), kind: 'cooking', x: 40, y: 41 });
      for (let i = 0; i < 3; i++)
        w.buildings.push({ id: nextId(w, 'building'), kind: 'bed', x: 38 + i, y: 38 });
      for (let y = 36; y < 40; y++)
        for (let x = 40; x < 45; x++) {
          const key = tileKey(w, { x, y });
          w.growingZones.push(key);
          ensureAgricultureTile(w, key, 'potato');
        }
      if (abundant) dropFood(w, { x: 40, y: 42 }, 6000);
      const sim = new Simulation(w);
      const observer = observeSurvival(sim, abundant ? 'C-abundant' : 'B-new-colony');
      for (let tick = 0; tick < 240000; tick++) {
        // C isolates logistics, not crop balance: record every external raw-food input.
        if (
          abundant &&
          tick % 6000 === 0 &&
          w.items.reduce((n, i) => n + (i.foodType === 'raw' ? freshPoints(i) : 0), 0) < 1000
        ) {
          dropFood(w, { x: 40, y: 42 }, 1000);
          observer.addInput(1000);
        }
        sim.step();
        observer.step();
      }
      const result = observer.finish();
      expect(result.ledger.maxError).toBeLessThan(1e-5);
      expect(result.minHunger.every((h) => h > 0)).toBe(true);
      // Every pawn repeatedly consumes prepared meals; raw/foraged meals are
      // separately included in FOOD_CONSUMED rather than conflated with cooking.
      expect(result.mealsByPawn.every((n) => n >= 2)).toBe(true);
      const nonAgriculturalTicks = result.jobs.reduce(
        (n, jobs) =>
          n +
          ['haul', 'gather', 'chop', 'build', 'deliver'].reduce(
            (sum, kind) => sum + (jobs[kind] ?? 0),
            0,
          ),
        0,
      );
      expect(nonAgriculturalTicks).toBeGreaterThan(result.ticks * w.pawns.length * 0.01);
      expect(result.repeatedHarvestTiles).toBeGreaterThan(0);
      expect(result.counts.PLANTING_COMPLETED).toBeGreaterThan(20);
      expect(result.counts.WATERING_COMPLETED).toBeGreaterThan(0);
      expect(result.counts.FERTILIZER_APPLIED).toBeGreaterThan(0);
    },
    abundant ? 900000 : 600000,
  );
