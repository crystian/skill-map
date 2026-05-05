import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'graph' },
  {
    path: 'graph',
    loadComponent: () =>
      import('./views/graph-view/graph-view').then((m) => m.GraphView),
    data: { title: 'Graph' },
  },
  {
    path: 'list',
    loadComponent: () =>
      import('./views/list-view/list-view').then((m) => m.ListView),
    data: { title: 'List' },
  },
  { path: '**', redirectTo: 'graph' },
];
