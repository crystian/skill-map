/**
 * `buildKindRegistry(providers)` — assemble the catalog of kinds the
 * BFF embeds in every payload-bearing envelope (Step 14.5.d).
 *
 * The registry mirrors `spec/schemas/api/rest-envelope.schema.json#/properties/kindRegistry`:
 * kind name → `{ providerId, label, color, colorDark?, emoji?, icon? }`.
 *
 * The function is deterministic (insertion order = first-Provider-wins
 * order across the input array, which itself comes from the same
 * `composeScanExtensions` the scan composer uses, so the registry never
 * diverges from what the scan actually classified). When two Providers
 * declare the same kind name, the first one wins — the kernel separately
 * surfaces this as a `provider-ambiguous` issue, but the UI still gets a
 * coherent registry to render against during the conflict window.
 *
 * No I/O, no kernel side-effects: it walks the in-memory Provider array
 * and copies the `ui` block. The composition root calls it once at boot
 * and threads the result through `IAppDeps` → `IRouteDeps`.
 */

import type { IProvider } from '../kernel/extensions/index.js';
import type { IKindRegistry, IKindRegistryEntry } from './envelope.js';

export function buildKindRegistry(providers: ReadonlyArray<IProvider>): IKindRegistry {
  const registry: IKindRegistry = {};
  for (const provider of providers) {
    for (const [kindName, kindEntry] of Object.entries(provider.kinds)) {
      if (registry[kindName]) continue;
      const ui = kindEntry.ui;
      const entry: IKindRegistryEntry = {
        providerId: provider.id,
        label: ui.label,
        color: ui.color,
      };
      if (ui.colorDark !== undefined) entry.colorDark = ui.colorDark;
      if (ui.emoji !== undefined) entry.emoji = ui.emoji;
      if (ui.icon !== undefined) entry.icon = ui.icon;
      registry[kindName] = entry;
    }
  }
  return registry;
}
