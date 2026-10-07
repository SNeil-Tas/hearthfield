import { BUILDINGS, DAY_TICKS, NODES } from './definitions';
import { emit } from './events';
import { isAdult } from './health';
import type { Candidate } from './job-board';
import { findPath, navigationGrid } from './pathfinding';
import { roomTopology } from './topology';
import type { Blueprint, HousingDesign, HousingProject, Pawn, Point, World } from './types';
import { distance, nextId, tileKey } from './world';

export const HOUSING_INTERVAL = 300;
export const MAX_HOUSING_PROJECTS = 3;
export const HOUSING_DESIGN_WORK = 8;
export const HOUSING_LABELS: Record<HousingDesign, string> = {
  shelter: 'simple shelter',
  cottage: 'cottage',
  house: 'two-room home',
  beds: 'extra indoor beds',
};

/** Knowledge limits design complexity; practical ability must support that knowledge. */
export function housingDesignFor(pawn: Pawn): Exclude<HousingDesign, 'beds'> | undefined {
  const ability = Math.min(pawn.knowledge.building, pawn.skills.build);
  return ability >= 12 ? 'house' : ability >= 6 ? 'cottage' : ability >= 2 ? 'shelter' : undefined;
}

export function householdMembers(w: World, adult: Pawn) {
  const adults = new Set([adult.id]);
  const partner = w.pawns.find((p) => p.id === adult.partnerId && isAdult(p) && p.health > 0);
  if (partner) adults.add(partner.id);
  const fallback = w.pawns.find((p) => isAdult(p) && p.health > 0)?.id;
  return w.pawns.filter((p) => {
    if (p.health <= 0) return false;
    if (adults.has(p.id)) return true;
    if (isAdult(p)) return false;
    const parents = p.parentIds.filter((id) =>
      w.pawns.some((parent) => parent.id === id && isAdult(parent) && parent.health > 0),
    );
    return parents.length
      ? parents.some((id) => adults.has(id))
      : adults.has(p.caregiverId ?? fallback ?? '');
  });
}

function plannedTopology(w: World) {
  return roomTopology({
    ...w,
    buildings: [...w.buildings.filter((b) => !b.deconstructing), ...w.blueprints],
  });
}

/** Adopt spare/player-planned indoor beds before requesting any new construction. */
function claimAvailableBeds(w: World, grid: Uint8Array) {
  const topology = plannedTopology(w);
  const beds = [...w.buildings, ...w.blueprints].filter(
    (b) => b.kind === 'bed' && !b.deconstructing && topology.isIndoors(b),
  );
  for (const bed of beds)
    if (bed.ownerId && !w.pawns.some((p) => p.id === bed.ownerId && p.health > 0))
      bed.ownerId = undefined;
  const covered = new Set(w.housingProjects.filter((p) => p.design).flatMap((p) => p.memberIds));
  for (const pawn of [...w.pawns].sort((a, b) => Number(isAdult(a)) - Number(isAdult(b)))) {
    if (pawn.health <= 0 || covered.has(pawn.id) || beds.some((b) => b.ownerId === pawn.id))
      continue;
    const bed = beds
      .filter((b) => !b.ownerId)
      .sort((a, b) => distance(pawn, a) - distance(pawn, b))
      .find((b) => findPath(w, pawn, b, false, grid) !== null);
    if (bed) bed.ownerId = pawn.id;
  }
}

function hasPlannedHousing(w: World, pawn: Pawn, grid: Uint8Array, topology = plannedTopology(w)) {
  return [...w.buildings, ...w.blueprints].some(
    (b) =>
      b.kind === 'bed' &&
      b.ownerId === pawn.id &&
      !b.deconstructing &&
      topology.isIndoors(b) &&
      findPath(w, pawn, b, false, grid) !== null,
  );
}

