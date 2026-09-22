import type { BuildingKind, Point, World } from './types';
import { cardinalNeighbours } from './geometry';

export interface Room {
  id: number;
  tiles: number[];
  area: number;
  doorIds: string[];
  neighbours: number[];
  connectsOutside: boolean;
  roofedArea: number;
}

export const isRoomBoundary = (kind: BuildingKind) => kind === 'wall' || kind === 'door';

/** Derived runtime state, deliberately absent from World/save JSON. */
export class RoomTopology {
  private dirty = new Set(['initial world/load']);
  private boundary = new Uint8Array(0);
  private outside = new Uint8Array(0);
  private roomIds = new Int32Array(0);
  private roofs = new Uint8Array(0);
  // Runtime overrides reserve independent roof semantics for tests/future roof systems.
  // Current gameplay only creates automatic roofs, so no persistent information is lost.
  private roofOverrides = new Map<number, boolean>();
  private records = new Map<number, Room>();
  private nextId = 1;
  rebuildCount = 0;
  lastChange = { reasons: [] as string[], created: 0, removed: 0, merged: 0, split: 0 };
  onRebuild?: (topology: RoomTopology) => void;

  constructor(private readonly world: World) {}

  invalidate(reason: string) {
    this.dirty.add(reason);
  }

  private key(p: Point) {
    const x = Math.round(p.x),
      y = Math.round(p.y);
    return x >= 0 && y >= 0 && x < this.world.width && y < this.world.height
      ? y * this.world.width + x
      : -1;
  }

  ensure() {
    if (!this.dirty.size) return this;
    const w = this.world,
      size = w.width * w.height;
    const oldIds = this.roomIds,
      oldRooms = this.records;
    this.boundary = new Uint8Array(size);
    this.outside = new Uint8Array(size);
    this.roomIds = new Int32Array(size);
    this.roofs = new Uint8Array(size);
    this.records = new Map();
    // Water, rocky ground, trees and mineable resource nodes are not structural walls.
    // Construction remains in blueprints (including delivered/partly worked plans).
    for (const b of w.buildings) if (isRoomBoundary(b.kind)) this.boundary[this.key(b)] = 1;
    const neighbours = (key: number) =>
      cardinalNeighbours({ x: key % w.width, y: Math.floor(key / w.width) })
        .map((p) => this.key(p))
        .filter((k) => k >= 0);
    const queue: number[] = [];
    const seed = (key: number) => {
      if (!this.boundary[key] && !this.outside[key]) {
        this.outside[key] = 1;
        queue.push(key);
      }
    };
    for (let x = 0; x < w.width; x++) {
      seed(x);
      seed((w.height - 1) * w.width + x);
    }
    for (let y = 0; y < w.height; y++) {
      seed(y * w.width);
      seed(y * w.width + w.width - 1);
    }
    for (let head = 0; head < queue.length; head++)
      for (const k of neighbours(queue[head]!)) seed(k);

    const visited = new Uint8Array(size),
      used = new Set<number>();
    const descendants = new Map<number, number>();
    let merged = 0;
    for (let start = 0; start < size; start++) {
      if (this.boundary[start] || this.outside[start] || visited[start]) continue;
      const tiles = [start];
      visited[start] = 1;
      for (let head = 0; head < tiles.length; head++)
        for (const k of neighbours(tiles[head]!))
          if (!this.boundary[k] && !this.outside[k] && !visited[k]) {
            visited[k] = 1;
            tiles.push(k);
          }
      const overlap = new Map<number, number>();
      for (const k of tiles)
        if (oldIds[k]) overlap.set(oldIds[k]!, (overlap.get(oldIds[k]!) ?? 0) + 1);
      for (const id of overlap.keys()) descendants.set(id, (descendants.get(id) ?? 0) + 1);
      if (overlap.size > 1) merged++;
      // Deterministic identity reuse: largest overlap, then lowest old ID. On splits,
      // the first component in row-major order retains the old identity.
      const id =
        [...overlap]
          .sort((a, b) => b[1] - a[1] || a[0] - b[0])
          .find(([candidate]) => !used.has(candidate))?.[0] ?? this.nextId++;
      used.add(id);
      for (const k of tiles) this.roomIds[k] = id;
      this.records.set(id, {
        id,
        tiles,
        area: tiles.length,
        doorIds: [],
        neighbours: [],
        connectsOutside: false,
        roofedArea: 0,
      });
    }
    for (let k = 0; k < size; k++) {
      this.roofs[k] = Number(this.roofOverrides.get(k) ?? this.roomIds[k]! > 0);
      const room = this.records.get(this.roomIds[k]!);
      if (room && this.roofs[k]) room.roofedArea++;
    }
    // Connected door tiles form a portal (also handles double/thick doorways).
    const doors = new Map(
      w.buildings.filter((b) => b.kind === 'door').map((b) => [this.key(b), b.id]),
    );
    const seenDoors = new Set<number>();
    for (const start of doors.keys()) {
      if (seenDoors.has(start)) continue;
      const portal = [start],
        rooms = new Set<number>();
      let outside = false;
      seenDoors.add(start);
      for (let head = 0; head < portal.length; head++)
        for (const k of neighbours(portal[head]!)) {
          if (doors.has(k) && !seenDoors.has(k)) {
            seenDoors.add(k);
            portal.push(k);
          }
          if (this.roomIds[k]) rooms.add(this.roomIds[k]!);
          if (this.outside[k]) outside = true;
        }
      // A door on the map edge opens directly beyond the map.
      outside ||= portal.some(
        (k) =>
          k % w.width === 0 || k % w.width === w.width - 1 || k < w.width || k >= size - w.width,
      );
      for (const id of rooms) {
        const room = this.records.get(id)!;
        room.doorIds.push(...portal.map((k) => doors.get(k)!));
        room.neighbours = [
          ...new Set([...room.neighbours, ...[...rooms].filter((other) => other !== id)]),
        ].sort((a, b) => a - b);
        room.connectsOutside ||= outside;
      }
    }
    this.lastChange = {
      reasons: [...this.dirty],
      created: [...used].filter((id) => !oldRooms.has(id)).length,
      removed: [...oldRooms.keys()].filter((id) => !used.has(id)).length,
      merged,
      split: [...descendants.values()].filter((count) => count > 1).length,
    };
    this.dirty.clear();
    this.rebuildCount++;
    this.onRebuild?.(this);
    return this;
  }

