---
name: lore-kickoff
description: "Use when starting a brand new project, bootstrapping the lore corpus workflow for the first time (lore init, root PRD, first spec), or user says 'kickoff', 'new project', 'initialize project', 'Day 0', '项目启动', '新项目'. NOT for provisioning infrastructure (use lore-auto-wire) or configuring Claude Code for a project (use lore-project-bootstrap)."
---

# Project Kickoff Orchestrator

You are in **kickoff mode**. Your job is to guide the user through new project initialization, from idea to actionable development plan. You are an orchestrator — you gather context, bootstrap the lore corpus, and route to existing skills. You do NOT duplicate skill logic.

All corpus writes go through the **lore CLI** (per-project `.lore/`). Keep `CLAUDECODE=1` exported so lore's AI-assist defaults OFF (agent surface).

## Arguments: $ARGUMENTS

If arguments provided, treat as the project description and skip to Phase 2 with pre-filled context.

## Phase 1: Structured Intake

Gather project context through a focused questionnaire. Ask all questions in ONE message, not one-by-one.

```
**[KICKOFF] Phase 1 — Project Intake**

Please answer these questions (skip any that don't apply):

1. **Project name**: What do you want to call it?
2. **One-liner**: Describe the project in one sentence.
3. **Type**: Web app / API / CLI tool / library / mobile app / bot / other?
4. **Target users**: Who will use this?
5. **Tech preferences**: Any stack preferences or constraints?
6. **Existing assets**: Starting from scratch, or existing code/design/PRD?
7. **Deploy target**: Where will this run?
8. **Timeline**: Any deadline or milestone? (optional)
```

Wait for the user's answers before proceeding.

## Phase 2: Lore Corpus Bootstrap

Run in the project root. If `.lore/` already exists, skip step 2a and reconcile instead (`lore status`, `lore tree` — don't re-init, don't overwrite).

### 2a. Init the corpus

```bash
lore init --name <project-name> --author <name>     # creates .lore/
```

### 2b. Seed the root PRD (PRD-as-living-root)

```bash
lore create prd --title "<project> — <one-liner>" --content-file <prd.md>
```

Body: structured overview from intake — problem, target users, scope, non-goals, constraints. The PRD is a *living root*: it may embed MDX placeholders that resolve at read time (`lore get <prd> --resolve-mdx`), e.g. `<ChildrenOf />` (child specs), `<ActivePlans />`, `<RecentDecisions />`, `<HealthStats />` — so the PRD stays current without manual edits.

### 2c. Optional: tree blueprint

Author a repo-root `lore.tree.yaml` to arm `lore status --check-tree` (structure conformance, CI-gateable, exit 3 on drift). Minimal example:

```yaml
version: 1
root:
  type: prd
  children:
    - type: spec
      min: 1
      children:
        - type: plan
          min: 0
          children:
            - { type: task, min: 0 }
            - { type: knowledge, min: 0 }
        - { type: adr, min: 0 }
        - { type: knowledge, min: 0 }
    - { type: adr, min: 0 }
    - { type: knowledge, min: 0 }
```

### 2d. First baseline leaf and rule (before any spec)

A spec takes no parent and cannot be approved without a criterion that cites a rule (BR-1007), so the project's first rule must exist before its first spec. Build the business baseline under the root PRD (the `lore-baseline` skill covers the full tree):

```bash
lore baseline add <prd-slug> --node root --label "<product>" --title "<product> baseline"      # business root; its parent is the PRD
lore baseline add <root-slug> --node branch --label "<area>" --title "<area>"                  # one branch per product area
lore baseline add <branch-slug> --node leaf --label "<capability>" --title "<capability>"      # a leaf holds rules, never code detail
lore rule add <leaf-slug> --statement "<one observable behaviour>" --confidence established --enforced-by guaranteed --example "<concrete case>"   # prints BR-<n>
```

### 2e. First spec (gated — feed before produce)

```bash
lore feed spec-create    # read the feeding pack FIRST
lore create spec --title "..." --kind feature|tech   # a spec takes no parent: it relates to the trees by citing rules
lore ac add <spec-slug> AC-1 --statement "..." --mode script|ai|human [--oracle test --command "..."] --cite BR-<n>   # cite the rule from 2d; or later: lore ac cite <spec-slug> AC-1 BR-<n>
```

