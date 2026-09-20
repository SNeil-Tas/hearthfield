import { describe, expect, it } from 'vitest';
import { findPath, navigationGrid } from '../../src/sim/pathfinding';
import { updateNeeds } from '../../src/sim/needs';
import { checksum, decode, encode } from '../../src/persistence/serialization';
import { drop } from '../../src/sim/world';
import { Simulation } from '../../src/sim/simulation';
import { flatWorld } from './fixtures';

describe('v0.3 friction systems', () => {
  it('keeps loose stacks walkable and adjacency pickup reachable', () => {
    const w = flatWorld();
    drop(w, { x: 4, y: 3 }, 'wood', 12);
    expect(navigationGrid(w)[4 + 3 * w.width]).toBe(1);
    expect(findPath(w, { x: 3, y: 3 }, { x: 4, y: 3 }, true)).toEqual([]);
  });

  it('charges more hunger and rest for hauling than idling', () => {
    const idle = flatWorld().pawns[0]!;
    const haulingWorld = flatWorld();
    const hauling = haulingWorld.pawns[0]!;
    hauling.carrying = { resource: 'wood', quantity: 12 };
    updateNeeds(flatWorld(), idle);
    updateNeeds(haulingWorld, hauling);
    expect(hauling.hunger).toBeLessThan(idle.hunger);
    expect(hauling.rest).toBeLessThan(idle.rest);
  });

  it('tracks readable food spoilage and preserves safe v2 defaults', () => {
    const w = flatWorld();
    drop(w, { x: 3, y: 3 }, 'food', 4);
    const save = encode(w);
    const old = JSON.parse(save.payload);
    delete old.weather;
    delete old.weatherUntil;
    for (const item of old.items) delete item.spoilsAt;
    const payload = JSON.stringify(old);
    const migrated = decode({ ...save, version: 2, payload, checksum: checksum(payload) });
    expect(migrated.world.weather).toBe('clear');
    expect(migrated.world.items[0]!.spoilsAt).toBeGreaterThan(migrated.world.tick);
    migrated.world.tick = migrated.world.items[0]!.spoilsAt! - 100;
    const sim = new Simulation(migrated.world);
    for (let i = 0; i < 100; i++) sim.step();
    expect(migrated.world.items[0]!.spoiled).toBe(true);
  });

  it('claims an unclaimed bed and gives its owner the stronger rest recovery', () => {
    const w = flatWorld();
    w.pawns = [w.pawns[0]!];
    w.pawns[0]!.rest = 20;
    w.buildings.push({ id: 'building-999', x: 4, y: 3, kind: 'bed' });
    const sim = new Simulation(w);
    for (let i = 0; i < 200; i++) sim.step();
    expect(w.buildings[0]!.ownerId).toBe(w.pawns[0]!.id);
    expect(w.pawns[0]!.rest).toBeGreaterThan(20);
  });
});
