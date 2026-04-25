import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { ToggleButtonModule } from 'primeng/togglebutton';

import { EVENT_LOG_TEXTS } from '../../../i18n/event-log.texts';
import { EventBusService, ISimEvent } from '../../../services/event-bus';
import { ScanSimulatorService } from '../../../services/scan-simulator';

@Component({
  selector: 'app-event-log',
  imports: [FormsModule, ButtonModule, BadgeModule, ToggleButtonModule],
  templateUrl: './event-log.html',
  styleUrl: './event-log.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventLog {
  private readonly bus = inject(EventBusService);
  private readonly simulator = inject(ScanSimulatorService);

  protected readonly texts = EVENT_LOG_TEXTS;

  readonly events = this.bus.events;
  readonly count = this.bus.count;
  readonly scanRunning = this.simulator.running;
  readonly expanded = signal(false);

  private readonly scrollRef = viewChild<ElementRef<HTMLElement>>('scroll');

  readonly recent = computed<ISimEvent[]>(() => {
    const list = this.events();
    return list.slice(-120);
  });

  constructor() {
    effect(() => {
      // Auto-scroll to the newest event when events change and we're expanded.
      this.recent();
      if (!this.expanded()) return;
      queueMicrotask(() => {
        const el = this.scrollRef()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }

  setExpanded(value: boolean): void {
    this.expanded.set(value);
  }

  clear(): void {
    this.bus.clear();
  }

  formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 8);
  }
}
