import { expect, it } from 'vitest';
import { generateWorld } from '../../src/sim/generate';
import { Simulation } from '../../src/sim/simulation';
import { nextId } from '../../src/sim/world';
import { validateWorld } from '../../src/persistence/serialization';

it('supports twenty colonists working on an 80×80 map for ten simulated minutes', () => {
  const w = generateWorld(610);
  const originals = structuredClone(w.pawns);
  w.pawns = Array.from({ length: 20 }, (_, i) => ({
    ...structuredClone(originals[i % 3]!),
    id: nextId(w, 'pawn'),
    name: `Settler ${i + 1}`,
    x: 37 + (i % 5),
    y: 38 + Math.floor(i / 5),
    hunger: 95,
    rest: 95,
  }));
  const sim = new Simulation(w);
  sim.command({
    type: 'designate',
    points: w.nodes.filter((n) => Math.hypot(n.x - 40, n.y - 40) < 20),
  });
  sim.command({
    type: 'blueprint',
    kind: 'bed',
    points: Array.from({ length: 10 }, (_, i) => ({ x: 36 + (i % 5), y: 35 + Math.floor(i / 5) })),
  });
  const timings: number[] = [];
  const start = performance.now();
  for (let i = 0; i < 6000; i++) {
    const before = performance.now();
    sim.step();
    timings.push(performance.now() - before);
  }
  const total = performance.now() - start;
  timings.sort((a, b) => a - b);
  console.log(
    `20-pawn benchmark: ${total.toFixed(0)}ms total / 6000 ticks; p95 ${timings[Math.floor(timings.length * 0.95)]!.toFixed(2)}ms; max ${timings.at(-1)!.toFixed(2)}ms. Desktop measurement, not a phone performance claim.`,
  );
  expect(w.buildings.filter((b) => b.kind === 'bed').length).toBeGreaterThanOrEqual(8);
  expect(() => validateWorld(w)).not.toThrow();
  expect(w.pawns.filter((p) => p.health > 90).length).toBe(20);
}, 30000);
