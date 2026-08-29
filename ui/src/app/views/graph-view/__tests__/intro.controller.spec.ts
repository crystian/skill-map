import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal, type DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { INTRO_ANIMATION_MS, setupIntro } from '../intro.controller';

/** Minimal DestroyRef stub: collects the teardown so a test can fire it. */
function makeDestroyRef(): { ref: DestroyRef; destroy: () => void } {
  const fns: (() => void)[] = [];
  return {
    ref: { onDestroy: (fn: () => void) => fns.push(fn) } as unknown as DestroyRef,
    destroy: () => fns.forEach((fn) => fn()),
  };
}

describe('intro.controller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays pending while no layout pass has been reconciled', () => {
    TestBed.runInInjectionContext(() => {
      const at = signal(0);
      const handle = setupIntro({ destroyRef: makeDestroyRef().ref, layoutReconciledAt: at });
      TestBed.tick();
      expect(handle.phase()).toBe('pending');
    });
  });

  it('the first reconciled pass flips to running, the window closes it to done', () => {
    vi.useFakeTimers();
    TestBed.runInInjectionContext(() => {
      const at = signal(0);
      const handle = setupIntro({ destroyRef: makeDestroyRef().ref, layoutReconciledAt: at });
      TestBed.tick();
      at.set(100);
      TestBed.tick();
      expect(handle.phase()).toBe('running');

      vi.advanceTimersByTime(INTRO_ANIMATION_MS - 1);
      expect(handle.phase()).toBe('running');
      vi.advanceTimersByTime(1);
      expect(handle.phase()).toBe('done');
    });
  });

  it('later stamps (drags, re-layouts, WS refreshes) never restart the intro', () => {
    vi.useFakeTimers();
    TestBed.runInInjectionContext(() => {
      const at = signal(0);
      const handle = setupIntro({
        destroyRef: makeDestroyRef().ref,
        layoutReconciledAt: at,
        durationMs: 50,
      });
      TestBed.tick();
      at.set(100);
      TestBed.tick();
      expect(handle.phase()).toBe('running');

      at.set(200);
      TestBed.tick();
      expect(handle.phase()).toBe('running');
      vi.advanceTimersByTime(50);
      expect(handle.phase()).toBe('done');

      at.set(300);
      TestBed.tick();
      expect(handle.phase()).toBe('done');
    });
  });

  it('destroying the host mid-window clears the timer (no write after teardown)', () => {
    vi.useFakeTimers();
    TestBed.runInInjectionContext(() => {
      const at = signal(0);
      const destroyRef = makeDestroyRef();
      const handle = setupIntro({
        destroyRef: destroyRef.ref,
        layoutReconciledAt: at,
        durationMs: 50,
      });
      TestBed.tick();
      at.set(100);
      TestBed.tick();
      expect(handle.phase()).toBe('running');

      destroyRef.destroy();
      vi.advanceTimersByTime(50);
      expect(handle.phase()).toBe('running');
    });
  });
});
