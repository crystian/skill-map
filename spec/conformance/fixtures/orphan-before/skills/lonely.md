---
name: orphan-lonely
description: Fixture node that gets deleted in the after-state to trigger the orphan path.
metadata:
  version: 1.0.0
  stability: stable
  author: conformance
---

# Orphan lonely body

This file disappears in `orphan-after`. With no replacement matching
its hashes, the rename heuristic emits an `orphan` issue.
