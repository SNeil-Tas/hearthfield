import { BUILDINGS, NODES, TERRAIN } from '../sim/definitions';
import { formatResourcePoints } from '../ui/format';
import type { BuildingKind, Point, World } from '../sim/types';
import type { UIState } from '../ui/state';
import { Camera } from './camera';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private visualPawns = new Map<string, Point>();
  constructor(
    private canvas: HTMLCanvasElement,
    public camera: Camera,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    this.ctx = ctx;
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 2);
    this.camera.width = rect.width;
    this.camera.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  draw(w: World, ui: UIState, elapsed = 1 / 60, paused = false) {
    const c = this.ctx,
      cam = this.camera,
      z = cam.zoom;
    cam.mapWidth = w.width;
    cam.mapHeight = w.height;
    cam.clamp();
    c.fillStyle = '#354b41';
    c.fillRect(0, 0, cam.width, cam.height);
    const min = cam.world({ x: -z * 2, y: -z * 2 }),
      max = cam.world({ x: cam.width + z * 2, y: cam.height + z * 2 });
    const visible = (p: Point) => p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y;
    for (let y = Math.max(0, Math.floor(min.y)); y <= Math.min(w.height - 1, Math.ceil(max.y)); y++)
      for (
        let x = Math.max(0, Math.floor(min.x));
        x <= Math.min(w.width - 1, Math.ceil(max.x));
        x++
      ) {
        const p = cam.screen({ x, y }),
          terrain = w.terrain[y * w.width + x]!,
          hash = ((x * 73856093) ^ (y * 19349663) ^ w.seed) >>> 0;
        c.fillStyle = TERRAIN[terrain].color;
        c.fillRect(p.x - z / 2, p.y - z / 2, z + 1, z + 1);
        c.fillStyle = hash % 2 ? '#ffffff05' : '#122b1406';
        c.fillRect(p.x - z / 2, p.y - z / 2, z, z);
        if (terrain === 'water') {
          c.strokeStyle = '#a5c4bb35';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(p.x - z * 0.25, p.y + ((hash % 9) - 4));
          c.lineTo(p.x + z * 0.2, p.y + ((hash % 9) - 4));
          c.stroke();
        } else if (hash % 3 === 0 && z > 18) {
          c.strokeStyle = terrain === 'rock' ? '#626f653b' : '#344d3036';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(p.x - 3, p.y + 2);
          c.lineTo(p.x - 4, p.y - 2);
          c.moveTo(p.x, p.y + 2);
          c.lineTo(p.x + 2, p.y - 3);
          c.stroke();
        }
      }
    for (const key of w.stockpiles) {
      const tile = { x: key % w.width, y: Math.floor(key / w.width) };
      if (!visible(tile)) continue;
      const p = cam.screen(tile);
      c.fillStyle = '#dbce9050';
      c.fillRect(p.x - z / 2 + 1, p.y - z / 2 + 1, z - 2, z - 2);
      c.strokeStyle = '#eddfa36b';
      c.lineWidth = 1;
      c.strokeRect(p.x - z / 2 + 1, p.y - z / 2 + 1, z - 2, z - 2);
    }
    for (const key of w.dumpZones) {
      const tile = { x: key % w.width, y: Math.floor(key / w.width) };
      if (!visible(tile)) continue;
      const p = cam.screen(tile);
      c.fillStyle = '#9d6f6348';
      c.fillRect(p.x - z / 2 + 1, p.y - z / 2 + 1, z - 2, z - 2);
      c.strokeStyle = '#d49a7a99';
      c.setLineDash([3, 3]);
      c.strokeRect(p.x - z / 2 + 1, p.y - z / 2 + 1, z - 2, z - 2);
      c.setLineDash([]);
    }
    for (const key of w.growingZones) {
      const tile = { x: key % w.width, y: Math.floor(key / w.width) };
      if (!visible(tile)) continue;
      const p = cam.screen(tile);
      c.fillStyle = '#a9bd7440';
      c.fillRect(p.x - z / 2 + 1, p.y - z / 2 + 1, z - 2, z - 2);
      c.strokeStyle = '#d8d38a99';
      c.strokeRect(p.x - z / 2 + 1, p.y - z / 2 + 1, z - 2, z - 2);
    }
    for (const crop of w.crops)
      if (visible(crop)) {
        const p = cam.screen(crop);
        const height = z * (0.12 + crop.growth * 0.32);
        c.strokeStyle = crop.growth >= 1 ? '#f2d47e' : '#9fbd68';
        c.lineWidth = Math.max(1.5, z * 0.08);
        c.beginPath();
        c.moveTo(p.x, p.y + z * 0.25);
        c.lineTo(p.x, p.y + z * 0.25 - height);
        c.moveTo(p.x, p.y + z * 0.05);
        c.lineTo(p.x - z * 0.16, p.y - z * 0.08);
        c.moveTo(p.x, p.y - z * 0.02);
        c.lineTo(p.x + z * 0.16, p.y - z * 0.14);
        c.stroke();
      }
    for (const b of w.blueprints)
      if (visible(b)) {
        const p = cam.screen(b);
        c.fillStyle = '#c5e2df24';
        c.fillRect(p.x - z * 0.43, p.y - z * 0.43, z * 0.86, z * 0.86);
        c.setLineDash([4, 3]);
        c.strokeStyle = '#d2f0e7';
        c.lineWidth = 1.5;
        c.strokeRect(p.x - z * 0.43, p.y - z * 0.43, z * 0.86, z * 0.86);
        c.setLineDash([]);
        c.globalAlpha = 0.35;
        this.building(b.kind, p, z);
        c.globalAlpha = 1;
        if (b.delivered) {
          c.fillStyle = '#f2cc7f';
          c.fillRect(
            p.x - z * 0.4,
            p.y + z * 0.38,
            (z * 0.8 * b.delivered) / BUILDINGS[b.kind].cost,
            3,
          );
        }
      }
    for (const b of w.buildings)
      if (visible(b)) {
        this.building(b.kind, cam.screen(b), z);
        if (b.deconstructing) {
          const p = cam.screen(b);
          c.strokeStyle = '#efaa8a';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(p.x - z * 0.35, p.y - z * 0.35);
          c.lineTo(p.x + z * 0.35, p.y + z * 0.35);
          c.moveTo(p.x + z * 0.35, p.y - z * 0.35);
          c.lineTo(p.x - z * 0.35, p.y + z * 0.35);
          c.stroke();
        }
      }
    for (const item of w.items)
      if (visible(item)) {
        const p = cam.screen(item);
        c.fillStyle = '#20322235';
        this.ellipse(p.x + 2, p.y + z * 0.17, z * 0.3, z * 0.16);
        if (item.resource === 'wood') {
          c.fillStyle = '#a9774d';
          c.fillRect(p.x - z * 0.29, p.y - z * 0.13, z * 0.58, z * 0.27);
          c.fillStyle = '#deb580';
          this.circle(p.x + z * 0.28, p.y, z * 0.14);
          c.strokeStyle = '#6e583d';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(p.x - 2, p.y - z * 0.14);
          c.lineTo(p.x - 2, p.y + z * 0.14);
          c.stroke();
        } else if (item.resource === 'food') {
          c.fillStyle = '#d4ac70';
          this.ellipse(p.x, p.y, z * 0.23, z * 0.21);
          c.fillStyle = '#a36c4c';
          c.fillRect(p.x - 3, p.y - z * 0.22, 6, 3);
        } else if (item.resource === 'waste') {
          c.fillStyle = '#76534d';
          this.ellipse(p.x, p.y, z * 0.25, z * 0.2);
          c.fillStyle = '#b38a62';
          c.fillRect(p.x - z * 0.12, p.y - z * 0.08, z * 0.24, z * 0.16);
        } else {
          c.fillStyle = '#b6b8a9';
          this.ellipse(p.x, p.y, z * 0.25, z * 0.17);
        }
        if (z >= 28) {
          c.font = 'bold 9px system-ui';
          c.textAlign = 'center';
          c.fillStyle = '#f5f1db';
          c.strokeStyle = '#435540';
          c.lineWidth = 3;
          c.strokeText(formatResourcePoints(item.quantity), p.x, p.y + z * 0.42);
          c.fillText(formatResourcePoints(item.quantity), p.x, p.y + z * 0.42);
        }
      }
    for (const node of w.nodes)
      if (visible(node)) {
        const p = cam.screen(node);
        c.fillStyle = '#213c263b';
        this.ellipse(p.x + z * 0.12, p.y + z * 0.24, z * 0.48, z * 0.23);
        if (node.kind === 'tree') {
          c.fillStyle = '#785e40';
          c.fillRect(p.x - z * 0.07, p.y, z * 0.14, z * 0.38);
          for (const [dy, size, color] of [
            [0.03, 0.48, '#365b41'],
            [-0.2, 0.39, '#476b48'],
            [-0.41, 0.28, '#5d7c50'],
          ] as const) {
            c.fillStyle = color;
            c.beginPath();
            c.moveTo(p.x, p.y + (dy - size) * z);
            c.lineTo(p.x + size * z, p.y + (dy + size * 0.45) * z);
            c.quadraticCurveTo(
              p.x,
              p.y + (dy + size * 0.8) * z,
              p.x - size * z,
              p.y + (dy + size * 0.45) * z,
            );
            c.closePath();
            c.fill();
          }
        } else if (node.kind === 'stone') {
          c.fillStyle = '#778780';
          this.ellipse(p.x, p.y, z * 0.41, z * 0.31);
          c.fillStyle = '#adb2a0';
          this.ellipse(p.x - z * 0.08, p.y - z * 0.1, z * 0.3, z * 0.22);
          c.strokeStyle = '#dde0cb55';
          c.beginPath();
          c.moveTo(p.x - z * 0.25, p.y - z * 0.1);
          c.lineTo(p.x, p.y - z * 0.22);
          c.stroke();
        } else {
          c.fillStyle = '#496346';
          this.circle(p.x, p.y, z * 0.33);
          c.fillStyle = '#667f4e';
          this.circle(p.x - z * 0.1, p.y - z * 0.12, z * 0.23);
          c.fillStyle = '#d39a79';
          for (const [dx, dy] of [
            [-0.15, 0],
            [0.12, -0.13],
            [0.16, 0.12],
          ])
            this.circle(p.x + dx! * z, p.y + dy! * z, z * 0.055);
        }
        if (node.designated) {
          c.strokeStyle = '#f4d498';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(p.x - 4, p.y - 4);
          c.lineTo(p.x + 4, p.y + 4);
          c.moveTo(p.x + 4, p.y - 4);
          c.lineTo(p.x - 4, p.y + 4);
          c.stroke();
        }
        if (node.work) {
          c.fillStyle = '#efcc83';
          c.fillRect(
            p.x - z * 0.3,
            p.y + z * 0.4,
            (z * 0.6 * node.work) / NODES[node.kind].work,
            2,
          );
        }
      }
    if (ui.debug)
      for (const pawn of w.pawns)
        if (pawn.job) {
          c.strokeStyle = pawn.color;
          c.lineWidth = 1.5;
          c.setLineDash([4, 5]);
          c.beginPath();
          let p = cam.screen(pawn);
          c.moveTo(p.x, p.y);
          for (const tile of pawn.job.path) {
            p = cam.screen(tile);
            c.lineTo(p.x, p.y);
          }
          c.stroke();
          c.setLineDash([]);
        }
    for (const pawn of w.pawns)
      if (visible(pawn)) {
        const previous = this.visualPawns.get(pawn.id) ?? pawn;
        const blend =
          paused || Math.hypot(previous.x - pawn.x, previous.y - pawn.y) > 3
            ? 1
            : 1 - Math.exp(-Math.max(0, elapsed) * 22);
        const position = {
          x: previous.x + (pawn.x - previous.x) * blend,
          y: previous.y + (pawn.y - previous.y) * blend,
        };
        this.visualPawns.set(pawn.id, position);
        const p = cam.screen(position);
        c.fillStyle = '#20372750';
        this.ellipse(p.x + 2, p.y + z * 0.22, z * 0.25, z * 0.13);
        if (ui.selectedId === pawn.id) {
          c.strokeStyle = '#fff1c9';
          c.lineWidth = 2;
          c.beginPath();
          c.ellipse(p.x, p.y + z * 0.15, z * 0.4, z * 0.24, 0, 0, Math.PI * 2);
          c.stroke();
        }
        c.fillStyle = pawn.color;
        this.ellipse(p.x, p.y + z * 0.05, z * 0.21, z * 0.27);
        c.fillStyle = '#e6c6a1';
        this.circle(p.x, p.y - z * 0.22, z * 0.16);
        c.fillStyle = '#514b3d';
        c.beginPath();
        c.arc(p.x, p.y - z * 0.26, z * 0.16, Math.PI, Math.PI * 2);
        c.fill();
        if (pawn.carrying) {
          c.fillStyle = pawn.carrying.resource === 'wood' ? '#be8c57' : '#e2b76e';
          c.fillRect(p.x + z * 0.09, p.y - 2, z * 0.21, z * 0.21);
        }
        c.textAlign = 'center';
        c.font = `600 ${Math.max(10, z * 0.32)}px system-ui`;
        c.fillStyle = '#faf4dc';
        c.strokeStyle = '#334c39';
        c.lineWidth = 3;
        const label =
          pawn.job?.kind === 'sleep' && !pawn.job.path.length ? `${pawn.name} · zZ` : pawn.name;
        c.strokeText(label, p.x, p.y + z * 0.68);
        c.fillText(label, p.x, p.y + z * 0.68);
      }
    const selected = [...w.nodes, ...w.items, ...w.buildings, ...w.blueprints].find(
      (e) => e.id === ui.selectedId,
    );
    if (selected) {
      const p = cam.screen(selected);
      c.strokeStyle = '#fff1c9';
      c.lineWidth = 2;
      c.strokeRect(p.x - z * 0.5, p.y - z * 0.5, z, z);
    }
    for (const tile of ui.preview)
      if (visible(tile)) {
        const p = cam.screen(tile);
        c.fillStyle = ui.tool === 'cancel' ? '#e3a17d66' : '#e2efbd66';
        c.fillRect(p.x - z / 2 + 1, p.y - z / 2 + 1, z - 2, z - 2);
      }
  }
  private circle(x: number, y: number, radius: number) {
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }
  private ellipse(x: number, y: number, rx: number, ry: number) {
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }
  private building(kind: BuildingKind, p: Point, z: number) {
    const c = this.ctx;
    c.fillStyle = '#263a3440';
    c.fillRect(p.x - z * 0.38 + 3, p.y - z * 0.36 + 4, z * 0.8, z * 0.8);
    if (kind === 'bed') {
      c.fillStyle = '#725a42';
      c.fillRect(p.x - z * 0.35, p.y - z * 0.43, z * 0.7, z * 0.86);
      c.fillStyle = '#92ae9d';
      c.fillRect(p.x - z * 0.29, p.y - z * 0.1, z * 0.58, z * 0.45);
      c.fillStyle = '#e9dfb9';
      c.fillRect(p.x - z * 0.26, p.y - z * 0.33, z * 0.52, z * 0.2);
    } else if (kind === 'cooking') {
      c.fillStyle = '#765b46';
      c.fillRect(p.x - z * 0.4, p.y - z * 0.35, z * 0.8, z * 0.7);
      c.fillStyle = '#d8b56f';
      this.circle(p.x, p.y - z * 0.12, z * 0.18);
      c.fillStyle = '#b7c9a3';
      c.fillRect(p.x - z * 0.22, p.y + z * 0.18, z * 0.44, z * 0.08);
    } else {
      c.fillStyle = kind === 'wall' ? '#a9926c' : '#6b5941';
      c.fillRect(p.x - z * 0.45, p.y - z * 0.4, z * 0.9, z * 0.8);
      c.strokeStyle = '#dcc6a073';
      c.lineWidth = 1;
      c.strokeRect(p.x - z * 0.4, p.y - z * 0.35, z * 0.8, z * 0.7);
      c.strokeStyle = '#594d3655';
      c.beginPath();
      c.moveTo(p.x - z * 0.42, p.y);
      c.lineTo(p.x + z * 0.42, p.y);
      c.stroke();
      if (kind === 'door') {
        c.fillStyle = '#d2b76c';
        this.circle(p.x + z * 0.24, p.y + z * 0.13, 2);
      }
    }
  }
}
