/**
 * `StoragePort` — persistence for all kernel tables (scan_*, state_*, config_*).
 *
 * Step 0b: shape-only. Typed repositories land with Step 1 (sqlite adapter +
 * migrations). For now the port exists so the kernel shell can be constructed
 * with a null adapter and the dependency rule (kernel never imports IO
 * libraries) is already enforced by the layout.
 */

export interface StoragePort {
  init(): Promise<void>;
  close(): Promise<void>;
}
