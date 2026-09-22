# Architecture

## Ownership and data flow

```text
Pointer / DOM UI → typed Command → Simulation → plain World state → Canvas + DOM UI
                                      ↕
                              versioned save codec
                                      ↕
                            IndexedDB / JSON export
```

Simulation modules have no browser, renderer or DOM dependencies. Rendering reads the world and never changes gameplay state. UI state, camera, time multiplier and renderer smoothing are ephemeral. The only production dependencies are browser APIs; npm packages are development/build/test tools.

| Boundary         | Location                                      | Responsibility                                                                     |
| ---------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Bootstrap        | `src/main.ts`                                 | Compose services, dispatch actions, frame loop, lifecycle and persistence          |
| World / entities | `src/sim/types.ts`, `world.ts`, `generate.ts` | Plain state, identity, coordinates, physical stacks, seeded generation             |
| Content          | `src/sim/definitions.ts`                      | Terrain, buildings, resource nodes, costs, yields, work and labels                 |
| Commands         | `src/sim/commands.ts`                         | Validate player intent; cancel safely; never grant instant resources               |
| Clock            | `src/sim/clock.ts`                            | Fixed 100 ms ticks; 0/1/2/4× independent of render rate                            |
| Work discovery   | `src/sim/job-board.ts`                        | Shared work opportunities and urgent personal needs                                |
| Assignment       | `src/sim/job-assignment.ts`                   | Priorities, skills, distance, reachability and atomic claims                       |
| Execution        | `src/sim/jobs.ts`                             | Travel, carrying, harvest/work progress, delivery, consumption, completion         |
| Needs            | `src/sim/needs.ts`                            | Hunger, rest, health effects, derived mood and interruption                        |
| Reservations     | `src/sim/reservations.ts`                     | Atomic multi-key claims and owner-wide release                                     |
| Navigation       | `src/sim/pathfinding.ts`                      | Four-way A*, binary heap, isolated walkability grid including loose item occupancy |
| Events           | `src/sim/events.ts`                           | Bounded simulation event journal                                                   |
| Camera / render  | `src/view/`                                   | Screen/world conversion, zoom, culling, original shapes, visual smoothing          |
| Touch            | `src/input/gestures.ts`                       | Pointer tracking, thresholded taps, pan, pinch, area/line previews                 |
| UI / selection   | `src/ui/`                                     | HUD, context, work priorities, panels, tool and selection state                    |
| Saves            | `src/persistence/`                            | Validation, codec, database, recovery and browser writer lock                      |

## Time and execution

The simulation advances at **10 Hz**. Movement updates each tick; needs, spoilage, illness and work-board rebuilding run at **1 Hz**. Idle pawns scan on staggered one-second schedules, with at most two candidate path attempts per assignment after ranking. Failed routes receive a ten-second retry cooldown, cleared after player commands. Work changes dirty the shared board; it is never rebuilt at rendering frequency.

The frame accumulator caps elapsed time at 250 ms to avoid catch-up spirals. At 4× this is at most ten ticks per render. Long stalls therefore slow simulated time rather than triggering an unbounded catch-up. Hidden documents do not advance simulation. Renderer-only exponential smoothing makes 10 Hz pawn movement visually continuous; it never determines positions, arrival or work completion.

Generation uses an explicit seed and a small deterministic PRNG. Subsequent simulation ticks do not call wall-clock time or random functions. The same initial world and tick-ordered commands yield the same state. `savedAt` is persistence metadata, not a simulation input.

## Work and physical logistics

Priorities range from 1–4; zero disables a work type. The score combines priority, Manhattan distance, skill and delivery distance. Eating, exhaustion and emergency foraging are higher than normal work, regardless of disabled work preferences. Skills currently affect gathering/build speed and candidate rank; they do not improve through use.

A job has a kind, reserved keys, source/target IDs, destination, cached path, phase and progress. The lifecycle is:

1. Generate available work from designations, blueprints and loose items.
2. Filter/rank candidates by pawn preferences, needs, cooldown and existing reservations.
3. Find both pickup and delivery routes before reserving a logistics job.
4. Atomically reserve the source and destination/task.
5. Walk the cached route; pick up up to the resource-specific effective carry capacity; walk to the destination.
6. Work, deposit or consume; then release all ownership keys.

