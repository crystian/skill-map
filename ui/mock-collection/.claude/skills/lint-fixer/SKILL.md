---
name: lint-fixer
description: Runs the project's lint toolchain, auto-fixes safe issues, and summarises the remainder.
type: skill
inputs:
  - name: paths
    type: glob
    required: false
    default: "**/*.{ts,tsx,js,jsx}"
outputs:
  - name: summary
    type: string
metadata:
  version: 1.4.1
  stability: stable
  author: acme
  tags: [lint, auto-fix]
  created: 2025-06-12
---

# Lint Fixer

Prefers the toolchain declared in `package.json`. If both `eslint` and `biome` are present, biome wins. Delegates unsafe fixes to a human review pass via @code-review.
