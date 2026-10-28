---
name: lore-init-context
description: "Use when the user says 'init context', 'generate context', 'setup CLAUDE.md layers', 'create module docs', 'refresh context', '初始化上下文', '生成项目上下文', '更新上下文', when a project has only a root CLAUDE.md, or when CLAUDE.md has drifted from the code. Generates root plus per-module CLAUDE.md files."
---

# Context Layer Initialization

Generate layered CLAUDE.md files so AI discovers project knowledge through Claude Code's native file loading — no MCP server, no hook injection, no runtime overhead.

## Why This Approach

AI agents don't follow prescribed information-discovery paths. They take the shortest route: search for what they need, read it directly. Elaborate context-injection pipelines and "MANDATORY" push directives get overridden by user intent every time.

What actually works:
- **Static knowledge in files** — architecture, invariants, conventions. Changes monthly. Version-controlled. Zero runtime dependency.
- **Dynamic state on-demand** — AI queries for plans, tasks, documents when it needs them. Not pushed at session start.
- **Layered CLAUDE.md** — Claude Code natively loads root + directory-level CLAUDE.md files. No MCP server, no hooks, no extra tooling.

## TL;DR Flow

```
Step 0  Preflight Check         — am I in a real project root with a source tree?
Step 1  Project Scan            — modules, key root files, sub-containers
Step 1.5 Drift Detection (UM)   — existing CLAUDE.md vs current code (Update Mode only)
Step 2  User Confirmation       — AskUserQuestion (modules / drift / dynamic context)
Step 3  Root CLAUDE.md          — preserve user content, update auto sections, fix drift if approved
Step 4  Module CLAUDE.md        — one per module (TaskCreate-tracked when ≥4)
Step 5  Verify with Tools       — actual ls/grep, not just claims
```

## When NOT to Use

- Single-file projects, hello-world scripts, throw-away experiments.
- Projects with ≤1 real source module — root CLAUDE.md alone is enough.
- Repositories without an established source tree (`src/` / `lib/` / `app/` / `pkg/`).

For these, suggest a single short CLAUDE.md by hand instead of running this skill.

---

## Step 0: Preflight Check

Before any scanning, verify:

