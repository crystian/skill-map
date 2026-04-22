import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { ButtonModule } from 'primeng/button';

import {
  ALL_KINDS,
  ALL_STABILITIES,
  FilterStoreService,
} from '../../../services/filter-store';
import type { TNodeKind, TStability } from '../../../models/node';

@Component({
  selector: 'app-filter-bar',
  standalone: true,
  imports: [
    FormsModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    MultiSelectModule,
    ButtonModule,
  ],
  templateUrl: './filter-bar.html',
  styleUrl: './filter-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterBar {
  private readonly store = inject(FilterStoreService);

  readonly searchText = this.store.searchText;
  readonly selectedKinds = this.store.selectedKinds;
  readonly selectedStabilities = this.store.selectedStabilities;
  readonly isActive = this.store.isActive;

  readonly kindOptions = ALL_KINDS.map((kind) => ({ label: kind, value: kind }));
  readonly stabilityOptions = ALL_STABILITIES.map((s) => ({ label: s, value: s }));

  onSearchChange(value: string): void {
    this.store.setSearchText(value);
  }

  onKindsChange(kinds: TNodeKind[]): void {
    this.store.setKinds(kinds);
  }

  onStabilitiesChange(values: TStability[]): void {
    this.store.setStabilities(values);
  }

  reset(): void {
    this.store.reset();
  }
}
