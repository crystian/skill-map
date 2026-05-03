---
name: post-build-notify
description: Posts a build outcome to the team channel. Non-blocking.
type: hook
event: PostToolUse
condition: "tool == 'Bash' && command.matches('npm run build')"
blocking: false
idempotent: false
metadata:
  version: 0.3.0
  stability: experimental
  author: acme
  tags: [notify, ci]
  created: 2026-02-28
  related:
    - .claude/commands/deploy.md
    - .claude/agents/backend-architect.md
---

# post-build-notify

Fire-and-forget. Not idempotent — duplicate notifications are accepted downstream. Delivery target configured via plugin KV.
