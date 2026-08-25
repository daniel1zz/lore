---
id: SPEC-153
type: spec
role: spec
title: "The mirror oracles' two command surfaces are O(corpus) by accident: one row contract for list --json, a real argv parser for export-spec-mirror"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
links:
  - {id: KN-528, type: relates-to}
  - {id: TASK-837, type: relates-to}
  - {id: TASK-839, type: relates-to}
  - {id: KN-542, type: relates-to}
---
## Overview

Two commands that the mirror oracles drive are O(corpus) in ways their callers never asked for,
and both failure modes are already measured and recorded — `knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in`
(approved 2026-08-24) and the two filed defect tasks
`task-skill-test-the-mirror-end-to-end-oracles-cost-o-corpus` and
`task-the-mirror-check-absorbed-the-content-probe-in-90951390`.

What is missing is not diagnosis. It is a governed surface change. This spec owns that change.

⛔ This spec deliberately does NOT re-derive the measurements. They are in the three documents
above and are cited, not restated. Re-measuring them is how this session already wasted a pass.

## The two surfaces

### S1 — `lore list --json` emits two different row shapes depending on an unrelated filter flag

Measured 2026-08-25 on main @ 3331a98e:

| invocation | bytes | keys per row |
|---|---|---|
| `lore list --type knowledge --json` | 313,281 | 10 (`id slug type title status priority tags updated_at validity_status meta`) |
| `lore list --type knowledge --json --include-invalid` | 23,180,068 | 18 (the above minus `meta`, plus `content extra created_at created_by deleted_at ordinal parent_id role version`) |

Same command, same `--json`, 74x the payload and a different row contract, selected by a filter
flag. `extra` alone is 17,236,681 bytes and one single row is 5,795,632 bytes.

⛔ Every byte figure in this spec is a POINT measurement of a corpus that grows monotonically, and
they will not agree with each other or with a later run. The same invocation measured 23,180,068
bytes at one point in this session and 22,988,107 at another, forty minutes apart; both are
correct for when they were taken. ⛔ This is exactly why no criterion here asserts a byte
threshold — see AC-MOS-1's stated refusal of one. The figures are here to establish the ORDER OF
MAGNITUDE and the 74x ratio, never as a value any oracle compares against.

⛔ The cause is NOT that the filter branches fetch full records — they must. `DocSummary` carries
no `extra`, and the validity gate plus `--plan-id` / `--phase` narrowing all read `extra`. The
defect is that `adapters/cli/commands/list.ts` then prints those full records verbatim at three of
its SIX `--json` emit sites, instead of projecting back down to the row shape the default branch
emits. Fetching wide to filter is correct; emitting wide is the accident.

⛔ CORRECTION, 2026-08-25, made by the implementing agent and verified before this edit: this
section originally said FIVE emit sites and three wide ones. There are **SIX** — `grep -c
'args.json'` and `grep -c 'console.log(JSON.stringify'` both return 6 on `list.ts`. The
uncounted one is the `--governed-by` branch, which was equally wide (18 keys, `content`/`extra`,
no `meta`). ⛔ The count came from ME reading the file, and an author's hand-enumeration silently
became the criterion's blind spot — the exact failure `knowledge-five-findings-from-planning-the-github-read-side-a`
records. AC-MOS-1 survived it only because it asserts a property of EVERY branch rather than a
list of branches; had it enumerated the five, the sixth would have shipped wide and the AC would
have certified it.

Blast radius, measured across the repo — NO in-repo consumer reads a full-record field off
`lore list --json`:
- `scripts/tests/spec-mirror-export.test.ts:181` reads `{id, slug}`
- `scripts/tests/mirror-status-parity.test.ts:79` reads `{id, slug, status}`
- `scripts/check-unclaimed-oracle.ts:492` reads `slug`
- `scripts/check-ac-ref-integrity.ts` never touches the CLI — it uses the in-process `App`

