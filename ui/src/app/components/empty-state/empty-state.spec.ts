import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders title, body, icon class and testId', () => {
    TestBed.configureTestingModule({ imports: [EmptyState] });
    const fixture = TestBed.createComponent(EmptyState);
    fixture.componentRef.setInput('title', 'Findings');
    fixture.componentRef.setInput('body', 'Available in v0.8.0');
    fixture.componentRef.setInput('icon', 'pi pi-search');
    fixture.componentRef.setInput('testId', 'inspector-empty-findings');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const card = root.querySelector('.empty-state-card');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-testid')).toBe('inspector-empty-findings');
    expect(root.querySelector('.empty-state-card__title')?.textContent?.trim()).toBe(
      'Findings',
    );
    expect(root.querySelector('.empty-state-card__body')?.textContent?.trim()).toBe(
      'Available in v0.8.0',
    );
    const icon = root.querySelector('.empty-state-card__icon');
    expect(icon?.classList.contains('pi')).toBe(true);
    expect(icon?.classList.contains('pi-search')).toBe(true);
  });

  it('falls back to the default icon when none is provided', () => {
    TestBed.configureTestingModule({ imports: [EmptyState] });
    const fixture = TestBed.createComponent(EmptyState);
    fixture.componentRef.setInput('title', 'Pending');
    fixture.componentRef.setInput('body', 'Soon');
    fixture.detectChanges();

    const icon = (fixture.nativeElement as HTMLElement).querySelector(
      '.empty-state-card__icon',
    );
    expect(icon?.classList.contains('pi-clock')).toBe(true);
  });

  it('omits data-testid when no testId is provided', () => {
    TestBed.configureTestingModule({ imports: [EmptyState] });
    const fixture = TestBed.createComponent(EmptyState);
    fixture.componentRef.setInput('title', 'Pending');
    fixture.componentRef.setInput('body', 'Soon');
    fixture.detectChanges();

    const card = (fixture.nativeElement as HTMLElement).querySelector(
      '.empty-state-card',
    );
    expect(card?.getAttribute('data-testid')).toBeNull();
  });
});
