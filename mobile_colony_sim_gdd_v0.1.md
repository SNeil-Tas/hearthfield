# Mobile Colony Sim  
## Game Design Document — v0.1

**Status:** Early design  
**Platform:** Mobile browser, primarily phones  
**Orientation:** Landscape  
**Genre:** Colony simulation / survival / emergent storytelling  
**Primary inspiration:** RimWorld-style indirect colony management  
**Working title:** TBD

---

# 1. High-Level Concept

The game is a mobile-first colony simulation in which the player manages a small group of autonomous colonists attempting to establish and sustain a settlement in a hostile environment.

The player does not normally control individual colonists directly. Instead, the player shapes the colony through:

- construction orders;
- resource designations;
- work priorities;
- policies;
- zones;
- schedules;
- equipment;
- drafted combat orders;
- strategic decisions.

Colonists independently select and perform jobs according to their needs, abilities, priorities and circumstances.

The intended experience is not that of commanding units in an RTS. The player is responsible for **the colony**, while the colonists remain semi-autonomous people within it.

The game should generate stories through interactions between relatively simple systems rather than rely primarily on scripted scenarios.

---

# 2. Core Design Goal

The central design challenge is:

> Deliver the depth and emergent behaviour of a desktop colony simulator through an interface designed specifically for a phone touchscreen.

The game should not be conceived as a simplified desktop game.

Simulation depth and interface complexity are separate problems.

Where possible, complexity should remain in the simulation while the interface exposes only the information and controls relevant to the player's current task.

This principle will be referred to as **progressive disclosure**.

---

# 3. Design Pillars

## 3.1 Autonomous Colonists

Colonists are not interchangeable units.

Each colonist should eventually possess a combination of:

- needs;
- skills;
- traits;
- health conditions;
- equipment;
- relationships;
- preferences;
- memories;
- work priorities;
- mood.

Their behaviour emerges from these systems.

A colonist may interrupt construction because they are hungry, refuse work because they are incapable of it, rescue another colonist without being directly ordered, become ineffective because of exhaustion, or perform a task badly because they lack the relevant skill.

The player influences these behaviours rather than micromanaging every action.

---

## 3.2 Emergent Stories

The game should create situations worth remembering.

Example:

A storm damages the colony's food supply.  
A skilled grower becomes injured.  
Another colonist takes over farming despite poor skill.  
Food production collapses.  
The player begins hunting aggressively.  
A hunter is wounded.  
The colony must choose between treating the hunter and completing shelter before nightfall.

None of this needs to be authored as a specific scenario.

The story emerges from interacting systems.

---

## 3.3 Mobile-Native Interaction

Touchscreen controls are a first-class design constraint.

The interface should avoid:

- tiny desktop-style buttons;
- reliance on hover states;
- simulated mouse cursors;
- essential long-press actions;
- large permanent toolbars;
- nested menus requiring repeated precision tapping.

Preferred interactions include:

- tap;
- drag;
- pinch;
- contextual action strips;
- bottom sheets;
- large modal management screens;
- direct manipulation of the map.

---

## 3.4 Pauseable Complexity

The player is not required to interact with the game at real-time RTS speed.

Time controls are fundamental:

- Pause
- 1×
- 2×
- 4×

Important events may optionally trigger automatic pause.

Examples:

- hostile arrival;
- colonist downed;
- major fire;
- medical emergency;
- mental break;
- critical resource shortage.

This allows sophisticated management despite the slower interaction speed of a phone.

---

## 3.5 Systems Before Content

Early development should prioritise reusable systems rather than large amounts of content.

For example:

A working hunger/job/cooking system is more valuable than twenty food items.

A robust health model is more valuable than fifty diseases.

A flexible event system is more valuable than dozens of hard-coded events.

Content should multiply the value of systems that are already interesting.

---

# 4. Player Fantasy

The player should feel like the organiser of a fragile human settlement.

The player decides:

- what is important;
- where resources should go;
- who should specialise;
- what risks are acceptable;
- where the colony should expand;
- when people should rest;
- when to fight;
- when to retreat;
- what shortages can be tolerated.

The colonists then attempt to execute those intentions in a messy simulated world.

The resulting gap between **what the player wants** and **what actually happens** is a major source of gameplay.

---

# 5. Core Gameplay Loop

The primary loop is:

