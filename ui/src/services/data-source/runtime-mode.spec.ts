import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSkillMapModeFromMeta } from './runtime-mode';

describe('readSkillMapModeFromMeta', () => {
  let inserted: HTMLMetaElement | null = null;

  beforeEach(() => {
    inserted = null;
    // Make sure no stale tag from a previous test bleeds through.
    document.head
      .querySelectorAll('meta[name="skill-map-mode"]')
      .forEach((el) => el.remove());
  });

  afterEach(() => {
    if (inserted && inserted.parentNode) inserted.parentNode.removeChild(inserted);
  });

  function setMeta(content: string): void {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'skill-map-mode');
    meta.setAttribute('content', content);
    document.head.appendChild(meta);
    inserted = meta;
  }

  it('returns "live" when no meta tag is present', () => {
    expect(readSkillMapModeFromMeta()).toBe('live');
  });

  it('returns "live" when meta content is "live"', () => {
    setMeta('live');
    expect(readSkillMapModeFromMeta()).toBe('live');
  });

  it('returns "demo" when meta content is "demo"', () => {
    setMeta('demo');
    expect(readSkillMapModeFromMeta()).toBe('demo');
  });

  it('collapses unknown values to "live"', () => {
    setMeta('staging');
    expect(readSkillMapModeFromMeta()).toBe('live');
  });

  it('collapses empty content to "live"', () => {
    setMeta('');
    expect(readSkillMapModeFromMeta()).toBe('live');
  });
});
