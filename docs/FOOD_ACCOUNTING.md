# Food accounting investigation (v0.7.0)

## Finding and limits

The crop-as-stack diagnosis is **not supported**. `World.crops` contains only ID, position, kind and growth. All item searches, cooking sources, merges and consolidation search `World.items`. Harvest completion creates 50 physical raw points, removes the crop, and a stale harvest job cancels because its crop no longer exists. Growth never replenishes an item quantity.

The player subsequently reported 35 growing tiles (5 x 7), day 16, approximately 11,000 Food, and 15 stockpile tiles, sometimes with food overlapping logs or rocks. A matching-scale deterministic experiment reproduced **11,245.370503 Food in the original code** after 16 elapsed days. Physical accounting reconciled every tick (maximum error 2.19e-11). It harvested 63,000 points and consumed only 2,160. Thus, a total of this size is explained primarily by legitimate production surplus, not crops becoming stacks. There was also a real 480-point overcount from expired meals in that original run.

The exact player save was not supplied, so this is a reproduction of the reported scale, not a reconstruction of that save's individual transactions. The audit found and fixed the independent defects below. No economy constants were changed.

## Confirmed defects and exact paths

- **Conditional duplication:** `depositStack -> mergeInto` incremented target.quantity before calling `freshPoints(target)`. When the optional freshPoints field was absent, the fallback read the incremented quantity and added incoming food again: 60 + 20 became 100. Capture freshness before mutation. Normal harvest/drop stacks already have explicit freshness; schema migration also fills it, so this is not evidence that ordinary crops caused the reported total.
- **Conditional double subtraction:** source pickup and raw eating decremented quantity before reading the same fallback freshness. Capture the pre-transfer value. Eating a fractional raw remnant could also leave a negative item quantity; consume only what exists and remove depleted items.
- **Rejuvenation:** pickup discarded expiry; `interruptJob -> dropStack -> drop` minted a fresh lifetime and discarded raw fresh/spoiled metadata. Transfers now preserve expiry and raw composition. Ordinary raw pickup takes only fresh points and leaves the spoiled fraction in the source, which is intentional.
- **Illegal storage designation:** growing and stockpile zones could overlap; candidate selection and consolidation did not exclude crop tiles. This stored physical items on agricultural tiles, not inside crop entities. Both zone commands now prevent overlap, and candidate selection, consolidation and deposit revalidate storage tiles (including old overlapping worlds).
- **Storage overflow:** deposit overflow could create another stack at an already full destination, and haul candidates could select a tile occupied only by incompatible inventory. Deposits now report unaccepted quantity; failed/full deliveries leave that quantity physically at the pawn without duplication. Raw stack capacity remains 100. Existing ground stacks are preserved, even when a growing crop later shares their tile.
- **HUD overcount:** `usefulResourceTotal` counted expired meals although eating rejected them; `advanceFoodSpoilage` previously ignored meals, so those stale items lingered indefinitely. The HUD excludes expired meals immediately, and the existing 100-tick spoilage pass converts them into physical waste (80 points per meal), which follows existing waste decay.
- **HUD undercount:** station ingredient buffers were omitted. The HUD now counts world fresh raw points + usable meal points + cargo + cooking buffers exactly once, excluding crops and waste.
- **Buffer loss:** demolishing a station could destroy its ingredients. It now cancels its cook and refunds the remaining buffer once. Loading also releases orphan buffers and stale station ownership.

## Lifecycle and fractions

1. Growth/maturity is crop state only. A harvest produces 50 raw points once and removes the crop.
2. Harvested food can remain on the ground. Re-sowing can place a new crop on the same tile as that independent item; rendering overlapping positions is not shared inventory.
3. Pickup transfers fresh raw points from a world item to cargo; any spoiled fraction stays behind. Reservations lock IDs, not copies of inventory.
4. Hauling deposits only into valid storage. Splits and compatible merges preserve fractional composition. Full or invalid storage leaves a ground remainder at the pawn.
5. Cooking moves cargo into one station buffer. Interruptions return buffer and cargo exactly once. A recipe consumes 100 raw points and produces one 80-point meal: an explicit 20-point loss.
6. Eating removes one meal (80 accounting points) or up to one raw point. Hunger recovery remains the existing design; hunger units and inventory points are not identical for raw food.
7. Raw spoilage moves fractional fresh points into a spoiled fraction. Separation moves that fraction to physical waste without a second usable-food loss. Meal expiry removes usability; periodic cleanup converts expired meals to waste. Waste expiry is not a second food loss.
8. Food HUD counts fresh raw points even in mixed stacks that require separation before cooking, as before. Ingredients in transit and buffers remain current inventory. Expired meals, crop yield and waste do not count.

Fractional quantities arise from proportional raw spoilage, taking the remaining fresh portion, partial recipe inputs and splitting. They remain precise. No global integer rounding was introduced.

## Saves and diagnostics

Schema remains **5**. On load, remove only stockpile designations overlapping a growing zone or crop; retain every crop and physical item. Preserve cargo freshness and known expiry. Old cargo missing expiry receives the existing lifetime from load time because its original deadline cannot be recovered. Existing job cancellation refunds owned station buffers; a subsequent pass refunds only remaining orphan buffers and clears ownership. Repeated save/load preserves quantities. Do not clamp large food totals or guess which existing units were historically duplicated.

Added bounded diagnostic events: `CROP_HARVEST` (crop ID, pawn, tile, output item ID and amount), `RESOURCE_DEPOSIT` (requested/accepted/remainder and destination validity), and `FOOD_SPOILED` (total loss and affected-stack count for each existing spoilage pass). `COOKING_COMPLETED` now reports input and conversion loss; `FOOD_CONSUMED` reports actual inventory points removed. Existing pickup/phase/buffer diagnostics provide the intermediate transfer trail. Spoilage is summarized once per 100-tick pass rather than logging every affected stack. Its loss is reported directly from each existing spoilage operation; no additional global accounting scan was added to production code. The reconciliation ledger runs in tests.