**Observe → Identify need/problem → Designate response → Colonists act → Systems interact → Consequences emerge → Reassess**

Typical example:

1. Player notices wood reserves are low.
2. Player enters the Orders tool.
3. Player paints several trees for cutting.
4. A colonist with plant-cutting work enabled claims the job.
5. They walk to the forest.
6. Hunger interrupts the job.
7. They return to eat.
8. Another colonist begins cutting instead.
9. Logs are produced.
10. A hauler moves the logs to storage.
11. A builder uses the logs to complete a wall.
12. The player's original resource shortage is reduced.

The game should make these chains understandable without requiring the player to manually control every link.

---

# 6. Map

## 6.1 Structure

The world is represented as a tile grid viewed from above.

Initial target map size:

**approximately 80 × 80 tiles**

This can be adjusted after performance testing.

The map should be large enough to support:

- settlement expansion;
- resource distribution;
- defensive layouts;
- farming;
- wilderness;
- hostile approaches.

It should remain small enough that pathfinding and simulation are inexpensive on a phone.

---

## 6.2 Initial Terrain Types

Early versions require only a limited set:

- soil;
- fertile soil;
- rock;
- shallow water or impassable water;
- trees;
- loose stone/resource deposits.

Later systems may include:

- terrain movement costs;
- marsh;
- roads;
- snow;
- mud;
- fire propagation;
- temperature;
- roofs;
- caves.

---

# 7. Colonists

The first playable colony begins with approximately **three colonists**.

The initial simulation target should comfortably support roughly **10–20 active colonists** before optimisation for larger populations is considered.

Each colonist initially requires:

### Core state

- name;
- position;
- health;
- hunger;
- rest;
- mood;
- current job;
- work priorities;
- basic skills.

### Initial skills

Potential first set:

- construction;
- plants;
- cooking;
- medicine;
- shooting;
- melee;
- hauling/general labour.

The skill list should remain small until the job system is stable.

---

# 8. Needs

Initial needs:

## Hunger

Declines over time.

Low hunger causes:

- food-seeking behaviour;
- mood penalties;
- eventually health consequences.

## Rest

Declines while awake.

Low rest causes:

- reduced performance;
- autonomous sleep seeking;
- mood penalties.

Beds improve sleep quality and recovery.

## Mood

Mood is derived from conditions rather than functioning as a generic health bar.

Early mood inputs may include:

- hunger;
- tiredness;
- pain;
- comfort;
- shelter;
- recent events.

The first implementation does not require elaborate psychology.

Mood becomes deeper once the basic colony loop works.

---

# 9. Jobs and Work

The job system is one of the game's central systems.

The player creates **work opportunities**, not usually direct orders.

Examples:

- cut tree;
- haul item;
- construct wall;
- cook meal;
- tend patient.

Colonists evaluate available jobs based on:

- work type enabled;
- priority;
- skill;
- distance;
- urgency;
- current needs;
- reservation status.

A job must be reservable so that multiple colonists do not repeatedly attempt to use the same resource or workstation.

---

## 9.1 Initial Work Types

First implementation:

- hauling;
- construction;
- plant cutting;
- cooking;
- tending;
- basic combat.

Later:

- growing;
- mining;
- crafting;
- cleaning;
- research;
- hunting;
- firefighting;
- animal handling.

---

# 10. Resources

Initial resources should remain deliberately limited.

Suggested starting set:

- **Wood**
- **Stone**
- **Food**
- **Metal**

Resources should ideally exist physically in the world rather than simply as abstract counters.

For example:

A tree becomes logs.

Logs remain on the ground until hauled.

A stockpile determines where those logs should be stored.

A builder reserves and collects logs when constructing something.

This physicality is important because logistics creates gameplay.

---

# 11. Construction

Buildings are first placed as blueprints.

Blueprints reserve a location and specify required materials.

Construction requires:

1. blueprint placement;
2. delivery of required material;
3. construction work;
4. completed structure.

Initial buildable objects:

### Structure

- wall;
- door.

### Furniture

- bed.

### Zones

- stockpile.

### Production

- simple cooking station.

Future categories:

- power;
- security;
- temperature;
- recreation;
- research;
- farming;
- sanitation, if appropriate.

---

# 12. Mobile Interaction Model

## 12.1 Camera

