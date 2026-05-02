/**
 * ESM/CJS interop helper for `ajv-formats`. The package ships CJS-first;
 * the default export is the callable plugin under ESM interop, but TS
 * sometimes types it as the namespace. This helper normalises the
 * import once so adapters that wire `ajv-formats` onto an Ajv instance
 * don't each carry the same `as unknown as ...` cast.
 *
 * Usage:
 *   import { applyAjvFormats } from '<...>/kernel/util/ajv-interop.js';
 *   applyAjvFormats(ajv);
 */

import type { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

type TAjv = InstanceType<typeof Ajv2020>;

const addFormats = (addFormatsModule as unknown as { default?: typeof addFormatsModule })
  .default ?? addFormatsModule;

/**
 * Wire the standard JSON Schema formats (`uri`, `date`, `date-time`,
 * etc.) onto the given Ajv instance.
 */
export function applyAjvFormats(ajv: TAjv): void {
  (addFormats as unknown as (a: TAjv) => void)(ajv);
}
