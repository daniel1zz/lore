---
id: SPEC-183
type: spec
role: spec
title: "Lore-owned agent context is generated from templates and registered variables"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
links:
  - {id: SPEC-155, type: relates-to}
  - {id: SPEC-169, type: relates-to}
  - {id: SPEC-098, type: relates-to}
  - {id: SPEC-095, type: relates-to}
  - {id: SPEC-154, type: relates-to}
  - {id: SPEC-179, type: relates-to}
---
## Overview/Goal

Every fact about lore that lore's own shipped text quotes (a limit, an agent name, a tool count) is stated ONCE — as a code constant — and filled into that text by lore when it renders or installs it. Today such values are hand-copied into fragment prose, shipped skills, CLI messages and zod schemas, and nothing notices when a copy drifts (measured: root `CLAUDE.md:64` says 16 `lore_*` tools and `assets/skills/lore/SKILL.md:122` says 23, while `adapters/mcp/tools.ts` registers 45 — issue #209; the 4000-char evidence tail is restated in 9 source files, two of them literal `max(4000)` schemas).

Content a user or project writes (CLAUDE.md, non-`lore-` rules files, `selection.yaml`, user/project fragment bodies) is never rewritten by lore; user/project fragment bodies MAY opt into variables.

This spec extends `spec-context-fragments-config-driven-layered-rule-injection` (a variable-expansion step before fingerprinting — amends its D15/AC-CF-6 "body verbatim": a fragment body is now verbatim AFTER expansion — the AC-CF-6 oracle (`packages/lore/tests/e2e/context-fragments-compiled.bun.test.ts`) compares against registry-expanded source; fragments without `{{lore:` render byte-identical to today) and `spec-rule-store-git-tracked-fragment-selection-on-demand-skill` (skill outlets).

## Scope

In scope:
- A pure expander + registry contract in `@lore/core`; the registry instance assembled in `packages/lore`.
- Expansion at the lore-owned outlets: fragment → `.claude/rules/lore-*.md` / `~/.claude/rules/lore-*.md` / `lore-<id>/SKILL.md` / `hook:subagent-start`; installed assets `assets/skills|agents|hooks` (at install, and identically when the manifest hashes them); the `{{CLAUDE_DIR}}` settings-hook substitution (absorbed as `{{lore:claude_dir}}`).
- A literal-duplication lint over lore-owned sources and this repo's CLAUDE.md files.
- Removing hand-typed code-derivable counts from this repo's CLAUDE.md files (fixes #209), per the approved content contract.

Out of scope (decided, with reason):
- **Config-sourced variables.** `.lore/config.yaml` is gitignored (`.gitignore:18`), so a project-config value would render different bytes per teammate at project outlets (violates BR-902 / AC-CF-21 / AC-RS-11); no user-scope setting with an enforcer exists to bind at user outlets, and a source with no production user is dead mechanism. Configurability stays at fragment level (selection, disable, language). A git-tracked project vars file would need its own spec.
- **Seat briefing.** BR-851 / AC-CF-17 require `lore governance seat-briefing` to print the asset byte-for-byte; its `{{ACTOR}}/{{BRANCH}}/{{MAIN_CHECKOUT}}` are per-session runtime values, not duplicated lore facts. The hook's own substitution stays.
- **Generating code facts INTO CLAUDE.md.** `assets/governance/claude-md-contract.md` (approved) classifies code-derivable facts as OUT of the memory file; the fix for a stale count there is deletion, not generation.
- LLM prompt slots inside skills (`{{file_list}}`, `{{project_context}}`, `{{input}}`) — never touched (D2).
- Hook-time injection of main-session context — `hook:session-start` stays retired.

## Design Decisions

