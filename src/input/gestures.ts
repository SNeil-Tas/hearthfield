import type { Point } from '../sim/types';
import type { Tool } from '../ui/state';
import { Camera } from '../view/camera';

export function gestureTiles(start: Point, end: Point, tool: Tool): Point[] {
  const a = { x: Math.round(start.x), y: Math.round(start.y) },
    b = { x: Math.round(end.x), y: Math.round(end.y) };
  const result: Point[] = [];
  if (tool === 'bed' || tool === 'door' || tool === 'cooking') return [b];
  if (tool === 'wall') {
    if (Math.abs(a.x - b.x) >= Math.abs(a.y - b.y)) b.y = a.y;
    else b.x = a.x;
  }
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
      if (result.length < 6400) result.push({ x, y });
    }
  return result;
}
export class Gestures {
  private pointers = new Map<number, Point>();
  private start: Point | null = null;
  private anchor: Point | null = null;
  private dragged = false;
  private multitouch = false;
  private suppressCommit = false;
  constructor(
    canvas: HTMLCanvasElement,
    camera: Camera,
    getTool: () => Tool,
    preview: (p: Point[]) => void,
    commit: (p: Point[]) => void,
    select: (p: Point) => void,
  ) {
    const point = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      const p = point(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 1) {
        this.start = p;
        this.anchor = camera.world(p);
        this.dragged = false;
        this.multitouch = false;
        this.suppressCommit = false;
      } else {
        this.multitouch = true;
        this.suppressCommit = true;
        preview([]);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const previous = this.pointers.get(e.pointerId);
      if (!previous) return;
      const p = point(e),
        old = [...this.pointers.values()];
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size >= 2) {
        const next = [...this.pointers.values()];
        const center = (v: Point[]) => ({ x: (v[0]!.x + v[1]!.x) / 2, y: (v[0]!.y + v[1]!.y) / 2 });
        const dist = (v: Point[]) => Math.hypot(v[0]!.x - v[1]!.x, v[0]!.y - v[1]!.y);
        const before = center(old),
          after = center(next);
        camera.pan(after.x - before.x, after.y - before.y);
        if (dist(old) > 2) camera.scale(dist(next) / dist(old), after);
        return;
      }
      if (this.multitouch) return;
      if (this.start && Math.hypot(p.x - this.start.x, p.y - this.start.y) > 7) this.dragged = true;
      if (getTool() === 'inspect') {
        if (this.dragged) camera.pan(p.x - previous.x, p.y - previous.y);
      } else if (this.anchor) preview(gestureTiles(this.anchor, camera.world(p), getTool()));
    });
    const finish = (e: PointerEvent, cancelled: boolean) => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = point(e);
      this.pointers.delete(e.pointerId);
      if (!cancelled && !this.suppressCommit && this.anchor) {
        if (getTool() !== 'inspect') commit(gestureTiles(this.anchor, camera.world(p), getTool()));
        else if (!this.dragged) select(camera.world(p));
      }
      preview([]);
      if (this.pointers.size === 1) {
        const remaining = [...this.pointers.values()][0]!;
        this.start = remaining;
        this.anchor = camera.world(remaining);
        this.dragged = true;
        this.multitouch = false;
      } else if (!this.pointers.size) {
        this.start = this.anchor = null;
        this.multitouch = false;
        this.suppressCommit = false;
      }
    };
    canvas.addEventListener('pointerup', (e) => finish(e, false));
    canvas.addEventListener('pointercancel', (e) => finish(e, true));
    canvas.addEventListener('lostpointercapture', (e) => {
      this.pointers.delete(e.pointerId);
      preview([]);
      if (!this.pointers.size) {
        this.start = this.anchor = null;
        this.dragged = false;
        this.multitouch = false;
        this.suppressCommit = false;
      }
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        camera.scale(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
      },
      { passive: false },
    );
  }
}
