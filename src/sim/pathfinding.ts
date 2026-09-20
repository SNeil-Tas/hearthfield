import type { Point, World } from './types';
import { inside, tileKey } from './world';
import { BUILDINGS, TERRAIN } from './definitions';

// A compact binary min-heap avoids sorting the A* frontier on every expansion.
class Heap {
  entries: { key: number; score: number }[] = [];
  push(key: number, score: number) {
    const entry = { key, score };
    let i = this.entries.length;
    this.entries.push(entry);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.entries[p]!.score <= score) break;
      this.entries[i] = this.entries[p]!;
      i = p;
    }
    this.entries[i] = entry;
  }
  pop() {
    const first = this.entries[0]!;
    const last = this.entries.pop()!;
    if (this.entries.length) {
      let i = 0;
      while (i * 2 + 1 < this.entries.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.entries.length && this.entries[c + 1]!.score < this.entries[c]!.score) c++;
        if (this.entries[c]!.score >= last.score) break;
        this.entries[i] = this.entries[c]!;
        i = c;
      }
      this.entries[i] = last;
    }
    return first.key;
  }
}
export function navigationGrid(w: World): Uint8Array {
  const grid = Uint8Array.from(w.terrain, (t) => (TERRAIN[t].passable ? 1 : 0));
  for (const n of w.nodes) if (n.kind !== 'berries') grid[tileKey(w, n)] = 0;
  for (const b of w.buildings) if (BUILDINGS[b.kind].blocks) grid[tileKey(w, b)] = 0;
  // Resource entities occupy storage, never pawn navigation cells.
  return grid;
}
export function findPath(
  w: World,
  from: Point,
  to: Point,
  adjacent = false,
  grid = navigationGrid(w),
): Point[] | null {
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  if (!inside(w, start) || !inside(w, to)) return null;
  const goals = adjacent
    ? [
        { x: to.x - 1, y: to.y },
        { x: to.x + 1, y: to.y },
        { x: to.x, y: to.y - 1 },
        { x: to.x, y: to.y + 1 },
      ]
    : [to];
  const valid = goals.filter((p) => inside(w, p) && grid[tileKey(w, p)] === 1);
  if (!valid.length) return null;
  const direct = (goal: Point, horizontalFirst: boolean) => {
    const result: Point[] = [];
    let x = start.x,
      y = start.y;
    const axes = horizontalFirst ? (['x', 'y'] as const) : (['y', 'x'] as const);
    for (const axis of axes) {
      const end = axis === 'x' ? goal.x : goal.y;
      while ((axis === 'x' ? x : y) !== end) {
        if (axis === 'x') x += Math.sign(end - x);
        else y += Math.sign(end - y);
        const p = { x, y };
        if (!grid[tileKey(w, p)]) return null;
        result.push(p);
      }
    }
    return result;
  };
  for (const goal of valid) {
    const straight = direct(goal, true) ?? direct(goal, false);
    if (straight) return straight;
  }
  const goalKeys = new Set(valid.map((p) => tileKey(w, p)));
  const startKey = tileKey(w, start);
  if (goalKeys.has(startKey)) return [];
  const size = w.width * w.height;
  const cost = new Float64Array(size).fill(Infinity),
    previous = new Int32Array(size).fill(-1),
    closed = new Uint8Array(size);
  const heap = new Heap();
  let expansions = 0;
  cost[startKey] = 0;
  heap.push(startKey, 0);
  while (heap.entries.length) {
    if (++expansions > 700) return null;
    const key = heap.pop();
    if (closed[key]) continue;
    closed[key] = 1;
    if (goalKeys.has(key)) {
      const result: Point[] = [];
      let k = key;
      while (k !== startKey) {
        result.push({ x: k % w.width, y: Math.floor(k / w.width) });
        k = previous[k]!;
      }
      return result.reverse();
    }
    const x = key % w.width,
      y = Math.floor(key / w.width);
    for (const p of [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ]) {
      if (!inside(w, p)) continue;
      const k = tileKey(w, p);
      if (!grid[k] || closed[k]) continue;
      const g = cost[key]! + 1;
      if (g < cost[k]!) {
        cost[k] = g;
        previous[k] = key;
        const h = Math.min(...valid.map((v) => Math.abs(v.x - p.x) + Math.abs(v.y - p.y)));
        heap.push(k, g + h);
      }
    }
  }
  return null;
}
