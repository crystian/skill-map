/**
 * Developer-facing log strings for CollectionLoaderService. Not user-facing
 * UI text — they flow through `console.warn`. Centralized here so the rest
 * of the codebase has a single place that maps to messages.
 */
export const COLLECTION_LOADER_TEXTS = {
  warnNoFrontmatter: (relPath: string) => `[collection-loader] no frontmatter in ${relPath}`,
  warnYamlParseFailed: '[collection-loader] yaml parse failed',
} as const;
