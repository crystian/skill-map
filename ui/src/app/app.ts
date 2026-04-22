import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { CollectionLoaderService } from '../services/collection-loader';
import { ScanSimulatorService } from '../services/scan-simulator';
import { EventLog } from './components/event-log/event-log';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ButtonModule, EventLog],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly simulator = inject(ScanSimulatorService);

  readonly count = this.loader.count;
  readonly scanRunning = this.simulator.running;

  ngOnInit(): void {
    void this.loader.load();
  }

  simulateScan(): void {
    void this.simulator.runScan();
  }
}
