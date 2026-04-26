---
name: orphan-keep
description: Fixture node that survives across before/after, so the after-state still has at least one node.
metadata:
  version: 1.0.0
  stability: stable
  author: conformance
---

# Survivor

Keeps the after-state graph non-empty so we can assert that the orphan
issue is the only one emitted.