### S2 — `export-spec-mirror.ts` ignores every flag except `--check`, and `--check` does two jobs

`main(argv)` reads `argv.includes("--check")` and nothing else, then loops `MIRROR_TYPES`
unconditionally. Consequences, both already recorded:
- any other flag is silently accepted and ignored (the `--dry-run` case, `knowledge-a-dry-run-flag-that-does-not-exist-writes-the-files`);
- `--check` runs parity AND the content probe in one pass, which is the 90951390 absorption that
  `task-the-mirror-check-absorbed-the-content-probe-in-90951390` measured at 27.9s per pass with
  only 0.41s of that being the corpus read.

## Scope

IN:
- `packages/lore/src/adapters/cli/commands/list.ts` — one row contract for every `--json` emit site.
- `scripts/export-spec-mirror.ts` — a real argv parser: a `--type` narrowing flag, and unknown
  flags refused rather than ignored.

OUT, deliberately:
- Raising any timeout or `maxBuffer` constant. Both are ceilings, not fixes, and both are already
  named as such in the cited knowledge doc.
- Making the content check incremental (durable "last checked" state). That is the harder half of
  `task-the-mirror-check-absorbed-the-content-probe-in-90951390`'s option 2 and stays filed.
- Splitting `--check`'s parity half from its content-probe half. S2 names that absorption as the
  cost's origin, but this spec resolves only the argv half; the split itself stays filed on
  `task-the-mirror-check-absorbed-the-content-probe-in-90951390`, whose own Scope states it as a
  two-option decision. ⛔ Stated as an explicit OUT rather than left implicit: a diagnosis with no
  AC and no deferral line reads, later, as an oversight.
- Re-pointing AC-FR-6 / AC-FR-7's oracle commands at the narrowed invocation. ⛔ That is a
  `lore ac set` on an APPROVED spec (`spec-falsifiability-reachability-a-feedable-checkpoint-an`),
  which demotes it and blocks every descendant claim, so it is sequenced AFTER this spec lands and
  is called out here so the cost is not discovered mid-flight.

⛔ THE TRAP, named by the filed task and inherited verbatim: `bun run check:spec-mirror` — the
command wired into `bun run test` — is the FULL `--check`. If the narrowed variant becomes what
the ACs drive, the production command's drift behaviour is no longer exercised by any AC. Any
implementation MUST keep one AC driving the full, unnarrowed command.

## Acceptance Criteria

See the structured criteria added via `lore ac add`.


## Acceptance Criteria (structured)

