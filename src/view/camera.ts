import type { Point } from '../sim/types';
export class Camera {
  x = 40;
  y = 40;
  zoom = 32;
  width = 800;
  height = 400;
  mapWidth = 80;
  mapHeight = 80;
  world(screen: Point): Point {
    return {
      x: (screen.x - this.width / 2) / this.zoom + this.x,
      y: (screen.y - this.height / 2) / this.zoom + this.y,
    };
  }
  screen(world: Point): Point {
    return {
      x: (world.x - this.x) * this.zoom + this.width / 2,
      y: (world.y - this.y) * this.zoom + this.height / 2,
    };
  }
  pan(dx: number, dy: number) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }
  scale(factor: number, anchor: Point) {
    const before = this.world(anchor);
    this.zoom = Math.max(12, Math.min(64, this.zoom * factor));
    const after = this.world(anchor);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }
  clamp() {
    this.x = Math.max(0, Math.min(this.mapWidth - 1, this.x));
    this.y = Math.max(0, Math.min(this.mapHeight - 1, this.y));
  }
}