| # | Decision | Chosen | Rejected (why) |
|---|---|---|---|
| D1 | Registry shape and ownership | `@lore/core/context-variables.ts` owns the MECHANISM only: types, `expandTemplate(text, ctx, registry)`, `findPlaceholders`, `validateRegistry(registry)` (pure, returns Result — never throws at module load; default barrel stays Node-free), plus core-owned constants it can reference without importing upward (`CAPTURE_TAIL_CHARS` moves here; `LORE_AGENT_NAMES`). The registry INSTANCE `LORE_CONTEXT_VARIABLES` is assembled in `packages/lore/src/service/context-variables-registry.ts`, which may read lore-package facts (`LORE_MCP_TOOL_NAMES`). `source` ∈ `code` (value from a constant) / `invocation` (value supplied by the caller at render) | Registry inside core holding adapter facts (core would import lore: cycle); `config` source (see Scope) |
| D2 | Placeholder syntax | `{{lore:<name>}}`, name `[a-z][a-z0-9_]*`. Only this exact token form expands; any other `{{…}}` (incl. `{{ lore:x }}`) is left byte-for-byte | Bare `{{NAME}}` — collides with shipped LLM prompt slots |
| D3 | Failure mode | Unregistered name, name not allowed at the outlet, or missing invocation value → `VALIDATION_ERROR` naming `path:line` (line counted in the FILE, via `VarContext.lineOffset` for frontmatter) and the name; never left as literal, never defaulted | Leave placeholder in output (silent fallback) |
| D4 | When expansion runs | Inside lore's own render/install code paths: refresh, `fragments check`, `setup --project [--check]`, `lore fragments render` for `hook:subagent-start` (the binary expands; the hook only prints), `RealAssetSource.load()` for installed assets, `scripts/embed-assets-manifest.mjs` (same expander, so manifest sha == installed bytes), `setup-service` for settings-hook commands. Fingerprints, drift, duplicate-line detection and byte caps all operate on expanded text | Expansion inside hook scripts (`.mjs` cannot import core; would fork the mechanism) |
| D5 | Outlet discipline | `code` vars are allowed at every outlet; `invocation` vars only at the outlet that supplies them (`claude_dir` → `setup:settings-hook`). Project outlets therefore depend only on the lore binary version — byte-identical across teammates (BR-902) | Per-teammate inputs at project outlets |
| D6 | Installed assets | Expanded in `RealAssetSource.load()` for kinds skill/agent/hook with outlet `asset:install` (code vars only); `scripts/embed-assets-manifest.mjs` hashes through the same expander (its "no @lore/core coupling" note is revised: it imports the pure expander + registry). Five-state freshness and `setup --check` stay unchanged; after a lore fact changes and the binary is rebuilt, old installed copies show `outdated`. `assets/governance` and `assets/project` files are installed byte-for-byte (never expanded) and the manifest script refuses `{{lore:` in them (exit 1); `assets/context` is never installed and expands only at refresh | Build-time-only expansion (manifest holds no content; setup copies raw files — installed copies would keep `{{lore:` and read behind forever); in-file managed markers (redundant with manifest sha) |
| D7 | `{{CLAUDE_DIR}}` | Renamed `{{lore:claude_dir}}` (invocation var, outlet `setup:settings-hook`), resolved by `expandTemplate` in `setup-service`. The token is emitted by CODE (`buildHookSettingsEntries` via `real-asset-source.ts`) into the settings-hook payload and exists in no `assets/` file, so it never meets the AC-CV-5 refusal; merged settings.json bytes for a given target dir are unchanged | Keep a second ad-hoc substitution |
| D8 | Literal-duplication lint | Registry entries declare `literalPatterns`; `capture_tail_chars` declares patterns that must each match a fixed spelling list asserted by the test (`4000-char`, `4000 char`, `4000 chars`, `max(4000)`, `tailChars(x, 4000)`, `= 4000;`). Agent-name patterns (`implementer_agent`, `reader_agent`) never scan any `.mjs` file (hook tests import those sources unexpanded). A vitest oracle scans an explicit glob list (`assets/**/*.{md,mjs}`, `.lore/context/**/*.md`, every `CLAUDE.md` in the repo, and the named `packages/*/src` files that state the value in messages or schemas) and fails naming `file:line` + variable, asserting the scanned-file count is > 0 and self-falsifying on a planted literal. Code references the constant | Generic magic-number lint (noise); review discipline (NOT ENFORCED) |
| D9 | CLAUDE.md code facts | Delete hand-typed code-derivable counts from this repo's CLAUDE.md files (root `:64`, any module file); `mcp_tool_count` has `literalPatterns` `/\b\d+ `?lore_\*`? tools/` so the lint keeps every CLAUDE.md and shipped asset free of hand-typed counts; `assets/skills/lore/SKILL.md` states it via `{{lore:mcp_tool_count}}` | Generate the facts into a Z1 section (contradicts the approved content contract and collides with the root-section required `## Module Index` and the existing `auto:module-index` block) |
| D10 | Single expansion helper for fragments | One helper `expandFragments(fragments, outlet, ctx, registry)` called per outlet by every fragment code path (refresh, check, drift, render, duplicate-line detection) so check and refresh cannot disagree | Expand once in `discoverFragments` (one context for all outlets; cannot apply D5 per outlet) |

