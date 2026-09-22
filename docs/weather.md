# Weather and physical exposure

`src/sim/weather.ts` is the authority for weather definitions, precipitation,
transitions, rain exposure, existing weather modifiers and colonist wetness.
World retains `weather` and `weatherUntil`, plus optional/defaulted
`weatherStartedAt`; intensity and elapsed/remaining durations are derived.
`isRainExposed(world, tile)` requires active precipitation and no roof, using
`roomTopology(world).isSheltered(tile)`. No new enclosure rule exists here.
Enclosed-but-unroofed tiles get rain; outdoor roofs protect from rain.

## Transitions

Weather changes only at a period deadline. The existing seeded PRNG has moved
unchanged from generate.ts to random.ts (generate.ts re-exports it). Each weather
transition seeds an independent draw from the world seed, saved deadline and
previous kind, so save/load and render frequency do not alter the sequence.
There is no offline simulation or visual transition affecting gameplay.

| Weather | Duration (simulation seconds) | Precipitation | Exposed raw-food multiplier | Exposed field-work multiplier |
| --- | --- | --- | --- | --- |
| Clear | 180–360 | 0 | 1 | 1 |
| Rain | 180–300 | 1 | 1.12 | 0.82 |
| Heavy rain | 90–180 | 2 | 1.35 | 0.65 |
| Storm | 60–120 | 3 | 1.45 | 0.60 |

Initial colonies retain the original 180-second clear period. Weighted next-state
probabilities (Clear / Rain / Heavy rain / Storm) are 45/48/7/0 from Clear,
55/20/22/3 from Rain, 30/45/15/10 from Heavy rain, and 20/50/30/0 from Storm.
Same-kind renewals extend a spell. Clear is common; storms are uncommon and cannot
appear directly from clear or immediately renew. Existing saves retain valid
deadlines even if little time remains in their current spell.

## Wetness and gameplay

Wetness is persisted on each pawn, clamped to 0–100, and updated every ten fixed
ticks (one simulation second), before needs. Rain adds 0.45 points/second,
heavy rain 0.90, storms 1.35, only at the pawn's exposed tile. Otherwise drying
removes 0.8/second indoors, 0.6 under an outdoor roof, or 0.35 in the open during
clear weather. Shelter stops further wetting immediately at the next environmental
sample; it does not instantly erase accumulated wetness. Exposure changes between
samples are not integrated at sub-second resolution.

Bands: Dry below 1, Damp from 1 to below 40, Wet from 40 to below 75, Soaked from
75 through 100. Wet has a -2 mood effect and Soaked -4. These are recomputed through
the existing needs/mood system, not accumulated moodBias. There is no additional
wetness speed multiplier, health damage or new illness. Existing mood thresholds
can still affect productivity/metabolism normally.

The existing rain field-work penalty remains only for exposed chopping, gathering,
sowing and harvesting. It models working in precipitation, while the small wetness
mood effect models discomfort that lasts while drying. There is no global rain
debuff and no extra exposure or wetness work multiplier stacked on top. Indoor or
roofed dry workers receive none of these rain effects. Colonists continue their
normal jobs; no weather avoidance, shelter seeking or job cancellation is added.

Food rules remain deliberately conservative:

- Ground raw food uses that tile's rain exposure, regardless of stockpile designation.
- Roofs remove the rain spoilage multiplier; actual indoors additionally retains
  the existing 0.78 storage multiplier. Baseline decay/contamination is unchanged.
- Cooking buffers and carried stacks retain their existing transient no-weather-decay
  behaviour; no new buffer decay or ingredient accounting is introduced. Dropped
  raw food subsequently uses the destination tile's exposure.
- Cooked meals retain their existing expiry handling. Spoiled food retains its
  expiry cohorts. Neither acquires a new rain effect.
- Stations have no deterioration or new direct cooking penalty. A wet cook's
  existing mood/productivity may reflect discomfort like other workers.

## Presentation and diagnostics

The compact existing HUD weather label is now visible on narrow mobile layouts.
The inspector shows wetness band, whether the pawn is in rain or drying, roof
state and current rain exposure. Rain strokes draw behind objects/zones, avoid
roofed tiles, vary in count/length/speed with intensity, and cap at 80. Animation
time belongs to Renderer, freezes when paused, and never modifies World or uses
simulation randomness. Indoor floor tint remains driven by `isIndoors()`.

Debug reports include weather timing/intensity, pawn wetness/band/mood effect and
current rain exposure, alongside existing roof/room state. Item and workstation
records include rain exposure. Events record weather periods, wetness band changes
and exposure changes, not each numerical wetness update. Exposure history is a
runtime WeakMap; first sampling establishes a baseline without a spurious event.

## Saves, cost and limits

Schema remains **5**, following existing optional-field defaults. Saves include
weather type/deadline/start and pawn wetness. Old missing fields default to dry
pawns and a start at load tick (previous elapsed duration is unknown). Missing
weather/deadline defaults to Clear and tick + 1800. Present invalid values are
rejected; timers and wetness are not silently clamped on load. Current loaders
support all older save versions; old app builds do not understand Storm saves.
Jobs/cargo keep the existing load interruption/refund behaviour.

Environmental updates are O(pawns) once per second with cached O(1) roof queries;
transitions use two PRNG draws per period. Rendering adds at most 160 cached roof
queries and 80 short strokes, with no per-frame topology rebuild unless dirty.
No claim of physical-phone performance is made from desktop tests.

Temperature, seasons, biomes, snow/heat, clothing, weather illness, wind, lightning,
damage, flooding, mud, puddles, crop damage, forecasts and weather avoidance AI
remain deliberately absent.