- One-finger drag: pan.
- Pinch: zoom.
- Optional double-tap: centre/focus.
- Camera momentum should be modest and controllable.

The player should never need a virtual joystick to move the camera.

---

## 12.2 Selection

Tap an object to select it.

Examples:

- colonist;
- tree;
- building;
- item;
- enemy.

Selection reveals an appropriate contextual interface.

---

## 12.3 Contextual Actions

Selecting something should expose only relevant actions.

Example:

**Tree selected**

`Chop | Info`

**Colonist selected**

`Draft | Prioritize | Gear | Info`

**Door selected**

`Hold Open | Deconstruct | Info`

This replaces the role of many right-click menus.

---

## 12.4 Long Press

Long press may be used as an optional shortcut.

It must not be required for core gameplay.

Reasons:

- poor discoverability;
- relatively slow;
- conflicts with map dragging;
- unreliable during frequent interaction.

---

# 13. Primary HUD

The normal map view should remain sparse.

Possible structure:

### Top

Horizontal colonist portrait strip.

Major alert indicator.

### Upper corner

Compact resource summary.

### Bottom corner

Time controls.

### Bottom navigation

Primary colony interfaces:

- Architect
- Work
- Assign
- Research
- More

Exact categories remain provisional.

The map should dominate the screen.

---

# 14. Architect Interface

Tap **Architect**.

A bottom sheet appears containing categories such as:

- Structure
- Furniture
- Production
- Zones
- Orders

Tap:

**Structure → Wall**

The catalogue retracts.

The game enters placement mode.

Player drags from one tile to another.

A line of wall blueprints appears.

Placement-mode controls remain visible:

`Wall | Undo | Cancel`

This follows the principle that the interface should reveal complexity only when required.

---

# 15. Orders Interface

Orders apply designations to existing world objects.

Examples:

- chop wood;
- harvest;
- mine;
- haul urgently;
- deconstruct;
- cancel.

After choosing an order, the player can paint directly across the map.

For example:

**Orders → Chop**

Player drags over an area of forest.

Eligible trees within the painted region become designated.

Colonists later perform the jobs automatically.

---

# 16. Colonist Interface

Colonist portraits remain easily accessible from the main screen.

Tap a portrait:

- select colonist;
- optionally centre camera.

Tap the selected colonist's information area to open detailed information.

Suggested sections:

- Overview
- Needs
- Health
- Gear
- Social
- Bio

These should use a large bottom sheet or full-screen interface rather than tiny tabs over the map.

---

# 17. Work Interface

Work priorities warrant a dedicated management screen.

Example:

| Colonist | Build | Plants | Cook | Tend | Haul |
|---|---:|---:|---:|---:|---:|
| Mara | 1 | — | 3 | 2 | 3 |
| Jonas | 3 | 1 | 2 | — | 2 |
| Iris | — | 2 | 1 | 1 | 3 |

Priority values may initially use:

**1–4**, where 1 is highest priority.

The interface should show relevant skill values alongside priorities where useful.

The player should not need to leave the Work screen simply to discover whether a colonist is competent at a job.

---

# 18. Combat

Combat is initially simple.

Colonists normally remain autonomous.

The player may **Draft** a colonist to gain direct tactical control.

Drafted controls include:

- move;
- attack;
- melee attack;
- hold position;
- undraft.

Initial combat systems:

- ranged attacks;
- melee attacks;
- health damage;
- incapacitation;
- death.

Later systems may add:

- body-part injuries;
- armour;
- bleeding;
- cover;
- accuracy;
- weapon quality;
- suppression;
- fire;
- medical rescue.

Combat should remain subordinate to the colony simulation rather than becoming the entire game.

---

# 19. Events

The colony periodically experiences external events.

Early event set:

- hostile raid;
- visitor/trader;
- food opportunity;
- illness;
- weather event.

Events should eventually be generated through a reusable event/storyteller framework.

The player should be able to configure which event types automatically pause the game.

---

# 20. Saving

Because the game runs in a browser, reliable persistence is mandatory.

Initial approach:

- automatic local saves;
- IndexedDB storage;
- manual save slots;
- periodic autosave;
- save on page hide where practical.

Refreshing or closing the browser must not casually destroy a colony.

Later:

- export save;
- import save;
- cloud save if hosting infrastructure warrants it.

---

# 21. Browser and Installation Strategy

The game should initially run as a normal browser application.

Target:

