import type { Point } from './types';

// Movement and enclosure both use cardinal connectivity; never cut a diagonal corner.
export function cardinalNeighbours(p: Point): Point[] {
  return [
    { x: p.x - 1, y: p.y },
    { x: p.x + 1, y: p.y },
    { x: p.x, y: p.y - 1 },
    { x: p.x, y: p.y + 1 },
  ];
}
