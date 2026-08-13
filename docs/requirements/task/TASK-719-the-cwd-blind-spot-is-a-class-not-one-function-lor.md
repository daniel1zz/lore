---
id: TASK-719
type: task
role: plan
title: "The --cwd blind spot is a CLASS, not one function: lore done's unfiltered-run floor also strips only a 'cd' prefix, so obeying this repo's own no-cd discipline makes a task un-archivable"
status: draft
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Second confirmed site of the same defect filed as 01KZV3XFFY7SEZ9E11NZDC81W8, with a worse consequence.

packages/core/src/attestation-completeness.ts::commandRunsFileUnfiltered:

    const { offset, rest } = stripCdPrefix(command);
    const target = normalizeForComparison(filePath);
    for (const token of tokenizeCommand(rest)) {
      if (token.length === 0 || token.startsWith('-')) continue;
      const joined = offset.length > 0 ? `${offset}/${token}` : token;
      if (normalizeForComparison(joined) === target) return true;
    }

The only recognised root-shifting form is a literal 'cd <dir> &&' prefix. With 'bun test --cwd packages/lore tests/integration/x.bun.test.ts', offset is empty and the token is 'tests/integration/x.bun.test.ts', which never equals the anchor 'packages/lore/tests/integration/x.bun.test.ts'. The '--cwd' flag token is skipped by the startsWith('-') guard and its VALUE is compared as an unrelated token.

Measured 2026-08-13: task-ac-own-5-s-oracle-exercises-only-the-pure-verdict-function carries TWO attested, unfiltered, result:pass rows whose command is exactly 'bun test --cwd packages/lore tests/integration/territory-replay.bun.test.ts 2>&1 && echo ...' against the declared anchor 'packages/lore/tests/integration/territory-replay.bun.test.ts'. lore done refused with exit 4, reporting no attested unfiltered pass for that anchor.

Why this is worse than the first site. This repo's CLAUDE.md forbids putting a 'cd' in front of a measurement, because zoxide shims 'cd' and the following '&&' can short-circuit silently - a documented false-oracle vector. The only command shape this floor understands is that forbidden one. An author who follows the discipline produces a task that cannot be archived, and the tool's own remediation text points at 'lore evidence --result pass', which is a SELF-REPORT and produces no attestation block, so pasting it cannot satisfy the very floor that printed it.

A third form works and is understood by both: 'bun test packages/lore/tests/integration/x.bun.test.ts' run from the repo root - measured exit 0 on the same 6 tests. Nothing documents that this is the only shape that satisfies both gates.
