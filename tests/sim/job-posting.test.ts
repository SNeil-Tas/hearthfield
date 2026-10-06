import { describe, expect, it } from 'vitest';
import { checksum, decode, encode } from '../../src/persistence/serialization';
import { interruptJob } from '../../src/sim/jobs';
import { workCandidates } from '../../src/sim/job-board';
import { Simulation } from '../../src/sim/simulation';
import { synchronizeJobPosts } from '../../src/sim/posted-jobs';
import { nextId } from '../../src/sim/world';
import { flatWorld } from './fixtures';

describe('colonist job posting', () => {
  it('lets a busy colonist post nearby work for another colonist to claim', () => {
    const world = flatWorld();
    world.pawns = world.pawns.slice(0, 2);
    const [poster, helper] = world.pawns;
    helper!.priorities.plants = 0;
    for (const [x, y] of [
      [5, 3],
      [6, 4],
    ] as const)
      world.nodes.push({
        id: nextId(world, 'node'),
        kind: 'tree',
        x,
        y,
        designated: true,
        work: 0,
      });
    const simulation = new Simulation(world);

    for (let tick = 0; tick < 35 && world.jobPosts.length === 0; tick++) simulation.step();
    expect(poster!.job?.kind).toBe('chop');
    expect(world.jobPosts).toHaveLength(1);
    expect(world.jobPosts[0]!.postedBy).toBe(poster!.id);
    expect(world.jobPosts[0]!.claimedBy).toBeUndefined();

    helper!.priorities.plants = 1;
    for (let tick = 0; tick < 20 && !helper!.job?.postedJobId; tick++) simulation.step();

    expect(helper!.job?.kind).toBe('chop');
    expect(helper!.job?.postedJobId).toBe(world.jobPosts[0]!.id);
    expect(world.jobPosts[0]!.claimedBy).toBe(helper!.id);
    expect(simulation.diagnostics.snapshot().some((event) => event.type === 'JOB_POSTED')).toBe(
      true,
    );
    expect(
      simulation.diagnostics.snapshot().some((event) => event.type === 'JOB_POST_CLAIMED'),
    ).toBe(true);
  });

  it('reopens interrupted posts and removes them when the work disappears', () => {
    const world = flatWorld();
    world.pawns = world.pawns.slice(0, 2);
    world.pawns[1]!.priorities.plants = 0;
    for (const [x, y] of [
      [5, 3],
      [6, 4],
    ] as const)
      world.nodes.push({
        id: nextId(world, 'node'),
        kind: 'tree',
        x,
        y,
        designated: true,
        work: 0,
      });
    const simulation = new Simulation(world);
    for (let tick = 0; tick < 35 && world.jobPosts.length === 0; tick++) simulation.step();
    world.pawns[1]!.priorities.plants = 1;
    for (let tick = 0; tick < 20 && !world.pawns[1]!.job?.postedJobId; tick++) simulation.step();

    const post = world.jobPosts[0]!;
    interruptJob(world, world.pawns[1]!, simulation.reservations);
    synchronizeJobPosts(world, workCandidates(world));
    expect(post.claimedBy).toBeUndefined();
    expect(world.jobPosts).toContain(post);

    world.nodes = world.nodes.filter((node) => node.id !== post.targetId);
    synchronizeJobPosts(world, workCandidates(world));
    expect(world.jobPosts).not.toContain(post);
  });

  it('persists open job posts and safely defaults older saves', () => {
    const world = flatWorld();
    const poster = world.pawns[0]!;
    world.jobPosts.push({
      id: nextId(world, 'post'),
      key: 'chop::node-999:5:5',
      kind: 'chop',
      work: 'plants',
      targetId: 'node-999',
      destination: { x: 5, y: 5 },
      postedBy: poster.id,
      postedAt: world.tick,
    });
    expect(decode(encode(world)).world.jobPosts).toEqual(world.jobPosts);

    const envelope = encode(world);
    const legacyWorld = JSON.parse(envelope.payload);
    delete legacyWorld.jobPosts;
    const payload = JSON.stringify(legacyWorld);
    const loaded = decode({
      ...envelope,
      payload,
      checksum: checksum(payload),
    });
    expect(loaded.world.jobPosts).toEqual([]);
  });
});
