# skill-map (alias)

This is **not** the real `skill-map` CLI. It is a placeholder package published under the un-scoped name to prevent name-squatting in the npm registry.

The official command-line tool is **`@skill-map/cli`** (sits in the same npm organization as [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec)).

## Install the real one

```bash
npm install --global @skill-map/cli
```

Or one-shot:

```bash
npx @skill-map/cli --version
```

## Why two names

`@skill-map/spec` was the first package published under this organization. To stay consistent with `@org/cli` conventions used by Angular, NestJS, Yarn and others, the reference CLI is published as `@skill-map/cli`. The bare `skill-map` name is reserved here as an alias so a typo or out-of-date doc reference does not lead users to a third-party package.

## Documentation

- Project home: https://skill-map.dev
- Repository: https://github.com/crystian/skill-map
