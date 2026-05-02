import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * `<sm-empty-state>` — small standalone component for placeholder
 * cards (inspector v0.8.0 placeholders, future "no data" states).
 *
 * Inputs:
 *   - `title`  — heading (required).
 *   - `body`   — descriptive copy (required).
 *   - `icon`   — PrimeNG icon class (optional, defaults to `pi pi-clock`).
 *   - `testId` — `data-testid` value for the card root (optional;
 *                callers without their own testid scope can omit).
 */
@Component({
  selector: 'sm-empty-state',
  templateUrl: './empty-state.html',
  styleUrl: './empty-state.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly body = input.required<string>();
  readonly icon = input<string>('pi pi-clock');
  readonly testId = input<string | null>(null);
}
