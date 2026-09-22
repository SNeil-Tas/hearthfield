# Rooms and shelter

`roomTopology(world)` owns one derived `RoomTopology` per world in a WeakMap. It is
not serialized. `getRoomAt`, `isOutside`, `isEnclosed`, `isRoofed`, `isSheltered`,
`isIndoors`, and `environmentAt` are constant-time tile lookups after a rebuild.
Coordinates round to the same tile as the existing simulation. Boundary tiles
belong to neither outside nor a room; inspectors label them Boundary.

## Algorithm and geometry

1. Mark completed walls and doors in a boundary mask. Construction plans, including
   delivered and partially worked plans, live in `world.blueprints` and do not count.
2. Seed every non-boundary edge tile and flood cardinal neighbours into outside.
3. Flood each remaining non-boundary component into a room.
4. Derive roofs and collect door portals between rooms and outside.

Pathfinding and topology share `cardinalNeighbours`. Neither permits diagonal
steps, so touching corners seal consistently. Navigation occupancy is deliberately
separate: water, trees, resource outcrops and furniture are not structural walls.
Rock terrain is walkable ground, not a cave wall. There is currently no structural
terrain type or terrain-changing command requiring topology invalidation.

Doors are always movement-passable (colonists automatically open them); there is
no stored open/closed state. Completed doors always block the enclosure flood.
Adjacent door tiles form a portal, including thick doorways. Rooms list their
door IDs, neighbouring room IDs, and direct portal connection to outside.
`connectsOutside` does not claim pawn reachability or a transitive route outside:
resource obstacles and navigation costs are separate. Sealed rooms need no doors.

Room records contain ID, tile keys, area, doors, neighbours, direct outside
connection and roofed area. IDs are reused by greatest overlap, then lowest ID;
on a split, the first component in row-major order can retain the old ID. IDs
are stable for unaffected rooms but record objects are replaced on rebuild.
Consumers should query by tile or ID again after topology changes. Save/load may
renumber rooms. Rebuild summaries count created/removed IDs and overlapping
merged/split components; those counts describe geometry, not building identities.

## Invalidation and roofing

Completed wall/door creation and actual demolition invalidate topology in the job
lifecycle itself, including when jobs run outside `Simulation`. Designation,
blueprint edits, bed/cooking construction and door passage do not invalidate it.
Queries ensure freshness; simulation steps ensure it at their boundaries. Multiple
changes coalesce until a consumer needs fresh data or the step ends. A consumer
between changes may cause an intermediate rebuild, intentionally avoiding stale
gameplay effects. No render-frame flood or pawn-specific world scan is needed.
Future direct structural mutations must call `invalidate(reason)`.

Automatic roofing covers all room interior tiles, with no size/support limit.
Breaching an exterior boundary removes the affected automatic roofs; restoring
enclosure restores them. This is a derived policy, not simulated roof collapse.
Roof arrays are independent of membership: `setRoof(tile, true/false/undefined)`
supports explicit runtime roof/unroof/return-to-automatic overrides, partial
coverage and outdoor shelter without rebuilding rooms. Overrides survive topology
rebuilds but are **runtime-only**. No current player tool or gameplay system creates
them. A future persistent roof editing feature must add save storage and migration.
Courtyards are enclosed components and automatically roofed under the initial
policy; semantic courtyard recognition is deliberately absent.

## Gameplay, inspection and diagnostics

- Indoors means both enclosed and roofed. Sheltered means roofed.
- Owned indoor beds retain 5.2 rest/second; other indoor beds retain 4.2. Outdoor or
  unroofed beds receive a 0.85 multiplier, including owned beds. Ground sleep is unchanged.
- Raw food receives the existing 0.78 spoilage multiplier only indoors. Roofing
  alone prevents the existing rain/heavy-rain spoilage multiplier. Meal lifetime,
  cooking, contamination and baseline raw-food decay constants are unchanged.
- Roof shelter prevents the existing rain slowdown for gathering, chopping,
  sowing and harvesting at the pawn's tile. There is no new temperature model.
- The existing selection inspector shows location, room ID, roof and exposure
  for colonists, objects and tiles. Normal HUD layout is unchanged.
- Indoor ground uses a warm earth colour, directly from `isIndoors(tile)`. It
  returns to the original terrain colour on breach or loss of roofing. This is
  visual feedback only, not constructed flooring or another completion rule.
  Existing texture, zone markings and objects render above the ground colour;
  wall and door tiles never receive the indoor tint.
- Debug exports include room summaries and colonist/food/cooking environment;
  colonist text exports include environment. Rebuild events include reasons,
  room/roofed-area counts and created/removed/merged/split counts. No per-tick
  tile dump is logged.

Schema remains **5**. Existing structures reconstruct rooms and automatic roofs
on first query or Simulation initialization; save payloads and migration are unchanged.
The old `shelteredTiles` helper remains a compatibility snapshot; production
consumers use topology queries. Legacy set arguments on job/spoilage helpers are
ignored so callers cannot override the authoritative environment.

No room naming, quality, ownership, thermal simulation, roof support/collapse,
manual roof UI, building grouping or room overlay is introduced.
