import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { computed, signal } from '@angular/core';

import { PlaybackBar } from '../playback-bar';
import {
  ActivityPlaybackService,
  type TReplaySource,
} from '../../../../../services/activity-playback';
import type { TRecordedEvent } from '../../../../../services/activity-recorder';
import { ActivityRecorderService } from '../../../../../services/activity-recorder';
import { SessionPurgeService } from '../../../../../services/session-purge';
import { LivePreferencesService } from '../../../../../services/live-preferences';
import type { IPlaybackState, TPlaybackCaption } from '../../../../../services/activity-playback-state';

/**
 * Stub for `ActivityPlaybackService`: writable signals behind the real
 * read-only shape plus spied transport verbs, so the template's
 * bindings and clicks exercise the same surface production does.
 */
function makeFixture(init?: {
  total?: number;
  cursor?: number;
  playing?: boolean;
  caption?: TPlaybackCaption | null;
  dropped?: number;
  scopeLabel?: string;
  tape?: readonly TRecordedEvent[];
  source?: TReplaySource;
  recorderEvents?: readonly TRecordedEvent[];
}) {
  const cursor = signal(init?.cursor ?? -1);
  const playing = signal(init?.playing ?? false);
  const total = signal(init?.total ?? 3);
  const state = computed<IPlaybackState>(() => ({
    executing: new Set<string>(),
    details: new Map<string, string>(),
    members: new Set<string>(),
    trail: [],
    invocations: [],
    spawns: [],
    coLitPairs: new Set<string>(),
    caption: init?.caption ?? null,
    virtualNowMs: 0,
  }));
  const playback = {
    active: signal(true).asReadonly(),
    cursor: cursor.asReadonly(),
    playing: playing.asReadonly(),
    total: total.asReadonly(),
    scopeLabel: signal(init?.scopeLabel ?? null).asReadonly(),
    source: signal<TReplaySource>(init?.source ?? { kind: 'whole-tape' }).asReadonly(),
    tape: signal<readonly TRecordedEvent[]>(init?.tape ?? []).asReadonly(),
    state,
    exit: vi.fn(),
    play: vi.fn(() => playing.set(true)),
    pause: vi.fn(() => playing.set(false)),
    seek: vi.fn((value: number) => cursor.set(value)),
    stepBack: vi.fn(),
    stepForward: vi.fn(),
  } as unknown as ActivityPlaybackService;
  const clear = vi.fn();
  const removeAll = vi.fn();
  const recorder = {
    droppedCount: signal(init?.dropped ?? 0).asReadonly(),
    size: signal(init?.total ?? 3).asReadonly(),
    events: signal<readonly TRecordedEvent[]>(init?.recorderEvents ?? []).asReadonly(),
    clear,
    removeAll,
  } as unknown as ActivityRecorderService;
  const purge = vi.fn();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PlaybackBar],
    providers: [
      provideRouter([]),
      { provide: ActivityPlaybackService, useValue: playback },
      { provide: ActivityRecorderService, useValue: recorder },
      { provide: SessionPurgeService, useValue: { purge } },
    ],
  });
  const fixture = TestBed.createComponent(PlaybackBar);
  fixture.detectChanges();
  return { fixture, playback, cursor, playing, clear, removeAll, purge };
}

function query(fixture: { nativeElement: unknown }, testid: string): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);
}