The source stack, construction task, bed, and haul destination cell use exclusive keys. Multiple colonists cannot consume the same stack, work the same blueprint or occupy the same bed concurrently. Pawns themselves do not block movement: they can pass one another, avoiding a premature crowd/traffic simulation.

Cancellation and urgent needs drop carried resources before clearing the job and reservations. Blueprint cancellation also refunds delivered wood. Harvest and construction progress belong to world objects, so interruption does not erase completed work. Build completion converts delivered wood into a building, after which that wood is no longer loose inventory. A wall cannot finish over a colonist; idle occupants autonomously step aside. Doors and beds are passable.

Compatible deposits merge into an existing stack up to its resource cap before creating overflow. Raw food caps at 100, spoiled food at 30, and wood/stone retain their existing unconstrained stack semantics. Active job sources/targets are excluded from idle consolidation so reservations remain stable.

## Navigation and scope of optimization

The 80×80 navigation grid marks deep water, trees, stone outcrops and completed walls impassable. All world resource items, crops, berry bushes, doors and beds are traversable at normal movement cost. Blueprints do not block until built. Item pickup and haul delivery retain adjacent interaction. Item creation/removal never writes collision cells. Storage capacity and blueprint placement remain separate from navigation. A direct Manhattan route is attempted before A* to keep ordinary open-map movement cheap.

A* uses Manhattan distance and a binary heap. Paths are retained for the job, and the next tile is revalidated as the pawn moves. A blocked route aborts safely and returns to normal job selection. The grid refreshes on world topology changes and at the slow system rate.

The current board rebuild is linear over world objects, with delivery/stockpile candidate cross-products. Low-priority consolidation targets compatible partial stacks only when it removes a source stack and materially reduces fragmentation. It is adequate for the measured first slice, not a claim of unlimited scaling. Large blueprint fields, fragmented stacks and frequent unreachable routes are the likely next pressure points. Add spatial buckets, connectivity labels and dirty indices when measured workloads justify them; keep the pathfinder API isolated.

## Rendering and mobile interaction

Canvas 2D was chosen for small moving populations, a simple original shape vocabulary, and zero runtime dependency. It culls to the visible tile/entity bounds and caps backing resolution at device pixel ratio 2. It requires no image decoding, network art, sprite atlas or WebGL context recovery. Reconsider Pixi/WebGL if device profiles show fill/object costs or visual requirements exceed Canvas.

Normal play uses tap-to-select and one-finger pan after a seven-pixel drag threshold. Tool mode maps a one-finger drag to an area designation, an axis-aligned wall line, or single placement. Two fingers always pan/zoom, including during tools; adding a second pointer cancels the one-finger preview. Pointer cancellation does not commit a command. `touch-action: none` and overscroll suppression isolate map gestures from the browser.

DOM panels use safe-area insets and 44 px action targets. Work/settings/journal temporarily occupy most of a phone screen. Selection/catalogue updates avoid replacing buttons during a held pointer interaction. The UI updates at up to 5 Hz, independently of the map render. No hover or long-press interaction is required.

## Persistence and migration

Save envelope version **3** contains a millisecond timestamp, JSON payload and FNV integrity checksum. The checksum detects accidental corruption; it is not an authentication mechanism. World validation rejects unknown definitions, invalid quantities/coordinates/needs, duplicate identities and invalid ID sequences before state reaches gameplay.

IndexedDB database `hearthfield`, schema 1, contains `saves/latest` and `saves/backup`. Both writes occur in one transaction; queued snapshots preserve local write ordering. Page hide also writes a best-effort synchronous recovery envelope to localStorage. Resume validates all candidates and picks the newest valid timestamp. Complete read failure never silently overwrites the original data.

Active jobs are intentionally ephemeral across a load: drop cargo exactly once into a new physical stack, snap to the nearest tile, clear jobs, then let assignment rebuild ownership. Persistent object progress and delivered quantities survive. This reduces the migration surface of the scheduler. Future schema changes must add explicit version dispatch/migration in the codec; do not reinterpret a newer payload as v1.

Web Locks hold an exclusive writer for the page lifetime where supported; a competing tab cannot save, import or start a replacement. In insecure HTTP contexts without that API, the application requires the user to keep a single active tab.

