import { housingStatus } from '../sim/housing';
import { roomTopology } from '../sim/topology';
import { isRainExposed, wetnessBand } from '../sim/weather';
import {
  BUILDINGS,
  COMPOST_WASTE_POINTS,
  DAY_TICKS,
  JOB_LABELS,
  NODES,
  TERRAIN,
  WORK,
} from '../sim/definitions';
import type { World } from '../sim/types';
import type { Panel, UIState } from './state';
import { escapeHTML as esc, icon } from './icons';
import {
  foodType,
  freshPoints,
  spoiledPoints,
  hasAdjacentWaste,
  resourceTotal,
  tileKey,
  isFoodSpoiled,
} from '../sim/world';
import { APP_VERSION, BUILD_ID } from '../build';
import { formatResourcePoints } from './format';
import { CROPS, waterSalinityAt, waterSourceClass } from '../sim/agriculture';
import { agricultureContextHTML } from './agriculture-context';
import { COLONY_GOALS, completedGoalIds, currentColonyGoal } from '../sim/goals';
import { ANIMALS, animalStage, ecosystemCounts } from '../sim/ecology';
import {
  ageYears,
  injuryLabel,
  agingMovementMultiplier,
  agingWorkMultiplier,
  isAdult,
  lifeStage,
  LIFE_STAGE_LABELS,
} from '../sim/health';
import { relationshipMoodEffect } from '../sim/relationships';
import { psychologyContextHTML } from './psychology-context';

const toolButton = (tool: string, label: string, detail: string, symbol = tool) =>
  `<button class="catalogue-item" data-action="tool" data-value="${tool}"><span class="catalogue-icon">${icon(symbol)}</span><span><strong>${label}</strong><small>${detail}</small></span><span class="chevron">›</span></button>`;
const heading = (eyebrow: string, title: string) =>
  `<header class="panel-heading"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div><button class="icon-button" data-action="close-panel" aria-label="Close panel">${icon('close')}</button></header>`;