1. **Working directory is a project root** — `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `Gemfile` / `mix.exs` / etc. present. If not → ask the user whether the cwd is correct before continuing.
2. **A source root exists** — common candidates: `src/`, `lib/`, `app/`, `pkg/`, `internal/`. If none → tell the user the skill needs a source tree and stop.
3. **Detect Update Mode** — `find . -maxdepth 4 -name 'CLAUDE.md'` (or equivalent). Any existing `CLAUDE.md` files mean Update Mode is active; remember to run Step 1.5.

Optional but recommended:
4. **Git repo?** — not required, but if absent, warn the user that generated files will not be version-controlled until they `git init`.

5. **Contract consumption** — check whether `lore` is on PATH. If it is, run `lore governance claude-md` and conform every file this skill generates (root and module) to that contract — it is the single SSOT for what goes in a project CLAUDE.md and what stays out; never copy or paraphrase it here. If `lore` is not on PATH, proceed with the generic structure below and recommend the user run `lore setup` to install it.

---

## Step 1: Project Scan

Use filesystem tools only. No external doc-system or MCP dependency.

**Gather:**
- Project config: `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`.
- Directory structure under the source root.
- Existing CLAUDE.md files (preserve user content).
- Test setup: framework, config location.
- Build/dev/lint commands from scripts.

**Detect module boundaries** using these heuristics (priority order):
1. Directories with an index/barrel file (`index.ts`, `mod.rs`, `__init__.py`, `main.go`).
2. Directories with ≥3 source files at the same level.
3. Directories explicitly named as architectural layers (`services/`, `models/`, `routes/`, `handlers/`).

**Minimum threshold**: Skip directories with <3 source files — they don't warrant a dedicated CLAUDE.md. Cover them with a one-liner in the root Module Index.

**Top-level key files**: Some projects have important files at the source root (e.g. `server.ts`, `constants.ts`, `app.ts`). Don't create a CLAUDE.md for these — describe them briefly in the root Architecture section. Only directories get their own CLAUDE.md.

**Subdirectory depth**: Generate CLAUDE.md at the first level of module directories only (e.g. `src/tools/CLAUDE.md`). Do NOT recurse into subdirectories. If a subdirectory has distinct patterns, describe them as a subsection within the parent module's CLAUDE.md.

### Sub-Container Pattern

When a directory contains **only subdirectories and no source files of its own** (typical examples: `src/adapters/`, `pkg/`, `internal/`, `cmd/`), it is a **container**, not a module.

Rules:
- Do **not** generate `<container>/CLAUDE.md` — there is no concrete code there to describe.
- Push the module decision down to each child. Each child directory is evaluated independently with the same heuristics (≥3 files, architectural-layer name, etc.).
- In the root Module Index, link to the children directly: `src/adapters/cli`, `src/adapters/http` — not `src/adapters`.

If a container genuinely has a shared invariant ("all adapters call services via the App composition root, never the store directly"), put that one line in the **root Architecture section**, not in a non-existent `adapters/CLAUDE.md`.

---

## Step 1.5: Drift Detection (Update Mode Only)

Skip this step if there is no existing root CLAUDE.md.

When a root CLAUDE.md exists, **the descriptive prose outside auto markers may have drifted from current code**. AI-written or AI-edited code moves faster than humans update prose. The skill's default ("preserve everything outside markers") protects user intent — but silent drift causes future AI sessions to read stale claims as facts.

**Compare existing prose against code reality:**

| Section in CLAUDE.md | Verify against |
|---|---|
| "What This Is" / project blurb | `package.json` description, actual entry files, recent commits |
| "Architecture" / Layer Stack diagram | Real directory structure under the source root |
| Services / Modules table | Files actually present under `src/service/` (or equivalent) |
| "Key Design Decisions" mentioning technologies | Imports in entry/composition files (e.g. `app.ts`) |
| Interface descriptions ("sync" / "async" / "returns X") | Actual signatures in the interface file |
| "Implementation Status" / "Phase X is underway" | Whether the files referenced as "target" now exist and are imported |

**Produce a drift table:**

```
Drift detected in CLAUDE.md vs current code:

| Section            | Existing claim                              | Actual code                                          |
|--------------------|---------------------------------------------|------------------------------------------------------|
| What This Is       | "Single CLI backed by bun:sqlite"           | Also has Turso sync (TursoStore) + HTTP adapter |
| Layer Stack        | cli / app.ts / service / store / core       | Missing: adapters/http, eval                     |
| Service Layer table| 5 services listed                           | TreeCheckService present in code, not in table       |
| StoreInterface     | "synchronous (bun:sqlite is sync)"          | Methods now return Promise<Result<...>>              |
| Implementation Status | "Phase 1 underway, CLI is current target"| CLI complete (22 commands), Turso sync landed        |
```

If no drift → say `No drift detected. Proceeding with auto sections only.` and skip to Step 2.

If drift found → present the table in Step 2's user-confirmation message **and ask how to resolve it** (the AskUserQuestion question is in Step 2).

---

## Step 2: User Confirmation

**MUST use AskUserQuestion. Never plain-text prompt the user.**

Ask in a single AskUserQuestion call with 2–4 questions (cap is 4 per call):

### Q1 — Module list (multiSelect)

> "Which modules should get a CLAUDE.md? (Recommended = all detected modules)"

Each detected module is an option. Pre-marked recommendation = all of them.

### Q2 — Drift resolution (single-select, only if Step 1.5 found drift)

> "N drift items found between existing CLAUDE.md and current code. How should they be handled?"

Options:
- **Rewrite drifted sections to match current code** *(Recommended)* — auto sections also updated. Preserves user voice/tone where possible.
- **Patch missing items only** — add missing modules/services to existing lists; do not touch descriptive prose.
- **Leave existing prose untouched** — strict marker behavior; drift remains. User wants to handle drift by hand.

### Q3 — Dynamic Context section

> "What should the Dynamic Context section in root CLAUDE.md show?"

Options:
- **Project's own query commands** — pick this when the project itself is a knowledge/CLI/doc system (Self-Hosted Project Pattern, below).
- **External doc-system / MCP query commands** — pick this when the project is *consumed by* a doc system but isn't one.
- **Omit the section entirely** — pick this when no query layer exists.

### Q4 — (optional) Skip / replace

Only ask if a non-recoverable conflict exists (e.g. user wrote a non-marker version of Module Index by hand). Otherwise omit.

---

## Step 3: Generate Root CLAUDE.md

**Behavior depends on Q2 answer (drift resolution):**

| Q2 choice | Marker sections | Non-marker descriptive sections |
|---|---|---|
| Rewrite drifted sections | Regenerate | Edit drifted sentences only, keep style and structure |
| Patch missing items only | Regenerate | Append missing items inline into existing lists; don't touch surrounding prose |
| Leave existing prose untouched | Regenerate | Touch nothing — strict marker behavior |

**Existing `## Module Index` (installed by `lore setup --project`)**: the root CLAUDE.md already carries `## Module Index` and `## Finding Live Project State` inside the lore-managed block. ⛔ FILL the existing `## Module Index` in place — never add a second `## Module Index` (a duplicate is a deterministic `section_duplicate` finding). Same for `## What This Is`, `## Commands`, `## Architecture`: fill the skeleton's section, do not append a new one.

