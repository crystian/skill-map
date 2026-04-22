/**
 * In-memory event bus for the Step 0c prototype. Mirrors the families
 * declared in spec/job-events.md (scan.*, issue.*) at a shape level, but
 * does NOT promise payload compatibility — the real scanner in Step 3
 * owns the canonical shapes. This is a stub so the UI can observe an
 * event flow without a backend.
 */

import { Injectable, computed, signal } from '@angular/core';

export type TEventFamily = 'scan' | 'issue' | 'job';

export type TEventSeverity = 'info' | 'success' | 'warn' | 'error';

export interface ISimEvent {
  id: string;
  timestamp: number;
  family: TEventFamily;
  name: string;
  severity: TEventSeverity;
  message: string;
  data?: Record<string, unknown>;
}

const MAX_EVENTS = 200;

@Injectable({ providedIn: 'root' })
export class EventBusService {
  private readonly _events = signal<ISimEvent[]>([]);
  private counter = 0;

  readonly events = this._events.asReadonly();
  readonly count = computed(() => this._events().length);

  emit(partial: Omit<ISimEvent, 'id' | 'timestamp'>): void {
    const event: ISimEvent = {
      ...partial,
      id: `e${++this.counter}`,
      timestamp: Date.now(),
    };
    const next = [...this._events(), event];
    if (next.length > MAX_EVENTS) next.splice(0, next.length - MAX_EVENTS);
    this._events.set(next);
  }

  clear(): void {
    this._events.set([]);
    this.counter = 0;
  }
}