export function panelHTML(panel: Panel, w: World, debug: boolean) {
  switch (panel) {
    case 'architect':
      return (
        heading('SHAPE YOUR SETTLEMENT', 'Architect') +
        `<div class="catalogue">${Object.entries(BUILDINGS)
          .map(([kind, def]) =>
            toolButton(
              kind,
              def.label,
              `${def.cost} wood · ${kind === 'bed' ? 'Better rest' : kind === 'door' ? 'A way through' : 'Timber structure'}`,
            ),
          )
          .join(
            '',
          )}${toolButton('stockpile', 'Stockpile', 'Drag an area · Store physical supplies')}${toolButton('dump', 'Dump zone', `Drag an area · ${COMPOST_WASTE_POINTS} aged waste → 1 fertilizer`)}${toolButton('grow', 'Growing zone', 'Drag soil · Potato by default · Tap a field to change crop', 'leaf')}</div><p class="panel-note">Place a plan. Your colonists deliver the materials and build it.</p>`
      );
    case 'orders':
      return (
        heading('GIVE THE COLONY DIRECTION', 'Orders') +
        `<div class="catalogue">${toolButton('gather', 'Gather resources', 'Cut trees, pick berries, collect stone', 'orders')}${toolButton('cancel', 'Cancel plans', 'Remove orders, blueprints and zones', 'close')}</div><p class="panel-note">Drag over an area to mark several resources at once.</p>`
      );
    case 'work': {
      const posts = w.jobPosts.length
        ? [...w.jobPosts]
            .sort(
              (a, b) => Number(!!a.claimedBy) - Number(!!b.claimedBy) || a.postedAt - b.postedAt,
            )
            .map((post) => {
              const poster = w.pawns.find((pawn) => pawn.id === post.postedBy)?.name ?? 'Someone';
              const claimant = post.claimedBy
                ? w.pawns.find((pawn) => pawn.id === post.claimedBy)?.name
                : undefined;
              return `<article class="job-post ${claimant ? 'claimed' : ''}"><i></i><div><strong>${esc(JOB_LABELS[post.kind])}</strong><small>Posted by ${esc(poster)}${post.housingProjectId ? ' · Household housing' : ''} · ${Math.max(0, Math.floor((w.tick - post.postedAt) / 10))}s ago</small></div><span>${claimant ? `${esc(claimant)} is on it` : 'OPEN'}</span></article>`;
            })
            .join('')
        : '<p>No posted work yet. Colonists request help with housing and nearby work.</p>';
      const board = `<section class="job-board"><header><div><span class="eyebrow">COLONY HANDOFFS</span><h3>Job board</h3></div><b>${w.jobPosts.filter((post) => !post.claimedBy).length} open</b></header>${posts}</section>`;
      return (
        heading('EVERYONE HAS A PART TO PLAY', 'Work priorities') +
        `<div class="work-content">${board}<div class="work-priorities"><p class="panel-note">Set priorities: <b>1</b> highest → <b>4</b> lowest → <b>—</b> off. Needs come first. Children receive care until 18.</p><table class="work-table"><thead><tr><th>Colonist</th>${Object.values(
          WORK,
        )
          .map((v) => `<th>${v}</th>`)
          .join('')}</tr></thead><tbody>${w.pawns
          .map(
            (p) =>
              `<tr><th><span class="person-dot" style="--person:${p.color}"></span>${esc(p.name)}</th>${Object.keys(
                WORK,
              )
                .map((type) => {
                  const t = type as keyof typeof WORK;
                  return `<td><button ${!isAdult(p) ? 'disabled title="Dependent until age 18"' : ''} data-action="priority" data-value="${p.id}:${t}" aria-label="${esc(p.name)} ${WORK[t]} priority ${p.priorities[t] || 'off'}"><b class="priority-${p.priorities[t]}">${p.priorities[t] || '—'}</b><small>skill ${p.skills[t]}${t === 'plants' ? ` · knowledge ${p.knowledge.agriculture}` : t === 'build' ? ` · knowledge ${p.knowledge.building}` : ''}</small></button></td>`;
                })
                .join('')}</tr>`,
          )
          .join('')}</tbody></table></div></div>`
      );
    }
    case 'goals': {
      const completed = completedGoalIds(w);
      const current = currentColonyGoal(w);
      return (
        heading('A STORY BUILT TOGETHER', 'Colony goals') +
        `<p class="panel-note">Small ambitions give the settlement direction. Each milestone lifts everyone’s spirits.</p><div class="goal-list">${COLONY_GOALS.map(
          (goal) => {
            const done = completed.has(goal.id);
            const progress = goal.progress(w);
            const active = current?.id === goal.id;
            const percent = done ? 100 : Math.min(100, (progress.value / progress.target) * 100);
            return `<article class="goal-card ${done ? 'done' : active ? 'active' : 'locked'}"><span>${done ? '✓ COMPLETE' : active ? 'NEXT STEP' : 'LATER'}</span><h3>${esc(goal.title)}</h3><p>${esc(done ? goal.completedText : goal.detail)}</p><div><i style="width:${percent}%"></i></div><small>${done ? 'Milestone complete' : esc(progress.label)}</small></article>`;
          },
        ).join('')}</div>`
      );
    }
    case 'wildlife': {
      const counts = ecosystemCounts(w);
      const cards = (Object.keys(ANIMALS) as Array<keyof typeof ANIMALS>)
        .map((species) => {
          const def = ANIMALS[species];
          const animals = w.animals.filter((animal) => animal.species === species);
          const stages = { juvenile: 0, adult: 0, elder: 0 };
          for (const animal of animals) stages[animalStage(animal)]++;
          const energy = animals.length
            ? Math.round(animals.reduce((sum, animal) => sum + animal.energy, 0) / animals.length)
            : 0;
          return `<article class="wildlife-card" style="--animal:${def.color};--animal-accent:${def.accent}"><i></i><div><span>${def.predator ? 'PREDATOR' : 'HERBIVORE'}</span><h3>${def.plural}</h3><strong>${counts[species]}</strong><p>${stages.juvenile} young · ${stages.adult} adult · ${stages.elder} elder<br>Average energy ${energy}</p></div></article>`;
        })
        .join('');
      const forageAverage = w.wildForage.length
        ? Math.round(w.wildForage.reduce((sum, value) => sum + value, 0) / w.wildForage.length)
        : 0;
      return (
        heading('A WORLD BEYOND THE HEARTH', 'Wildlife') +
        `<p class="panel-note"><b>${esc(w.landscape.name)}</b> · ${esc(w.landscape.description)}<br>${w.animals.length} animals share the map · average wild forage ${forageAverage}. Predators may stalk and attack nearby colonists when hungry. Colonists fight back instinctively, but bare hands are very ineffective.</p><div class="wildlife-grid">${cards}</div>`
      );
    }
    case 'journal':
      return (
        heading('SMALL MOMENTS, A GROWING COLONY', 'Field notes') +
        `<div class="journal-list">${[...w.events]
          .reverse()
          .map(
            (e) =>
              `<article class="event ${e.kind}"><span>DAY ${Math.floor(e.tick / DAY_TICKS) + 1} · ${Math.floor(e.tick / 10)}s</span><p>${esc(e.text)}</p></article>`,
          )
          .join('')}</div>`
      );
    case 'settings':
      return (
        `<p class="panel-note">Hearthfield v${APP_VERSION} · Build ${BUILD_ID}</p><button class="text-button" data-action="check-updates">Check for updates</button>` +
        heading('HEARTHFIELD · FIRST PLAYABLE', 'Your colony') +
        `<div class="settings-list"><button data-action="panel" data-value="goals">${icon('leaf')} Colony goals <span>Milestones</span></button><button data-action="panel" data-value="wildlife">${icon('focus')} Wildlife <span>${w.animals.length} animals</span></button><button data-action="save">${icon('save')} Save now <span>Local device</span></button><button data-action="export">${icon('journal')} Export save <span>Keep a backup</span></button><button data-action="import">${icon('save')} Import save <span>Restore a backup</span></button><button data-action="journal">${icon('journal')} Field notes <span>Colony activity</span></button><button data-action="debug">${icon('focus')} Diagnostics <span>${debug ? 'On' : 'Off'}</span></button>${debug ? '<button data-action="mark-debug">Mark Debug Moment <span>Record marker</span></button><button data-action="export-debug">Export Debug Report <span>JSON · Share or download</span></button>' : ''}<button data-action="fullscreen">${icon('focus')} Fullscreen <span>When supported</span></button><button data-action="help">${icon('leaf')} Getting started</button><button class="danger" data-action="new">${icon('home')} New colony <span>Replace current save…</span></button></div><p class="panel-note">Autosaves every 15 seconds and when hidden. Simulation rests while you are away. Install from your browser menu on HTTPS.</p>`
      );
    default:
      return '';
  }
}
export function contextHTML(w: World, ui: UIState, owner?: string) {
  const p = w.pawns.find((e) => e.id === ui.selectedId);
  const animal = w.animals.find((e) => e.id === ui.selectedId);
  const node = w.nodes.find((e) => e.id === ui.selectedId);
  const bp = w.blueprints.find((e) => e.id === ui.selectedId);
  const b = w.buildings.find((e) => e.id === ui.selectedId);
  const item = w.items.find((e) => e.id === ui.selectedId);
  const crop = w.crops.find((e) => e.id === ui.selectedId);
  const e = p ?? animal ?? node ?? bp ?? b ?? item ?? crop;
  const close = `<button class="icon-button context-close" data-action="deselect" aria-label="Close selection">${icon('close')}</button>`;
  let content = '';
  if (p) {
    const meter = (label: string, value: number) =>
      `<div class="need"><span>${label}</span><meter min="0" max="100" low="25" high="60" optimum="100" value="${value}"></meter><b>${Math.round(value)}</b></div>`;
    const moodLabel = p.mood >= 60 ? 'Normal' : p.mood >= 30 ? 'Strained' : 'Miserable';
    const injuries = p.injuries.length
      ? p.injuries
          .map((injury) => `${injuryLabel(injury)} · severity ${injury.severity}`)
          .join(', ')
      : 'None';
    const tierLabel = {
      rival: 'Rival',
      acquaintance: 'Acquaintance',
      friend: 'Friend',
      'close-friend': 'Close friend',
    } as const;
    const relationships = p.relationships
      .map((relationship) => ({
        ...relationship,
        target: w.pawns.find((candidate) => candidate.id === relationship.targetId),
      }))
      .filter((relationship) => relationship.target)
      .sort((a, b) => b.familiarity - a.familiarity || b.opinion - a.opinion)
      .map(
        (relationship) =>
          `<article class="relationship ${relationship.tier}"><span class="person-dot" style="--person:${relationship.target!.color}"></span><div><strong>${esc(relationship.target!.name)}</strong><small>${p.partnerId === relationship.targetId ? 'Romantic partner' : p.parentIds.includes(relationship.targetId) ? 'Parent' : relationship.target!.parentIds.includes(p.id) ? 'Child' : tierLabel[relationship.tier]} · familiarity ${Math.round(relationship.familiarity)}%</small></div><b>${relationship.opinion > 0 ? '+' : ''}${Math.round(relationship.opinion)}</b></article>`,
      )
      .join('');
    const socialMood = relationshipMoodEffect(p);
    const partner = w.pawns.find((other) => other.id === p.partnerId);
    const caregiver = w.pawns.find((other) => other.id === p.caregiverId);
    const family = `<p>${LIFE_STAGE_LABELS[lifeStage(p)]} · ${p.sex} · ${p.orientation}<br>Partner: ${partner ? esc(partner.name) : 'None'}${p.pregnancy ? `<br>Expecting a baby · due in ${Math.max(0, Math.ceil((p.pregnancy.dueAt - w.tick) / DAY_TICKS))} days` : ''}${!isAdult(p) ? `<br>Needs shelter and adult care until age 18.<br>Shelter: ${roomTopology(w).isIndoors(p) ? 'Indoors' : 'Needed'} · Caregiver: ${caregiver ? esc(caregiver.name) : 'Needed'}` : ''}<br>Aging begins at ${p.agingOnsetYears} · age-related work ${Math.round(agingWorkMultiplier(p) * 100)}% · movement ${Math.round(agingMovementMultiplier(p) * 100)}%</p>`;
    content = `<span class="eyebrow">COLONIST · ${esc(moodLabel.toUpperCase())}</span><h3>${esc(p.name)}</h3><p class="job-status">${p.job ? JOB_LABELS[p.job.kind] : !isAdult(p) ? 'Growing up · awaiting adult care' : 'Taking a breather'}${p.carrying ? ` · ${p.carrying.quantity} ${p.carrying.resource}` : ''}</p><div class="needs">${meter('Food', p.hunger)}${meter('Rest', p.rest)}${meter('Health', p.health)}${!isAdult(p) ? meter('Care', p.care) : ''}</div>${psychologyContextHTML(w, p)}${family}<p><b>Housing:</b> ${esc(housingStatus(w, p))}<br>Build skill: ${p.skills.build} · Building knowledge: ${p.knowledge.building}</p><p>Age: ${ageYears(p)} · lifespan: ${p.lifespanYears}<br>Injuries: ${esc(injuries)}<br>Hunger drain ${(p.activity === 'hauling' ? 3.8 : p.activity === 'heavy-work' ? 3.3 : 2.7).toFixed(1)} / hour · ${p.activity ?? 'resting'}<br>Mood: ${moodLabel} · work speed ${Math.round((p.productivity ?? 1) * 100)}%${socialMood ? ` · social ${socialMood > 0 ? '+' : ''}${socialMood.toFixed(1)}` : ''}${p.illnessUntil && p.illnessUntil > w.tick ? ' · mildly ill' : ''}<br>Plants skill: ${p.skills.plants} · Agriculture knowledge: ${p.knowledge.agriculture}</p><section class="relationships"><span class="eyebrow">RELATIONSHIPS</span>${relationships || '<p>No other colonists.</p>'}</section><button class="text-button" data-action="panel" data-value="work">Manage work priorities <span>↗</span></button><button class="text-button" data-action="copy-debug">Copy Selected Colonist Debug <span>↗</span></button>`;
  } else if (animal) {
    const def = ANIMALS[animal.species];
    const stage = animalStage(animal);
    const population = ecosystemCounts(w)[animal.species];
    const targetedAnimal = animal.huntTargetId
      ? w.animals.find((candidate) => candidate.id === animal.huntTargetId)
      : undefined;
    const target = animal.huntTargetId
      ? (w.pawns.find((pawn) => pawn.id === animal.huntTargetId)?.name ??
        (targetedAnimal ? ANIMALS[targetedAnimal.species].name.toLowerCase() : undefined))
      : undefined;
    const activity =
      animal.state === 'hunting'
        ? `Tracking ${target ? esc(target) : 'prey'}`
        : animal.state === 'fleeing'
          ? 'Fleeing a predator'
          : animal.state === 'foraging'
            ? 'Grazing'
            : animal.state === 'feeding'
              ? 'Feeding'
              : animal.state === 'resting'
                ? 'Resting'
                : 'Roaming';
    content = `<span class="eyebrow">WILDLIFE · ${def.predator ? 'PREDATOR' : 'HERBIVORE'}</span><h3>${def.name}</h3><p>${stage[0]!.toUpperCase() + stage.slice(1)} ${animal.sex} · ${activity}<br>Health ${Math.round(animal.health)} / ${def.maxHealth} · Energy ${Math.round(animal.energy)} / 100<br>Age ${(animal.ageTicks / DAY_TICKS).toFixed(1)} days · ${population} ${population === 1 ? def.name.toLowerCase() : def.plural.toLowerCase()} on the map.</p><p>${def.predator ? 'A hungry adult may attack nearby colonists. Colonists automatically defend themselves with their hands, but do very little damage.' : 'Colonists do not currently hunt, tame, or feed wildlife.'}</p>`;
  } else if (node) {
    const def = NODES[node.kind];
    content = `<span class="eyebrow">${node.designated ? 'MARKED FOR GATHERING' : 'NATURAL RESOURCE'}</span><h3>${def.label}</h3><p>${def.yield} ${def.resource} when gathered.</p><button class="primary" data-action="node" data-value="${node.designated ? 'cancel' : 'gather'}">${icon(node.designated ? 'close' : 'orders')}${node.designated ? 'Cancel order' : node.kind === 'tree' ? 'Chop tree' : 'Gather'}</button>`;
  } else if (bp) {
    const def = BUILDINGS[bp.kind];
    const needed = def.cost - bp.delivered;
    const buildEnabled = w.pawns.some((pawn) => pawn.priorities.build > 0 && pawn.skills.build > 0);
    const status =
      bp.delivered < def.cost
        ? resourceTotal(w, 'wood') < needed
          ? `Waiting for ${needed} wood`
          : !buildEnabled
            ? 'No colonist has Build enabled'
            : 'Waiting for material delivery'
        : `Building · ${Math.min(100, Math.round((bp.work / def.work) * 100))}%`;
    content = `<span class="eyebrow">CONSTRUCTION PLAN</span><h3>${def.label}</h3><p>${bp.delivered} / ${def.cost} wood delivered<br>${status}</p><button class="text-button" data-action="cancel-blueprint">Cancel blueprint</button>`;
  } else if (b) {
    content = `<span class="eyebrow">COMPLETED BUILDING</span><h3>${BUILDINGS[b.kind].label}</h3><p>${BUILDINGS[b.kind].description}</p>`;
    if (b.kind === 'bed')
      content += `<p>${roomTopology(w).isIndoors(b) ? 'Indoor bed · full rest recovery' : 'Outdoor/unroofed bed · 15% slower rest'}<br>Owner: ${b.ownerId ? esc(w.pawns.find((p) => p.id === b.ownerId)?.name ?? 'unknown') : 'Unclaimed'}</p>`;
    if (b.kind === 'cooking') {
      const raw = w.items
        .filter((item) => item.resource === 'food' && foodType(item) === 'raw')
        .reduce((total, item) => total + item.quantity, 0);
      const buffer = b.ingredientFresh ?? 0;
      const cookOwner = b.reservedBy
        ? w.pawns.find((pawn) => pawn.id === b.reservedBy)?.name
        : undefined;
      content += `<p>${cookOwner ? `Reserved by ${esc(cookOwner)} · ingredients ${buffer} / 100` : raw < 1 ? 'Blocked: no usable food' : 'Idle · available for hungry colonists'}${b.cookingProgress ? `<br>Cooking meal · ${Math.min(100, Math.round((b.cookingProgress / 8) * 100))}%` : ''}</p>`;
    }
    content += b.deconstructing
      ? '<p>Deconstruction is underway.</p>'
      : '<button class="text-button" data-action="deconstruct">Deconstruct <span>↗</span></button>';
  } else if (item) {
    const freshness =
      item.resource === 'food'
        ? foodType(item) === 'raw'
          ? `Fresh: ${freshPoints(item).toFixed(1)}<br>Spoiled: ${spoiledPoints(item).toFixed(1)}<br>Total: ${item.quantity.toFixed(1)}${spoiledPoints(item) > 10 ? '<br>Separation required' : ''}${hasAdjacentWaste(w, item) ? '<br>Spoilage: 2× · adjacent waste' : ''}`
          : 'Cooked meal · 80 food points'
        : '';
    const itemLabel =
      item.resource === 'seed' && item.seedType
        ? `${CROPS[item.seedType].name} seed`
        : item.resource === 'waste'
          ? 'spoiled food'
          : item.foodType === 'meal'
            ? 'meal'
            : item.resource;
    const inDump = w.dumpZones.includes(tileKey(w, item));
    const location = inDump
      ? item.resource === 'waste'
        ? `Composting in a Dump zone · ${COMPOST_WASTE_POINTS} aged waste → 1 fertilizer`
        : 'In a Dump zone'
      : w.stockpiles.includes(tileKey(w, item))
        ? 'In a stockpile'
        : 'On the ground · Awaiting hauling';
    content = `<span class="eyebrow">PHYSICAL SUPPLIES</span><h3>${formatResourcePoints(item.quantity)} ${itemLabel}</h3><p>${freshness}${freshness ? '<br>' : ''}${location}</p>`;
  } else if (crop) {
    content = agricultureContextHTML(w, crop, crop);
  } else if (ui.selectedTile) {
    const agriculture = agricultureContextHTML(w, ui.selectedTile);
    if (agriculture) content = agriculture;
    else {
      const terrain = w.terrain[tileKey(w, ui.selectedTile)];
      if (!terrain) return '';
      const salinity = terrain === 'water' ? waterSalinityAt(w, tileKey(w, ui.selectedTile)) : 0;
      content = `<span class="eyebrow">${ui.selectedTile.x}, ${ui.selectedTile.y}</span><h3>${TERRAIN[terrain].label}</h3><p>${w.dumpZones.includes(tileKey(w, ui.selectedTile)) ? `Dump zone · ${COMPOST_WASTE_POINTS} aged waste becomes 1 fertilizer` : w.stockpiles.includes(tileKey(w, ui.selectedTile)) ? 'Stockpile · Accepts wood, stone and food' : TERRAIN[terrain].passable ? 'Open ground. A place for something new.' : `${waterSourceClass(salinity)} irrigation source · salinity ${salinity.toFixed(1)} · impassable`}</p>`;
    }
  } else return '';
  const selected = e ?? ui.selectedTile;
  if (selected) {
    const env = roomTopology(w).environmentAt(selected);
    const environment = `<p>Location: ${env.location} / Room: ${env.roomId ?? 'None'}<br>Roofed: ${env.roofed ? 'Yes' : 'No'} / Rain exposure: ${isRainExposed(w, selected) ? 'Yes' : 'No'}</p>`;
    const wetness = p
      ? `<p>Wetness: ${wetnessBand(p.wetness)} / ${isRainExposed(w, p) ? 'In rain' : (p.wetness ?? 0) > 0 ? 'Drying' : 'Dry'}</p>`
      : '';
    content = content.replace('</h3>', `</h3>${environment}${wetness}`);
  }
  if (ui.debug && e)
    content += `<code>${esc(e.id)} · ${e.x.toFixed(1)}, ${e.y.toFixed(1)}${owner ? `<br>Reserved: ${esc(owner)}` : ''}</code>`;
  return close + content;
}