/** Leaves physical materials/plans intact; cancellation cannot mint or destroy resources. */
export function abandonHousingProject(w: World, id: string) {
  const project = w.housingProjects.find((p) => p.id === id);
  if (!project) return;
  for (const pawn of w.pawns)
    if (project.memberIds.includes(pawn.id)) pawn.nextHousingAttempt = w.tick + DAY_TICKS;
  for (const b of [...w.blueprints, ...w.buildings])
    if (b.housingProjectId === id) b.housingProjectId = undefined;
  w.housingProjects = w.housingProjects.filter((p) => p.id !== id);
  w.jobPosts = w.jobPosts.filter((p) => p.housingProjectId !== id);
}

export function advanceHousing(w: World, grid = navigationGrid(w)) {
  for (const project of [...w.housingProjects]) {
    project.memberIds = project.memberIds.filter((id) => w.pawns.some((p) => p.id === id));
    if (!project.memberIds.length) {
      abandonHousingProject(w, project.id);
      continue;
    }
    const requester = w.pawns.find((p) => p.id === project.requestedBy && p.health > 0);
    if (!requester) {
      const successor = w.pawns.find((p) => project.memberIds.includes(p.id) && isAdult(p));
      if (successor) project.requestedBy = successor.id;
      else {
        abandonHousingProject(w, project.id);
        continue;
      }
    }
    if (project.design && !w.blueprints.some((b) => b.housingProjectId === project.id)) {
      emit(w, `The ${HOUSING_LABELS[project.design]} is ready for its household.`, 'success');
      // Completed beds retain ownership; a new child can trigger a later addition.
      w.housingProjects = w.housingProjects.filter((p) => p.id !== project.id);
      for (const b of w.buildings)
        if (b.housingProjectId === project.id) b.housingProjectId = undefined;
    }
  }
  claimAvailableBeds(w, grid);
  const topology = plannedTopology(w);
  // Player construction or a newly vacant bed can satisfy a request while it awaits design.
  for (const project of [...w.housingProjects]) {
    if (project.design) continue;
    project.memberIds = project.memberIds.filter((id) => {
      const member = w.pawns.find((p) => p.id === id);
      return member && !hasPlannedHousing(w, member, grid, topology);
    });
    if (!project.memberIds.length) abandonHousingProject(w, project.id);
  }
  const covered = new Set(w.housingProjects.flatMap((p) => p.memberIds));
  const adults = w.pawns
    .filter((p) => isAdult(p) && p.health > 0)
    .map((pawn) => ({ pawn, household: householdMembers(w, pawn) }))
    .sort(
      (a, b) =>
        Number(b.household.some((p) => !isAdult(p))) - Number(a.household.some((p) => !isAdult(p))),
    );
  for (const { pawn, household } of adults) {
    if (w.housingProjects.length >= MAX_HOUSING_PROJECTS) break;
    if ((pawn.nextHousingAttempt ?? 0) > w.tick || pawn.hunger < 38 || pawn.rest < 28) continue;
    const missing = household
      .filter(
        (member) =>
          !covered.has(member.id) &&
          (member.nextHousingAttempt ?? 0) <= w.tick &&
          !hasPlannedHousing(w, member, grid, topology),
      )
      .sort((a, b) => Number(isAdult(a)) - Number(isAdult(b)))
      .slice(0, 8);
    if (!missing.length) continue;
    const project: HousingProject = {
      id: nextId(w, 'home'),
      x: Math.round(pawn.x),
      y: Math.round(pawn.y),
      requestedBy: pawn.id,
      memberIds: missing.map((p) => p.id),
      createdAt: w.tick,
      designWork: 0,
      retryAt: w.tick,
      timberIds: [],
    };
    w.housingProjects.push(project);
    missing.forEach((p) => covered.add(p.id));
    emit(
      w,
      `${pawn.name} wants shelter and beds for ${missing.some((p) => !isAdult(p)) ? 'their family' : 'their household'}${housingDesignFor(pawn) ? '.' : ' and is asking for design help.'}`,
    );
  }
  requestHousingTimber(w, grid);
}

