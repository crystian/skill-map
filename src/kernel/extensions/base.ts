/**
 * Base manifest shape shared by every extension kind. Mirrors
 * `spec/schemas/extensions/base.schema.json` at the TypeScript level.
 */

import type { Stability } from '../types.js';

export interface IExtensionBase {
  id: string;
  version: string;
  description?: string;
  stability?: Stability;
  preconditions?: string[];
  entry?: string;
}