- [⚑] [script] AC-MOS-1: ONE row contract for every `lore list --json` emit branch. The CANONICAL row is the DEFAULT branch's — exactly `id slug type title status priority tags updated_at validity_status meta`, ten keys, ⛔ named as a CLOSED set so 'identical' cannot be satisfied by every branch converging on the WIDE shape instead. (a) In a throwaway corpus (mkdtemp + lore init, cwd inside it, NEVER this repo's .lore/), five invocations — bare `--type knowledge --json`; `--include-invalid`; `--type task`; `--type task --plan-id <p>`; `--type task --phase <p>` — each return rows whose sorted key set EQUALS that set (equality, ⛔ not containment), and no row carries `content` or `extra`. (b) `meta` is built by the EXISTING SSOT `deriveTypeMeta` (packages/core/src/doc-type-meta.ts:86; it takes a DocRecord, which the wide branches already hold) — ⛔ do not reimplement it, ⛔ do not drop `meta` to make the sets match (the cheap wrong way to satisfy (a)). Assert the discriminant for EVERY type the run exercises, ⛔ task included, else its three invocations are checked for key-set equality while a wrong meta payload passes: knowledge -> {t,sub_type}; spec -> {t,kind}; adr -> {t,decision_status}; task -> {t,evidence_pass,evidence_fail,evidence_expected_fail} (deriveTypeMeta's own JSDoc example). SHAPE assertion, ⛔ never a byte threshold — corpus growth re-crosses those. Measured 2026-08-25 @ 3331a98e: bare knowledge = those 10 keys; --include-invalid = 18 keys, NO meta key; `--type task --json` = 18 keys, no meta. RED BY CONSTRUCTION until the three full-record emit sites in packages/lore/src/adapters/cli/commands/list.ts project down. Smallest mutation turning it red after landing: revert ONE emit site to printing fullDocs verbatim. Describe block: 'one row contract across every --json emit branch'.
  script: test — out=$(bunx vitest run packages/lore/tests/integration/list-json-row-contract.test.ts 2>&1); ec=$?; printf '%s\n' "$out"; [ "$ec" -eq 0 ] && printf '%s' "$out" | grep -qE 'Tests +[0-9]+ passed' && echo 'AC-MOS-1 PASS: all five lore list --json invocations returned rows whose key set equals the ten-key default contract with a deriveTypeMeta-built meta asserted per exercised type including task, and neither content nor extra'
- [⚑] [script] AC-MOS-2: PRODUCTION WIRING, against THIS repo's REAL corpus (read-only — `lore list` writes nothing). Spawn `lore list --type knowledge --json --include-invalid` with `maxBuffer: 20 * 1024 * 1024` and assert THREE conjuncts in one run. (a) BEHAVIOUR: `status === 0`, `error === undefined`, `signal === null`. (b) SHAPE: no returned row carries a `content` or an `extra` key — so a status-0 produced by some unrelated change cannot satisfy this criterion. (c) NON-VACUITY: the returned row count is >= 400 (measured 555 on 2026-08-25). ⛔ (c) is required because this criterion is ENVIRONMENT-COUPLED: it reads the real corpus, so without a floor it would WEAKEN SILENTLY — a corpus that shrank on its own would fit 20MB even with full records, and the criterion would keep reporting pass while measuring nothing. A shrunken corpus must make it FAIL, not pass. ⛔ Separate from AC-MOS-1 on purpose: AC-MOS-1 proves the shape in a throwaway; this proves the shipped binary stopped emitting the payload that breaks the live consumer. The 20MB figure is NOT a budget this spec chose — it is the exact constant scripts/tests/spec-mirror-export.test.ts already declares, so this criterion goes green only when that live consumer stops failing. Measured A/B 2026-08-25 with only maxBuffer varied: 20MB gives status null / signal SIGTERM / error.code ENOBUFS / stdout truncated at 20,849,318 in 2.5s; 64MB gives status 0 / 22,988,107 bytes. Describe block: 'the real corpus read fits the consumer's declared buffer'.
  script: test — out=$(bunx vitest run packages/lore/tests/integration/list-json-real-corpus-buffer.test.ts 2>&1); ec=$?; printf '%s\n' "$out"; [ "$ec" -eq 0 ] && printf '%s' "$out" | grep -qE 'Tests +[0-9]+ passed' && echo 'AC-MOS-2 PASS: the real-corpus include-invalid read returned spawnSync status exactly 0 under a 20MB maxBuffer with error undefined, over at least 400 rows none of which carried content or extra'
- [·] [script] AC-MOS-3: export-spec-mirror.ts REFUSES an unrecognised flag instead of ignoring it. Three conjuncts, one run. (a) `bun scripts/export-spec-mirror.ts --check --definitely-not-a-flag` exits with a DEDICATED usage code — asserted by importing the exported constant, ⛔ never a literal and ⛔ never 'non-zero' — and its stderr contains the string '--definitely-not-a-flag' verbatim. (b) That usage code MUST differ from BOTH 0 and MIRROR_DRIFT_EXIT_CODE, asserted as an inequality between the two imported constants, so a drifting corpus can never be mistaken for a usage error or the reverse. (c) GREEN CONTROL in the SAME run: `--check` alone returns 0 or MIRROR_DRIFT_EXIT_CODE and NEVER the usage code, so (a) is not a parser that rejects everything. Measured 2026-08-25 on main @ 3331a98e with the invocation `--check --type prd --definitely-not-a-flag`: it exited 2 having scanned all six types and printed no refusal line, so BOTH the unknown flag and the not-yet-existing --type were silently inert in that single run. ⛔ Conjunct (a) drops --type deliberately: this criterion is about the parser, and AC-MOS-4 owns --type's behaviour. Describe block: 'an unrecognised flag is refused, not ignored'.
  script: test — out=$(bunx vitest run scripts/tests/export-spec-mirror-argv.test.ts 2>&1); ec=$?; printf '%s\n' "$out"; [ "$ec" -eq 0 ] && printf '%s' "$out" | grep -qE 'Tests +[0-9]+ passed' && echo 'AC-MOS-3 PASS: an unknown flag exits with the dedicated usage code naming the flag verbatim, while --check alone never returns that code'
- [·] [script] AC-MOS-4: `--type` narrows WITHOUT losing discriminating power — the falsifier design is inherited verbatim from task-the-mirror-check-absorbed-the-content-probe-in-90951390, which states that a timing assertion alone has no discriminating power and must not be the oracle. In a throwaway corpus (mkdtemp + lore init, NEVER this repo's docs/requirements — the shared-real-mirror mutation is defect 2 of task-skill-test-the-mirror-end-to-end-oracles-cost-o-corpus, where one test file's mutation reddened a different file running concurrently), seed ONE drift in type X, then assert all three in one run: (a) full `--check` exits MIRROR_DRIFT_EXIT_CODE and names X's slug; (b) `--check --type X` exits the SAME code and names the SAME slug; (c) `--check --type Y` for some Y != X exits 0 and does NOT name that slug. Smallest mutation that turns it red: make the narrow path skip the seeded type — (b) fails; make it scan everything — (c) fails. ⛔ Wall-clock is a machine property and MUST NOT appear in any assertion here. Describe block: '--type narrows the scan without narrowing what it can detect'.
  script: test — out=$(bunx vitest run scripts/tests/export-spec-mirror-type-scope.test.ts 2>&1); ec=$?; printf '%s\n' "$out"; [ "$ec" -eq 0 ] && printf '%s' "$out" | grep -qE 'Tests +[0-9]+ passed' && echo 'AC-MOS-4 PASS: the narrowed and full --check reported the SAME seeded drift with the same exit code and slug, and a non-seeded --type reported none'
- [·] [script] AC-MOS-5: THE TRAP, closed at the surface that decides it. package.json's `check:spec-mirror` script MUST remain byte-identical to 'bun scripts/export-spec-mirror.ts --check' — no `--type`, no narrowing of any kind. ⛔ WHY this exists as its own criterion: `check:spec-mirror` is the link `bun run test` invokes, so if the narrowed variant became what the ACs drive, the production command's drift behaviour would be exercised by nothing — the exact shape of knowledge-an-attested-pass-is-not-evidence-of-production-wiring. Fixed-string equality, ⛔ not containment: containment stays true if someone appends '--type spec'. Measured 2026-08-25: the script is exactly that string today and this conjunct is therefore VACUOUSLY GREEN before any work — it is a REGRESSION GUARD over the narrowing this spec introduces, and its pass MUST NOT be banked as coverage of AC-MOS-3 or AC-MOS-4. Describe block: 'the chain-wired mirror command is never narrowed'.
  script: test — out=$(bunx vitest run scripts/tests/mirror-production-command-unnarrowed.test.ts 2>&1); ec=$?; printf '%s\n' "$out"; [ "$ec" -eq 0 ] && printf '%s' "$out" | grep -qE 'Tests +[0-9]+ passed' && echo 'AC-MOS-5 PASS: package.json check:spec-mirror is byte-identical to the unnarrowed invocation, so the chain-wired command still exercises every type'
