# Prototype Fidelity

> Layer 2 cross-skill rule. When a UI design-spec ships with **executable prototype HTML files**, implementation MUST achieve pixel-level fidelity to the prototype — never re-interpret, never re-author components that are already canonical.

## Failure mode this prevents

**Pattern**: design phase produces N HTML prototypes; plan decomposes UI work referencing those prototypes by file path; implementer writes React/Vue/Svelte from intuition because the task description only says "implement Today page"; final code resembles the prototype at 60-70% fidelity (right colors, wrong spacing; right anchors, slightly different markup; right layout, wrong responsive breakpoints). User sees drift, raises issue, dev cycle reopens. Loss = full implementation cycle redone.

Observed instances:
- Prior gankjob session: `tracking/new` page implemented as plain HTML form, ignoring `docs/design-system/prototype/tracking.html`. User feedback: "this is too simple and doesn't match the UI". Root cause: no prototype-binding in plan tasks.
- General SaaS pattern: 4 reviewers in the prior session caught 8 BLOCKER drifts between prototypes and design-spec because subagents used "intuitive markup" instead of the canonical anchor-badge SVG.

## Discipline (MUST apply when prototype HTML exists for the surface)

### 1. Line-range precision in task references

Every UI-bearing task's "Design refs:" block MUST cite:
```
docs/design-system/prototype/<screen>.html#L<start>-L<end>
```
NOT just `docs/design-system/prototype/<screen>.html` — line range identifies the exact component / region the task implements. Without line precision, implementer has to scan the entire (often 500+ line) file and guess.

### 2. Verbatim copy for canonical components

For any component whose markup is defined in `docs/design-system/ui-standards.md` §11.x (or equivalent SSOT section), implementer MUST:
- READ the SSOT markup
- COPY byte-identical (only swap `{placeholder}` values like `{fieldPath}`)
- NEVER re-author from intuition

Examples of canonical components in gankjob's v1.2:
- anchor-badge (ui-standards.md §11.1)
- agent message bubble (§11.3)
- artifact card (§11.4)
- FAB (§11.5)
- ⌘K command palette pill (§11.6)
- inline-edit pattern (§11.7)
- toggle switch (§11.8)
- tab widget contract (§11.9)
- streaming UI (§11.10)
- shimmer skeleton (§11.11)
- wordmark (§11.14)
- avatar button (§11.15)

Re-authoring any of these = `lore verify <plan> --task <task>` rejects the implementation (oracle exit code decides, never self-asserted).

### 3. Required oracles per UI task

Every UI implementation task MUST carry these as AC (each runnable, not vague):

| Oracle | Command pattern | Threshold |
|---|---|---|
| **Visual parity** | `playwright screenshot --url <route> --baseline docs/design-system/prototype/<screen>.html` OR `mcp__hypothesi_tauri-mcp-server__webview_screenshot` + diff | < 2% pixel diff (or per-surface configurable) |
| **Token-drift lint** | `grep -rE '#[0-9a-fA-F]{3,6}' <impl-files> \| grep -v <allowed-tokens>` | 0 violations (any off-palette hex outside the token list) |
| **A11y** | `axe-core --severity serious+` at the real route | 0 violations |
| **Markup parity** (for canonical components) | `grep -F "<canonical markup>" <impl-file>` | matches the SSOT block from `ui-standards.md §11.x` |

All four MUST appear as separate AC lines in the implementation task — `~/.claude/skills/lore-plan/references/ac-quality.md` banned-verbs check applies.

### 4. Prototype-parity-check terminal task per surface

For each surface that has a prototype file, the leaf-task chain extends from 3 to 4:
```
test → impl → wire → prototype-parity-check
```
See `~/.claude/skills/lore-plan/references/phase-decomposition.md` Integration Task Mandate. The 4th task's sole job is the visual-parity oracle above; it runs AFTER integration so the screenshot reflects the real production route.

### 5. Subagent prompt requirement

When dispatching `lore-implementer` (or any implementation subagent) for a UI task:
- The prompt MUST embed the SSOT component markup VERBATIM (not just a link)
- The prompt MUST cite line range from the prototype file
- The prompt MUST list all oracle commands explicitly
- The prompt MUST forbid re-authoring documented components

Without these in the dispatch bundle, the subagent has no choice but to invent — and inventions drift.

## Skill responsibilities

| Skill | Responsibility |
|---|---|
| `/design-ui` | Produces prototype HTML files + `ui-standards.md` §11.x canonical markup. Stage 2 approval = these become SSOT. |
| `/plan` (mode-create) | Generates UI tasks with line-range refs, verbatim-copy rule, parity-check terminal task. `lore verify <plan>` BLOCKS on missing items (see `mode-create.md` UI-task reference binding). |
| `/writing-plans` (superpowers) | Same discipline as `/plan` when invoked for UI work. |
| `lore-implementer` (subagent) | READS prototype + ui-standards SSOT, COPIES canonical markup, runs all 4 oracles in AC. |
| `lore-reviewer` (subagent) | VERIFIES verbatim-copy via grep, runs visual parity diff, BLOCKs on drift. |

## Trigger checkpoints

| About to do | Stop and check |
|---|---|
| Generate a task that touches a page/component/route | Has prototype? → line-range + parity-check |
| Dispatch implementation subagent for UI work | Did prompt embed SSOT markup verbatim? Cite line range? List oracles? |
| Approve a UI PR / commit | Did parity-check task run? Diff < threshold? |
| Use any color / radius / shadow / class string | Came from ui-standards.md? If invented → STOP |

## When in doubt

| 🚩 AI rationalization | Reality |
|---|---|
| "The prototype is just inspiration, I'll improve on it" | Inspiration ≠ specification. Approved prototype IS specification. Improve via formal change to prototype + ui-standards, never silently in impl. |
| "Copying markup is mechanical, the agent can do better" | "Better" by AI ≠ approved by user. Approved markup wins. Verbatim copy is correct. |
| "Line range is overkill, file path is enough" | 500+ line files are common. Without line range, implementer scans and guesses. Cite the range. |
| "Visual diff is too strict, 5% tolerance is fine" | Tolerance drifts upward over time. Start at 2%, raise per-surface only with explicit user approval logged in task. |
| "Parity check task adds overhead" | Drift without parity check = user-visible bug = full re-implementation. Parity task amortizes by orders of magnitude. |