## Deterministic results

New ten-day test: 60,000 ticks, three colonists, nine planted tiles, two storage tiles, one cooking station. It reconciles every tick:

`initial inventory + harvested - consumed - spoiled - cooking conversion loss = world food + cargo + station buffers`

Expired meals awaiting the periodic waste pass are explicitly subtracted when comparing this physical ledger with the usable Food HUD. No waste is counted as usable inventory.

| Measurement | Food points |
| --- | ---: |
| Harvested | 10,800 |
| Consumed | 1,200 |
| Spoiled | 7,249.051660 |
| Cooking conversion loss (62 meals) | 1,240 |
| Final inventory | 1,110.948340 |
| Maximum inventory | 2,009.821623 |
| Maximum reconciliation error | 5.46e-12 |

All colonists survived and continued cooking/eating; final hunger was approximately 87.55, 76.00 and 52.75. All quantities stayed finite, crops had no inventory fields, and accepted haul deposits targeted valid storage.

The measured average harvest was 1,080 points/day versus 120 points/day eaten, 124/day recipe loss and 724.905/day spoiled. This scenario has legitimate surplus, including food lying outside storage. Limited stockpiles do not cap all physical ground inventory. Raw spoilage is proportional and asymptotic; tiny remnants can persist, and raw emergency consumption has a different hunger-per-point conversion from meals. These are tuning observations, not changes made in this fix. The matching-scale original/fixed comparison below confirms that five-figure Food totals can be physically explained at the reported planted area.

Regression coverage includes harvest once, crop rejection, merge/consolidation destinations, full/incompatible storage, failed deposits, interrupted hauling, cooking pickup/refund/conversion, fractional eating, meal consumption, raw/meal spoilage, HUD cargo/buffer accounting and schema-5 round trips. The existing three-day self-care audit still reconciles physical food plus waste. Its incidental assertions that a particular run must use personal cooking and that every consumed meal has a unique item ID were removed: ready meals can satisfy needs, and valid stack merging allows repeated IDs. Dedicated personal-cooking tests remain. Its timeout is now 30 seconds for concurrent long-run suites; economic assertions remain unchanged.


## Reported playtest scale: original versus fixed

An isolated copy of the original tracked source and the fixed source each ran 96,000 ticks on a 20 x 20 open map, with 35 initially mature growing tiles, 15 storage tiles (two containing wood/stone), three colonists, beds, one station and a dump zone. This represents 16 elapsed days; the player's day-16 label may represent slightly less elapsed time. Layout, weather, priorities and initial maturity need not match the player's actual save.

| Measurement | Original | Fixed |
| --- | ---: | ---: |
| Harvested points | 63,000 | 63,500 |
| Eaten points | 2,160 | 2,400 |
| Meals cooked | 33 | 113 |
| Recipe loss | 660 | 2,260 |
| Waste expired | 10,306.984011 | 11,846.491620 |
| Final Food HUD | 11,245.370503 | 10,035.420303 |
| Maximum sampled Food HUD | 11,377.197959 | 10,895.532218 |
| Expired meals still counted in HUD | 480 | 0 |
| Maximum physical mass reconciliation error | 2.19e-11 | 2.19e-11 |
| Remaining food stacks | 919 | 953 |
| Colonist health | 100 / 100 / 100 | 100 / 100 / 100 |

The larger audit uses a second independent equation that includes spoiled material: `harvested - eaten - recipe loss - expired waste = world food (fresh + spoiled) + meals + waste + cargo + station buffers`. Each tick reconciled. The ten-day test separately verifies usable-food losses and HUD semantics. More meals are cooked after the fix because expired meals no longer occupy the scheduler's six-meal stock target indefinitely; this is spoilage cleanup, not a changed recipe or hunger rule.

Original production averaged 3,937.5 points/day versus 135/day eaten. Fixed production averaged 3,968.75/day versus 150/day eaten. Fifteen storage tiles do not cap the much larger inventory of harvested food still on the ground. Proportional raw spoilage eventually counteracts production, but it does not eliminate an entire raw stack at a fixed deadline. This explains both large totals and many fractional remnants without rounding or treating crops as inventory.

The original/fixed exploratory runs completed all economic assertions but exceeded their initially configured 120-second test timeout (about 246 and 283 seconds respectively). The retained fixed-code endurance audit has an appropriate 600-second limit and is opt-in: `npm run test:food-audit`. The normal suite retains the faster 60,000-tick ledger regression. The temporary original-source copy was removed after comparison.


## Final validation

- Regular simulation suite: **163 passed** across 14 files, including 17 new focused accounting regressions and the new ten-day audit. Existing cooking, self-care, room and weather tests pass.
- Separate 35-tile, 16-day endurance audit: **1 passed** (about 327 seconds in the final run). The 600-second limit accommodates this intentionally large physical-inventory scenario.
- Browser suite: **15 passed**, including mobile interaction, rooms/weather, save recovery and offline PWA behavior.
- TypeScript, production build, production asset verification, full formatting check and diff whitespace checks pass.

No economy tuning was applied. One additional throughput observation is that the existing non-cooking pickup path limits individual haul pickups to 12 points even though the nominal food carry capacity is 100. This limit was left unchanged; it is not an accounting duplication and changing it would alter the requested carrying/throughput behavior. Large numbers of fractional ground stacks also make the endurance scenario slower than the small-colony test. Both are separate follow-up considerations, not explanations involving inventory stored inside crops.
