import './style.css';
import './ui/mobile.css';
import { SimulationClock, type Speed } from './sim/clock';
import { generateWorld } from './sim/generate';
import { Simulation } from './sim/simulation';
import type { Point, WorkType } from './sim/types';
import { inside } from './sim/world';
import { SaveStore } from './persistence/storage';
import { acquireWriter } from './persistence/session';
import { decode, encode } from './persistence/serialization';
import { Camera } from './view/camera';
import { Renderer } from './view/renderer';
import { Gestures } from './input/gestures';
import { Interface, type DebugMetrics } from './ui/interface';
import { initialUI, type Panel, type Tool } from './ui/state';
import { selectAt } from './ui/selection';

async function bootstrap() {
  const store = new SaveStore();
  const ui = initialUI();
  const camera = new Camera();
  const clock = new SimulationClock();
  const ownsSession = await acquireWriter();
  let sim: Simulation;
  const metrics: DebugMetrics = {
    fps: 0,
    lastTickMs: 0,
    worstTickMs: 0,
    activeJobs: 0,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    dpr: window.devicePixelRatio || 1,
    standalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    serviceWorker: 'unsupported',
    lastSave: 'not yet',
  };
  let savingAllowed = true;
  let startupMessage = '';
  try {
    const loaded = await store.load();
    sim = new Simulation(loaded.world ?? generateWorld());
    if (loaded.world) ui.guide = false;
    startupMessage = loaded.warnings.join(' ');
  } catch (error) {
    sim = new Simulation(generateWorld());
    savingAllowed = false;
    clock.speed = 0;
    startupMessage =
      error instanceof Error ? error.message : 'Could not load saves. Existing data is preserved.';
  }
  if (!ownsSession) {
    savingAllowed = false;
    clock.speed = 0;
    startupMessage =
      'Another tab is running this colony. This is a preview. Close the other tab and reload to continue here.';
  }
  let toastTimer = 0;
  const notify = (message: string, duration = 4000) => {
    ui.toast = message;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      ui.toast = '';
    }, duration);
    refresh();
  };
  const save = async (manual = false, mirror = false) => {
    if (!savingAllowed) {
      if (manual)
        notify(
          'Existing saves are protected. Export this preview or explicitly start a new colony.',
          8000,
        );
      return;
    }
    try {
      await store.save(sim.world, mirror);
      metrics.lastSave = new Date().toLocaleTimeString();
      view.saveStatus('Saved on this device');
      if (manual) notify('Colony saved on this device.');
    } catch {
      view.saveStatus('Save failed · Export a backup');
      if (manual) notify('Local save failed. Use Export save to keep your colony.', 8000);
    }
  };
  const resetSelection = () => {
    ui.selectedId = null;
    ui.selectedTile = null;
    ui.preview = [];
  };
  const focus = () => {
    camera.x = sim.world.width / 2;
    camera.y = sim.world.height / 2;
  };
  const dismissGuide = () => {
    ui.guide = false;
    try {
      localStorage.setItem('hearthfield-guide', '1');
    } catch {
      /* Nonessential preference. */
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(encode(sim.world))], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `hearthfield-day-${Math.floor(sim.world.tick / 6000) + 1}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const action = (name: string, value: string) => {
    if (!ownsSession && ['new', 'import', 'save'].includes(name)) {
      notify('Close the other colony tab, then reload this one to enable saving.', 8000);
      return;
    }
    switch (name) {
      case 'panel':
        ui.panel = ui.panel === value ? null : (value as Panel);
        ui.tool = 'inspect';
        break;
      case 'close-panel':
        ui.panel = null;
        break;
      case 'tool':
        ui.tool = value as Tool;
        ui.panel = null;
        ui.preview = [];
        resetSelection();
        dismissGuide();
        break;
      case 'speed':
        clock.speed = Number(value) as Speed;
        break;
      case 'focus':
        focus();
        break;
      case 'colonist': {
        const pawn = sim.world.pawns.find((p) => p.id === value);
        if (pawn) {
          ui.selectedId = pawn.id;
          ui.selectedTile = null;
          ui.tool = 'inspect';
          ui.panel = null;
          camera.x = pawn.x;
          camera.y = pawn.y;
        }
        break;
      }
      case 'deselect':
        resetSelection();
        break;
      case 'node':
      case 'cancel-blueprint': {
        const target = [...sim.world.nodes, ...sim.world.blueprints].find(
          (e) => e.id === ui.selectedId,
        );
        if (target)
          sim.command({
            type: 'designate',
            points: [target],
            cancel: value === 'cancel' || name === 'cancel-blueprint',
          });
        break;
      }
      case 'deconstruct': {
        const building = sim.world.buildings.find((b) => b.id === ui.selectedId);
        if (building) {
          sim.command({ type: 'deconstruct', points: [building] });
          void save();
        }
        break;
      }
      case 'priority': {
        const [pawnId, work] = value.split(':');
        const pawn = sim.world.pawns.find((p) => p.id === pawnId);
        if (pawn)
          sim.command({
            type: 'priority',
            pawnId: pawn.id,
            work: work as WorkType,
            value: (pawn.priorities[work as WorkType] + 1) % 5,
          });
        break;
      }
      case 'dismiss-guide':
        dismissGuide();
        break;
      case 'help':
        ui.guide = true;
        ui.panel = null;
        resetSelection();
        break;
      case 'debug':
        ui.debug = !ui.debug;
        break;
      case 'journal':
        ui.panel = 'journal';
        break;
      case 'save':
        void save(true, true);
        break;
      case 'export':
        download();
        break;
      case 'import':
        document.querySelector<HTMLInputElement>('#import-file')!.click();
        break;
      case 'fullscreen': {
        const operation = document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen?.();
        if (operation)
          void operation.catch(() =>
            notify('Fullscreen is not available here. Try installing from the browser menu.'),
          );
        else notify('Use your browser’s install option for an app-like view.');
        break;
      }
      case 'new': {
        if (
          !confirm(
            'Start a new colony? This replaces the current local colony. Export a save first if you want to keep it.',
          )
        )
          break;
        sim = new Simulation(generateWorld());
        savingAllowed = true;
        clock.speed = 1;
        ui.panel = null;
        ui.tool = 'inspect';
        ui.guide = true;
        resetSelection();
        focus();
        void save(false, true);
        notify('A new beginning.');
        break;
      }
    }
    refresh();
  };
  const view = new Interface(document.querySelector<HTMLElement>('#app')!, action);
  focus();
  const renderer = new Renderer(view.canvas, camera);
  const refresh = () =>
    view.update(
      sim.world,
      ui,
      clock.speed,
      sim.reservations.size,
      ui.selectedId ? sim.reservations.owner(ui.selectedId) : undefined,
      metrics,
    );
  new ResizeObserver(() => renderer.resize()).observe(view.canvas);
  renderer.resize();
  const commit = (points: Point[]) => {
    let changed = 0;
    if (ui.tool === 'gather' || ui.tool === 'cancel')
      changed = sim.command({ type: 'designate', points, cancel: ui.tool === 'cancel' });
    else if (ui.tool === 'stockpile') changed = sim.command({ type: 'stockpile', points });
    else if (ui.tool === 'grow') changed = sim.command({ type: 'growing', points });
    else if (ui.tool !== 'inspect')
      changed = sim.command({ type: 'blueprint', points, kind: ui.tool });
    if (!changed)
      notify(
        ui.tool === 'gather'
          ? 'Drag over trees, berry bushes or stone outcrops.'
          : ui.tool === 'cancel'
            ? 'No plans or orders here to cancel.'
            : 'Choose clear, empty ground.',
      );
    else {
      notify(
        `${changed} ${ui.tool === 'gather' ? 'resource' : ui.tool === 'cancel' ? 'plan' : 'tile'}${changed === 1 ? '' : 's'} ${ui.tool === 'cancel' ? 'cancelled' : 'planned'}.`,
      );
      void save();
    }
  };
  new Gestures(
    view.canvas,
    camera,
    () => ui.tool,
    (points) => {
      ui.preview = points;
    },
    commit,
    (p) => {
      if (!inside(sim.world, { x: Math.round(p.x), y: Math.round(p.y) })) return;
      ui.selectedId = selectAt(sim.world, p)?.id ?? null;
      ui.selectedTile = { x: Math.round(p.x), y: Math.round(p.y) };
      ui.panel = null;
      refresh();
    },
  );
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      clock.speed = clock.speed ? 0 : 1;
    }
    if (e.key === 'Escape') {
      ui.panel = null;
      ui.tool = 'inspect';
      resetSelection();
    }
    if (e.key.toLowerCase() === 'f') focus();
    if (e.key.toLowerCase() === 'd') ui.debug = !ui.debug;
    refresh();
  });
  document
    .querySelector<HTMLInputElement>('#import-file')!
    .addEventListener('change', async (event) => {
      const input = event.target as HTMLInputElement,
        file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        if (file.size > 10000000) throw new Error('Save is too large.');
        const decoded = decode(JSON.parse(await file.text()));
        if (!confirm('Replace the current colony with this imported save?')) return;
        sim = new Simulation(decoded.world);
        savingAllowed = true;
        clock.speed = 0;
        ui.panel = null;
        resetSelection();
        focus();
        await save(false, true);
        notify('Colony imported and paused.');
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not import save.', 8000);
      }
    });
  let lastFrame = performance.now(),
    lastUI = 0,
    frameCount = 0,
    fpsWindow = lastFrame;
  const frame = (now: number) => {
    if (!document.hidden) {
      clock.advance((now - lastFrame) / 1000, () => {
        const started = performance.now();
        sim.step();
        const duration = performance.now() - started;
        metrics.lastTickMs = duration;
        metrics.worstTickMs = Math.max(metrics.worstTickMs, duration);
      });
      frameCount++;
      if (now - fpsWindow >= 1000) {
        metrics.fps = Math.round((frameCount * 1000) / (now - fpsWindow));
        frameCount = 0;
        fpsWindow = now;
      }
      metrics.activeJobs = sim.world.pawns.filter((p) => !!p.job).length;
      metrics.viewport = `${window.innerWidth}×${window.innerHeight}`;
      metrics.dpr = window.devicePixelRatio || 1;
      renderer.draw(sim.world, ui, (now - lastFrame) / 1000, clock.speed === 0);
      if (now - lastUI > 200) {
        refresh();
        lastUI = now;
      }
    }
    lastFrame = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setInterval(() => {
    if (!document.hidden) void save();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    lastFrame = performance.now();
    if (document.hidden) void save(false, true);
  });
  window.addEventListener('pagehide', () => {
    void save(false, true);
  });
  refresh();
  if (startupMessage) notify(startupMessage, 15000);
  if (!savingAllowed) view.saveStatus('Recovery mode · Original saves preserved');
  else void save();
  if ('serviceWorker' in navigator && import.meta.env.PROD)
    void navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        metrics.serviceWorker = registration.active ? 'active' : 'installing';
        void registration.update();
        void navigator.serviceWorker.ready.then(() => {
          metrics.serviceWorker = 'active';
        });
      })
      .catch(() => {
        metrics.serviceWorker = 'error';
        notify('Offline installation unavailable. The game still works online.');
      });
  // Headless browser diagnostics are only included in development builds.
  if (import.meta.env.DEV)
    Object.assign(window, {
      colonyDebug: {
        get simulation() {
          return sim;
        },
        camera,
        clock,
        ui,
        save,
        step: (count: number) => {
          for (let i = 0; i < count; i++) sim.step();
          refresh();
        },
      },
    });
}
void bootstrap().catch((error) => {
  const root = document.querySelector('#app')!;
  root.textContent = `Hearthfield could not start: ${error instanceof Error ? error.message : String(error)}. Reload to try again. Your saves have not been deleted.`;
});