/** Budget every outstanding plan and every physical/in-transit timber stack once. */
function requestHousingTimber(w: World, grid: Uint8Array) {
  for (const project of w.housingProjects) {
    project.timberIds = project.timberIds.filter((id) =>
      w.nodes.some((n) => n.id === id && n.designated),
    );
    if (!project.design) continue;
    const requester = w.pawns.find((p) => p.id === project.requestedBy)!;
    const reachable = (point: Point) => findPath(w, requester, point, true, grid) !== null;
    const demand = w.blueprints
      .filter(reachable)
      .reduce((sum, b) => sum + Math.max(0, BUILDINGS[b.kind].cost - b.delivered), 0);
    const supply =
      w.items
        .filter((i) => i.resource === 'wood' && reachable(i))
        .reduce((n, i) => n + i.quantity, 0) +
      w.pawns
        .filter(reachable)
        .reduce((n, p) => n + (p.carrying?.resource === 'wood' ? p.carrying.quantity : 0), 0) +
      w.nodes.filter((n) => n.kind === 'tree' && n.designated && reachable(n)).length *
        NODES.tree.yield;
    let shortfall = demand - supply;
    if (shortfall <= 0) continue;
    for (const tree of w.nodes
      .filter((n) => n.kind === 'tree' && !n.designated)
      .sort((a, b) => distance(project, a) - distance(project, b))) {
      if (!reachable(tree)) continue;
      tree.designated = true;
      project.timberIds.push(tree.id);
      shortfall -= NODES.tree.yield;
      if (shortfall <= 0) break;
    }
  }
}

function occupiedTiles(w: World) {
  return new Set(
    [...w.nodes, ...w.items, ...w.buildings, ...w.blueprints, ...w.crops]
      .map((p) => tileKey(w, p))
      .concat(w.stockpiles, w.dumpZones, w.growingZones),
  );
}

/** Prefer adding beds to reachable existing shelter, especially a parent's room. */
function indoorBedPlans(w: World, project: HousingProject, grid: Uint8Array) {
  const occupied = occupiedTiles(w);
  const topology = roomTopology(w);
  const relativeBeds = w.buildings.filter(
    (b) => b.kind === 'bed' && b.ownerId === project.requestedBy,
  );
  const rooms = [...topology.rooms].sort((a, b) => {
    const familyRoom = (id: number) =>
      relativeBeds.some((bed) => topology.getRoomAt(bed)?.id === id);
    return Number(familyRoom(b.id)) - Number(familyRoom(a.id));
  });
  for (const room of rooms) {
    const points = room.tiles
      .filter((key) => !occupied.has(key))
      .map((key) => ({ x: key % w.width, y: Math.floor(key / w.width) }))
      .filter((p) => topology.isIndoors(p) && findPath(w, project, p, false, grid) !== null);
    if (points.length >= project.memberIds.length)
      return project.memberIds.map((ownerId, i) => ({
        ...points[i]!,
        kind: 'bed' as const,
        ownerId,
      }));
  }
  return undefined;
}

