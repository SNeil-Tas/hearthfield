# Hearthfield Android test checklist

Use a modern Android phone in Chrome. Test the hosted HTTPS address when one is available. Keep the phone in landscape unless a step says otherwise. Pause the colony before testing a control if you need time to inspect it.

## A. Opening the deployed URL

1. Open the HTTPS Hearthfield URL in Chrome.
2. Wait for the three colonists and map to appear.
3. Open **More → Diagnostics** if you need to check viewport, device pixel ratio, service-worker state, or save time.

## B. Landscape behaviour

Rotate to landscape before playing. Rotate back to portrait once, then return to landscape. Confirm the landscape hint appears in portrait, the map and controls recover after rotation, and no page scroll or clipped button remains.

## C. One-finger pan

With no tool selected, drag across an empty map area. The camera should follow the finger smoothly. A short tap should select the thing under the finger instead of panning.

## D. Pinch zoom

Place two fingers on the map and pinch in and out. The map should zoom around the fingers, keep both fingers as map gestures, and never select a resource or place a plan when the gesture ends.

## E. Tap selection

Tap a colonist, tree, item, and blueprint. The contextual panel should identify the selected object and remain usable while the simulation runs.

## F. Area gathering/designation

Open **Orders → Gather resources** and drag across trees, berries, or stone. Confirm gold marks appear. Use **Cancel plans** to remove a mark. Tap **Done** and confirm the map returns to normal inspection.

## G. Blueprint placement

Open **Architect**, place a bed with a tap, and place a short wall with a drag. Confirm plans appear, materials are delivered, and construction completes. Try a pinch while a placement tool is active; it must not place a plan.

## H. Colonist inspection

Tap each portrait and a colonist on the map. Check the name, job, food, rest, health, and work-priority action. Close the context panel and verify map gestures still work.

## I. Work-priority screen

Open **Work**. Cycle a priority through 1, 2, 3, 4, and off. Check that every priority control is easy to hit and that the last row is not clipped on a short landscape screen.

## J. Pause / 1× / 2× / 4×

Tap each time control and watch the day/tick advance. At 4×, pan and open a panel. Note any visible stutter, delayed taps, or controls that stop responding.

## K. Save/reopen

Make a small change, wait for the save indicator to confirm, close the tab, and reopen the URL. Confirm the same seed, plans, buildings, and colony state remain.

## L. PWA installation

From the HTTPS page menu, choose **Install app** or **Add to home screen**. Launch Hearthfield from the home screen. Confirm it opens in an app-like standalone window and starts in landscape when Android supports the request.

## M. Offline launch

Open the installed app once online, then enable airplane mode or disable mobile/Wi-Fi data. Launch it again and confirm the saved colony loads. Restore the network and reopen once more; confirm there is one colony with no duplicated or rolled-back state.

## N. Background/reopen behaviour

Change the colony, background the browser or app, open another app for a few minutes, then return. Confirm the colony resumes safely, the save indicator updates, and no page reload loses the last autosave.

## O. 15–30 minute thermal/performance test

Run the colony for 15–30 minutes, including a few minutes at 4×, several pans, a pinch, a Work screen visit, and construction. Note heat, battery drain, dropped frames, touch lag, browser termination, and whether the device dims or rotates unexpectedly.

## What to report back

Report the phone model, Android version, Chrome version, whether the browser or installed PWA was used, and the exact step. Useful examples:

- “Pinching sometimes selects the map.”
- “Pan starts too late.”
- “Architect button is hard to hit.”
- “4× makes panning stutter.”
- “The phone becomes hot after 15 minutes.”
- “Returning from another app loses progress.”
- “The installed app is showing an older build.”
- “This menu is too small to use comfortably.”
