# skillmap

## 0.0.2

### Patch Changes

- 48c386b: First publish of the alias / placeholder packages, all under `alias/*`. Each one is functionally inert: the bin (`<name>` and `sm`) prints a warning to stderr pointing at `@skill-map/cli` and exits with code 1.

  Reservations defended:

  - **`skill-map`** — top-level (un-scoped) name. Reserved against third-party squatters; users who follow stale docs or Google results land on a redirect rather than a hostile package.
  - **`skillmap`** — common typo (no hyphen).
  - **`skill-mapper`** — lookalike (extra suffix).
  - **`sm-cli`** — confusion between binary name (`sm`) and package name (`@skill-map/cli`).

  The official CLI is `@skill-map/cli` (published from `src/`); these aliases never delegate to it nor wrap it as a dependency, so installing one of them does NOT also install the real CLI. The intent is education + name reservation, not transparent forwarding.