## Module Boundary

- Public (`@lore/core`, default barrel, no Node builtins): `ContextVariable`, `VariableSource`, `VariableOutlet`, `VarContext`, `expandTemplate`, `findPlaceholders`, `validateRegistry`, `CAPTURE_TAIL_CHARS`, `LORE_AGENT_NAMES`.
- `packages/lore`: `LORE_CONTEXT_VARIABLES` (registry instance), `LORE_MCP_TOOL_NAMES` (pure leaf module consumed by MCP registration AND the registry), `expandFragments`.
- Dependencies: core imports nothing from lore; lore imports core. Registry is a parameter everywhere (tests inject their own).

```ts
export type VariableSource = "code" | "invocation";
export type VariableOutlet = OutletId | "asset:install" | "setup:settings-hook";
export interface ContextVariable {
  readonly name: string;                         // [a-z][a-z0-9_]*
  readonly source: VariableSource;
  readonly outlets: readonly VariableOutlet[];   // invocation: exactly its supplying outlet
  readonly describe: string;
  readonly value?: () => string;                 // required iff source === "code"
  readonly literalPatterns?: readonly RegExp[];
}
export interface VarContext {
  readonly outlet: VariableOutlet;
  readonly path: string;
  readonly lineOffset: number;                   // lines before the body in the file
  readonly invocation: Readonly<Record<string, string>>;
}
export function expandTemplate(text: string, ctx: VarContext, registry: readonly ContextVariable[]): Result<string, LoreError>;
export function findPlaceholders(text: string): readonly { name: string; line: number }[];
export function validateRegistry(registry: readonly ContextVariable[]): Result<void, LoreError>;
```

Dependency graph: `@lore/core/context-variables` ← `packages/lore/src/service/context-variables-registry.ts` ← { `service/context-fragments/*` via `expandFragments`, `flows/context-flow.ts`, `flows/fragments-flow.ts`, `adapters/real-asset-source.ts`, `service/setup-service.ts`, `scripts/embed-assets-manifest.mjs` }. Acyclic.

## Phases

