import { describe, expect, it } from 'vitest';
import { Renderer } from '../../src/view/renderer';
import { Camera } from '../../src/view/camera';
import { roomTopology } from '../../src/sim/topology';
import { TERRAIN } from '../../src/sim/definitions';
import { nextId } from '../../src/sim/world';
import { initialUI } from '../../src/ui/state';
import { flatWorld } from './fixtures';

function scene() {
  const w = flatWorld();
  w.pawns = [];
  for (let x = 2; x <= 6; x++)
    for (let y = 2; y <= 6; y++)
      if (x === 2 || x === 6 || y === 2 || y === 6)
        w.buildings.push({
          id: nextId(w, 'building'),
          x,
          y,
          kind: x === 4 && y === 2 ? 'door' : 'wall',
        });
  const draws: { color: string; x: number; y: number; width: number }[] = [];
  const context = new Proxy(
    {
      fillStyle: '',
      fillRect(x: number, y: number, width: number) {
        draws.push({ color: this.fillStyle, x, y, width });
      },
    },
    {
      get(target, property) {
        return Reflect.get(target, property) ?? (() => {});
      },
    },
  );
  const camera = new Camera();
  camera.x = camera.y = 5;
  const renderer = new Renderer(
    { getContext: () => context } as unknown as HTMLCanvasElement,
    camera,
  );
  const draw = () => {
    draws.length = 0;
    renderer.draw(w, initialUI());
  };
  const floor = (x: number, y: number) => {
    const p = camera.screen({ x, y });
    return draws.find((d) => d.x === p.x - 16 && d.y === p.y - 16 && d.width === 33)!.color;
  };
  return { w, draws, draw, floor, topology: roomTopology(w) };
}

describe('indoor floor feedback', () => {
  it('tints only indoor ground and restores terrain immediately after breach', () => {
    const s = scene();
    s.draw();
    expect(s.floor(4, 4)).not.toBe(TERRAIN.soil.color);
    expect(s.floor(2, 4)).toBe(TERRAIN.soil.color); // Wall tile.
    expect(s.floor(4, 2)).toBe(TERRAIN.soil.color); // Door tile.
    expect(s.floor(1, 1)).toBe(TERRAIN.soil.color);
    const indoor = s.floor(4, 4),
      rebuilds = s.topology.rebuildCount;
    s.draw();
    s.draw();
    expect(s.topology.rebuildCount).toBe(rebuilds);
    const door = s.w.buildings.find((b) => b.kind === 'door')!;
    s.w.buildings = s.w.buildings.filter((b) => b !== door);
    s.topology.invalidate('breach');
    s.draw();
    expect(s.floor(4, 4)).toBe(TERRAIN.soil.color);
    s.w.blueprints.push({ ...door, work: 1, delivered: 8 });
    s.draw();
    expect(s.floor(4, 4)).toBe(TERRAIN.soil.color);
    s.w.blueprints = [];
    s.w.buildings.push(door);
    s.topology.invalidate('completed door');
    s.draw();
    expect(s.floor(4, 4)).toBe(indoor);
  });

  it('uses actual roof state, including partial roofs and outdoor shelter', () => {
    const s = scene();
    s.topology.setRoof({ x: 4, y: 4 }, false);
    s.topology.setRoof({ x: 1, y: 1 }, true);
    s.draw();
    expect(s.floor(4, 4)).toBe(TERRAIN.soil.color);
    expect(s.floor(1, 1)).toBe(TERRAIN.soil.color);
    expect(s.floor(3, 3)).not.toBe(TERRAIN.soil.color);
  });

  it('draws stockpile markings, beds and items above the floor with their original colours', () => {
    const s = scene();
    s.w.stockpiles = [4 * s.w.width + 4];
    s.w.buildings.push({ id: nextId(s.w, 'building'), x: 3, y: 3, kind: 'bed' });
    s.w.items.push({ id: nextId(s.w, 'item'), x: 4, y: 4, resource: 'wood', quantity: 5 });
    s.draw();
    const lastFloor = s.draws.reduce(
      (last, d, index) => (d.color === s.floor(4, 4) ? index : last),
      -1,
    );
    for (const color of ['#dbce9050', '#725a42', '#a9774d'])
      expect(s.draws.findIndex((d) => d.color === color)).toBeGreaterThan(lastFloor);
  });
});
