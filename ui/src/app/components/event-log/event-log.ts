import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { ToggleButtonModule } from 'primeng/togglebutton';

import { EVENT_LOG_TEXTS } from '../../../i18n/event-log.texts';

/**
 * EventLog drawer.
 *
 * Step 14.3.a: the in-memory `EventBusService` and the `ScanSimulator`
 * were removed (no canned events at 14.3 — the live `EventStreamPort`
 * wires up at 14.4). The drawer now always renders an empty state.
 * The shell of the component (toggle, scroll container, expansion
 * state) is preserved so 14.4 can plug the live stream in with
 * minimal churn.
 */
@Component({
  selector: 'app-event-log',
  imports: [FormsModule, ButtonModule, BadgeModule, ToggleButtonModule],
  templateUrl: './event-log.html',
  styleUrl: './event-log.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventLog {
  protected readonly texts = EVENT_LOG_TEXTS;

  readonly expanded = signal(false);

  setExpanded(value: boolean): void {
    this.expanded.set(value);
  }
}