1. **P1 core + fragment outlets** — mechanism, registry instance (`capture_tail_chars`, `implementer_agent`, `reader_agent`), `expandFragments` across all fragment paths, outlet discipline.
2. **P2 installed assets + literal lint** — install-time expansion + manifest parity, replace hand-copied literals, lint.
3. **P3 claude_dir + tool count** — `{{lore:claude_dir}}`, `mcp_tool_count` + `LORE_MCP_TOOL_NAMES`, delete hand-typed counts (#209).

## Acceptance Criteria

Declared as structured criteria (`lore ac add`), AC-CV-1 … AC-CV-8. Every command also refuses `.skip(`, `.skipIf(`, `.todo(`, `.only(` and `skip: true` in its test file. Golden fixtures for "byte-identical to before" checks are captured by the RED test task BEFORE implementation and committed under `packages/lore/tests/fixtures/context-variables/` (`pre-change-rules/` for AC-CV-2, `pre-change-settings.json` for AC-CV-7). Tests that exercise the CLI spawn `bun packages/lore/src/index.ts` with `HOME` set to a `mkdtemp` directory — never the installed `lore`, never this repo's `.lore/`.

## Risks

- Expansion changes rules-file bytes only for fragments that adopt `{{lore:`; each installed project sees those files `outdated` once after upgrade — expected, and the existing reminder's "binary version changed" reason is correct because project outlets depend on nothing else (D5).
- A fragment author writes `{{lore:x}}` for an unregistered x: refused with file:line (AC-CV-1/2), never shipped half-expanded.
- `RealAssetSource` and the manifest script must use the SAME expander and registry or every install reads `diverged` — AC-CV-4 installs and checks end to end.


## Acceptance Criteria (structured)

- [⚑] [script] AC-CV-1: With an injected test registry, expandTemplate replaces each {{lore:<name>}} of a code variable with its value; an unregistered name, a name not allowed at ctx.outlet, and an invocation variable with no supplied value each return VALIDATION_ERROR whose message contains '<path>:<line>' (line = lineOffset + body line) and the name; '{{file_list}}' and '{{ lore:x }}' are returned byte-identical; validateRegistry refuses a code entry without value, an invocation entry allowed at more than one outlet, and a malformed name, without throwing.
  script: test — bunx vitest run packages/core/src/context-variables.test.ts && ! grep -nE '\.(skip|skipIf|todo|only)\(|skip: *true' packages/core/src/context-variables.test.ts && echo 'AC-CV-1 PASS'
- [⚑] [script] AC-CV-2: A fragment containing {{lore:capture_tail_chars}} renders to .claude/rules/lore-<id>.md, lore-<id>/SKILL.md and the hook:subagent-start block each containing String(CAPTURE_TAIL_CHARS) and no '{{lore:'; the rules-file fingerprint hash equals the hash of the expanded body; fragments without '{{lore:' render byte-identical to the committed fixtures in packages/lore/tests/fixtures/context-variables/pre-change-rules/; refresh over a fragment naming an unregistered variable (spawned 'bun packages/lore/src/index.ts context refresh' in a mkdtemp repo) exits 4, names file:line and writes no rules file; for two fragments whose lines are equal only after expansion, 'lore fragments check --json' exits 4 (CHECK_FAILED_EXIT, packages/lore/src/adapters/cli/commands/fragments.ts:68) and its findings contain kind 'duplicate_line' naming both fragment ids.
  script: test — bunx vitest run packages/lore/tests/unit/context-fragments/fragment-variables.test.ts && ! grep -nE '\.(skip|skipIf|todo|only)\(|skip: *true' packages/lore/tests/unit/context-fragments/fragment-variables.test.ts && echo 'AC-CV-2 PASS'
- [⚑] [script] AC-CV-3: An invocation variable used by a fragment is refused at rules:project, skills:project, rules:user and hook:subagent-start with VALIDATION_ERROR naming the variable and the outlet; rendering the project rules files of the same repo with two different HOME directories (different user fragments and global config) yields byte-identical project files.
  script: test — bunx vitest run packages/lore/tests/unit/context-fragments/fragment-variables-scope.test.ts && ! grep -nE '\.(skip|skipIf|todo|only)\(|skip: *true' packages/lore/tests/unit/context-fragments/fragment-variables-scope.test.ts && echo 'AC-CV-3 PASS'
- [⚑] [script] AC-CV-4: Spawned 'bun packages/lore/src/index.ts setup' with HOME=<mkdtemp> installs a shipped skill whose source contains {{lore:capture_tail_chars}}: the installed copy contains String(CAPTURE_TAIL_CHARS) and no '{{lore:'; an immediately following 'setup --check --json' reports zero outdated, diverged and missing entries.
  script: test — bunx vitest run packages/lore/tests/unit/setup/asset-install-variables.test.ts && ! grep -nE '\.(skip|skipIf|todo|only)\(|skip: *true' packages/lore/tests/unit/setup/asset-install-variables.test.ts && echo 'AC-CV-4 PASS'
- [⚑] [script] AC-CV-5: For every manifest entry of kind skill, agent or hook, the embedded sha256 equals sha256 of RealAssetSource.load() output for that file (same expander and registry); assets/skills/lore/SKILL.md carries {{lore:capture_tail_chars}} and its loaded bytes contain String(CAPTURE_TAIL_CHARS); an installed-kind asset naming an invocation variable, or any '{{lore:' in a governance or project asset, makes 'bun scripts/embed-assets-manifest.mjs' exit 1 naming file and variable; '--check' exits 0 on the repo tree.
  script: test — bunx vitest run packages/lore/tests/unit/build/asset-variables.test.ts && ! grep -nE '\.(skip|skipIf|todo|only)\(|skip: *true' packages/lore/tests/unit/build/asset-variables.test.ts && echo 'AC-CV-5 PASS'
- [⊘] [script] AC-CV-6: The capture_tail_chars literalPatterns match every spelling in a fixed list asserted by the test ('4000-char', '4000 char', '4000 chars', 'max(4000)', 'tailChars(x, 4000)', '= 4000;'); for every LORE_CONTEXT_VARIABLES entry with literalPatterns there are zero matches in the declared scan set (assets/**/*.md; assets/**/*.mjs for every entry except implementer_agent and reader_agent, which never scan any .mjs file; .lore/context/**/*.md; every CLAUDE.md in the repo; packages/core/src/{session,task-workflow,truncate}.ts, packages/lore/src/adapters/cli/evidence-precheck.ts, packages/lore/src/adapters/cli/commands/evidence.ts, packages/lore/src/adapters/mcp/tools.ts, packages/lore/src/service/{verify-executor,verify-runner-service,verify-spawn,merged-stream-command}.ts); each hit is reported as file:line + variable; the scanned file count is > 0; a literal planted into a temp copy is reported.
  script: test — bunx vitest run packages/lore/tests/unit/assets/registered-literal-lint.test.ts && ! grep -nE '\.(skip|skipIf|todo|only)\(|skip: *true' packages/lore/tests/unit/assets/registered-literal-lint.test.ts && echo 'AC-CV-6 PASS'
- [⚑] [script] AC-CV-7: setup-service resolves {{lore:claude_dir}} in settings-hook commands through expandTemplate; the token '{{CLAUDE_DIR}}' appears in no file under assets/ or packages/*/src; settings.json written by a fresh spawned 'setup' into HOME=<mkdtemp> equals packages/lore/tests/fixtures/context-variables/pre-change-settings.json byte-for-byte after replacing every occurrence of the absolute '<HOME>/.claude' path with the literal token '<CLAUDE_DIR>' on BOTH sides (the fixture is captured from the pre-change code by the RED task with the same replacement).
  script: test — bunx vitest run packages/lore/tests/unit/setup/claude-dir-variable.test.ts && ! grep -nE '\.(skip|skipIf|todo|only)\(|skip: *true' packages/lore/tests/unit/setup/claude-dir-variable.test.ts && echo 'AC-CV-7 PASS'
- [⚑] [script] AC-CV-8: LORE_MCP_TOOL_NAMES has exactly the names registered on a real MCP server instance (compared against the server's tool list, not a hand count); the installed lore skill states the tool count as String(LORE_MCP_TOOL_NAMES.length); no CLAUDE.md in the repo and no file under assets/ matches /\b\d+ `?lore_\*`? tools/ outside an unexpanded {{lore:mcp_tool_count}} (issue #209).
  script: test — bunx vitest run packages/lore/tests/unit/assets/mcp-tool-count.test.ts && ! grep -nE '\.(skip|skipIf|todo|only)\(|skip: *true' packages/lore/tests/unit/assets/mcp-tool-count.test.ts && echo 'AC-CV-8 PASS'

## Code anchors

- packages/core/src/context-variables.ts#expandTemplate
- packages/core/src/context-variables.ts#validateRegistry
- packages/lore/src/service/context-fragments/expand.ts#expandFragments
- packages/lore/src/service/context-variables-registry.ts#LORE_CONTEXT_VARIABLES
- packages/lore/src/adapters/mcp/tool-names.ts#LORE_MCP_TOOL_NAMES
- packages/lore/src/adapters/real-asset-source.ts#expandInstalledAsset
