# Implementation status

**Milestone:** v0.14.0 Dump-zone composting closes the renewable soil-fertility loop on the v0.13 procedural landscape release. Original GDD preserved unchanged.

**Patch:** v0.2.1 PWA update delivery fix remains the release foundation; v0.3 gameplay scope is now implemented.

## Completed

- Seeded 80×80 terrain, water barriers, trees, berry bushes and stone outcrops; original viewport-culled Canvas visuals.
- Three autonomous named colonists with random starting ages from 20–40, finite lifespans, health, recoverable work injuries, hunger, rest, derived mood, skills, priorities and inspectable jobs.
- Fixed simulation clock; pause, 1×, 2× and 4×; slow needs/assignment tiers; no render-FPS gameplay dependency.
- Shared job board, atomic reservations, ownership/release, four-way A*, cached routes, interruption and retry cooldowns.
- Complete physical loop: designation → chopping → loose wood → carrying/stockpile → blueprint delivery → work → building.
- Walls, doors, beds and stockpile zones. Cancellation refunds physical materials. Occupants make room for walls.
- Physical food consumption; urgent food interruption; autonomous emergency berry gathering; reserved beds and ground sleep.
- Touch pan/pinch/tap; area gather/cancel/stockpile; wall strokes; pointer cancellation and multi-touch safeguards; desktop equivalents.
- Sparse HUD, selection/context, dedicated work screen, activity journal, safe-area layout and portrait fallback.
- Versioned/validated IndexedDB save/load; autosave, page-hide recovery, backup selection, protected failure state, JSON import/export, new colony.
- Writer exclusion across tabs on browsers exposing Web Locks.
- Production manifest, original 192/512 px icons, standalone/landscape request, generated service worker and verified offline reload.
- Development-only debug API; optional path/tick/lock/entity diagnostics; project documentation and Git history.
- Growing zones, one grain crop, sow/harvest jobs, physical raw food, cooking stations, physical meals, meal preference, deconstruction work, shelter recognition, and sheltered-bed rest consequences.
- Activity-based metabolism; carrying has the highest hunger/rest cost and activity/productivity is inspectable.
- World resource stacks are traversable at normal movement cost; pickup/drop uses adjacent interaction and storage remains physical with resource stack caps.
- Food has simple raw/meal spoilage timers and spoiled food is retained as visible, inedible waste.
- Plants, Build and Cook skills affect deterministic work speed; hunger, rest, mood and illness modestly affect productivity.
- Agriculture Knowledge is separate from Plants skill and deterministically changes judgement of ambiguous fresh/brackish/salt irrigation sources. Selected water salinity persists in soil and affects crop growth through ordinary suitability.
- Ambiguous irrigation judgements can appear briefly above the acting colonist, salinity stress raises a transition-based notice, and the field inspector records the most recent irrigation source and colonist.
- Clear/rain/heavy-rain weather slows outdoor work; mild illness recovers naturally; beds auto-claim and prefer their owner.
- Food-pressure schema 5: raw stacks track fractional fresh/spoiled points, waste separates above an absolute 10-point threshold into 30-point expiry cohorts, Dump zones and bounded rot mood effects are supported, and pantry/weather modifiers affect spoilage.
- Dump-zone composting converts each full 30 expired waste points on a designated tile into one physical fertilizer; smaller expired remainders decay. Existing waste hauling and field-fertilizing work moves both sides of the loop, with no new save schema.
- Hungry colonists reserve cooking stations for personal 100-point-input/80-point-output meals, with multi-trip ingredient buffers and safe interruption refunds.
- Mood thresholds visibly affect productivity and bounded metabolism; hunger drain is tuned by activity and hauling remains the highest-cost activity.
- Seven persistent colony goals turn the existing bed, food, farming, cooking, and shelter systems into a readable early-game arc. The HUD shows the current goal and progress; the roadmap records completion, emits field notes and brief celebrations, and grants a small capped morale lift without adding a new resource economy.
- Busy colonists notice suitable unattended work within 16 tiles and post it to a persistent 30-entry shared board. Open posts receive a modest assignment preference, retain ordinary work priorities and path checks, show poster/claimant state in the Work screen, reopen after interruption, and disappear when their underlying work is no longer valid.
- Four herbivores (rabbits, deer, wild boars, bison) and two predators (foxes, wolves) inhabit a persistent ecology. Terrain carries regenerating wild forage; herbivores graze and flee, predators hunt configured wildlife prey or nearby colonists while hungry, nearby adults reproduce under energy/population constraints, animals mature and die, and bounded edge migration protects species from permanent local extinction. Predator attacks cause ordinary persistent injuries; attacked colonists counter automatically for only 1–3 bare-handed damage. Wildlife remains outside jobs, reservations, path occupancy, food accounting, and crops.
- New colonies select one of five deterministic landform families—river valley, twin lakes, marsh edge, highland creek, or wooded basin—with layered terrain variance, coherent fresh/brackish/salt water, habitat-aware resource clusters, a protected settlement clearing, accessible freshwater, and guaranteed onboarding supplies. Landscape identity persists in saves and is visible in the HUD and Wildlife overview.
- Colonists maintain directed opinion and familiarity for every other living settler. Nearby awake pairs periodically interact, develop friendships or rivalries, contribute a bounded social mood effect, emit major relationship milestones, and expose their bonds in the colonist inspector. Version 8 saves persist and validate the social graph while versions 1–7 migrate safely.

