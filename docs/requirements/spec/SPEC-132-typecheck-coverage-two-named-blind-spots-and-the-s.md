---
id: SPEC-132
type: spec
role: spec
title: "Typecheck coverage: two named blind spots, and the stale comments that understate them"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PRD-001
---
# Overview

Two named typecheck blind spots in this repo, both measured 2026-08-10. Each is already
documented in a code comment — and in one case the comment understates the gap by 13x, which
makes the comment itself a stale assertion that must be corrected in the same unit as the gap.

# Scope

## In scope

### C1 — `packages/dashboard/tests/e2e` is typechecked by nothing, and the comment says "two files"

`packages/dashboard/tsconfig.tests.json` excludes `tests/e2e` and names the residual honestly
but with the wrong magnitude: *"with this exclude, those TWO helper .ts files are typechecked
by NOTHING in `bun run typecheck`"*.

Measured census of `packages/dashboard/tests/e2e/`:

| kind | count |
|---|---|
| `.pw.ts` | 8 |
| `.spec.ts` | 6 |
| other `.ts` (helpers, fixtures, seeds, configs) | 13 |
| total `.ts` | 27 |

A grep over every `tsconfig*.json` in the repo confirms no other project includes that
directory. The stated REASON for the exclude is sound — the helpers import from
`packages/lore/src/**`, outside `rootDir: "."`, producing 102 x TS6059 + 7 x TS2307 +
8 x TS2868, none of it a real defect. The UNDERSTATED COUNT is the defect: a residual
documented as 2 files reads as negligible; at 27 it is the largest untypechecked surface here.

Deliverable: a separate e2e tsconfig project with no `rootDir`, wired into `bun run typecheck`.
⛔ SAME UNIT: correct that comment to the measured figure. A comment naming a gap becomes a
stale assertion the moment the gap's size changes.

### C2 — `typecheck:dashboard-tests` is a trap as a public entry point

`typecheck:dashboard` runs `bunx @tanstack/router-cli generate && tsc --noEmit`.
`typecheck:dashboard-tests` runs only `tsc --noEmit -p packages/dashboard/tsconfig.tests.json`.
`packages/dashboard/src/routeTree.gen.ts` is git-ignored and generated ONLY by the former. The
full `bun run typecheck` chain happens to order them correctly, so it exits 0 — but the
sub-script is a documented public entry point and on a fresh clone it lies.

Measured (generated file moved aside, run, restored, verified byte-identical):

```
exit=2
error count: 24   (21 x TS2345, 2 x TS7006, 1 x TS2307)
```

⛔ This red already exists and is reproducible with no new code — it is a ready-made red-first
oracle, and the AC below must exercise it rather than assert only the green direction.

Deliverable: make the dependency explicit rather than positional — either the script generates
the route tree itself (idempotently), or it declares the prerequisite and fails loud with a
named recovery command instead of 24 misleading type errors.

## Out of scope

- **Un-excluding `tests/e2e` from `tsconfig.tests.json`.** The rootDir conflict that motivated
  the exclude is real; C1 adds a project, it does not relax that one.
- **Typechecking `.pw.ts` under Playwright's own pipeline.** Out of `bun run typecheck`'s remit;
  C1 covers them via the new project's program, not by changing how Playwright runs.

# Acceptance Criteria

Declared structurally via `lore ac add` (AC-TC-1..3). Each carries a named way to make it red.


## Acceptance Criteria (structured)

- [⚑] [script] AC-TC-1: A CHECKED-IN test asserts BOTH: (a) root package.json's typecheck chain contains typecheck:dashboard-e2e — proving the project is WIRED INTO production, not merely present — and (b) tsc -p packages/dashboard/tsconfig.e2e.json --listFilesOnly resolves at least 27 files under tests/e2e/. RED for (a): remove typecheck:dashboard-e2e from the chain and the test must fail. RED for (b): point include at a directory resolving zero e2e files and it must fail. ⛔ Re-baselined 2026-08-10 after lore assess rated the prior version a MAJOR outcome gap: the original command (bunx tsc -p ... --listFilesOnly piped to a grep -c ≥27 test) interrogated the project DIRECTLY and passed attested at exit 0 with 27 files — an honest run, but structurally blind to chain membership, so deleting the script from package.json would have left it green while the blind spot reopened. The ≥27 floor is unchanged and nothing was removed; assertion (a) is purely additive.
  script: test — bunx vitest run scripts/tests/typecheck-chain-contract.test.ts -t e2e-project-wired
- [⚑] [script] AC-TC-2: packages/dashboard/tsconfig.tests.json no longer claims the residual is two helper files; the corrected text states the measured count and remains greppable. RED: the assertion fails while the phrase asserting two files is still present.
  script: other — test $(grep -c 'those two helper' packages/dashboard/tsconfig.tests.json) -eq 0
- [⚑] [script] AC-TC-3: With packages/dashboard/src/routeTree.gen.ts absent, bun run typecheck:dashboard-tests does NOT emit the 24 misleading type errors: it either generates the file itself or fails with an exit code and a message naming the recovery command. The test restores the file and asserts it is byte-identical afterwards. RED: this is the ready-made red — the pre-fix run exits 2 with 24 errors (21 TS2345, 2 TS7006, 1 TS2307), measured 2026-08-10.
  script: test — bunx vitest run scripts/tests/typecheck-script-contract.test.ts -t routetree-prerequisite