**Root CLAUDE.md structure** (for fresh projects or full rewrites):

```markdown
# CLAUDE.md

## What This Is
[1-3 sentences. What the project does, its primary users or consumers.]

## Commands
[Verbatim from project config. Build, test, lint, dev, format.]

## Architecture
[Design-level overview — layers, data flow, key decisions and WHY.
 NOT a file listing. NOT implementation details. Mention key root-level
 files (server.ts, app.ts) here.]

<!-- auto:module-index -->
## Module Index
Module-specific context lives alongside the code:
- [`services`](src/services/CLAUDE.md) — business logic orchestration
- [`stores`](src/stores/CLAUDE.md) — persistence layer (FileStore is source of truth)
- [`routes`](src/routes/CLAUDE.md) — HTTP/MCP tool handlers
- [`utils`](src/utils/CLAUDE.md) — shared helpers and pure functions
<!-- /auto:module-index -->

<!-- auto:dynamic-context -->
## Finding Live Project State
[See Self-Hosted Project Pattern below for what to put here.]
<!-- /auto:dynamic-context -->
```

### Self-Hosted Project Pattern

When the project itself is a knowledge/CLI/doc system (e.g. `lore`, `wiki-cli`, `awk`), Dynamic Context should list the project's **own** commands, not external doc-system or MCP commands:

```markdown
## Finding Live Project State
- `lore search <query>` — find documents by FTS keyword
- `lore get <id-or-slug>` — read full document content
- `lore tree` — view document hierarchy
- `lore list --type spec` — filter by document type
```

Detect this case by checking whether the project's `bin` (from `package.json`) or `cmd/` directory exposes a CLI that mirrors document-management capabilities. If yes → Self-Hosted; otherwise list external doc-system/MCP commands or omit.

### Guidelines

- Target ≤150 lines total.
- Architecture section: design intent, not implementation. Mention root-level key files here (e.g. `app.ts` = composition root).
- Module Index: one line per module with a link and a ≤10-word purpose.

---

## Step 4: Generate Module CLAUDE.md Files

For each module, create `<source-root>/<module>/CLAUDE.md`.

### TaskCreate Tracking

If generating ≥4 modules → use TaskCreate to register one task per file (root + each module). TaskUpdate to `completed` as each is written. Below 4 modules, tracking adds noise; skip it.

### Per-module scan (before writing)

- Read the entry file (index.ts, mod.rs) for public API surface.
- Read 2-3 representative files to detect patterns and conventions.
- Check imports/exports for cross-module dependencies.

### Module CLAUDE.md structure

