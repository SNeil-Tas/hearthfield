# Implementation status

**Milestone:** v0.2 survival loop in progress, built on the first playable foundation. Original GDD preserved unchanged.

**Patch:** v0.2.1 PWA update delivery fix in progress; no gameplay scope added.

## Completed

- Seeded 80×80 terrain, water barriers, trees, berry bushes and stone outcrops; original viewport-culled Canvas visuals.
- Three autonomous named colonists with health, hunger, rest, derived mood, skills, priorities and inspectable jobs.
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

## Verification

- **Latest v0.2 run:** 24 simulation tests and 10 Chromium browser tests passed; TypeScript, production build/PWA verification, and formatting passed.
- The user reports that the deployed PWA passed browser play, landscape touch interaction, save/reopen, installation, installed-app reopen, offline launch, and sustained real-device play without a major mobile usability or performance blocker.

- The v0.2 verification run supersedes the earlier counts: **24 simulation tests** and **10 Chromium browser tests** passed.
- TypeScript/build, production path/PWA, and formatting checks passed. The v0.2 build is ready for the final Pages deployment.
- Actual Chromium touch events, 844×390 and 667×375 landscape, 390×844 portrait, 1440×900 desktop, save/reload and offline production reload.
- Tested a 15-minute three-colonist simulation and a ten-minute 20-colonist workload. The latter measured about 1.52 s for 6,000 ticks on this desktop (p95 1.47 ms/tick; max 14.04 ms in that run).
- Screenshots inspected. See [verification notes](docs/VERIFICATION.md) for scope and limits. The user reports the physical Android validation flow passed without a major mobile usability or performance blocker.

## Latest verification run

- Standard system Node.js: `C:\Program Files\nodejs\node.exe` v24.19.0; npm 11.17.0.
- `npm run typecheck`: passed.
- `npm test -- --run`: 17/17 passed in 3.33 seconds.
- `npm run build`: passed; 49.77 kB JavaScript and 15.84 kB CSS before gzip.
- `npm run verify:production`: passed; relative bundle paths, manifest, icons, and generated service worker verified.
- `npm run format:check`: passed.
- `npm run test:browser`: 9/9 Chromium tests passed in 22.2 seconds, including touch, phone-sized layouts, save/reload, offline startup, and multi-tab protection.

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

## v0.2 survival-loop limitations

- One grain crop only; no crop catalogue, seasons, spoilage, nutrition categories, or stockpile filters.
- Cooking uses one automatic rule and a six-meal target; there is no bill editor, ingredient policy, or workstation queue UI.
- Shelter is enclosed-tile recognition only. It has no roofs, room quality, ownership, temperature, weather, or airflow.
- Blocked-work explanations cover common construction and cooking shortages in context panels; unreachable-job diagnosis remains intentionally lightweight.

## Partial systems and known limitations

- **Survival/content:** finite wild food/trees plus one renewable grain crop and automatic simple meals; starvation health stops at 1, with no death or incapacitation. Mood is derived, with no mental breaks or memories. Skills are static.
- **Construction:** one-tile buildings, wood only, physical deconstruction, and simple enclosed-tile shelter recognition; no rotation or roof simulation. Doors are passable visual structures, without door timing or hold-open state. Large sealed plans can become unreachable; no reachability warning explains them yet. Leave doorways and cancel unfinished obstructing plans.
- **Logistics:** simple all-resource stockpiles, exclusive whole-stack pickup claims, twelve-unit carrying limit, no consolidation or storage priorities. Large quantities of separate stacks/blueprints need profiling and indexing work.
- **Navigation:** pawns may visually overlap. Terrain has passability but no variable movement costs. Cached-route abort/reassignment is used instead of local crowd avoidance.
- **Saves:** one latest colony, one automatic prior snapshot; no named slots or cloud. Browser clearing/eviction can remove saves. Abrupt OS process termination may lose work since the latest autosave. Insecure LAN HTTP without Web Locks requires one active tab.
- **Mobile/PWA:** service worker installation requires HTTPS/localhost. Real-device thermals, battery, install UX, keyboard/assistive technology coverage and Safari compatibility are unverified. No forced orientation lock; portrait remains usable with a landscape hint.
- **Threats:** no hostile event, combat, drafting, medicine, injury model or death. Explicitly deferred to protect the requested primary loop.
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
