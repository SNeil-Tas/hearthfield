import { BUILDINGS, NODES, TERRAIN } from '../sim/definitions';
import { formatResourcePoints } from '../ui/format';
import type { AnimalSpecies, BuildingKind, Point, World } from '../sim/types';
import type { UIState } from '../ui/state';
import { Camera } from './camera';
import { roomTopology } from '../sim/topology';
import { precipitationIntensity } from '../sim/weather';
import { waterSalinityAt, waterSourceClass } from '../sim/agriculture';
import type { WorldFeedback } from '../sim/simulation';
import { ANIMALS, animalStage } from '../sim/ecology';
import { agingProgress, lifeStageScale, isAdult } from '../sim/health';

// Warm earth tone signals recognised indoor ground; entities and zones draw above it.
const INDOOR_FLOOR_COLOR = '#b0a184';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private visualPawns = new Map<string, Point>();
  private visualAnimals = new Map<string, Point>();
  private rainTime = 0;
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
  draw(
    w: World,
    ui: UIState,
    elapsed = 1 / 60,
    paused = false,
    feedback: readonly WorldFeedback[] = [],
  ) {
    const c = this.ctx,
      cam = this.camera,
      z = cam.zoom,
      topology = roomTopology(w);
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
        const waterClass =
          terrain === 'water' ? waterSourceClass(waterSalinityAt(w, y * w.width + x)) : null;
        c.fillStyle = topology.isIndoors({ x, y })
          ? INDOOR_FLOOR_COLOR
          : waterClass === 'saltwater'
            ? '#496f82'
            : waterClass === 'brackish'
              ? '#627e72'
              : TERRAIN[terrain].color;
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
    // Presentation-only rain, drawn behind entities. No particle state touches World.
    if (!paused) this.rainTime += Math.max(0, Math.min(elapsed, 0.1));
    const rain = precipitationIntensity(w);
    if (rain > 0) {
      const count = Math.min(80, Math.ceil(((cam.width * cam.height) / 12000) * rain));
      c.strokeStyle = rain === 1 ? '#dbe8e956' : '#dbe8e973';
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i < count; i++) {
        const x = ((i * 137.5 + this.rainTime * 25) % (cam.width + 20)) - 10;
        const y = ((i * 83.7 + this.rainTime * (160 + rain * 30)) % (cam.height + 20)) - 10;
        const length = 5 + rain * 2;
        if (
          topology.isSheltered(cam.world({ x, y })) ||
          topology.isSheltered(cam.world({ x: x - 2, y: y + length }))
        )
          continue;
        c.moveTo(x, y);
        c.lineTo(x - 2, y + length);
      }
      c.stroke();
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
        } else if (item.resource === 'fertilizer') {
          c.fillStyle = '#806b4e';
          this.ellipse(p.x, p.y + z * 0.03, z * 0.27, z * 0.19);
          c.strokeStyle = '#b4c98d';
          c.lineWidth = Math.max(1.5, z * 0.06);
          c.beginPath();
          c.moveTo(p.x, p.y);
          c.lineTo(p.x, p.y - z * 0.24);
          c.stroke();
          c.fillStyle = '#9eb67c';
          this.ellipse(p.x - z * 0.08, p.y - z * 0.18, z * 0.1, z * 0.06);
          this.ellipse(p.x + z * 0.08, p.y - z * 0.23, z * 0.1, z * 0.06);
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
    for (const animal of w.animals)
      if (visible(animal)) {
        const previous = this.visualAnimals.get(animal.id) ?? animal;
        const blend =
          paused || Math.hypot(previous.x - animal.x, previous.y - animal.y) > 3
            ? 1
            : 1 - Math.exp(-Math.max(0, elapsed) * 12);
        const position = {
          x: previous.x + (animal.x - previous.x) * blend,
          y: previous.y + (animal.y - previous.y) * blend,
        };
        this.visualAnimals.set(animal.id, position);
        const p = cam.screen(position);
        if (ui.selectedId === animal.id) {
          c.strokeStyle = '#fff1c9';
          c.lineWidth = 2;
          c.beginPath();
          c.ellipse(p.x, p.y + z * 0.1, z * 0.48, z * 0.3, 0, 0, Math.PI * 2);
          c.stroke();
        }
        this.animal(animal.species, p, z, animalStage(animal) === 'juvenile' ? 0.72 : 1);
        if (ui.selectedId === animal.id || ui.debug) {
          c.textAlign = 'center';
          c.font = `600 ${Math.max(9, z * 0.27)}px system-ui`;
          c.fillStyle = '#f7edd2';
          c.strokeStyle = '#334c39';
          c.lineWidth = 3;
          c.strokeText(ANIMALS[animal.species].name, p.x, p.y + z * 0.62);
          c.fillText(ANIMALS[animal.species].name, p.x, p.y + z * 0.62);
        }
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
        const size = z * lifeStageScale(pawn);
        const aging = agingProgress(pawn);
        const stoop = size * aging * 0.12;
        c.fillStyle = pawn.color;
        this.ellipse(p.x, p.y + size * 0.05, size * 0.21, size * (0.27 - aging * 0.05));
        c.fillStyle = '#e6c6a1';
        this.circle(p.x + stoop, p.y - size * 0.22 + stoop, size * 0.16);
        c.fillStyle = `rgb(${Math.round(81 + aging * 133)}, ${Math.round(75 + aging * 139)}, ${Math.round(61 + aging * 146)})`;
        c.beginPath();
        c.arc(p.x + stoop, p.y - size * 0.26 + stoop, size * 0.16, Math.PI, Math.PI * 2);
        c.fill();
        if (pawn.pregnancy || (!isAdult(pawn) && (pawn.care < 30 || !topology.isIndoors(pawn)))) {
          c.fillStyle = pawn.pregnancy ? '#e8a9bc' : '#efb760';
          this.circle(p.x + z * 0.28, p.y - size * 0.28, z * 0.07);
        }
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
    for (const thought of feedback) {
      const pawn = w.pawns.find((candidate) => candidate.id === thought.entityId);
      if (!pawn || !visible(pawn)) continue;
      const position = this.visualPawns.get(pawn.id) ?? pawn;
      const p = cam.screen(position);
      const fontSize = Math.max(11, Math.min(14, z * 0.34));
      const width = thought.text.length * fontSize * 0.56 + 16;
      const height = fontSize + 10;
      const x = p.x - width / 2;
      const y = p.y - z * 0.82 - height;
      c.fillStyle = '#fff8e8e8';
      c.fillRect(x, y, width, height);
      c.fillStyle = '#fff8e8e8';
      c.beginPath();
      c.moveTo(p.x - 4, y + height);
      c.lineTo(p.x + 4, y + height);
      c.lineTo(p.x, y + height + 6);
      c.fill();
      c.fillStyle = '#2d3d32';
      c.font = `600 ${fontSize}px system-ui`;
      c.textAlign = 'center';
      c.fillText(thought.text, p.x, y + fontSize + 3);
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
  private animal(species: AnimalSpecies, p: Point, z: number, lifeScale: number) {
    const c = this.ctx;
    const def = ANIMALS[species];
    const speciesScale = species === 'bison' ? 1.18 : species === 'rabbit' ? 0.7 : 1;
    const s = lifeScale * speciesScale;
    c.fillStyle = '#20372745';
    this.ellipse(p.x + z * 0.05, p.y + z * 0.23, z * 0.34 * s, z * 0.11 * s);
    c.fillStyle = def.color;
    this.ellipse(p.x, p.y + z * 0.03, z * 0.31 * s, z * 0.19 * s);
    const facing = species === 'fox' || species === 'wolf' ? 1 : -1;
    c.fillStyle = def.accent;
    this.circle(p.x + facing * z * 0.27 * s, p.y - z * 0.08 * s, z * 0.12 * s);
    c.strokeStyle = def.color;
    c.lineWidth = Math.max(1, z * 0.055 * s);
    c.beginPath();
    c.moveTo(p.x - z * 0.16 * s, p.y + z * 0.14 * s);
    c.lineTo(p.x - z * 0.17 * s, p.y + z * 0.31 * s);
    c.moveTo(p.x + z * 0.16 * s, p.y + z * 0.14 * s);
    c.lineTo(p.x + z * 0.17 * s, p.y + z * 0.31 * s);
    c.stroke();
    if (species === 'rabbit') {
      c.strokeStyle = def.accent;
      c.lineWidth = z * 0.07 * s;
      c.beginPath();
      c.moveTo(p.x - z * 0.2 * s, p.y - z * 0.14 * s);
      c.lineTo(p.x - z * 0.24 * s, p.y - z * 0.39 * s);
      c.moveTo(p.x - z * 0.12 * s, p.y - z * 0.14 * s);
      c.lineTo(p.x - z * 0.1 * s, p.y - z * 0.4 * s);
      c.stroke();
    } else if (species === 'deer') {
      c.strokeStyle = '#d9c69b';
      c.lineWidth = Math.max(1, z * 0.035 * s);
      c.beginPath();
      c.moveTo(p.x - z * 0.27 * s, p.y - z * 0.17 * s);
      c.lineTo(p.x - z * 0.38 * s, p.y - z * 0.36 * s);
      c.moveTo(p.x - z * 0.38 * s, p.y - z * 0.3 * s);
      c.lineTo(p.x - z * 0.47 * s, p.y - z * 0.34 * s);
      c.stroke();
    } else if (species === 'boar') {
      c.fillStyle = '#e5d7b5';
      this.circle(p.x - z * 0.34 * s, p.y, z * 0.035 * s);
    } else if (species === 'bison') {
      c.fillStyle = '#403329';
      this.ellipse(p.x - z * 0.17 * s, p.y - z * 0.06 * s, z * 0.2 * s, z * 0.22 * s);
    } else {
      c.fillStyle = def.accent;
      c.beginPath();
      c.moveTo(p.x - facing * z * 0.27 * s, p.y);
      c.lineTo(p.x - facing * z * 0.52 * s, p.y - z * 0.09 * s);
      c.lineTo(p.x - facing * z * 0.43 * s, p.y + z * 0.1 * s);
      c.fill();
    }
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
