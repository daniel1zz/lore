# Template SLOTS Protocol

## Available Templates

| Template | SLOT 1 | SLOT 2 | SLOT 3 |
|---|---|---|---|
| legal-review-agent | business-contract-parsing | business-law-corpus | business-report-format |
| customer-support-agent | business-kb-source | business-escalation-rules | business-response-tone |
| data-analyst-agent | business-schema-meta | business-query-policies | business-chart-format |
| code-reviewer-agent | business-review-rules | business-severity-policy | business-comment-template |
| research-assistant-agent | business-domain-whitelist | business-citation-format | business-summary-style |

## Fork SOP

1. Copy: `cp -r templates/<source>-agent templates/<target>-agent`
2. Identify your 3 business slots for the new domain
3. Edit `src/main.ts` — update the Slots interface, replace `// AI:SLOT business-*` anchors
4. Edit tool files — replace implementation bodies, keep SLOT anchors
5. Verify: `pnpm lint:templates` (exit 0)
6. Verify: `pnpm typecheck` (exit 0)
7. Verify: `pnpm test` (smoke test passes)

## Rules

- Each template MUST have exactly 3 unique `business-<name>` slot IDs
- Slot IDs follow kebab-case: `business-risk-rules`, `business-citation-format`
- `src/main.ts` is the canonical declaration file for slot IDs
- Files without SLOT anchors MUST start with `// AI:LOCKED infrastructure`

## What Goes in a SLOT (acceptable)

- Domain-specific data (rules, patterns, KB sources, schemas)
- Display formats (citation style, output format)
- Policy lists (allowed domains, denied keywords, escalation triggers)

## What Does NOT Go in a SLOT (infrastructure)

- Tool registration/wiring (handled by `buildDomainRegistry`)
- Model selection (use `defineModel.<provider>`)
- Memory configuration (use `defineMemory`)
- Guard composition (use defaults; user opts in via security config)
