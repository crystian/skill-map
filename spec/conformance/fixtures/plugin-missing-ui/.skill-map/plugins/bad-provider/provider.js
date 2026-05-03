// Conformance fixture: provider whose `kinds[*]` entry deliberately
// omits the required `ui` block (Step 14.5.d). The plugin loader MUST
// reject this manifest with a clear "missing required property 'ui'"
// diagnostic and the plugin MUST end up in `invalid-manifest` status.
// The companion case `plugin-missing-ui-rejected.json` asserts the
// stderr text and that `sm scan` survives (the loader degrades the
// bad plugin and lets the rest of the pipeline continue).
export default {
  kind: 'provider',
  id: 'bad-provider-provider',
  version: '0.1.0',
  description: 'provider whose note kind is missing the ui block',
  stability: 'experimental',
  explorationDir: '~/.bad',
  kinds: {
    note: {
      schema: './schemas/note.schema.json',
      schemaJson: {
        $id: 'urn:test:bad-provider/note',
        type: 'object',
        additionalProperties: true,
      },
      defaultRefreshAction: 'bad-provider/summarize-note',
      // NOTE: deliberately no `ui` — this is what the case asserts.
    },
  },
  async *walk() {},
  classify() {
    return 'note';
  },
};
