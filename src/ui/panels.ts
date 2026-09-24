import { roomTopology } from '../sim/topology';
import { isRainExposed, wetnessBand } from '../sim/weather';
import { BUILDINGS, DAY_TICKS, JOB_LABELS, NODES, TERRAIN, WORK } from '../sim/definitions';
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
import { CROPS } from '../sim/agriculture';
import { agricultureContextHTML } from './agriculture-context';

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
          )}${toolButton('stockpile', 'Stockpile', 'Drag an area · Store physical supplies')}${toolButton('dump', 'Dump zone', 'Drag an area · Place spoiled food')}${toolButton('grow', 'Growing zone', 'Drag soil · Potato by default · Tap a field to change crop', 'leaf')}</div><p class="panel-note">Place a plan. Your colonists deliver the materials and build it.</p>`
      );
    case 'orders':
      return (
        heading('GIVE THE COLONY DIRECTION', 'Orders') +
        `<div class="catalogue">${toolButton('gather', 'Gather resources', 'Cut trees, pick berries, collect stone', 'orders')}${toolButton('cancel', 'Cancel plans', 'Remove orders, blueprints and zones', 'close')}</div><p class="panel-note">Drag over an area to mark several resources at once.</p>`
      );
    case 'work':
      return (
        heading('EVERYONE HAS A PART TO PLAY', 'Work priorities') +
        `<p class="panel-note">Tap to cycle: <b>1</b> highest → <b>4</b> lowest → <b>—</b> off.<br>Small numbers show skill. Needs always come first.</p><table class="work-table"><thead><tr><th>Colonist</th>${Object.values(
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
                  return `<td><button data-action="priority" data-value="${p.id}:${t}" aria-label="${esc(p.name)} ${WORK[t]} priority ${p.priorities[t] || 'off'}"><b class="priority-${p.priorities[t]}">${p.priorities[t] || '—'}</b><small>skill ${p.skills[t]}</small></button></td>`;
                })
                .join('')}</tr>`,
          )
          .join('')}</tbody></table>`
      );
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
        `<div class="settings-list"><button data-action="save">${icon('save')} Save now <span>Local device</span></button><button data-action="export">${icon('journal')} Export save <span>Keep a backup</span></button><button data-action="import">${icon('save')} Import save <span>Restore a backup</span></button><button data-action="journal">${icon('journal')} Field notes <span>Colony activity</span></button><button data-action="debug">${icon('focus')} Diagnostics <span>${debug ? 'On' : 'Off'}</span></button>${debug ? '<button data-action="mark-debug">Mark Debug Moment <span>Record marker</span></button><button data-action="export-debug">Export Debug Report <span>JSON · Share or download</span></button>' : ''}<button data-action="fullscreen">${icon('focus')} Fullscreen <span>When supported</span></button><button data-action="help">${icon('leaf')} Getting started</button><button class="danger" data-action="new">${icon('home')} New colony <span>Replace current save…</span></button></div><p class="panel-note">Autosaves every 15 seconds and when hidden. Simulation rests while you are away. Install from your browser menu on HTTPS.</p>`
      );
    default:
      return '';
  }
}
export function contextHTML(w: World, ui: UIState, owner?: string) {
  const p = w.pawns.find((e) => e.id === ui.selectedId);
  const node = w.nodes.find((e) => e.id === ui.selectedId);
  const bp = w.blueprints.find((e) => e.id === ui.selectedId);
  const b = w.buildings.find((e) => e.id === ui.selectedId);
  const item = w.items.find((e) => e.id === ui.selectedId);
  const crop = w.crops.find((e) => e.id === ui.selectedId);
  const e = p ?? node ?? bp ?? b ?? item ?? crop;
  const close = `<button class="icon-button context-close" data-action="deselect" aria-label="Close selection">${icon('close')}</button>`;
  let content = '';
  if (p) {
    const meter = (label: string, value: number) =>
      `<div class="need"><span>${label}</span><meter min="0" max="100" low="25" high="60" optimum="100" value="${value}"></meter><b>${Math.round(value)}</b></div>`;
    const moodLabel = p.mood >= 60 ? 'Normal' : p.mood >= 30 ? 'Strained' : 'Miserable';
    content = `<span class="eyebrow">COLONIST · ${esc(moodLabel.toUpperCase())}</span><h3>${esc(p.name)}</h3><p class="job-status">${p.job ? JOB_LABELS[p.job.kind] : 'Taking a breather'}${p.carrying ? ` · ${p.carrying.quantity} ${p.carrying.resource}` : ''}</p><div class="needs">${meter('Food', p.hunger)}${meter('Rest', p.rest)}${meter('Health', p.health)}</div><p>Hunger drain ${(p.activity === 'hauling' ? 3.8 : p.activity === 'heavy-work' ? 3.3 : 2.7).toFixed(1)} / hour · ${p.activity ?? 'resting'}<br>Mood: ${moodLabel} · work speed ${Math.round((p.productivity ?? 1) * 100)}%${p.illnessUntil && p.illnessUntil > w.tick ? ' · mildly ill' : ''}</p><button class="text-button" data-action="panel" data-value="work">Manage work priorities <span>↗</span></button><button class="text-button" data-action="copy-debug">Copy Selected Colonist Debug <span>↗</span></button>`;
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
    content = `<span class="eyebrow">PHYSICAL SUPPLIES</span><h3>${formatResourcePoints(item.quantity)} ${itemLabel}</h3><p>${freshness}${freshness ? '<br>' : ''}${w.dumpZones.includes(tileKey(w, item)) ? 'In a Dump zone · Decays naturally' : w.stockpiles.includes(tileKey(w, item)) ? 'In a stockpile' : 'On the ground · Awaiting hauling'}</p>`;
  } else if (crop) {
    content = agricultureContextHTML(w, crop, crop);
  } else if (ui.selectedTile) {
    const agriculture = agricultureContextHTML(w, ui.selectedTile);
    if (agriculture) content = agriculture;
    else {
      const terrain = w.terrain[tileKey(w, ui.selectedTile)];
      if (!terrain) return '';
      content = `<span class="eyebrow">${ui.selectedTile.x}, ${ui.selectedTile.y}</span><h3>${TERRAIN[terrain].label}</h3><p>${w.dumpZones.includes(tileKey(w, ui.selectedTile)) ? 'Dump zone · accepts spoiled food and waste' : w.stockpiles.includes(tileKey(w, ui.selectedTile)) ? 'Stockpile · Accepts wood, stone and food' : TERRAIN[terrain].passable ? 'Open ground. A place for something new.' : 'Impassable water.'}</p>`;
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