- modern Android Chrome as primary development target;
- iOS Safari compatibility where practical.

Once the core game is stable, package it as a **Progressive Web App**.

Desired PWA behaviour:

- installable to home screen;
- fullscreen presentation;
- offline-capable assets;
- persistent saves;
- app-like launch behaviour.

---

# 22. Simulation Architecture Principles

Rendering and simulation should be separated.

The simulation should not depend on visual frame rate.

Potential model:

- rendering: up to 60 FPS;
- simulation: fixed timestep;
- slow systems updated at lower frequencies where appropriate.

Examples:

Path movement may update frequently.

Hunger does not need 60 calculations per second.

Job searching should not run every frame.

Mood recalculation may occur periodically.

This separation will be important for phone battery usage and performance.

---

# 23. Performance Philosophy

Avoid premature optimisation, but design systems so optimisation remains possible.

Potential expensive systems include:

- pathfinding;
- job searching;
- large item counts;
- visibility;
- temperature;
- fire;
- social simulation.

Early architecture should avoid every colonist scanning the entire map every frame.

Likely strategies include:

- spatial indexing;
- cached paths;
- job queues;
- reservations;
- dirty-state updates;
- lower-frequency simulation tiers.

---

# 24. First Playable Prototype

The first serious prototype should contain only enough systems to prove the central loop.

### World

- procedural tile map;
- trees;
- stone;
- basic terrain.

### Colonists

- three colonists;
- hunger;
- rest;
- health;
- simple skills.

### Work

- autonomous job selection;
- cutting trees;
- hauling;
- construction.

### Construction

- stockpile;
- wall;
- door;
- bed.

### Resources

- wood;
- stone;
- food.

### Interface

- pan;
- zoom;
- selection;
- contextual actions;
- Architect menu;
- Orders menu;
- pause and speed control.

### Threat

- one simple hostile event.

### Persistence

- autosave;
- load.

The purpose of this prototype is not to demonstrate content.

It must answer one question:

> Is managing a genuinely autonomous little colony enjoyable on a phone?

If the answer is yes, additional systems can be layered onto that foundation.

---

# 25. Explicit Non-Goals for the First Prototype

Do not initially build:

- world map travel;
- caravans;
- diplomacy;
- detailed relationships;
- breeding;
- animals;
- complex research trees;
- electricity networks;
- temperature simulation;
- dozens of weapons;
- large technology trees;
- elaborate procedural storytelling;
- extensive crafting;
- multiplayer;
- hundreds of colonists.

These may be valuable later.

They are not required to validate the game.

---

# 26. Originality

The game may take strong structural inspiration from colony simulators such as RimWorld, but it should not become a direct reproduction.

Avoid copying:

- proprietary art;
- names;
- lore;
- text;
- events;
- UI artwork;
- exact content catalogues.

The long-term game should establish its own identity through:

- setting;
- visual language;
- simulation emphasis;
- event design;
- colonist psychology;
- world systems;
- thematic choices.

The specific differentiating feature has not yet been chosen.

That should emerge during design rather than being invented merely for the sake of appearing different.

---

# 27. Current Design Principles

For future decisions, prefer solutions consistent with these rules:

1. **The player runs the colony, not the colonists.**
2. **Keep simulation depth where mobile UI can hide complexity intelligently.**
3. **Touch the thing you mean.**
4. **Use contextual controls rather than permanent clutter.**
5. **Pause makes complexity manageable.**
6. **Physical logistics create gameplay.**
7. **Systems should interact to create stories.**
8. **Build robust primitives before adding large amounts of content.**
9. **The phone is the primary platform, not a reduced desktop target.**
10. **A small interesting colony is preferable to a large shallow one.**

---

# 28. Open Design Questions

The following remain deliberately unresolved:

- Setting and fiction.
- Visual style.
- Exact needs model.
- Detailed health model.
- Job-priority algorithm.
- Whether direct movement orders exist outside drafted mode.
- Exact colonist portrait/navigation design.
- Selection of multiple colonists on touch.
- Area-designation gesture.
- Combat depth.
- Storyteller/event architecture.
- Technology progression.
- Colony victory/failure conditions.
- Long-term campaign structure.
- What fundamentally distinguishes the game from RimWorld beyond mobile-native interaction.

These should be resolved progressively rather than guessed at before the core simulation exists.
