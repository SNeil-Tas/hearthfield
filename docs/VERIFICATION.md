# Verification record · 2026-09-18

## Environment

Windows, Node 24.19.0, npm 11.17.0. Chromium supplied by Playwright. Production build contains **49.77 kB JavaScript (18.50 kB gzip)** and **15.84 kB CSS (4.15 kB gzip)** plus the HTML, manifest, service worker and two generated icons. No runtime CDN resources.

The browser suite used Playwright 1.55.0 with Chromium 153.0.8010.12 (Playwright browser revision 1243). The browser binary was installed locally before the passing run.

## Automated checks

`npm run build` checks strict TypeScript and produces the production bundle. `npm run format:check` checks maintained source/test/config formatting. `npm test` runs 17 meaningful headless cases:

- A* shortest detour, adjacency and unreachable targets.
- Atomic reservations and complete owner release.
- Seed-stable generation.
- End-to-end chop → items → delivery → bed → residual stockpile hauling.
- Cancellation during pickup and partial delivery with exact material conservation.
- Urgent food interruption, physical ration consumption, rest in a reserved bed, ground sleep and emergency gathering.
- Disabled priorities and cancellation not disturbing unrelated jobs.
- Idle wall-site occupants stepping aside.
- Long-run finite state, consistent locks and serialization.
- Fixed-tick equivalence across render cadences and all speeds.
- Save round-trip, carried material conservation, corruption/version/schema rejection.
- Twenty colonists gathering/building on an 80×80 map for 6,000 ticks.

`npm run test:browser` runs nine cases against dedicated dev and production servers:

- Landscape placement, work priority editing, construction, explicit save/reload and 667×375 resize.
- Pan versus tap, real two-finger pinch, wheel zoom, pause/speed and cancellation.
- Production service-worker readiness, full network disable, reload, working selection and cached scripts/styles/icons.
- Area gathering using Chromium touch events; cancellation/pinch never commit stray wall plans.
- Corrupt latest save recovered from a valid IndexedDB backup.
- Unreadable storage leaves existing data untouched and shows a paused recovery preview.
- Desktop/portrait UI and absence of document overflow.
- Competing-tab write prevention and ownership after the original tab closes.
- Held context actions surviving live status updates without being replaced under the pointer.

The completed run passed all **9 tests in 22.2 seconds**. `npm run typecheck`, `npm test -- --run` (**17 tests in 3.33 seconds**), `npm run build`, `npm run verify:production`, and `npm run format:check` also passed. No GitHub deployment was performed.

Screenshots are written to `test-results/`: `mobile-colony.png`, `mobile-work.png`, `offline-colony.png`, `desktop-colony.png`, `portrait-fallback.png`. The directory is ignored because these are regenerated outputs. A selected mobile view is retained in `docs/mobile-colony.png`.

## Performance observation

One isolated desktop run of `npx vitest run tests/sim/load.test.ts --disableConsoleIntercept --reporter=verbose` measured:

| Workload | Result |
|---|---:|
| 20 colonists, 80×80 map, 6,000 ticks | 1,520 ms total |
| 95th percentile simulation tick | 1.47 ms |
| Maximum tick in that run | 14.04 ms |

These are **headless desktop simulation measurements**. They do not include rendering, imply a phone frame rate, or establish thermal/battery performance. No strict timing assertion is imposed on CI machines.

## Issues caught and addressed

- Existing unrelated service at default port 5173: tests now use dedicated ports and refuse reuse.
- Offline shell loaded but modules failed because precache/module Origin headers differed under `Vary: Origin`: immutable asset cache matching now ignores Vary; full offline reload passes.
- Cancelling an empty tile could compare undefined target IDs: only existing node/blueprint IDs can trigger interruption.
- A cancelled delivery can leave several smaller stacks: conservation tests cover partial delivery rather than assuming a particular pickup order.
- An idle colonist could obstruct wall completion forever: autonomous step-aside behavior resolves it.
- Storage reads failing without any valid candidate could accidentally start saving a fresh colony: loading now protects existing data and disables saving.
- Invalid imported fractional tile positions: validator rejects them for stationary entities.
- Work screen's last row was clipped at 375 px height: spacing adjusted and screenshot reviewed while retaining 44 px priority controls.
- Context updates could replace a button during a held press: dynamic panel replacement is deferred during the press.
- Multiple secure-context tabs could race local saves: Web Locks now permit only one writer.

## Remaining verification

Physical Android Chrome/iOS Safari, installation UX, long-running browser/OS suspension, storage eviction/quota exhaustion, real-device rendering/battery behavior, exhaustive map seeds and large sealed construction layouts remain unverified. These limits are carried into the implementation status rather than presented as passing results.

## Mobile deployment gate

The production path is now covered by the build and browser checks: the HTML entry point, manifest, generated service worker, icons, relative asset paths, service-worker registration, save/reload, and fully offline reload are exercised from the production preview. The GitHub Pages workflow repeats `npm ci` and `npm run build` on every `main` push. The deployed public URL and physical Android installation/offline flow remain pending until this repository is connected to a GitHub remote and tested on a phone.
