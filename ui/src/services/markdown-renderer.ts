/**
 * `MarkdownRenderer` — lazy markdown → safe HTML pipeline.
 *
 * Rendering pipeline:
 *
 *   1. `markdown-it` (CommonMark + linkify) renders the source string
 *      into HTML with raw HTML disabled (`html: false`). Disabling raw
 *      HTML at the parser level is the first sanitization line — the
 *      worst input the renderer can produce is text-styled markup, no
 *      direct `<script>` injection.
 *   2. `DOMPurify` runs over the rendered HTML as the second line of
 *      defence (markdown features that wrap user input — e.g. autolinks,
 *      reference labels — can still smuggle attribute-level vectors
 *      through a permissive parser config).
 *   3. The resulting HTML is wrapped via `bypassSecurityTrustHtml` so
 *      Angular's template binding renders it as DOM rather than text.
 *
 * **Lazy-loaded**: the heavy modules (`markdown-it` ~80 KB, `dompurify`
 * ~30 KB) are imported via dynamic `import()` on first call. The renderer
 * is provided in the root injector and constructed cheaply (no work in
 * the constructor) so the inspector view can `inject()` it without
 * paying the cost until a card actually needs to render markdown.
 *
 * **Singleton libs**: the import promise is cached on the instance, so
 * subsequent calls await the same already-resolved modules — no double
 * import, no double parser construction.
 *
 * **DOMPurify default export shape**: the ESM default export is the
 * singleton DOMPurify instance — itself callable as `DOMPurify(window)`
 * to get a freshly-bound instance. Calling `.sanitize()` on the
 * default export directly works against the current global `window`
 * (the browser default) or jsdom's `window` in unit tests.
 */

import { Injectable, inject } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

@Injectable({ providedIn: 'root' })
export class MarkdownRenderer {
  private readonly sanitizer = inject(DomSanitizer);

  /**
   * Resolved on first use. Subsequent calls reuse the same promise so
   * the heavy libs are imported and instantiated exactly once per
   * instance.
   */
  private libsPromise: Promise<IRenderer> | null = null;

  /**
   * Render a markdown source string into a `SafeHtml` value Angular
   * binds via `[innerHTML]` without re-sanitising. The two lines of
   * defence (`markdown-it` `html: false` + DOMPurify) run inside the
   * promise; failures bubble — callers decide whether to surface the
   * error or fall back to plain text.
   */
  async render(src: string): Promise<SafeHtml> {
    const renderer = await this.loadLibs();
    const rendered = renderer.md.render(src);
    const clean = renderer.purify.sanitize(rendered);
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  /**
   * Render to a sanitised HTML string (no `bypassSecurityTrustHtml`
   * wrap). Useful for tests, server-side rendering, or any caller that
   * wants the raw string instead of an Angular `SafeHtml`.
   */
  async renderToHtml(src: string): Promise<string> {
    const renderer = await this.loadLibs();
    const rendered = renderer.md.render(src);
    return renderer.purify.sanitize(rendered);
  }

  private loadLibs(): Promise<IRenderer> {
    if (!this.libsPromise) {
      this.libsPromise = importRenderer();
    }
    return this.libsPromise;
  }
}

interface IRenderer {
  md: { render(src: string): string };
  purify: { sanitize(html: string): string };
}

/**
 * Dynamic import + instantiation of the markdown + sanitizer libraries.
 * Extracted so tests can swap it via `__testHooks` without touching the
 * Angular `inject()` graph.
 */
async function importRenderer(): Promise<IRenderer> {
  const [mdMod, purifyMod] = await Promise.all([
    import('markdown-it'),
    import('dompurify'),
  ]);
  // markdown-it ships its constructor on the default export. The
  // `.default` access works for both ESM and Vite's CJS interop.
  const MarkdownIt = (mdMod as unknown as { default: new (opts: unknown) => { render: (src: string) => string } }).default;
  const md = new MarkdownIt({ html: false, linkify: true });
  // DOMPurify's default export IS the singleton DOMPurify instance —
  // calling `.sanitize()` on it directly uses the current `window`
  // (browser default) or jsdom's `window` in unit tests.
  const purify = (purifyMod as unknown as { default: { sanitize: (html: string) => string } }).default;
  return { md, purify };
}

/**
 * Test hooks — exposed so unit tests can stub the dynamic import without
 * loading the real markdown-it / DOMPurify chunks. Callers replace
 * `importRendererImpl` with a fake factory before instantiating the
 * renderer; the prod call site never touches this.
 */
export const __testHooks = {
  importRenderer,
};
