# Agriculture bundle integration validation

Validated locally on 24 September 2026. No release or deployment was performed.

## Checkout and application

- Repository: `C:/Users/Simon/OneDrive/Desktop/Projects/Colony Sim`.
- Initial branch: `main`; working tree was clean with no pre-existing changes.
- Initial and final HEAD: `8ac8607df39661cc0ef09da1cc477d440c2fc2d4`, exactly the requested v0.7.1 baseline.
- Working branch: `codex/agriculture-integration`.
- Source: `C:/Users/Simon/Downloads/hearthfield-v0.8-agriculture-local.zip`.
- Read the bundle README and inspected `apply.py` before running it from the repository root.
- The first supplied application attempt stopped at the guarded Growing Zone UI string replacement. Python's Windows default encoding was cp1252, while the source is UTF-8. Restored only the two integration files partially patched by that attempt (`main.ts`, `panels.ts`), then reran the supplied script with `PYTHONUTF8=1`. All guarded replacements succeeded on that retry. No baseline/content merge conflicts remained.
- Application release version remains **0.7.1**; save schema is **6**. Crop definitions, growth durations, yields, environmental coefficients and fertilizer balance were not retuned.

## Integration fixes

- Typed connected-field neighbor coordinates as tuples for strict indexed-access checking.
- Represented absent seed species as `null` in diagnostics rather than an unsupported `undefined` value.
- Restored the existing `CROP_HARVEST.values.produced` and `createdItemId` fields alongside the new agriculture fields. The full food-accounting regression test exposed this diagnostic compatibility defect.
- Updated old schema assertions, the Gather-to-Plants browser selector, planting/harvest text expectations, and fixed-yield accounting assumptions.
- Updated fixtures that directly inserted growing zones to include persistent agricultural soil. The survival primitive now supplies a physical seed and accelerates the actual growth function with maintained soil rather than expecting seed-free, sub-day growth.
- Updated the ten-day accounting fixture to an established 35-tile field with water access and initially hungry colonists. Updated the three-day self-care fixture to 18 initially mature Grain tiles. These retain their existing throughput, accounting, pathing and consumption assertions while accommodating the multi-day crop cycle; production balance was not changed.
- Updated the separate 35-tile audit fixture with agricultural soil and map water, and made its harvest ledger read the actual diagnostic yield instead of assuming 50 food per crop.

## Validation actually run

| Command / check | Final result |
| --- | --- |
| `npm.cmd run format` | Passed |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd test` | Passed: 15 files, 199 tests |
| Agriculture tests within the full suite | Passed: 38 tests, including two added migration regressions |
| `npm.cmd run test:food-audit` | Passed: one 35-tile, 16-day accounting audit; see survival limitation below |
| `npm.cmd run test:browser` | Passed: 17 tests, including two new agriculture browser tests |
| `npm.cmd run build` | Passed |
| `npm.cmd run verify:production` | Passed: relative assets, manifest, icons and service worker |
| `npm.cmd run format:check` | Passed |
| `git diff --check` | Passed |

The production bundle was built before browser validation because Playwright also starts a production preview. It was built and verified again after the final browser run. Production browser checks include offline PWA save/resume and build diagnostics. No failed step is represented as passing on its initial attempt.

## Save compatibility

Explicit schema-5 envelopes were decoded through the real migration path. Tests verify Grain crop identity and growth, deterministic moisture/nutrients for old fields, preservation of non-seed items, a six-seed physical recovery cache for the small fixture, preservation of room topology, weather timers and pawn wetness, repeatable migration, and stable schema-6 save/reload without a second recovery cache. Existing seed stock prevents the recovery cache. Existing food-buffer, storage, room and weather roundtrip tests also pass under schema 6.

## Browser smoke observations

The browser tests run real application modules locally. The new-colony UI test uses the development build's existing debug stepping; the controlled environmental smoke uses the real simulation and agriculture modules inside Chromium with a deterministic fixture. These are accelerated checks, not an unattended multi-day production playthrough.

- Inspected starting Potato Seed x20, Grain Seed x12 and Fertilizer x8 with correct inspector labels.
- Designated a field using the touch UI; Potato was the default. Selected Grain and switched back to Potato using the inspector.
- Observed planting produce a Potato crop and reduce total physical Potato seeds from 20 to 19.
- Verified crop, lifecycle stage, growth, moisture, nutrients, neutral/not-simulated temperature, and plain-language status in the inspector.
- Verified crop controls on portrait mobile and after scrolling the existing inspector on a short landscape screen; inspected both screenshots.
- Verified rain raises exposed soil moisture and roofing blocks direct rainfall.
- Verified dry soil generates watering work, and a colonist completes it using accessible map water.
- Verified one physical fertilizer unit restores nutrients; subsequent growth depletes nutrients.
- Accelerated the actual growth function through seeded, germinating, seedling, growing and mature stages with maintained soil.
- Observed one Potato harvest create 48 physical food and two replacement seeds. Replanting candidates exist with seed and disappear after seed removal.
- Existing inspector, mobile input, room/roof/weather feedback, save recovery, storage failure and multi-tab protection browser tests pass.

Screenshots are in the ignored local `test-results/agriculture-portrait.png` and `test-results/agriculture-landscape.png` files.

## Remaining playtest concern

The separate repository-native 16-day accounting audit passes its assertions and reconciles with maximum error about `9.1e-13`, but it is **not a healthy-colony endurance result**. It records 2,520 harvested food, 400 consumed food points, 17 cooked meals and final hunger `[0, 0, 0]` / health `[1, 1, 1]`. This fixture begins with 35 mature Grain crops and is not equivalent to the bundle's environmental balance benchmark. Its large initial harvest, spoilage and slower replenishment warrant follow-up survival/logistics playtesting before release; the cause was not established as an integration defect, and no balance retuning was attempted.

The supplied 16-day (3,360 food, 1.56x) and 64-day maintained-soil (16,800 food, 1.94x) JSON results were inspected as bundle evidence. Their exact benchmark harness was not included, so those figures were **not independently reproduced or claimed as new validation**.

## Final Git state

All changes remain uncommitted on `codex/agriculture-integration`: 25 modified tracked files and five new files (this report, agriculture simulation/UI modules, and simulation/browser agriculture tests). HEAD remains at the original baseline. No unrelated user work existed or was overwritten. No local commit, push, tag, release, GitHub Pages deployment or other publication was performed.