  get rooms(): readonly Room[] {
    this.ensure();
    return [...this.records.values()];
  }
  getRoomAt(p: Point) {
    this.ensure();
    return this.records.get(this.roomIds[this.key(p)] ?? 0);
  }
  isOutside(p: Point) {
    this.ensure();
    return this.outside[this.key(p)] === 1;
  }
  isEnclosed(p: Point) {
    return this.getRoomAt(p) !== undefined;
  }
  isRoofed(p: Point) {
    this.ensure();
    return this.roofs[this.key(p)] === 1;
  }
  isSheltered(p: Point) {
    return this.isRoofed(p);
  }
  isIndoors(p: Point) {
    return this.isEnclosed(p) && this.isRoofed(p);
  }
  setRoof(p: Point, roofed: boolean | undefined) {
    this.ensure();
    const k = this.key(p);
    if (k < 0) return;
    if (roofed === undefined) this.roofOverrides.delete(k);
    else this.roofOverrides.set(k, roofed);
    const value = Number(roofed ?? this.roomIds[k]! > 0);
    const room = this.records.get(this.roomIds[k]!);
    if (room) room.roofedArea += value - this.roofs[k]!;
    this.roofs[k] = value;
  }
  environmentAt(p: Point) {
    const room = this.getRoomAt(p),
      roofed = this.isRoofed(p);
    const boundary = this.boundary[this.key(p)] === 1;
    return {
      location: boundary
        ? 'Boundary'
        : room
          ? roofed
            ? 'Indoors'
            : 'Enclosed, unroofed'
          : roofed
            ? 'Sheltered outdoors'
            : 'Outdoors',
      roomId: room?.id ?? null,
      outside: this.isOutside(p),
      enclosed: !!room,
      roofed,
      indoors: !!room && roofed,
      weatherExposed: !roofed,
    };
  }
  summary() {
    this.ensure();
    return {
      rebuildCount: this.rebuildCount,
      lastChange: this.lastChange,
      rooms: this.rooms.map(({ tiles: _tiles, ...room }) => room),
    };
  }
}

const topologies = new WeakMap<World, RoomTopology>();
export function roomTopology(w: World) {
  let topology = topologies.get(w);
  if (!topology) {
    topology = new RoomTopology(w);
    topologies.set(w, topology);
  }
  return topology;
}
