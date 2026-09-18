import type { Point, World } from '../sim/types';
export function selectAt(w: World, p: Point) {
  const hit = (e: Point, radius = 0.6) =>
    Math.abs(e.x - p.x) < radius && Math.abs(e.y - p.y) < radius;
  return (
    w.pawns.find((e) => hit(e, 0.7)) ??
    w.blueprints.find((e) => hit(e)) ??
    w.buildings.find((e) => hit(e)) ??
    w.nodes.find((e) => hit(e)) ??
    w.items.find((e) => hit(e)) ??
    w.crops.find((e) => hit(e))
  );
}
