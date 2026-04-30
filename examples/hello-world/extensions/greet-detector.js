/**
 * `hello-world` reference detector.
 *
 * Detects tokens of the form `[[greet:<name>]]` in a node body and emits
 * one `references` link per distinct name. This is intentionally trivial
 * — the goal is to demonstrate the smallest viable shape of a real
 * detector, not to do anything useful at runtime.
 *
 * **Why a wikilink-style pattern**: the obvious choice (`@greet:<name>`)
 * collides with the built-in `at-directive` detector, which fires on any
 * `@token` in the body. Two detectors emitting the same trigger with
 * different `target` shapes is exactly what `trigger-collision` flags
 * as an `error`. A non-`@`, non-`/` prefix avoids the collision and
 * keeps the example clean. Real plugins should pick a syntax that
 * doesn't overlap with built-ins for the same reason.
 *
 * Real detectors typically:
 *
 *   - normalise their triggers via `normalizeTrigger` from `@skill-map/cli`
 *     so the rules layer can match against `frontmatter.name`.
 *   - emit a `trigger` block on each link with the original + normalised
 *     forms, so `sm show` can group by trigger.
 *   - declare `scope: 'frontmatter'` if they only consume frontmatter
 *     (the kernel passes an empty body when scope is not `'both'`).
 *
 * For brevity this example does the minimum and skips trigger
 * normalisation — see the built-in `slash` detector at
 * `src/extensions/detectors/slash/` for a production-grade example.
 */

const ID = 'hello-world-greet';
const PATTERN = /\[\[greet:([a-z0-9_-]+)\]\]/gi;

export default {
  id: ID,
  kind: 'detector',
  version: '1.0.0',
  description: 'Reference detector — emits one `references` link per [[greet:<name>]] token in the body.',
  stability: 'stable',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'medium',
  scope: 'body',

  detect(ctx) {
    const seen = new Set();
    const out = [];
    for (const match of ctx.body.matchAll(PATTERN)) {
      const name = match[1].toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({
        source: ctx.node.path,
        target: name,
        kind: 'references',
        confidence: 'medium',
        sources: [ID],
        trigger: {
          originalTrigger: match[0],
          normalizedTrigger: match[0].toLowerCase(),
        },
      });
    }
    return out;
  },
};