## Latest v0.14 verification run

- `npm run typecheck`: passed.
- `npm test -- --run`: 249/249 simulation and persistence tests passed, including dump-zone conversion, off-dump decay, partial batches, expiry-cohort idempotence, compost feedback, and the resulting fertilizer entering ordinary field work.
- `npm run build` and `npm run verify:production`: passed.
- `npm run format:check`: passed.
- `npm run test:browser`: 22/22 Chromium tests passed across desktop, landscape mobile, portrait fallback, saves, offline startup, goals, job board, wildlife, relationships, and procedural-landscape presentation.

## Latest v0.13 verification run

- `npm run typecheck`: passed.
- `npm test -- --run`: 244/244 simulation and persistence tests passed, including relationship graph integrity, proximity-gated encounters, bounded social mood effects, relationship save roundtrips, predator attacks, five-family determinism, and legacy-save migration.
- `npm run build` and `npm run verify:production`: passed.
- `npm run format:check`: passed.
- `npm run test:browser`: 22/22 Chromium tests passed across desktop, landscape mobile, portrait fallback, saves, offline startup, goals, job board, wildlife, relationships, and procedural-landscape presentation.

## Latest v0.12 verification run

- `npm run typecheck`: passed.
- `npm test -- --run`: 237/237 simulation and persistence tests passed, including colonist ages, injury/healing effects, lifespan death and cleanup, deterministic wildlife seeding, grazing, reproduction, life stages, navigation isolation, save roundtrips, and legacy-save migration.
- `npm run build` and `npm run verify:production`: passed.
- `npm run format:check`: passed.
- `npm run test:browser`: 20/20 Chromium tests passed across desktop, landscape mobile, portrait fallback, saves, offline startup, goals, the job board, wildlife overview, and individual animal inspection.

## Latest v0.11 verification run

- `npm run typecheck`: passed.
- `npm test -- --run`: 223/223 simulation and persistence tests passed, including posting, claiming, interruption reopening, invalid-work pruning, and save migration.
- `npm run build` and `npm run verify:production`: passed.
- `npm run format:check`: passed.
- `npm run test:browser`: 19/19 Chromium tests passed across desktop, landscape mobile, portrait fallback, saves, offline startup, goals, and open/claimed job-board presentation.

## Latest v0.10 verification run

- `npm run typecheck`: passed.
- `npm test -- --run`: 220/220 simulation and persistence tests passed, including goal completion, duplicate prevention, out-of-order achievement, morale bounds, and save migration.
- `npm run build`: passed; production bundle generated successfully.
- `npm run test:browser`: 18/18 Chromium tests passed across desktop, landscape mobile, portrait fallback, save/reload, offline behavior, and the colony-goal roadmap.

## Verification

- **Latest v0.2 run:** 24 simulation tests and 10 Chromium browser tests passed; TypeScript, production build/PWA verification, and formatting passed.
- The user reports that the deployed PWA passed browser play, landscape touch interaction, save/reopen, installation, installed-app reopen, offline launch, and sustained real-device play without a major mobile usability or performance blocker.

- The v0.2 verification run supersedes the earlier counts: **24 simulation tests** and **10 Chromium browser tests** passed.
- TypeScript/build, production path/PWA, and formatting checks passed. The v0.2 build is ready for the final Pages deployment.
- Actual Chromium touch events, 844×390 and 667×375 landscape, 390×844 portrait, 1440×900 desktop, save/reload and offline production reload.
- Tested a 15-minute three-colonist simulation and a ten-minute 20-colonist workload. The latter measured about 1.52 s for 6,000 ticks on this desktop (p95 1.47 ms/tick; max 14.04 ms in that run).
- Screenshots inspected. See [verification notes](docs/VERIFICATION.md) for scope and limits. The user reports the physical Android validation flow passed without a major mobile usability or performance blocker.

## Latest v0.3 verification run

- Standard system Node.js: `C:\Program Files\nodejs\node.exe` v24.19.0; npm 11.17.0.
- `npm run typecheck`: passed.
- `npm test -- --run`: 28/28 passed in 8.79 seconds.
- `npm run build`: passed; 61.73 kB JavaScript and 16.39 kB CSS before gzip.
- `npm run verify:production`: passed; relative bundle paths, manifest, icons, and generated service worker verified.
- `npm run format:check`: passed.
- `npm run test:browser`: 11/11 Chromium tests passed in 18.4 seconds, including touch, phone-sized layouts, save/reload, offline startup, and multi-tab protection. A physical Android v0.3 update check remains.

## GitHub Pages deployment

