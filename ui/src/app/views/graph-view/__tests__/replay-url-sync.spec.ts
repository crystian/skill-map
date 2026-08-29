import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import type { TReplaySource } from '../../../../services/activity-playback';
import type { IReplayTarget } from '../../../../services/session-catalog';
import {
  parseReplayLink,
  replayLinkFromPlayback,
  replayLinkQueryParams,
  setupReplayUrlSync,
} from '../replay-url-sync';

const TARGET: IReplayTarget = { selection: { rootOwner: 'main:s1' }, label: 'deploy · lint' };

function reader(params: Record<string, string>): (name: string) => string | null {
  return (name) => params[name] ?? null;
}

/** The router re-serializes params (a `:` stays bare), so assert on the parsed tree. */
function qp(router: Router): Record<string, string | undefined> {
  return router.parseUrl(router.url).queryParams as Record<string, string | undefined>;
}

async function settle(): Promise<void> {
  // Two macrotask turns: the resolve promise chain, then the router navigation.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('replay-url-sync helpers', () => {
  it('parses the three params, dropping a malformed or negative frame', () => {
    expect(parseReplayLink(reader({}))).toBeNull();
    expect(parseReplayLink(reader({ replay: 'main:s1' }))).toEqual({ rootOwner: 'main:s1' });
    expect(parseReplayLink(reader({ replay: 'main:s1', agent: 'sp-7', at: '4' }))).toEqual({
      rootOwner: 'main:s1',
      agentSpawnId: 'sp-7',
      at: 4,
    });
    expect(parseReplayLink(reader({ replay: 'main:s1', at: 'x' }))).toEqual({ rootOwner: 'main:s1' });
    expect(parseReplayLink(reader({ replay: 'main:s1', at: '-1' }))).toEqual({ rootOwner: 'main:s1' });
  });

  it('a whole-tape replay is never linkable; a paused session carries its frame', () => {
    expect(replayLinkFromPlayback({ kind: 'whole-tape' }, false, 3)).toBeNull();
    const source: TReplaySource = { kind: 'journal', rootOwner: 'main:s1', agentSpawnId: 'sp-7' };
    expect(replayLinkFromPlayback(source, true, 3)).toEqual({ rootOwner: 'main:s1', agentSpawnId: 'sp-7' });
    expect(replayLinkFromPlayback(source, false, 3)).toEqual({
      rootOwner: 'main:s1',
      agentSpawnId: 'sp-7',
      at: 3,
    });
    // Before the first frame there is no moment to name yet.
    expect(replayLinkFromPlayback(source, false, -1)).toEqual({ rootOwner: 'main:s1', agentSpawnId: 'sp-7' });
  });

  it('query params clear with nulls so a merge navigation drops them', () => {
    expect(replayLinkQueryParams(null)).toEqual({ replay: null, agent: null, at: null });
    expect(replayLinkQueryParams({ rootOwner: 'main:s1', at: 0 })).toEqual({
      replay: 'main:s1',
      agent: null,
      at: '0',
    });
  });
});

describe('setupReplayUrlSync', () => {
  function makePlayback() {
    const active = signal(false);
    const playing = signal(false);
    const cursor = signal(-1);
    const source = signal<TReplaySource>({ kind: 'whole-tape' });
    return {
      signals: { active, playing, cursor, source },
      slice: {
        active: active.asReadonly(),
        playing: playing.asReadonly(),
        cursor: cursor.asReadonly(),
        source: source.asReadonly(),
      },
    };
  }

  async function boot(url: string) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '', children: [] }])] });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    return router;
  }

  it('boot: a known link enters the replay paused on its frame, then the URL mirrors the transport', async () => {
    const router = await boot('/?replay=main%3As1&at=2&path=x.md');
    const playback = makePlayback();
    const resolve = vi.fn().mockResolvedValue(TARGET);
    const enter = vi.fn(() => {
      playback.signals.active.set(true);
      playback.signals.source.set({ kind: 'tape-session', rootOwner: 'main:s1' });
      playback.signals.cursor.set(2);
    });
    TestBed.runInInjectionContext(() => {
      setupReplayUrlSync({ playback: playback.slice, resolve, enter });
    });
    await settle();
    expect(resolve).toHaveBeenCalledWith({ rootOwner: 'main:s1', at: 2 });
    expect(enter).toHaveBeenCalledWith(TARGET, 2);
    // Other params survive the merge; the link stays while paused on 2.
    expect(qp(router)['path']).toBe('x.md');
    expect(qp(router)['replay']).toBe('main:s1');
    expect(qp(router)['at']).toBe('2');

    // Play: the frame drops out of the URL, the session stays.
    playback.signals.playing.set(true);
    TestBed.tick();
    await settle();
    expect(qp(router)['replay']).toBe('main:s1');
    expect(qp(router)['at']).toBeUndefined();

    // Exit: everything replay-related is gone, the rest untouched.
    playback.signals.active.set(false);
    TestBed.tick();
    await settle();
    expect(qp(router)['replay']).toBeUndefined();
    expect(qp(router)['path']).toBe('x.md');
  });

  it('boot: an unknown link never enters and its params are dropped', async () => {
    const router = await boot('/?replay=main%3Agone&at=1');
    const playback = makePlayback();
    const resolve = vi.fn().mockResolvedValue(null);
    const enter = vi.fn();
    TestBed.runInInjectionContext(() => {
      setupReplayUrlSync({ playback: playback.slice, resolve, enter });
    });
    await settle();
    expect(enter).not.toHaveBeenCalled();
    expect(qp(router)['replay']).toBeUndefined();
    expect(qp(router)['at']).toBeUndefined();
  });

  it('no link at boot: the writer engages immediately for a later replay', async () => {
    const router = await boot('/');
    const playback = makePlayback();
    const resolve = vi.fn();
    TestBed.runInInjectionContext(() => {
      setupReplayUrlSync({ playback: playback.slice, resolve, enter: vi.fn() });
    });
    expect(resolve).not.toHaveBeenCalled();
    playback.signals.active.set(true);
    playback.signals.source.set({ kind: 'journal', rootOwner: 'main:s2', agentSpawnId: 'sp-1' });
    playback.signals.cursor.set(0);
    TestBed.tick();
    await settle();
    expect(qp(router)['replay']).toBe('main:s2');
    expect(qp(router)['agent']).toBe('sp-1');
    expect(qp(router)['at']).toBe('0');
  });
});
