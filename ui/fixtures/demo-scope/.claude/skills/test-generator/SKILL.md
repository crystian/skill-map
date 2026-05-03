---
name: test-generator
description: Proposes unit tests for the given source file. Experimental — output quality depends on naming discipline in the target code.
type: skill
inputs:
  - name: source
    type: path
    required: true
  - name: framework
    type: "enum:node-test|vitest|jest"
    required: false
    default: vitest
outputs:
  - name: testPath
    type: path
metadata:
  version: 0.6.0
  stability: experimental
  author: acme
  tags: [tests, generation]
  created: 2026-01-09
  related:
    - .claude/skills/code-review/SKILL.md
---

# Test Generator

Parses the source with the host's default parser, extracts exports, and proposes one describe-block per exported symbol. Emits a single `.test.ts` file next to the source. Not idempotent across versions.