- Repository: [github.com/SNeil-Tas/hearthfield](https://github.com/SNeil-Tas/hearthfield).
- Live HTTPS site: [sneil-tas.github.io/hearthfield](https://sneil-tas.github.io/hearthfield/).
- Workflow: [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).
- Deployment run `35306828769` passed its build and deploy jobs. A live smoke test returned HTTP 200, rendered three colonists, loaded the manifest and service worker, found relative hashed assets, and reported no page errors or failed requests.
- Physical Android installation, offline launch, and sustained play were user-reported as successful. Detailed thermals, battery use, and background/reopen behavior remain useful follow-up observations.

## Verification scope

- **Desktop verification:** simulation, persistence, build, formatting, and Chromium browser tests on the development PC.
- **Emulated mobile verification:** Chromium touch events and landscape/portrait viewport checks at 844×390, 667×375, and 390×844.
- **Physical-device verification:** user-reported passed. The browser, installed PWA, save/reopen, offline launch, and sustained real-device flow worked without a major mobile usability or performance blocker. Continue reporting thermals, battery, and background behavior during survival-loop playtests.

## v0.3 friction limitations

- One grain crop only; no crop catalogue, seasons, nutrition categories, or stockpile filters. Spoilage is age-based rather than temperature-based.
- Cooking uses one automatic rule and a six-meal target; there is no bill editor, ingredient policy, or workstation queue UI.
- Shelter has room topology, independent runtime roof state and indoor floor feedback. Weather has seeded Clear/Rain/Heavy rain/Storm periods, exposure-based wetness, drying, mood effects, rain visuals and roof-aware food/field-work hooks. Room quality, temperature, airflow and weather avoidance AI remain deferred. See `docs/weather.md` and `docs/room-topology.md`.
- Blocked-work explanations cover common construction and cooking shortages in context panels; unreachable-job diagnosis remains intentionally lightweight.

## Partial systems and known limitations

- **Survival/content:** finite wild food/trees plus one renewable grain crop and automatic simple meals. Starvation, injuries and old age can kill colonists. There is no incapacitation, rescue, treatment, recruitment, or replacement population yet. Mood is derived, with no mental breaks or memories. Skills are static.
- **Construction:** one-tile buildings, wood only, physical deconstruction, and simple enclosed-tile shelter recognition; no rotation or roof simulation. Doors are passable visual structures, without door timing or hold-open state. Large sealed plans can become unreachable; no reachability warning explains them yet. Leave doorways and cancel unfinished obstructing plans.
- **Logistics:** resource-specific carrying (food 100, spoiled food 30, wood 12, stone 12), compatible stockpile merging, throughput-ranked cooking sources, and low-priority partial-stack consolidation. Large quantities of separate stacks/blueprints still need profiling and indexing work.
- **Navigation:** pawns may visually overlap. Terrain has passability but no variable movement costs. Cached-route abort/reassignment is used instead of local crowd avoidance.
- **Saves:** one latest colony, one automatic prior snapshot; no named slots or cloud. Browser clearing/eviction can remove saves. Abrupt OS process termination may lose work since the latest autosave. Insecure LAN HTTP without Web Locks requires one active tab.
- **Mobile/PWA:** service worker installation requires HTTPS/localhost. Real-device thermals, battery, install UX, keyboard/assistive technology coverage and Safari compatibility are unverified. No forced orientation lock; portrait remains usable with a landscape hint.
- **Threats:** hungry adult predators can stalk and attack colonists, and colonists make a weak automatic unarmed counterattack. There is still no drafting, targeting, equipment, hunting order, raid system, incapacitation, rescue, or medicine.
- **Interactions:** no undo history, zoning filters, save slot picker, audio, minimap or multi-colonist selection. Cancelling unfinished plans is supported.

No reproducible core-loop blocker remained in the exercised scenarios. This is a first playable foundation, not a finished survival game.

## Next priorities

1. Tune the survival loop from real play: crop timing, meal target, cooking bottlenecks, shelter rest benefit, and food pressure. Keep the passed Android interaction model intact.
2. Expand blocked-work explanations for unreachable blueprints/resources, missing material quantities, disabled work types and stockpile capacity.
3. Tune crop timing, meal target, cooking bottlenecks, shelter rest benefit, and hunger pressure through physical-device playtesting.
4. Add one bounded hostile event and defensive behavior with a coherent incapacitation/recovery model. Extend job interruption and reservations without direct normal-work pawn control.
5. Improve logistics indexing, stack consolidation and path connectivity only after large-plan/device measurements; add regression tests around new ownership transitions.
6. Add named save slots and explicit schema migration tests before the next incompatible data revision; validate Safari separately.

## v0.2 release deployment

The v0.2 survival-loop commit is live at [sneil-tas.github.io/hearthfield](https://sneil-tas.github.io/hearthfield/). Pages run [35311555660](https://github.com/SNeil-Tas/hearthfield/actions/runs/35311555660) passed build and deploy, and the live smoke test returned HTTP 200 with three colonists, manifest/service-worker HTTP 200, relative hashed assets, and no page errors or failed requests.
