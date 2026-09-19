import { describe, expect, it } from 'vitest';
import {
  DiagnosticLog,
  DIAGNOSTIC_CAPACITY,
  buildDebugReport,
  colonistDebugText,
} from '../../src/sim/diagnostics';
import { Reservations } from '../../src/sim/reservations';
import { Simulation } from '../../src/sim/simulation';
import { flatWorld } from './fixtures';

describe('runtime diagnostics', () => {
  it('keeps a bounded chronological ring buffer', () => {
    const world = flatWorld();
    const log = new DiagnosticLog(3);
    for (let i = 0; i < 5; i++) log.record(world, `TEST_${i}`);
    expect(log.snapshot().map((event) => event.type)).toEqual(['TEST_2', 'TEST_3', 'TEST_4']);
    expect(DIAGNOSTIC_CAPACITY).toBeGreaterThanOrEqual(5000);
  });

  it('exports current colonists, stations, reservations, and events without mutation', () => {
    const world = flatWorld();
    const sim = new Simulation(world);
    const before = JSON.stringify(world);
    sim.diagnostics.marker(world, 'stuck cooking suspected');
    const report = buildDebugReport(
      world,
      sim.reservations,
      sim.diagnostics,
      { appVersion: '0.4.1' },
      0,
    );
    expect(JSON.stringify(world)).toBe(before);
    expect(report.build).toEqual({ appVersion: '0.4.1' });
    expect(report.colonists).toHaveLength(world.pawns.length);
    expect(report.recentEvents.at(-1)?.type).toBe('USER_MARKER');
  });

  it('formats a selected colonist snapshot with job phase and station state', () => {
    const world = flatWorld();
    const pawn = world.pawns[0]!;
    pawn.job = {
      kind: 'cook',
      targetId: 'building-17',
      destination: { x: 4, y: 3 },
      path: [],
      phase: 'target',
      progress: 0,
      keys: ['building-17'],
    };
    const reservations = new Reservations();
    reservations.claim(['building-17'], pawn.id);
    const text = colonistDebugText(world, pawn, reservations);
    expect(text).toContain('Job: cook');
    expect(text).toContain('Phase: target');
    expect(text).toContain('Reservations: building-17');
  });
});