describe('PlaybackBar', () => {
  it('renders the transport with the human 1-based counter', () => {
    const { fixture } = makeFixture({ cursor: 0, total: 3 });
    expect(query(fixture, 'graph-playback-toggle')).not.toBeNull();
    expect(query(fixture, 'graph-playback-scrubber')).not.toBeNull();
    expect(query(fixture, 'graph-playback-counter')?.textContent).toContain('1 / 3');
  });

  it('play/pause routes through the service', () => {
    const { fixture, playback } = makeFixture({ playing: false });
    (query(fixture, 'graph-playback-toggle')?.querySelector('button') as HTMLButtonElement).click();
    expect(playback.play).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    (query(fixture, 'graph-playback-toggle')?.querySelector('button') as HTMLButtonElement).click();
    expect(playback.pause).toHaveBeenCalledTimes(1);
  });

  it('the scrubber seeks by absolute cursor', () => {
    const { fixture, playback } = makeFixture({ total: 5 });
    const scrubber = query(fixture, 'graph-playback-scrubber') as HTMLInputElement;
    scrubber.value = '3';
    scrubber.dispatchEvent(new Event('input'));
    expect(playback.seek).toHaveBeenCalledWith(3);
  });

  it('exit routes through the service', () => {
    const { fixture, playback } = makeFixture();
    (query(fixture, 'graph-playback-exit')?.querySelector('button') as HTMLButtonElement).click();
    expect(playback.exit).toHaveBeenCalledTimes(1);
  });

  it('copy link: hidden on the whole-tape replay, copies the paused frame for a session', async () => {
    expect(query(makeFixture({ source: { kind: 'whole-tape' } }).fixture, 'graph-playback-copy-link')).toBeNull();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { fixture } = makeFixture({
      source: { kind: 'tape-session', rootOwner: 'main:s1', agentSpawnId: 'sp-7' },
      cursor: 2,
      playing: false,
    });
    const button = query(fixture, 'graph-playback-copy-link')?.querySelector('button') as HTMLButtonElement;
    expect(button).not.toBeNull();
    button.click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledTimes(1);
    const url = new URL(writeText.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get('replay')).toBe('main:s1');
    expect(url.searchParams.get('agent')).toBe('sp-7');
    expect(url.searchParams.get('at')).toBe('2');
    fixture.detectChanges();
    expect(button.getAttribute('aria-label')).toBe('Link copied');
  });

  it('the director toggle flips the browser-local camera preference', () => {
    const { fixture } = makeFixture();
    const prefs = TestBed.inject(LivePreferencesService);
    prefs.setDirectorEnabled(true);
    fixture.detectChanges();
    const button = (): HTMLButtonElement =>
      query(fixture, 'graph-playback-director')?.querySelector('button') as HTMLButtonElement;
    expect(button().getAttribute('aria-label')).toContain('Director camera on');

    button().click();
    expect(prefs.directorEnabled()).toBe(false);
    fixture.detectChanges();
    expect(button().getAttribute('aria-label')).toContain('Director camera off');

    button().click();
    expect(prefs.directorEnabled()).toBe(true);
  });

  it('the trash clears the browser tape ONLY, immediately (the journal evidence survives)', () => {
    const { fixture, playback, clear, purge } = makeFixture();
    (query(fixture, 'graph-playback-delete')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Decision 2026-08-17 (superseding the both-memories gesture): the
    // tape is regenerable and the Sessions tab re-hydrates from the
    // journal, so no confirm and NO journal wipe from here; the full
    // both-memories delete lives in Settings behind its warning.
    expect(clear).toHaveBeenCalledTimes(1);
    expect(purge).not.toHaveBeenCalled();
    expect(playback.exit).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Delete the recording?');
  });

  it('a tape-session replay trashes ONLY that session and exits (other sessions survive)', () => {
    const mine = [
      { tMs: 1, type: 'node.activity', data: { nodePath: 'a.md', phase: 'start', owner: 'main:s1' } },
    ] as unknown as TRecordedEvent[];
    const other = [
      { tMs: 2, type: 'node.activity', data: { nodePath: 'b.md', phase: 'start', owner: 'main:s2' } },
    ] as unknown as TRecordedEvent[];
    const { fixture, playback, clear, removeAll } = makeFixture({
      source: { kind: 'tape-session', rootOwner: 'main:s1' },
      recorderEvents: [...mine, ...other],
    });
    (query(fixture, 'graph-playback-delete')?.querySelector('button') as HTMLButtonElement).click();
    expect(clear).not.toHaveBeenCalled();
    expect(removeAll).toHaveBeenCalledTimes(1);
    const removed = removeAll.mock.calls[0]![0] as readonly TRecordedEvent[];
    expect(removed).toEqual(mine);
    // The tape may stay non-empty, so the empty-tape auto-exit cannot
    // be relied on: the delete exits explicitly.
    expect(playback.exit).toHaveBeenCalledTimes(1);
  });

  it('a journal-sourced replay shows no trash at all (nothing of it lives in this browser)', () => {
    const { fixture } = makeFixture({ source: { kind: 'journal', rootOwner: 'main:j1' } });
    expect(query(fixture, 'graph-playback-delete')).toBeNull();
  });

  it('narrates the cursor event and flags a trimmed tape', () => {
    const { fixture } = makeFixture({
      cursor: 0,
      caption: { kind: 'start', path: 'docs/guide.md', detail: 'Read' },
      dropped: 7,
    });
    expect(query(fixture, 'graph-playback-caption')?.textContent).toContain('Read');
    expect(query(fixture, 'graph-playback-counter')?.textContent).toContain('*');
  });

  it('never leaves the ticker blank on custody frames (turn end, node-less signals)', () => {
    const turn = makeFixture({ cursor: 0, caption: { kind: 'turn-end' } });
    expect(query(turn.fixture, 'graph-playback-caption')?.textContent).toContain('turn ended');
    const other = makeFixture({ cursor: 0, caption: { kind: 'other' } });
    expect(query(other.fixture, 'graph-playback-caption')?.textContent).toContain('session signal');
  });

  it('a session-context spawn (no parent node) narrates without a dangling parent', () => {
    const { fixture } = makeFixture({
      cursor: 0,
      caption: { kind: 'spawn', phase: 'start', childName: 'content-editor' },
    });
    expect(query(fixture, 'graph-playback-caption')?.textContent?.trim()).toBe(
      'spawned content-editor',
    );
  });

  it('stamps the cursor event with wall-clock HH:MM:SS plus the (mm:ss) session offset', () => {
    const start = new Date(2026, 7, 16, 14, 28, 24).getTime(); // local 14:28:24
    const tape = [
      { tMs: start, type: 'node.activity', data: { nodePath: 'a.md', phase: 'start' } },
      { tMs: start + 221_000, type: 'node.activity', data: { nodePath: 'b.md', phase: 'start' } },
    ] as unknown as TRecordedEvent[];
    const { fixture } = makeFixture({
      cursor: 1,
      total: 2,
      tape,
      caption: { kind: 'start', path: 'b.md', detail: 'Read' },
    });
    expect(query(fixture, 'graph-playback-time')?.textContent).toContain('14:32:05');
    expect(query(fixture, 'graph-playback-elapsed')?.textContent).toContain('(03:41)');
  });

  it('renders no time stamps before step 0 (no event under the cursor)', () => {
    const { fixture } = makeFixture({ cursor: -1 });
    expect(query(fixture, 'graph-playback-time')).toBeNull();
    expect(query(fixture, 'graph-playback-elapsed')).toBeNull();
  });

  it('shows the scope chip only on a scoped replay', () => {
    const { fixture } = makeFixture();
    expect(query(fixture, 'graph-playback-scope')).toBeNull();
    const scoped = makeFixture({ scopeLabel: 'Session 3' });
    expect(query(scoped.fixture, 'graph-playback-scope')?.textContent).toContain('Session 3');
  });
});
