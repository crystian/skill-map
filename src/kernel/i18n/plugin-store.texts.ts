/**
 * Kernel-side strings emitted by `kernel/adapters/plugin-store.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation. See
 * `kernel/i18n/orchestrator.texts.ts` header for rationale.
 *
 * Spec § A.12 — opt-in JSON Schema validation for plugin custom
 * storage. Both messages are thrown synchronously from the wrapper
 * when the plugin author's declared output schema rejects the value
 * the plugin tried to persist. Caller (the future kernel-side store
 * adapter) surfaces the throw to the orchestrator's
 * `extension.error` channel.
 */

export const PLUGIN_STORE_TEXTS = {
  kvValidationFailed:
    "plugin '{{pluginId}}' ctx.store.set('{{key}}', value): value violates declared schema " +
    '({{schemaPath}}) — {{errors}}',

  dedicatedValidationFailed:
    "plugin '{{pluginId}}' ctx.store.write('{{table}}', row): row violates declared schema " +
    '({{schemaPath}}) — {{errors}}',
} as const;
