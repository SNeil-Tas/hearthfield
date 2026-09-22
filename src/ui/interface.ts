import { DAY_TICKS, JOB_LABELS } from '../sim/definitions';
import { WEATHER } from '../sim/weather';
import type { World } from '../sim/types';
import { resourceTotal, usefulResourceTotal } from '../sim/world';
import type { Speed } from '../sim/clock';
import type { UIState } from './state';
import { icon, escapeHTML as esc } from './icons';
import { contextHTML, panelHTML } from './panels';
import { formatResourcePoints } from './format';

export interface DebugMetrics {
  build: string;
  fps: number;
  lastTickMs: number;
  worstTickMs: number;
  activeJobs: number;
  viewport: string;
  dpr: number;
  standalone: boolean;
  serviceWorker: string;
  lastSave: string;
}

export class Interface {
  readonly canvas: HTMLCanvasElement;
  private root: HTMLElement;
  private panelKey = '';
  private contextKey = '';
  private portraitKey = '';
  private pressingButton = false;
  constructor(root: HTMLElement, action: (action: string, value: string) => void) {
    this.root = root;
    root.innerHTML = `<canvas id="world" aria-label="Colony map. Drag to pan, pinch or scroll to zoom. Use Orders or Architect to make plans."></canvas>
      <header class="top-hud"><div class="brand">${icon('leaf')}<div><strong>hearthfield</strong><span>A LITTLE COLONY, A LIVING WORLD</span></div></div><div class="colonist-strip" aria-label="Colonists"></div><div class="resource-strip" aria-label="Physical supplies">${['wood', 'stone', 'food'].map((r) => `<div title="${r} on ground and carried${r === 'food' ? ' plus cooking ingredients; excludes spoiled food' : ''}">${icon(r)}<b id="resource-${r}">0</b><span>${r}</span></div>`).join('')}</div></header>
      <div class="world-label"><span class="season-dot"></span><span id="day-label">Day 1 · Early morning</span><span class="world-divider">/</span><span id="weather-label">Clear · outdoor work normal</span></div>
      <button class="focus-button icon-button" data-action="focus" aria-label="Focus settlement">${icon('focus')}</button>
      <aside class="guide" aria-label="Getting started"><button class="icon-button context-close" data-action="dismiss-guide" aria-label="Dismiss getting started">${icon('close')}</button><span class="eyebrow">A SMALL BEGINNING</span><h1>Make room<br>for tomorrow.</h1><p>Three settlers. An open meadow.<br>The rest is up to you.</p><ol><li>Mark trees in <b>Orders</b>.</li><li>Plan beds in <b>Architect</b>.</li><li>Watch your people make it happen.</li></ol><button class="text-button" data-action="dismiss-guide">Let’s settle in <span>→</span></button></aside>
      <div class="alert" role="status"></div><div class="update-banner" role="status" hidden><span>New version available</span><button data-action="update">Reload</button><button data-action="update-later">Later</button></div><div class="tool-hint" hidden></div><div class="toast" role="status" hidden></div>
      <div class="panel-shield" hidden></div><section class="panel" hidden aria-label="Colony management"></section><aside class="context" hidden aria-label="Selection information"></aside>
      <nav class="bottom-hud" aria-label="Colony controls"><div class="navigation">${[
        ['architect', 'build', 'Architect'],
        ['orders', 'orders', 'Orders'],
        ['work', 'work', 'Work'],
        ['settings', 'more', 'More'],
      ]
        .map(
          ([id, symbol, label]) =>
            `<button data-action="panel" data-value="${id}" aria-label="${label}">${icon(symbol!)}<span>${label}</span></button>`,
        )
        .join(
          '',
        )}</div><div class="time-control"><button data-action="speed" data-value="0" aria-label="Pause simulation">${icon('pause')}</button>${[1, 2, 4].map((n) => `<button data-action="speed" data-value="${n}" aria-label="${n}x speed">${n}×</button>`).join('')}</div></nav>
      <div class="save-indicator" aria-live="polite">Local colony</div><div class="debug-overlay" hidden></div><div class="portrait-notice">Best played in landscape <span>↻</span></div><input id="import-file" type="file" accept="application/json,.json" hidden />`;
    this.canvas = root.querySelector('canvas')!;
    root.addEventListener('pointerdown', (event) => {
      this.pressingButton = !!(event.target as Element).closest('button');
    });
    const release = () => {
      setTimeout(() => {
        this.pressingButton = false;
      }, 0);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    root.addEventListener('click', (event) => {
      this.pressingButton = false;
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
      if (button) action(button.dataset.action!, button.dataset.value ?? '');
    });
    root.querySelector('.panel-shield')!.addEventListener('click', () => action('close-panel', ''));
  }
  update(
    w: World,
    ui: UIState,
    speed: Speed,
    reservationCount: number,
    owner?: string,
    metrics?: DebugMetrics,
  ) {
    const portraits = w.pawns.map((p) => p.id).join();
    if (portraits !== this.portraitKey) {
      this.portraitKey = portraits;
      this.el('.colonist-strip').innerHTML = w.pawns
        .map(
          (p) =>
            `<button class="colonist" data-action="colonist" data-value="${p.id}" aria-label="Select ${esc(p.name)}"><span class="portrait" style="--person:${p.color}"><i></i></span><span class="colonist-label"><b>${esc(p.name)}</b><small id="job-${p.id}">Settling in</small></span><span class="status-dot" id="status-${p.id}"></span></button>`,
        )
        .join('');
    }
    for (const pawn of w.pawns) {
      this.el(`#job-${pawn.id}`).textContent = pawn.job ? JOB_LABELS[pawn.job.kind] : 'Idle';
      this.el(`#status-${pawn.id}`).style.background = pawn.mood < 35 ? '#d38661' : '#a4ba86';
      this.el(`[data-value="${pawn.id}"]`).classList.toggle('selected', ui.selectedId === pawn.id);
    }
    for (const resource of ['wood', 'stone', 'food'] as const)
      this.el(`#resource-${resource}`).textContent = formatResourcePoints(
        resource === 'food' ? usefulResourceTotal(w, resource) : resourceTotal(w, resource),
      );
    const hour = (Math.floor(((w.tick % DAY_TICKS) / DAY_TICKS) * 24) + 6) % 24;
    this.el('#day-label').textContent =
      `Day ${Math.floor(w.tick / DAY_TICKS) + 1} · ${String(hour).padStart(2, '0')}:${String(Math.floor(((w.tick % 250) / 250) * 60)).padStart(2, '0')}`;
    this.el('#weather-label').textContent = WEATHER[w.weather].label;
    this.el('.guide').hidden = !ui.guide || !!ui.panel || ui.tool !== 'inspect' || !!ui.selectedId;
    const alert = this.el('.alert');
    alert.textContent =
      usefulResourceTotal(w, 'food') < 6
        ? 'Food is running low · Gather berry bushes'
        : w.pawns.some((p) => p.hunger < 18)
          ? 'A colonist needs food'
          : '';
    alert.hidden = !alert.textContent || !!ui.panel;
    const panelKey = JSON.stringify([
      ui.panel,
      ui.debug,
      ui.panel === 'work' ? w.pawns.map((p) => p.priorities) : null,
      ui.panel === 'journal' ? w.events : null,
    ]);
    const panel = this.el('.panel');
    panel.hidden = !ui.panel;
    panel.classList.toggle('wide', ['work', 'settings', 'journal'].includes(ui.panel ?? ''));
    panel.classList.toggle('work-panel', ui.panel === 'work');
    this.el('.panel-shield').hidden = !['work', 'settings', 'journal'].includes(ui.panel ?? '');
    if (panelKey !== this.panelKey && !this.pressingButton) {
      this.panelKey = panelKey;
      panel.innerHTML = panelHTML(ui.panel, w, ui.debug);
    }
    const context = this.el('.context');
    context.hidden = !!ui.panel || ui.tool !== 'inspect';
    const contextText = contextHTML(w, ui, owner);
    if (contextText !== this.contextKey && !this.pressingButton) {
      this.contextKey = contextText;
      context.innerHTML = contextText;
    }
    if (!contextText) context.hidden = true;
    const hint = this.el('.tool-hint');
    hint.hidden = ui.tool === 'inspect';
    const toolLabels = {
      gather: 'Gather · Drag over resources',
      cancel: 'Cancel · Drag over plans',
      wall: 'Wall · Drag a line · 5 wood each',
      door: 'Door · Tap to place · 8 wood',
      bed: 'Bed · Tap to place · 10 wood',
      cooking: 'Cooking station · Tap to place · 12 wood',
      stockpile: 'Stockpile · Drag an area',
      dump: 'Dump zone · Drag an area',
      grow: 'Growing zone · Drag fertile ground',
    };
    const hintText =
      ui.tool === 'inspect'
        ? ''
        : `<span>${toolLabels[ui.tool]}</span><small>Two fingers to pan / zoom</small><button data-action="tool" data-value="inspect">Done ${icon('close')}</button>`;
    if (hint.innerHTML !== hintText) hint.innerHTML = hintText;
    this.root.querySelectorAll<HTMLButtonElement>('[data-action="speed"]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.value) === speed);
      b.setAttribute('aria-pressed', String(Number(b.dataset.value) === speed));
    });
    this.root
      .querySelectorAll<HTMLButtonElement>('[data-action="panel"]')
      .forEach((b) => b.classList.toggle('active', b.dataset.value === ui.panel));
    this.el('.debug-overlay').hidden = !ui.debug;
    this.el('.debug-overlay').textContent = metrics
      ? `Hearthfield ${metrics.build}\nFPS ${metrics.fps} · tick ${metrics.lastTickMs.toFixed(2)}ms (worst ${metrics.worstTickMs.toFixed(2)}ms)\n${metrics.activeJobs} active jobs · ${w.nodes.length} nodes · ${w.items.length} stacks · ${reservationCount} locks\n${metrics.viewport} · DPR ${metrics.dpr} · ${metrics.standalone ? 'standalone' : 'browser'} · SW ${metrics.serviceWorker}\nLast save ${metrics.lastSave}`
      : `tick ${w.tick} · ${speed}× · ${w.nodes.length} nodes · ${w.items.length} stacks · ${reservationCount} locks`;
    const toast = this.el('.toast');
    toast.hidden = !ui.toast;
    toast.textContent = ui.toast;
  }
  saveStatus(text: string) {
    this.el('.save-indicator').textContent = text;
  }
  showUpdate() {
    this.el('.update-banner').hidden = false;
  }
  hideUpdate() {
    this.el('.update-banner').hidden = true;
  }
  private el(selector: string) {
    return this.root.querySelector<HTMLElement>(selector)!;
  }
}