Production builds generate a service worker with exact hashed asset filenames. The worker serves immutable assets from the precache, uses network-first navigation with the cached shell as an offline fallback, and scopes cleanup to this app's caches. A waiting worker responds to an explicit `SKIP_WAITING` message; the page offers Reload and performs one guarded reload on `controllerchange`. Static asset matches ignore `Vary` because module and precache requests differ in Origin headers, although the same-origin immutable file contents do not. A real Chromium offline reload verifies this path.

The static deployment remains a Vite build published by GitHub Pages. `index.html`, the manifest, service-worker registration, and generated asset references use relative paths so a project-page subpath works without changing simulation or persistence code. Each production build emits a fresh worker cache name; registration requests an update, while the worker waits for old tabs to close before claiming the next launch.

## Survival loop additions

Growing zones are persistent tile keys. A zone creates a sow candidate for an empty tile; sowing creates a persistent `Crop` entity. Crop growth advances every ten simulation ticks toward a 2,400-tick maturity period, independent of rendering. Mature crops create harvest candidates and yield physical raw food stacks. The existing Plants/Gather work priority, paths, and reservations govern both sowing and harvesting.

Food remains a physical `food` resource with an optional `foodType`: legacy and harvested food is `raw`, while cooking produces `meal`. A cooking station is an ordinary blueprint/building. Its automatic job reserves one raw stack and the station, gathers up to 100 fresh points per trip, consumes the 100-point recipe over time, and drops one meal item. Sources are ranked by useful pickup relative to travel cost. Meals are ranked ahead of raw food for hungry colonists and restore more hunger. The station stops automatically when six meals are available.

Completed buildings can be marked for deconstruction. The existing Build work path reserves the building, removes it after work completes, and drops 60% of its wood cost as a normal physical stack. Unfinished blueprints still use their separate cancellation/refund path.

Rooms and roofs are derived runtime state owned by `roomTopology(world)`. Completed walls/doors invalidate an outside-in cardinal flood; unreached non-boundary components become rooms with IDs and door connections. Automatic roofs cover enclosed interiors and are removed on breach, independently of enclosure data. Indoors requires both enclosure and roofing. Outdoor/unroofed beds receive 15% slower recovery, including owned beds; indoor food storage and roof-based rain protection use the same authoritative queries. Schema remains 5. See [room topology](docs/room-topology.md) for lifecycle, geometry, API and limitations.

Weather/exposure is centralised in `src/sim/weather.ts`: seeded weighted Clear/Rain/Heavy rain/Storm periods, roof-authoritative rain exposure, and persistent pawn wetness updated once per second. Existing rain food/field-work effects use its queries; wetness contributes a small mood effect. See [weather](docs/weather.md) for rates, transitions, save defaults and limits.

Save envelopes are version 5. Loading version 1/2/3/4 adds safe agriculture, weather, food-expiry, mood/productivity, food-point, Dump-zone and neutral ownership defaults before normal validation. Missing wetness defaults to dry and missing weather start time defaults to load tick, including older schema 5 saves. Job state remains ephemeral across loading, so reservations and carried ingredients are reconstructed safely.

Raw food items retain a physical stack with fractional `freshPoints` and `spoiledPoints`; meals remain whole items worth 80 points. Cooking stations own a transient `ingredientFresh` buffer and `cookingProgress` while reserved by one pawn. Interrupted cooking refunds buffered fresh points as physical food. More than 10 spoiled points are separated into expiry-tracked physical `waste` items capped at 30, traversable like other resources. Dump zones are persistent tile designations. Spoilage uses indoor shelter, exposed weather, and a bounded 8-neighbour waste-contamination multiplier.

In v0.5.3, assignment compares semantic self-care tiers before numeric scores: prepared meal, eligible emergency food, personal food preparation, rest, ordinary work. Reservations and paths are checked before assignment; all food candidates can be checked even when the two-attempt ordinary-work budget is exhausted. Personal recipe admission counts reachable, unreserved fresh ingredients. Required separation runs at the source inside the cooking job; general separation is Haul work. Cooking claims the station at assignment and a personal cook transitions synchronously to an eat job holding its exact output's reservation. Critical hunger (<20) checks for a ready meal even during cooking/separation; interruption refunds the station buffer and cargo before claiming that meal. No schema change or item relocation is required.