type Piece = Point & { kind: 'wall' | 'door' | 'bed'; ownerId?: string };
function layout(project: HousingProject, design: Exclude<HousingDesign, 'beds'>) {
  const innerWidth = design === 'house' ? 5 : design === 'cottage' ? 3 : 2;
  const innerHeight = Math.max(
    design === 'shelter' ? 2 : 3,
    Math.ceil(project.memberIds.length / 2),
  );
  const width = innerWidth + 2,
    height = innerHeight + 2;
  const pieces: Piece[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
        pieces.push({ x, y, kind: x === 1 && y === height - 1 ? 'door' : 'wall' });
  if (design === 'house')
    for (let y = 1; y <= innerHeight; y++)
      pieces.push({ x: 3, y, kind: y === innerHeight ? 'door' : 'wall' });
  project.memberIds.forEach((ownerId, i) =>
    pieces.push({
      x: i % 2 === 0 ? 1 : innerWidth,
      y: 1 + Math.floor(i / 2),
      kind: 'bed',
      ownerId,
    }),
  );
  return { width, height, pieces };
}

/** A clear one-tile perimeter preserves circulation around every autonomous house. */
function findHomeSite(
  w: World,
  project: HousingProject,
  design: Exclude<HousingDesign, 'beds'>,
  grid: Uint8Array,
) {
  const { width, height, pieces } = layout(project, design);
  const occupied = occupiedTiles(w);
  for (const pawn of w.pawns) occupied.add(tileKey(w, pawn));
  const origins: Point[] = [];
  for (let y = Math.max(1, project.y - 20); y < Math.min(w.height - height, project.y + 20); y++)
    for (let x = Math.max(1, project.x - 20); x < Math.min(w.width - width, project.x + 20); x++)
      origins.push({ x, y });
  origins.sort((a, b) => distance(project, a) - distance(project, b));
  for (const origin of origins) {
    let clear = true;
    for (let y = origin.y - 1; clear && y <= origin.y + height; y++)
      for (let x = origin.x - 1; x <= origin.x + width; x++) {
        const key = y * w.width + x;
        if (!grid[key] || occupied.has(key)) {
          clear = false;
          break;
        }
      }
    if (!clear) continue;
    const door = { x: origin.x + 1, y: origin.y + height - 1 };
    if (findPath(w, project, door, false, grid) === null) continue;
    return pieces.map((piece) => ({ ...piece, x: origin.x + piece.x, y: origin.y + piece.y }));
  }
  return undefined;
}

export function finishHousingDesign(
  w: World,
  project: HousingProject,
  designer: Pawn,
  grid: Uint8Array,
) {
  let design: HousingDesign | undefined = housingDesignFor(designer);
  if (!design) return false;
  let pieces: Piece[] | undefined = indoorBedPlans(w, project, grid);
  if (pieces) design = 'beds';
  else {
    // A skilled colonist can settle for a simpler, smaller home when land is tight.
    const options = (['house', 'cottage', 'shelter'] as const).slice(
      ['house', 'cottage', 'shelter'].indexOf(design),
    );
    for (const option of options) {
      pieces = findHomeSite(w, project, option, grid);
      if (pieces) {
        design = option;
        break;
      }
    }
  }
  if (!pieces) {
    project.retryAt = w.tick + HOUSING_INTERVAL * 4;
    return false;
  }
  project.design = design;
  project.designerId = designer.id;
  for (const piece of pieces) {
    const blueprint: Blueprint = {
      ...piece,
      id: nextId(w, 'blueprint'),
      delivered: 0,
      work: 0,
      housingProjectId: project.id,
    };
    w.blueprints.push(blueprint);
  }
  emit(
    w,
    `${designer.name} designed ${HOUSING_LABELS[design]} with ${project.memberIds.length} ${project.memberIds.length === 1 ? 'bed' : 'beds'}.`,
    'success',
  );
  requestHousingTimber(w, grid);
  return true;
}

export function housingDesignCandidates(w: World): Candidate[] {
  return w.housingProjects
    .filter((p) => !p.design && p.retryAt <= w.tick)
    .map((p) => ({
      kind: 'design',
      targetId: p.id,
      destination: p,
      adjacent: false,
      keys: [p.id],
      work: 'build',
      score: -15,
      housingProjectId: p.id,
    }));
}

export function housingStatus(w: World, pawn: Pawn) {
  const project = w.housingProjects.find(
    (p) => p.memberIds.includes(pawn.id) || p.requestedBy === pawn.id,
  );
  if (project) {
    if (!project.design)
      return project.retryAt > w.tick
        ? 'Looking for room to build'
        : 'Planning a home · design help welcome';
    const plans = w.blueprints.filter((b) => b.housingProjectId === project.id);
    const wood = plans.reduce((n, b) => n + BUILDINGS[b.kind].cost - b.delivered, 0);
    return `${HOUSING_LABELS[project.design]} · ${plans.length} pieces left · ${wood} wood to deliver`;
  }
  const bed = w.buildings.find(
    (b) =>
      b.kind === 'bed' &&
      b.ownerId === pawn.id &&
      !b.deconstructing &&
      roomTopology(w).isIndoors(b),
  );
  return bed
    ? 'Own indoor bed'
    : (pawn.nextHousingAttempt ?? 0) > w.tick
      ? 'Housing plans deferred'
      : 'Needs an indoor bed';
}
