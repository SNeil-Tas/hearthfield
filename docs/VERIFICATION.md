# Verification record · 2026-09-18

## Environment

Windows, Node 24.19.0, npm 11.17.0. Chromium supplied by Playwright. The v0.2 production build contains **57.00 kB JavaScript (20.58 kB gzip)** and **15.84 kB CSS (4.15 kB gzip)** plus the HTML, manifest, service worker and two generated icons. No runtime CDN resources.

The browser suite used Playwright 1.55.0 with Chromium 153.0.8010.12 (Playwright browser revision 1243). The browser binary was installed locally before the passing run.

## Automated checks

`npm run build` checks strict TypeScript and produces the production bundle. `npm run format:check` checks maintained source/test/config formatting. `npm test` runs 24 meaningful headless cases, including the original foundation and v0.2 survival-loop cases:

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

`npm run test:browser` runs ten cases against dedicated dev and production servers:

- Landscape placement, work priority editing, construction, explicit save/reload and 667×375 resize.
- Pan versus tap, real two-finger pinch, wheel zoom, pause/speed and cancellation.
- Production service-worker readiness, full network disable, reload, working selection and cached scripts/styles/icons.
- Area gathering using Chromium touch events; cancellation/pinch never commit stray wall plans.
- Corrupt latest save recovered from a valid IndexedDB backup.
- Unreadable storage leaves existing data untouched and shows a paused recovery preview.
- Desktop/portrait UI and absence of document overflow.
- Competing-tab write prevention and ownership after the original tab closes.
- Held context actions surviving live status updates without being replaced under the pointer.
- Growing-zone touch designation, cooking-station placement, crop/meal context UI, and deconstruction interaction.

The completed v0.2 run passed all **10 browser tests in 20.6 seconds**. `npm run typecheck`, `npm test -- --run` (**24 tests in 1.89 seconds**), `npm run build`, `npm run verify:production`, and `npm run format:check` also passed.

## v0.2 verification addendum

The v0.2 run supersedes the first-playable counts above: `npm test -- --run` passed 24 tests in 1.89 seconds, `npm run test:browser` passed 10 tests in 20.6 seconds, and typecheck, build, production path/PWA verification, and formatting all passed. The v0.2 build measured 57.00 kB JavaScript (20.58 kB gzip) and 15.84 kB CSS (4.15 kB gzip). The v0.2 build is ready for the final public deployment after the release commit.

## Published deployment

The repository is [github.com/SNeil-Tas/hearthfield](https://github.com/SNeil-Tas/hearthfield). GitHub Pages deployment run [35306828769](https://github.com/SNeil-Tas/hearthfield/actions/runs/35306828769) passed the build and deploy jobs using [`.github/workflows/deploy-pages.yml`](../.github/workflows/deploy-pages.yml). The live site is [https://sneil-tas.github.io/hearthfield/](https://sneil-tas.github.io/hearthfield/).

A read-only live smoke test returned HTTP 200, rendered three colonists, loaded the manifest and service worker with HTTP 200, detected relative hashed assets, and reported no page errors or failed requests. The user then reported passing browser play, landscape touch interaction, save/reopen, PWA installation, installed-app reopen, offline launch, and sustained real-device play without a major mobile usability or performance blocker.

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

iOS Safari, storage eviction/quota exhaustion, exhaustive map seeds and large sealed construction layouts remain unverified. The user-reported Android Chrome/PWA flow passed; detailed battery/thermal measurements and long-running OS suspension remain follow-up observations.

## Mobile deployment gate

The production path is covered by the build and browser checks: the HTML entry point, manifest, generated service worker, icons, relative asset paths, service-worker registration, save/reload, and fully offline reload are exercised from the production preview. The GitHub Pages workflow repeats `npm ci` and `npm run build` on every `main` push. The existing deployed URL and user-reported Android installation/offline flow passed; the v0.2 build still requires its final Pages deployment and live smoke test after the release commit.
