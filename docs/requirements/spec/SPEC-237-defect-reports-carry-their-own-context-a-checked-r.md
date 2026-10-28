---
id: SPEC-237
type: spec
role: spec
title: "Defect reports carry their own context: a checked repro command, split fix and refs fields, and the named test's header"
status: approved
priority: medium
created: 2026-10-24
updated: 2026-10-28
tags: []
links:
  - {id: SPEC-145, type: relates-to}
  - {id: SPEC-212, type: relates-to}
  - {id: SPEC-161, type: relates-to}
---
# Defect reports carry their own context: a checked repro command, split fix and refs fields, and the named test's header

## Overview/Goal

`lore report-issue` files a defect to the configured GitHub upstream. Three reports filed on 2026-10-24 (#362, #363, #364) showed where the body fails its reader:

- #362 omitted the one fact that explains the failure. Its repro command named a test file whose header says "before that it is red by design"; nothing brought that header into the report, and the reporter did not read it.
- #364's `--repro-command` held a sentence ("with an old-format fragment in ... : lore integrate ..."), not a command. Nothing refused it; no code ever runs the repro command after filing (measured: no reader in `src/` executes it), so only a filing-time check can keep it a command.
- #364's `--expected` mixed the expected behaviour with the reporter's proposed fix, and no report could point at the spec, criterion, commit or issue it relates to except by prose.
- #363 itself: `--severity` / `--category` help says "(optional)" (commands/report-issue.ts, the two flag definitions) while every filing path requires them (BR-492); the MCP schema marks them optional too, and the report hint (adapters/cli/report-issue-hint.ts, both its configured-upstream and unconfigured variants) prints an example command that is refused for missing flags.

Goal: the report states what it is about without the reader re-deriving it.
1. `--repro-command`, as given by a person or agent (CLI flag, MCP field), is checked: one line, shell-lexable, and its program is found on PATH, is a shell builtin, is lore itself or is an existing path; multi-step prose goes in a new `--repro-steps`.
2. New optional `--suggested-fix` and repeatable `--refs`, rendered as their own sections, so `--expected` stays the behaviour.
3. When the repro command names an existing test file, the report attaches that file's `@spec_ref` lines and, when the reporting project is the upstream repository itself, its header comment (at most 40 lines). Reports from any other project attach only the `@spec_ref` lines.
4. Help, MCP schema and hint agree that severity and category are required.

Benchmark: GitHub issue forms (`docs.github.com/.../syntax-for-issue-forms`) split "steps to reproduce", "expected", "actual" and free "additional context" into separate required/optional fields with per-field validation; Sentry attaches the failing frame's surrounding source automatically. Adopted: separate fields with filing-time validation; automatic context from the artifact the report already names.

Relates to (approved, locked): `spec-the-defect-channel-reaches-no-machine-but-its-own-github` (front-matter codec, six-field closed set — unchanged here), `spec-github-owns-issue-report-state-no-mirror-task-work-carries` (in flight on branch gs-integration; its Non-goals keep the filing contract BR-489..504 — this spec is that change), `spec-p0-requirement-coverage-falsifying-criteria-for-the-8` (AC-P0C-1 pins BR-494's body order).

## Scope

In:
- CLI `lore report-issue` and MCP `lore_report_issue`: new fields `--repro-steps`, `--suggested-fix`, `--refs` (repeatable); repro-command check; help text for `--severity` / `--category` says required.
- Body renderer (`buildIssueDescriptionBlock`, report-issue-wiring.ts): new sections in a fixed order.
- Context attachment: test-file detection, header extraction, same-repository decision, BR-502 redaction of the attached text.
- Report hint (`report-issue-hint.ts`): its example command carries every required flag.
- Lore's own filers (`assess-file-issues.ts`, which writes `lore assess <plan>`, and `lore issues migrate`, which re-files historical values) are not re-checked: their repro values are generated or historical, not input.

Out:
- The front-matter block's format (owner decision 2026-10-24: unchanged; hundreds of existing issues and three readers parse it).
- Executing the repro command, deduplication (BR-499/BR-500), labels, listing.
- Parsing `@spec_ref` into structured ids (its spellings vary; the lines are attached verbatim).

Base: current main (owner decision 2026-10-25). Branch gs-integration (plan `plan-github-owns-issue-report-state`, 45 commits, no activity since 2026-10-19, no owning session) also rewrites report-issue code; whoever lands it later merges main into it and resolves this spec's changes there, as it must already for the 500+ commits main gained since its base.

## Design

### Repro command check

```ts
/** Result of checking a --repro-command value; pure except for the injected PATH lookup. */
export type ReproCheck = { ok: true } | { ok: false; reason: "multi_line" | "unlexable" | "no_program" | "program_not_found"; detail: string };
export function checkReproCommand(cmd: string, deps: { which(name: string): boolean; selfName: "lore" }): ReproCheck;
```
- Where: in the input adapters only — the CLI flag (`commands/report-issue.ts`) and the MCP field (`lore_report_issue` handler) — before `fileGithubIssue` is called, so before the duplicate search, any GitHub call or receipt intent.
- Lexing: single and double quotes and a backslash escape group words; backticks and `$( )` are ordinary characters (never executed or expanded). The program is the first word of the first segment, i.e. before the first unquoted `;`, `|`, `&&` or `||`, after skipping leading `NAME=value` words.
- Refused (exit 2, naming the reason and the offending word, pointing at `--repro-steps`): a newline (`multi_line`); unbalanced quotes or a trailing backslash (`unlexable`); no program word (`no_program`); a program that is none of `lore`, a shell builtin (`cd`, `export`, `source`, `.`, `set`, `unset`), a name found on the invocation's PATH (`Invocation.env.PATH`, never the process default — an MCP server's PATH may differ from the agent's shell), or an existing path relative to the current folder (`program_not_found`).

### Body sections

Order after the front-matter block and description: `**Expected:**`, `**Actual:**`, `**Repro command:**` (fenced code block whose fence is `max(3, longest backtick run in the command + 1)` backticks, so no command can break it), `**Repro steps:**`, `**Suggested fix:**`, `**Refs:**` (bullet list, one per `--refs`), `**Context:**`, then `Reported by:`. A section whose field is absent is omitted entirely; each present marker appears exactly once. On main the only body readers are `parseIssueBody` (front matter only: `lore issues`, `issue-task-shaping.ts`) and the dashboard's raw display; none parses the section markers, so new sections change no reader. (gs-integration's `issue-adoption.ts` `descriptionOf` copies the whole description after the front matter, so it would also take new sections unchanged.) The BR-494 body-contract test (`report-issue-body-contract.bun.test.ts`, AC-P0C-1) asserts the inline repro form today; R1 updates that assertion to the fenced form (AC-P0C-1's statement still holds).

### Context attachment

- Test file: the first token of the repro command (after the program) that is an existing regular file under the project root and whose name matches `\.(test|spec)\.[cm]?[jt]sx?$`.
- Header: the leading comment region — blank lines, `//` lines, a shebang and block comments — up to the first line of code (the boundary rule of `scripts/test-declared-inputs.ts` `parseDeclaredInputs`, moved into a pure module in packages/lore so the binary ships it; the script imports it from there).
- Same repository: `parseGithubRemote(url)` (pure) reads the reporting project's git `origin` URL (one injected git call) in ssh (`git@github.com:o/n(.git)`) or https (`https://github.com/o/n(.git)`) form; the host must be `github.com`; owner/name compare case-insensitively with the upstream repository `classifyFeedbackUpstream` resolves (vendor upstream included). Any other host, no origin or an unparsable URL → a different repository.
- Attached text: every `@spec_ref` line of the header (verbatim) always; plus, for the same repository, the header itself, first 40 lines, then `… N more lines` when longer. Prefixed by the file's project-relative path.
- A named test file from which nothing is attached (no `@spec_ref` line, and for the same repository no header either) prints `nothing to attach from <path>` as the Context section — never a silent omission. No test file named → no Context section.
- Reduction: the description body is not otherwise redacted (issue-front-matter.ts passes it byte-for-byte), so the attached text gets its own pure `redactHomeInText(text, home)`: every occurrence of the home folder prefix becomes `~`.

### Severity / category

Help text for both flags: "required" (BR-492 already requires them on every filing path). MCP `LoreReportIssueSchema`: both stay `.optional()` in the zod shape so the handler keeps answering an unconfigured upstream with BR-489's remedy first, and their `.describe()` text says required; the handler's existing refusal stays the enforcement. Hint example (`adapters/cli/report-issue-hint.ts`, configured and unconfigured variants): includes `--description`, `--severity`, `--category`.

## Design Decisions

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| D1 | Front-matter format | unchanged (owner, 2026-10-24) | HTML comment + dual read; HTML comment + mass migration of existing issues | cosmetic gain; dual format forever or a mass edit of live issues |
| D2 | Base | current main (owner, 2026-10-25) | wait for gs-integration; land gs-integration first | gs-integration has no owner and no activity since 2026-10-19; its lander must merge 500+ main commits anyway |
| D3 | Context scope | header (≤40 lines) only when reporter = upstream; else `@spec_ref` lines only (owner) | always header; always only `@spec_ref` | other projects' comments would be published to lore's public repo |
| D4 | "Runnable" | syntactic + program on PATH / builtin / lore / existing path, at the input adapters | execute it; no check; check inside fileGithubIssue | nothing runs it later; a local lookup refuses prose like "with ..."; lore's own filers carry generated or historical values that are not input |
| D7 | MCP severity/category | described as required, refused by the handler | zod-required | zod would answer before BR-489's unconfigured-upstream remedy |
| D8 | Same-repo test | parsed origin, host github.com only | owner/name only | a same-named repo on another host would leak headers to the public issue |
| D5 | Repro rendering | fenced block | inline backticks | a backtick in the command breaks inline code today |
| D6 | `@spec_ref` | attached verbatim | parse into ids | 7 spellings measured across 938 files; ~40% are not AC ids |

## Acceptance Criteria

Declared with `lore ac add` (AC-RI-1 .. AC-RI-6).

## Structure

```
packages/lore/src/adapters/cli/commands/report-issue.ts      (flags, help)
packages/lore/src/adapters/cli/report-issue-wiring.ts         (check call, body sections)
packages/lore/src/adapters/mcp/tools.ts                       (schema)
packages/lore/src/service/report-issue-repro.ts               (new: checkReproCommand, pure + injected which)
packages/lore/src/service/report-issue-context.ts             (new: test-file pick, header extraction, attach text)
packages/lore/src/service/leading-comment.ts                  (new: boundary rule moved from scripts/test-declared-inputs.ts)
scripts/test-declared-inputs.ts                               (imports the moved rule)
packages/lore/src/adapters/cli/report-issue-hint.ts           (example command)
packages/lore/src/service/github-remote.ts                    (new: parseGithubRemote, pure)
packages/lore/src/service/redact-home.ts                      (new: redactHomeInText, pure)
```

## Cross-cutting

- Security / privacy: D3, D8 and home-prefix reduction of attached text; the header is read only from a file inside the project root (no symlink escape: realpath must stay under the root).
- Performance: one PATH lookup, one git call (origin URL) and at most one file read per filing.


## Acceptance Criteria (structured)

- [⚑] [script] AC-RI-1: checkReproCommand with an injected which() reading only the given PATH: accepts 'bun run test:file a.test.ts' (bun on PATH), 'FOO=1 bun test' (assignment skipped), 'lore assess my-plan' and 'lore assess ' (lore), 'cd sub && lore x' (builtin), 'echo `date`' and 'echo $(date)' (backticks and $() ordinary), './scripts/x.sh' (existing path); refuses with the exact reason and word: a two-line command (multi_line), "echo 'unclosed" (unlexable), 'FOO=1' alone (no_program), 'with an old fragment: lore integrate x' (program_not_found, word 'with'), 'bun x' when PATH lacks bun even though the test process has it (describe 'AC-RI-1'). Falsifier: make which() always true -> the 'with' case goes red.
  script: test — f=$(mktemp); bun run test:file packages/lore/tests/unit/service/report-issue-repro.test.ts -t 'AC-RI-1' > "$f" 2>&1; rc=$?; tail -6 "$f"; [ $rc -eq 0 ] && grep -qE 'Tests +[1-9][0-9]* passed' "$f" && echo 'AC-RI-1 PASS: repro command check accepts commands and refuses prose with the exact reason'
  other_command=1
- [⚑] [script] AC-RI-2: Compiled lore with the stub gh as the only PATH entry (pattern of report-issue-body-contract; every repro in this AC uses program lore or an existing path): a filing with every optional part records a body whose markers appear exactly once in the order Expected, Actual, Repro command (fenced block; a command containing three backticks gets a four-backtick fence), Repro steps, Suggested fix, Refs (one bullet per --refs), Context, Reported by; a filing with none of them has no Repro/Suggested fix/Refs/Context heading; parseIssueBody round-trips both bodies; a prose --repro-command exits exactly 2 naming the reason and records no issue POST (describe 'AC-RI-2'). Falsifier: render Suggested fix before Repro command -> the order case goes red.
  script: e2e — f=$(mktemp); bun run test:file packages/lore/tests/integration/cli/report-issue-body-contract.bun.test.ts -t 'AC-RI-2' > "$f" 2>&1; rc=$?; tail -6 "$f"; [ $rc -eq 0 ] && grep -qE 'Tests +[1-9][0-9]* passed' "$f" && echo 'AC-RI-2 PASS: body sections in order, optional parts omitted when absent, prose repro refused before GitHub'
  other_command=3
- [⚑] [script] AC-RI-3: Context builder, same repository: origin 'git@github.com:Owner/Repo.git' and upstream 'owner/repo' match; for a fixture test file with two @spec_ref lines and a 55-line header containing a nonce and the home folder path, the Context part holds the project-relative path, both @spec_ref lines, the first 40 header lines and '… 15 more lines', and the home path appears as ~; parseGithubRemote also matches 'https://github.com/owner/repo' and rejects 'git@gitlab.com:owner/repo.git'; a test file reached through a symlink pointing outside the project root is not read; a repro command naming no test file gives no Context part (describe 'AC-RI-3'). Falsifier: drop the 40-line cap -> red.
  script: test — f=$(mktemp); bun run test:file packages/lore/tests/unit/service/report-issue-context.test.ts -t 'AC-RI-3' > "$f" 2>&1; rc=$?; tail -6 "$f"; [ $rc -eq 0 ] && grep -qE 'Tests +[1-9][0-9]* passed' "$f" && echo 'AC-RI-3 PASS: same-repo context attaches spec refs and capped, reduced header'
  other_command=2
- [⚑] [script] AC-RI-4: Context builder, different repository (origin on another owner, on gitlab.com with the same owner/name, or no origin): the same fixture gives the path and both @spec_ref lines and NOT the header nonce nor any other header line; a test file with a header but no @spec_ref gives 'nothing to attach from <path>' (describe 'AC-RI-4'). Falsifier: compare owner/name without the host -> the gitlab case leaks the nonce and goes red.
  script: test — f=$(mktemp); bun run test:file packages/lore/tests/unit/service/report-issue-context.test.ts -t 'AC-RI-4' > "$f" 2>&1; rc=$?; tail -6 "$f"; [ $rc -eq 0 ] && grep -qE 'Tests +[1-9][0-9]* passed' "$f" && echo 'AC-RI-4 PASS: other projects attach only spec ref lines'
  other_command=2
- [⚑] [script] AC-RI-5: Severity and category stated as required everywhere: 'lore report-issue --help' marks --severity and --category as required and shows no '(optional)' on either; the hint's example command in both the configured-upstream and the unconfigured variants of adapters/cli/report-issue-hint.ts contains --title, --description, --expected, --actual, --severity and --category (describe 'AC-RI-5'). Falsifier: restore '(optional)' on --category -> red.
  script: test — f=$(mktemp); bun run test:file packages/lore/tests/unit/adapters/report-issue-required-flags.test.ts -t 'AC-RI-5' > "$f" 2>&1; rc=$?; tail -6 "$f"; [ $rc -eq 0 ] && grep -qE 'Tests +[1-9][0-9]* passed' "$f" && echo 'AC-RI-5 PASS: help and hint agree severity and category are required'
  other_command=2
- [⚑] [script] AC-RI-6: Production wiring, compiled lore with the stub gh: in a throwaway git project whose origin is git@github.com:<upstream owner/name>.git, --repro-command 'lore fragments check tests/x.test.ts' with tests/x.test.ts carrying a header nonce records a body whose Context part holds that nonce; the same filing from a project whose origin is another repository records the @spec_ref line but not the nonce (describe 'AC-RI-6'). Falsifier: skip the context builder in the filing path -> red.
  script: e2e — f=$(mktemp); bunx --bun vitest run packages/lore/tests/e2e/report-issue-context-compiled.bun.test.ts -t 'AC-RI-6' > "$f" 2>&1; rc=$?; tail -8 "$f"; [ $rc -eq 0 ] && grep -qE '^ *Tests +[1-9][0-9]* passed' "$f" && ! grep -qE '^ *(Tests|Test Files) .*[0-9]+ failed' "$f" && echo 'AC-RI-6 PASS: context and repro check wired into the compiled filing path'
  other_command=2

## Code anchors

- packages/lore/src/service/report-issue-repro.ts#checkReproCommand
- packages/lore/src/service/report-issue-context.ts
- packages/lore/src/service/github-remote.ts#parseGithubRemote
- packages/lore/src/service/redact-home.ts#redactHomeInText
- packages/lore/src/adapters/cli/report-issue-wiring.ts#buildIssueDescriptionBlock
