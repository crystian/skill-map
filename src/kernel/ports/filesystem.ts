/**
 * `FilesystemPort` — walks roots, reads nodes, writes job files.
 *
 * Step 0b: shape-only. The real adapter lands with Step 4 (scan end-to-end).
 */

export interface NodeStat {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface WalkOptions {
  ignore?: string[];
}

export interface FilesystemPort {
  walk(roots: string[], options?: WalkOptions): AsyncIterable<NodeStat>;
  readNode(path: string): Promise<string>;
  stat(path: string): Promise<NodeStat>;
  writeJobFile(path: string, content: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
}