The spec step cites the rule created in 2d; there is no approval without a citing criterion (BR-1007). Declare acceptance criteria up front — `lore verify` / `lore assess` judge against them later.

### 2f. Layered CLAUDE.md context

Invoke the `zz-init-context` skill for root + per-module CLAUDE.md files — it replaced the retired MCP doc-system's init_* module tools with zero-dependency file-based context.

### 2g. Verify

```bash
lore status        # corpus health; add --check-tree if 2c done
lore tree          # confirm the PRD tree; `lore baseline tree` shows the baseline from 2d
```

Output:
```
**[KICKOFF] Phase 2 — Lore Corpus Bootstrapped**
- .lore/ initialized: ✅
- Root PRD: <slug>
- First spec: <slug> (ACs: n)
- Tree blueprint: armed / skipped
- CLAUDE.md context: generated / deferred
```

## Phase 3: Skill Chain Routing

Based on project type and existing assets, determine the skill chain.

### Route Decision Matrix

| Starting Point | Skill Chain |
|---|---|
| Idea only (no PRD, no code) | `lore-product-benchmark` → `/lore-product ideation` → `discovery` → `opportunity` → `validate` → `/lore-product prd` → `research:sdk` → `design:architecture` → `plan:create` |
| Has PRD (user provided or just seeded) | `research:sdk` → `design:architecture` → `plan:create` |
| Has PRD + tech stack decided | `design:architecture` → `plan:create` |
| Has existing code, adding major feature | `domain:analyze` → `/lore-product opportunity` → `validate` → `/lore-product prd` → `design:module` → `plan:create` |
| CLI tool / library | `research:sdk` → `design:api` → `plan:create` |
| Bot (Slack/Telegram/etc.) | `research:sdk` → `design:module` → `plan:create` |

Persist chain outputs into the corpus as you go: research conclusions → `lore create adr --parent <spec it governs> --decision-status proposed`; architecture → `lore create spec --kind tech`; plans → `lore create plan --parent <spec>` + `lore phase add` + `lore create task --parent <plan> --plan-id <plan> --anchor <path>`.

### Scaffold Recommendation

| Stack | Scaffold Command |
|---|---|
| Next.js SaaS (full-featured) | `npx next-forge@latest init` |
| Next.js (standard) | `npx create-next-app@latest` |
| Turborepo monorepo | `npx create-turbo@latest` |
| Vite (React/Vue/Svelte) | `npm create vite@latest` |
| Python API | `uv init` or framework-specific |
| CLI tool (Node) | `npm init` + recommended libs |

**Do NOT run the scaffold command** — present it as a recommendation. The user decides when/how to scaffold.

Output:
```
**[KICKOFF] Phase 3 — Routing**

Skill chain: {ordered list with reasons}
Scaffold: `{command}` ({why this starter})

Ready to proceed? I'll start with {first skill in chain}.
```

## Phase 4: Execute First Skill

After user confirms:

1. Call the first skill in the chain using `Skill(skill="{name}", args="{mode} {context}")`
2. Pass the intake context as arguments so the skill has project info
3. After the first skill completes, announce the next step and ask to continue

**Do NOT auto-execute the entire chain** — pause after each skill for user review.

## Guardrails

- **No gold-plating**: Only recommend what's needed for the specific project type. A CLI tool doesn't need a UI framework.
- **No framework bias**: Recommend based on the user's stated preferences first, then best fit.
- **Search-first**: Common pattern (e.g., "SaaS with auth + payments") → check for existing starters/templates before building from scratch.
- **Existing corpus respect**: `.lore/` already present → reconcile (`lore status`, `lore tree`, `lore search`), never re-init or duplicate the root PRD.
- **Never bypass gates**: exit 4 from `lore create` means read the feeding pack and fix the input — `LORE_GATE_BYPASS=1` only with explicit user say-so.
- **Incremental**: It's OK to defer the tree blueprint and design decisions until they're actually needed. Not everything must be decided on Day 0.
