---
id: TASK-151
type: task
role: plan
title: "FTS5 CJK search returns zero hits — unicode61 tokenizes contiguous CJK runs as single tokens, so any substring query misses (Chinese corpora effectively unsearchable)"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Found during SPEC-078 two-project UAT (2026-07-25) against the real guyin corpus (A-share trading assistant, 107 docs): lore search 交易 → 0 results in BOTH dashboard (/p/guyin/search) and CLI, while sqlite title LIKE %交易% counts 3 docs. Root cause: FTS5 default unicode61 tokenizer treats a contiguous CJK run as ONE token; escapeFtsQuery phrase-quoting makes the query a token that only matches identical whole runs. SPEC-068 fixed CJK slugify but search tokenization was never covered.

AC:
- Given a doc whose title/content contains 量化交易策略, When searching 交易, Then it is returned — pinned by store-level bun tests (SQLiteStore FTS) with CJK fixtures covering title-hit, content-hit, and mixed CJK+ASCII.
- Given existing ASCII queries/corpora, Then result sets and ranking stay green (existing FTS suites pass unchanged).
- Given the chosen mechanism (trigram tokenizer / CJK bigram indexing+query preprocessing — evaluate both, pick with evidence), Then existing corpora get the fix via a migration that rebuilds the FTS index, and the migration is covered by a bun test on a pre-migration fixture db.