```markdown
# Module: <Name>

## Purpose
[1-2 sentences. What this module does. Where its boundary is.]

## Key Invariants
[Constraints that MUST hold. Things you'd tell a new developer before
they touch this code. Skip if none — not every module has invariants.]

## Patterns
[Module-specific conventions. Registration patterns, naming conventions,
wrapper composition order — only what differs from or extends root.]

## Links
- Depends on: [`stores`](../stores/CLAUDE.md), [`utils`](../utils/CLAUDE.md)
- Used by: [`routes`](../routes/CLAUDE.md)
```

### Guidelines

- Target ≤80 lines per module. If it needs more, the module may be too big.
- Only write what you can verify from the code — never fabricate invariants.
- Prefer one concrete example over three abstract rules.
- Cross-link to other module CLAUDE.md files using relative paths.

---

## Step 5: Verify (with actual tool calls)

Do not "claim and move on." Run real checks:

1. **`ls` each path you claim to have written.** Anything missing → re-write or list as failure.
2. **`grep` root CLAUDE.md's Module Index links.** Every linked CLAUDE.md must exist on disk.
3. **`grep` each module CLAUDE.md's `## Links` section.** Every sibling link must resolve.
4. **Broken links → fix or explicitly report.** Do not silently leave them.
5. **No content duplicated between root and module files** — quick spot-check that module purpose is one line in root, expanded in the module file.

### Report format

```
Created/updated:
  ✓ CLAUDE.md (root) — 128 lines       [drift fixed: 5 items]
  ✓ src/services/CLAUDE.md — 45 lines
  ✓ src/stores/CLAUDE.md — 38 lines
  ✓ src/routes/CLAUDE.md — 52 lines
  ✓ src/utils/CLAUDE.md — 22 lines

Verified:
  ✓ All 4 Module Index links resolve
  ✓ All 7 cross-module Links resolve

Total context: 285 lines across 5 files
```

If any verify step failed, list it under a `Failures:` section above the totals.

---

## Content Contract

What goes in a CLAUDE.md versus what stays out, the section taxonomy, and style rules are governed by the SSOT contract, not by this skill — see Step 0's contract-consumption preflight (`lore governance claude-md`). When `lore` is unavailable, fall back to the generic structure in Steps 3-4 below and recommend `lore setup`.

---

## Update Mode Details

When re-running on a project with existing CLAUDE.md files:

1. Read all existing CLAUDE.md files first (Step 0 already flagged Update Mode).
2. Run Drift Detection (Step 1.5) against the root file.
3. Detect structural changes: new modules, removed modules, renamed directories.
4. Ask via AskUserQuestion (Step 2) — modules, drift resolution, dynamic context.
5. Apply changes according to user choices:
   - **New modules** → fresh CLAUDE.md, added to Module Index.
   - **Existing modules** → preserve all content outside `<!-- auto:... -->` markers; update auto sections only.
   - **Removed modules** → warn in report; do not delete (may be intentional restructure).
   - **Root CLAUDE.md** → behavior driven by Q2 answer (see Step 3 table).

The `<!-- auto:... -->` markers protect user-written content from being overwritten:

```markdown
<!-- auto:module-index -->
... this section gets regenerated ...
<!-- /auto:module-index -->
```

Everything outside markers is treated as user-owned. Drift-fix mode (Q2 = "Rewrite drifted sections") is the only exception, and only with explicit user consent through AskUserQuestion.

---

## Step 6: Contract Oracle

After generating (or updating) files, if `lore` is on PATH run `lore status --check-claude-md`. Exit 3 means one or more generated files violate the deterministic line/byte ceiling from the contract — treat this as a failure and fix the offending file(s) before reporting done. Exit 0 (or `lore` absent) means this oracle passed or does not apply.

## Also use when

Other phrases that route here: 'initialize project knowledge', onboarding AI to a codebase, starting a new project's context, or refreshing context after major structural changes.

History: this skill replaces the retired session-start bootstrap injection and the init_* MCP tooling with zero-dependency, file-based context. Use it when migrating from bootstrap-based injection. It detects drift between existing CLAUDE.md files and the actual code, and writes static knowledge (architecture, invariants, conventions) into native Claude Code context files.
