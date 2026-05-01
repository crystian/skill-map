/**
 * `FilesystemPort` — walks roots, reads nodes, writes job files.
 *
 * Shape-only. The real adapter ships with the scan end-to-end pipeline.
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
