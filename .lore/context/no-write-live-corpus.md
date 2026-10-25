---
id: project-no-write-live-corpus
title: "Never write the repo's own .lore/ from tests or smoke runs"
inject: [subagent-start]
agents: [lore-implementer, lore-reader]
---
## Never write the repo's own `.lore/` corpus

- Never write to the repo's own `.lore/` corpus from tests or smoke checks — it is the team's live knowledge base. Any smoke/e2e run that creates or edits docs MUST use a throwaway corpus (`mkdtemp` + `lore init`, cwd inside it); canonical pattern: `packages/dashboard/tests/e2e/global-setup.ts`.
- Never assume a server on port 8787 is yours — a stale `lore dashboard` on the real corpus once absorbed an entire e2e write suite.
