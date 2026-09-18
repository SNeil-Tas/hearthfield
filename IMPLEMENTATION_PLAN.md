# Initial implementation plan

The v0.1 GDD is the product source of truth. The directory initially contained only that document; preserve it unchanged.

1. Establish a strict TypeScript/Vite project and headless deterministic world.
2. Integrate seeded terrain, three colonists, reservations, A*, commands, physical items, work priorities, chopping, hauling, delivered-material construction, eating and sleeping.
3. Add a viewport-culling Canvas renderer and touch-first DOM UI: selection, pan/pinch, paint orders, blueprints, work screen, time controls and diagnostics.
4. Add versioned IndexedDB persistence, recovery/export support and production PWA caching.
5. Exercise the simulation with integration tests and the app with Chromium at landscape phone sizes; inspect screenshots, fix issues, and document limitations.

Canvas 2D is the initial renderer: an 80×80 world with viewport culling and a handful of moving entities does not require a graphics dependency. Simulation owns plain serializable data, never canvas or DOM objects. Revisit with measured device evidence.

Combat and cooking are optional extensions after the logistics loop is reliable. Do not compromise that loop to add breadth.
