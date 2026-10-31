/**
 * lore create <type> — create a new document.
 *
 * Type-specific required flags:
 *   adr       → --decision-status (proposed|accepted|deprecated|superseded)
 *   knowledge → --sub-type (ideation|retro|research|reference)
 *   task      → --plan-id <plan-slug-or-id> is ALWAYS required. --parent
 *               <slug-or-id> defaults to the resolved --plan-id when omitted
 *               (SPEC-065 D4 — the dominant shape; a task parented somewhere
 *               OTHER than its own plan passes --parent explicitly). Missing
 *               BOTH flags is reported in ONE exit-2 message
 *               (`create-task-validation.ts::checkTaskCreateRequiredFlags`),
 *               not two separate round trips. Source: SPEC-065 D4.
 *               EXCEPTION: --adhoc (SPEC-069 D2) makes --plan-id/--parent
 *               BOTH optional — an ad-hoc task is deliberately planless and
 *               parents to the corpus root PRD instead (resolved service-side,
 *               CorpusService._createImpl). --adhoc is mutually exclusive with
 *               --plan-id/--phase (nothing plan-scoped to declare) and with
 *               --linkage (which JUSTIFIES a CHOSEN plan attachment — SPEC-069
 *               D3 — the opposite of "no plan"), checked in the SAME
 *               single-pass validation (`checkTaskCreateAdhocConflicts`).
 *               --adhoc DOES require an explicit --ac-scope (exit 4 without
 *               one, `isAdhocAcScopeDeclarationMissing`): the plan branch's
 *               requiredness is enforced service-side by the `task-create`
 *               gate off the parent plan's spec lineage, which --adhoc
 *               guarantees is absent, so the ad-hoc branch is keyed on the
 *               author's flag here instead. `--ac-scope ""` is the legal
 *               "claims nothing" declaration. Source:
 *               task-an-ad-hoc-task-can-never-reach-the-attestation-path-that.
 *
 * Type-specific OPTIONAL flags:
 *   spec      → --kind (feature|tech|design); defaults to "feature" when omitted
 *               (materialized by CorpusService._createImpl, not this command).
 *               An invalid value flows through to createDocInputSchema and surfaces
 *               as VALIDATION_ERROR (exit 4) — unlike --decision-status/--sub-type,
 *               --kind is NOT pre-validated here since it is optional, not required.
 *               Source: SPEC-032 §3.1
 *   plan      → --requires-uat (boolean); absent/false leaves extra.requires_uat unset.
 *               Source: SPEC-058 hotfix (plan-add-requires-uat-authoring-path)
 *
 * Content decision tree (SPEC-017 §3.11, amended by SPEC-024):
 *   --content-file <path> → read file, use its contents (skip AI and editor)
 *   --content "…" passed explicitly → use it (skip AI and editor)
 *   --ai passed explicitly → AI generation (overrides surface default)
 *   --no-ai passed explicitly → open $EDITOR (overrides surface default)
 *   neither passed → resolve via app.resolveAiDefault(undefined):
 *     - "cli" surface (human terminal): default AI on (SPEC-017 unchanged)
 *     - "agent" surface (CLAUDECODE=1/CI=true/LORE_AI_DEFAULT=off): default AI off
 *
 * --ai / --no-ai mutual exclusion: passing both → exit 2 (SPEC-003 usage error).
 *
 * --content-file <path>:
 *   Reads the file at <path> and uses its full contents as the document body.
 *   Workaround for Bug A: citty/mri treats `---` as an option terminator when passed
 *   directly to --content. Mutually exclusive with --content (exit 2 if both passed).
 *   File not found or unreadable → exit 4 (VALIDATION_ERROR).
 *
 * Editor flow (SPEC-003 §3.1, preserved under --no-ai or agent surface default):
 *   Opens defaults.editor / $EDITOR / vi for the doc body.
 *   --content "" is accepted as explicit empty body (bypasses both AI and editor).
 */

import { readFileSync } from "node:fs";
import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { openEditor } from "../editor.js";
import type { DocRecord, DocType, JudgeIdentity, KnowledgeSubType, LoreError, Priority } from "@lore/core";
import { KNOWLEDGE_SUB_TYPES, SPEC_KINDS, extractFileAnchors } from "@lore/core";
import { createWithSupersedes, renderSupersedeRepairMessage } from "../../../flows/supersede-flow.js";
import { collectFileAnchorResolution, renderFileAnchorAdvisory } from "../../../service/anchor-resolution.js";
import { buildFileAnchorProbeContext } from "../../real-fs-probe.js";
import { resolveIssueCarrierRefs } from "../create-issue-refs.js";
import {
  checkTaskCreateAdhocConflicts,
  checkTaskCreateRequiredFlags,
  formatAdhocAcScopeMissingError,
  formatTaskCreateAdhocConflictError,
  formatTaskCreateMissingFlagsError,
  inferTaskParentId,
  isAdhocAcScopeDeclarationMissing,
  resolveAcScopeForCreate,
  type ResolvedAcScope,
} from "../create-task-validation.js";
import { readFieldsFile, type FieldsFileContent } from "../fields-file.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import type { ExitReport } from "../cli-exit.js";

const VALID_TYPES: DocType[] = ["prd", "spec", "adr", "plan", "knowledge", "task"];

/**
 * `--supersedes` target-type eligibility (`SUPERSEDE_CREATE_ELIGIBLE_TYPES`) is no
 * longer declared or checked here. It moved to `flows/supersede-flow.ts`, checked
 * INSIDE `createWithSupersedes` before `deps.create` ever runs
 * (task-mcp-lore-create-supersedes-still-creates-then-fails-the) — this command used
 * to precheck it locally, one layer above that shared seam, which is exactly why the
 * MCP surface (calling the same shared function directly) never inherited the check.
 * See that module's doc comment for the eligibility rationale.
 */

const ADR_DECISION_STATUSES = ["proposed", "accepted", "deprecated", "superseded"] as const;
type AdrDecisionStatus = (typeof ADR_DECISION_STATUSES)[number];

// reason: SPEC-041 §3 D4 drive-by SSOT repair — this list used to be a hand-copied
// literal that had already drifted from `@lore/core`'s `KNOWLEDGE_SUB_TYPES` (missing
// "prompt"/"skill"). Now imported directly so CLI validation can never diverge again.
// "assessment"/"handoff" are listed for --help discoverability but are NOT manually
// completable via this command:
//   - "assessment" — the retired plan-outcome assessment: CorpusService refuses to create
//     a new one (BR-1372); archived docs of that sub_type stay readable.
//   - "handoff" — CorpusService._createImpl's writer-identity guard (SPEC-041 §3 D4)
//     rejects `type: "knowledge"` + `extra.sub_type: "handoff"` on this command's
//     write path with a VALIDATION_ERROR naming `lore handoff` as the sole legitimate
//     writer; this command intentionally does NOT pre-empt that rejection — the CLI
//     forwards --sub-type handoff through to the service seam so the service's own
//     naming message is what the user sees (module header content decision tree).


/** Flags that are only meaningful for specific types. Used to detect mismatches. */
const TYPE_SPECIFIC_FLAGS: Readonly<Record<string, readonly DocType[]>> = {
  "decision-status": ["adr"],
  "sub-type": ["knowledge"],
  "plan-id": ["task"],
  phase: ["task"],
  kind: ["spec"],
  anchor: ["task"],
  "ac-scope": ["task"],
  "code-anchor": ["spec"],
  "requires-uat": ["plan"],
  adhoc: ["task"],
  linkage: ["task"],
  spec: ["task"],
};

/** citty/mri yields a single string for one occurrence of a repeatable flag, an array for ≥2, or `undefined` for zero. Normalizes to a string array. */
function normalizeRepeatable(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

export default defineLoreCommand({
  meta: {
    name: "create",
    description: "Create a new document",
  },
  args: {
    type: {
      type: "positional",
      description: `Document type: ${VALID_TYPES.join(" | ")}`,
      required: true,
    },
    title: {
      type: "string",
      description: "Document title",
    },
    parent: {
      type: "string",
      description:
        "Parent document ID or slug. REQUIRED for knowledge (every sub-type), adr and plan: without it the create is refused (exit 4) and the refusal lists the documents that could take it (BR-709). A task takes its plan (--plan-id). Refused for a spec: a spec takes no parent — relate it to the trees with `lore ac cite`",
    },
    content: {
      type: "string",
      description: "Document content (markdown)",
    },
    "content-file": {
      type: "string",
      description:
        "Path to file whose full contents become the document body. Mutually exclusive with --content.",
    },
    "fields-file": {
      type: "string",
      description:
        "YAML or JSON file with `fields:` and `dimensions:`: the structured content of a templated document. It is validated against the latest approved template of the type and kind, which the document then pins; the body is rendered from the fields (no AI, no editor, no --content). `lore template show <type> --blank` prints the skeleton.",
    },
    priority: {
      type: "string",
      description: "Priority: critical | high | medium | low",
      default: "medium",
    },
    tags: {
      type: "string",
      description: "Comma-separated tags",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    "decision-status": {
      type: "string",
      description: `[adr only] ADR decision status: ${ADR_DECISION_STATUSES.join(" | ")}`,
    },
    "sub-type": {
      type: "string",
      description: `[knowledge only] Knowledge sub-type: ${KNOWLEDGE_SUB_TYPES.join(" | ")}`,
    },
    "plan-id": {
      type: "string",
      description: "[task only] Plan document ID or slug this task belongs to",
    },
    phase: {
      type: "string",
      description: "[task only] Phase name to assign this task to (must be declared on the parent plan). Source: SPEC-023",
    },
    kind: {
      type: "string",
      description: `[spec only] Spec kind: ${SPEC_KINDS.join(" | ")} (defaults to "feature" when omitted). Source: SPEC-032`,
    },
    anchor: {
      type: "string",
      description:
        "[task only, repeatable] Declare a file_anchors entry (repo-relative POSIX path; trailing '/' = directory scope). Validated + normalized by CorpusService (SPEC-042 D3). A path that does not resolve on disk is ADVISED on stderr, never refused — a task may anchor a file it is about to create.",
    },
    "ac-scope": {
      type: "string",
      description:
        "[task only, repeatable] Declare an extra.ac_scope entry — an acceptance-criterion id on the governing spec that THIS task claims (e.g. AC-VS-9). Pass an explicit empty value (--ac-scope \"\") to declare this task claims NONE, storing an empty array (distinct from omitting the flag entirely). Required (may be empty) on BOTH task branches: when the parent plan's spec declares >= 1 script-mode AC (spec-declaring-ac-scope-is-required-at-task-creation-so-the), and ALWAYS with --adhoc, whose absent plan lineage that first trigger can never see (task-an-ad-hoc-task-can-never-reach-the-attestation-path-that). Consumed by `lore verify`'s declared-scope intersection; an --adhoc task with ids here must also pass --spec (its governing spec); edit later with `lore scope add|rm` (there is no `lore set --ac-scope`).",
    },
    "code-anchor": {
      type: "string",
      description:
        "[spec only, repeatable] Declare a code_anchors entry (path[#Symbol] — repo-relative POSIX path, optional #ExportedSymbol). Distinct grammar from task --anchor. Verified by `lore status --check-drift` (SPEC-045).",
    },
    "requires-uat": {
      type: "boolean",
      description:
        "[plan only] Declare that this plan requires a P0-accepted UAT verdict before it may be archived (SPEC-058 plan-promote requiresUat gate / SPEC-054 plan-close uatP0Accepted gate). Absent or --requires-uat=false leaves extra.requires_uat unset.",
    },
    adhoc: {
      type: "boolean",
      description:
        "[task only] Create a planless task (extra.adhoc = true), parented to the corpus root PRD instead of a plan. Makes --plan-id/--parent both optional; mutually exclusive with --plan-id, --phase, and --linkage. Source: SPEC-069 D2",
    },
    spec: {
      type: "string",
      description:
        "[task only, with --adhoc] The spec that governs this ad-hoc task's --ac-scope ids (stored as extra.governing_spec). REQUIRED whenever --ac-scope names at least one id (exit 4 without it); every id must be declared on that spec (exit 4 naming the declared ids). Criterion ids are unique only within one spec, so the spec is recorded, never looked up by id. Record it later with `lore scope spec <task> <spec>`. Source: BR-118, BR-1495",
    },
    linkage: {
      type: "string",
      description:
        "[task only] Free-text justification for WHY this task is attached to --plan-id despite looking unrelated to the plan's declared scope — stored verbatim in extra.linkage and surfaced in lore assess scope-fidelity facts. Mutually exclusive with --adhoc. Source: SPEC-069 D3",
    },
    supersedes: {
      type: "string",
      description:
        "ID or slug of an existing knowledge/adr doc this new doc supersedes — creates then invalidates the old doc in one command (SPEC-043 D11). The target's type is validated BEFORE any write: a non-knowledge/adr target (e.g. a task) is refused with exit 4 and creates NOTHING (task-a-task-cannot-be-retracted-supersedes-emits-a-repair). Half-failure past that point (create ok, invalidate fails) reports a nonzero exit naming the exact repair command; the new doc is still created.",
    },
    issue: {
      type: "string",
      description:
        "[plan|task, repeatable] Carry a GitHub issue on this work: writes extra.issues [{repo_id, number}] on the new document, so archiving it closes the issue. Each <n> must be an issue in the live listing of the configured feedback.upstream repository; otherwise nothing is created (exit 4). A spec is not an issue carrier (exit 4). Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries D1",
    },
    ai: {
      type: "boolean",
      // reason: SPEC-024 tri-state AI flag — the ai arg in citty/mri is kept for --help
      // discoverability, but the actual tri-state detection (--ai / --no-ai / neither) is
      // done by scanning process.argv directly (see run handler). This is necessary because
      // mri collapses --ai (true) and no-flag (default) into the same value regardless of
      // what default we set, making it impossible to distinguish "explicitly passed --ai"
      // from "no flag passed". No default here — the actual logic uses process.argv.
      // AC-AI-19 (--no-ai shows in help): mri negation still works for discoverability.
      description: "Explicitly enable AI content generation (overrides surface default). Pass --no-ai to disable.",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const docType = args.type as DocType;

    if (!VALID_TYPES.includes(docType)) {
      inv.io.stderr.write(
        `Error: Invalid type '${args.type}'. Valid types: ${VALID_TYPES.join(", ")}\n`,
      );
      exitCli(2);
    }

    if (!args.title) {
      inv.io.stderr.write("Error: --title is required.\n");
      exitCli(2);
    }

    // Reject empty string passed explicitly to --parent (citty parses "" as string "").
    if (args.parent !== undefined && args.parent.trim() === "") {
      inv.io.stderr.write(
        "Error: --parent received empty string. Pass a valid document ID or slug, or omit the flag.\n",
      );
      exitCli(2);
    }

    // Reject type-flag mismatches: e.g. `lore create prd --decision-status accepted`
    for (const [flag, allowedTypes] of Object.entries(TYPE_SPECIFIC_FLAGS)) {
      const flagValue = args[flag as keyof typeof args];
      if (flagValue !== undefined && !allowedTypes.includes(docType)) {
        inv.io.stderr.write(
          `Error: --${flag} is only valid for type(s): ${allowedTypes.join(", ")} (got '${docType}').\n`,
        );
        exitCli(2);
      }
    }

    // Validate type-specific required flags before hitting the service layer
    if (docType === "adr") {
      const ds = args["decision-status"];
      if (!ds) {
        inv.io.stderr.write(
          `Error: --decision-status is required for type 'adr'.\n` +
            `  Valid values: ${ADR_DECISION_STATUSES.join(" | ")}\n`,
        );
        exitCli(2);
      }
      if (!ADR_DECISION_STATUSES.includes(ds as AdrDecisionStatus)) {
        inv.io.stderr.write(
          `Error: Invalid --decision-status '${ds}'.\n` +
            `  Valid values: ${ADR_DECISION_STATUSES.join(" | ")}\n`,
        );
        exitCli(2);
      }
    }

    if (docType === "knowledge") {
      const st = args["sub-type"];
      if (!st) {
        inv.io.stderr.write(
          `Error: --sub-type is required for type 'knowledge'.\n` +
            `  Valid values: ${KNOWLEDGE_SUB_TYPES.join(" | ")}\n`,
        );
        exitCli(2);
      }
      if (!KNOWLEDGE_SUB_TYPES.includes(st as KnowledgeSubType)) {
        inv.io.stderr.write(
          `Error: Invalid --sub-type '${st}'.\n` +
            `  Valid values: ${KNOWLEDGE_SUB_TYPES.join(" | ")}\n`,
        );
        exitCli(2);
      }
    }

    // Resolved ONCE here (pure fn, no IO) and consumed twice: by the ad-hoc
    // --ac-scope requiredness check inside the task block below, and by
    // `buildExtra` further down — the absent-vs-explicitly-empty bit must be
    // the SAME fact in both places.
    const acScope = resolveAcScopeForCreate(args["ac-scope"] as string | string[] | undefined);

    // SPEC-065 D4 (extended by SPEC-069 D2/D3/D4): single-pass validation —
    // reports every --adhoc mutual-exclusion conflict AND every missing
    // required flag together, never a two-round-trip discovery (P1-5 dogfood
    // finding). Conflicts are checked FIRST: a --adhoc + --plan-id caller
    // should see the conflict, not a (misleading, since --adhoc alone needs
    // neither) missing-flags message.
    if (docType === "task") {
      const taskCreateFlags = {
        planId: args["plan-id"] as string | undefined,
        parent: args.parent,
        adhoc: args.adhoc as boolean | undefined,
        phase: args.phase,
        linkage: args.linkage as string | undefined,
      };
      if (args.spec !== undefined && args.adhoc !== true) {
        inv.io.stderr.write(
          "Error: --spec applies only with --adhoc (a plan member takes its criteria from its plan's spec).\n",
        );
        exitCli(2);
      }
      const adhocConflicts = checkTaskCreateAdhocConflicts(taskCreateFlags);
      if (adhocConflicts.length > 0) {
        inv.io.stderr.write(formatTaskCreateAdhocConflictError(adhocConflicts) + "\n");
        exitCli(2);
      }
      const missingTaskFlags = checkTaskCreateRequiredFlags(taskCreateFlags);
      if (missingTaskFlags.length > 0) {
        inv.io.stderr.write(formatTaskCreateMissingFlagsError(missingTaskFlags) + "\n");
        exitCli(2);
      }
      // The ad-hoc branch of --ac-scope requiredness (task-an-ad-hoc-task-can-
      // never-reach-the-attestation-path-that). Checked AFTER the two exit-2
      // usage families above so an --adhoc + --plan-id caller learns about the
      // mutual exclusion first, and BEFORE loadLoreApp() so a refusal can never
      // write a doc.
      //
      // Exit 4, not 2: the plan branch's identical requirement is denied
      // service-side by the `task-create` gate as a VALIDATION_ERROR (exit 4),
      // and a caller must not need to know which branch it is on to detect an
      // ac-scope requiredness refusal.
      if (isAdhocAcScopeDeclarationMissing(taskCreateFlags, acScope.passed)) {
        inv.io.stderr.write(formatAdhocAcScopeMissingError() + "\n");
        exitCli(4);
      }
    }

    // SPEC-024 §9.1: tri-state AI detection.
    // reason: citty/mri cannot distinguish "no flag passed" from "flag passed with default value"
    // for booleans when a default is set. We REMOVED the default from the `ai` citty arg (see
    // above) so citty now leaves args.ai = undefined when neither --ai nor --no-ai is passed.
    // However, we ALSO scan process.argv to:
    //   (a) detect mutual exclusion (--ai AND --no-ai both present → exit 2)
    //   (b) provide the primary signal for real CLI invocations
    // The args.ai fallback covers programmatic invocations (bun test / integration harness)
    // that call cmd.run({ args: { ai: true } }) directly without going through process.argv.
    //
    // Precedence: process.argv scan > args.ai (programmatic) > undefined (resolved by surface)
    // This scan must happen before loadLoreApp() so we can exit 2 before touching the DB.
    const _rawArgv = inv.argv;
    const _hasExplicitAi = _rawArgv.includes("--ai");
    const _hasExplicitNoAi = _rawArgv.includes("--no-ai");

    if (_hasExplicitAi && _hasExplicitNoAi) {
      inv.io.stderr.write(
        "Error: --ai and --no-ai are mutually exclusive. Pass only one.\n",
      );
      exitCli(2);
    }

    const explicitAi: boolean | undefined = _hasExplicitAi
      ? true
      : _hasExplicitNoAi
        ? false
        // fallback: use citty-parsed args.ai (valid for programmatic invocation where
        // process.argv was not set; undefined when flag not present since no default).
        : (args.ai as boolean | undefined);

    const { app, defaults, config } = loadLoreApp({ inv });
    try {
      const tags = args.tags
        ? args.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : [];

      // Mutex guard: --content and --content-file are mutually exclusive (exit 2 per Bug A spec).
      if (args.content !== undefined && args["content-file"] !== undefined) {
        inv.io.stderr.write(
          "Error: --content and --content-file are mutually exclusive. Pass only one.\n",
        );
        exitCli(2);
      }

      // Content decision tree (SPEC-017 §3.11, amended by SPEC-024):
      //   0. --content-file passed → read file, use as content (skip AI + editor)
      //   1. --content passed explicitly → use it (skip AI and editor)
      //   2. Resolve AI default (SPEC-024):
      //        --ai passed → force AI on (explicit_arg)
      //        --no-ai passed → force AI off → editor (explicit_arg)
      //        neither → app.resolveAiDefault(undefined) reads surface + config
      //          "cli" surface → AI on (cli_flag default)
      //          "agent" surface (CLAUDECODE/CI/LORE_AI_DEFAULT=off) → AI off (env default)
      //
      // args.content === undefined means the flag was absent (citty does not set it).
      // args.content === "" means --content "" was passed explicitly → accepted as empty body.
      let resolvedContent: string | undefined = args.content;
      // SPEC-103 §Mechanisms M1 — set ONLY by the AI-generation branch below (never
      // invented for an editor/--content-authored doc); folded into `extra.ai_provenance`
      // when building `createInput` further down.
      let aiProvenance: JudgeIdentity | undefined;
      // reason: --content-file reads from disk and assigns as content, bypassing the mri
      // argv-terminator bug that drops content starting with `---` (Bug A fix, SPEC-003 §3.1).
      if (resolvedContent === undefined && args["content-file"] !== undefined) {
        try {
          resolvedContent = readFileSync(args["content-file"], "utf8");
        } catch (e) {
          inv.io.stderr.write(
            `Error: cannot read --content-file '${args["content-file"]}': ${e instanceof Error ? e.message : String(e)}\n`,
          );
          return 4;
        }
      }
      // BR-1528 — `--fields-file`: the body is rendered from the fields service-side, so neither AI nor the editor runs.
      let fieldsFile: FieldsFileContent | undefined;
      if (args["fields-file"] !== undefined) {
        const readFields = readFieldsFile(args["fields-file"]);
        if (!readFields.ok) {
          inv.io.stderr.write(formatErrorFor(inv, readFields.error) + "\n");
          return exitCode(readFields.error);
        }
        fieldsFile = readFields.value;
      }
      if (resolvedContent === undefined && fieldsFile === undefined) {
        // SPEC-024: resolve AI default from surface + explicit flag + config
        const { ai: useAi, source: aiSource } = app.resolveAiDefault(explicitAi);

        if (!useAi) {
          // No-AI path: fall back to editor (SPEC-003 §3.1 / AC-AI-2)
          const editorResult = await openEditor({ defaults, env: inv.env, tmpDir: inv.paths.tmpDir, cwd: inv.cwd, stdinIsTTY: inv.io.stdinIsTTY });
          if (!editorResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, editorResult.error) + "\n");
            return exitCode(editorResult.error);
          }
          resolvedContent = editorResult.value;
        } else {
          // AI path (SPEC-017 §3.11 default; surface-aware via SPEC-024)
          // Resolve parent title for template interpolation — one extra O(1) corpus read.
          // reason: skip when no --parent flag; insignificant vs provider latency (SPEC-017 §7).
          let parent_title: string | undefined;
          if (args.parent) {
            const parentResult = await app.corpusService.get(args.parent);
            // reason: parent title lookup failure is non-fatal for AI path — template will
            // omit the {{#parent_title}}…{{/parent_title}} block gracefully.
            if (parentResult.ok) {
              parent_title = parentResult.value.doc.title;
            }
          }

          const showSpinner = inv.io.stderr.isTTY === true && !args.json;
          const aiService = app.aiProviderService;
          if (showSpinner) {
            inv.io.stderr.write(`⏳ Generating via ${aiService.activeProviderName}...\n`);
          }

          const aiResult = await aiService.generate({
            doc_type: docType,
            title: args.title,
            ...(parent_title !== undefined ? { parent_title } : {}),
            // SPEC-024 AC-NOAI-8: pass surface + source for telemetry
            caller_surface: app.callerSurface,
            ai_default_source: aiSource,
          });

          if (!aiResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, aiResult.error) + "\n");
            return exitCode(aiResult.error);
          }

          resolvedContent = aiResult.value.content;
          aiProvenance = aiResult.value.ai_provenance;
          if (showSpinner) {
            inv.io.stderr.write(
              `✓ Generated ${aiResult.value.content.length} chars in ` +
              `${(aiResult.value.duration_ms / 1000).toFixed(1)}s\n`,
            );
          }
        }
      }

      // Resolve --plan-id slug or ULID → canonical ULID before building extra
      let resolvedPlanId: string | undefined;
      if (docType === "task" && args["plan-id"]) {
        const planResolve = await app.corpusService.resolve(args["plan-id"]);
        if (!planResolve.ok) {
          inv.io.stderr.write(formatErrorFor(inv, planResolve.error) + "\n");
          return exitCode(planResolve.error);
        }
        resolvedPlanId = planResolve.value;
      }

      // spec-github-owns-issue-report-state-no-mirror-task-work-carries D1 — every --issue number is checked
      // against the live GitHub listing BEFORE any write: one bad value refuses the whole creation (exit 4).
      const issueTokens = normalizeRepeatable(args.issue);
      let issueRefs: Array<{ repo_id: number; number: number }> = [];
      if (issueTokens.length > 0) {
        const resolvedRefs = await resolveIssueCarrierRefs(inv, config, docType, issueTokens);
        if (!resolvedRefs.ok) {
          inv.io.stderr.write(formatErrorFor(inv, resolvedRefs.error) + "\n");
          return exitCode(resolvedRefs.error);
        }
        issueRefs = resolvedRefs.value;
      }

      // Assemble type-specific extra object
      const baseExtra = buildExtra(
        docType,
        args["decision-status"],
        args["sub-type"],
        resolvedPlanId,
        args.phase,
        args.kind,
        normalizeRepeatable(args.anchor),
        normalizeRepeatable(args["code-anchor"]),
        args["requires-uat"] as boolean | undefined,
        args.adhoc as boolean | undefined,
        args.linkage as string | undefined,
        acScope,
        args.spec as string | undefined,
      );
      const extra = issueRefs.length > 0 ? { ...(baseExtra ?? {}), issues: issueRefs } : baseExtra;

      // SPEC-065 D4: --parent defaults to the (already-resolved) --plan-id when
      // omitted — for every non-task type resolvedPlanId is always undefined, so
      // this transparently reduces to the pre-D4 `args.parent` passthrough.
      const inferredParentId = inferTaskParentId(args.parent, resolvedPlanId);

      // SPEC-103 §Mechanisms M1 — fold the AI-generation seam's provenance tuple
      // into `extra.ai_provenance` ONLY when `generate()` actually produced one
      // (the AI path ran); never invented for an editor/--content-authored doc.
      const provenanceExtra =
        aiProvenance !== undefined ? { ...(extra ?? {}), ai_provenance: aiProvenance } : extra;
      const extraWithProvenance =
        fieldsFile === undefined
          ? provenanceExtra
          : { ...(provenanceExtra ?? {}), fields: fieldsFile.fields ?? {}, dimensions: fieldsFile.dimensions ?? [] };

      const createInput = {
        type: docType,
        title: args.title,
        ...(inferredParentId !== undefined ? { parent_id: inferredParentId } : {}),
        ...(resolvedContent !== undefined ? { content: resolvedContent } : {}),
        priority: (args.priority as Priority) ?? "medium",
        ...(tags.length > 0 ? { tags } : {}),
        ...(extraWithProvenance !== undefined ? { extra: extraWithProvenance } : {}),
      };

      // SPEC-043 D11: --supersedes composes create() THEN ValidityService.invalidate()
      // via the shared createWithSupersedes orchestration (flows/supersede-flow.ts) —
      // the SAME function MCP lore_create.supersedes uses, so the two surfaces can
      // never diverge on half-failure behavior.
      let doc;
      let supersedeError: LoreError | undefined;

      // SPEC-079 G2 — resolved once, reused as the create's own audit actor
      // (both branches below) and, when --supersedes is set, the invalidate
      // step's actor too.
      const resolvedActor = resolveActor(inv);

      if (args.supersedes !== undefined) {
        if (app.validityService === undefined) {
          inv.io.stderr.write("Error: ValidityService not wired on this App instance.\n");
          return 1;
        }

        // task-mcp-lore-create-supersedes-still-creates-then-fails-the: the target-type
        // eligibility precheck now lives INSIDE createWithSupersedes (flows/supersede-
        // flow.ts) — it resolves args.supersedes and refuses BEFORE calling deps.create,
        // so nothing is created on refusal (assert-doc-count-unchanged, AC1) and CLI/MCP
        // can never diverge on this predicate again (the prior fix lived one layer above
        // this call, in this command, which is exactly how the MCP surface missed it).
        const orchResult = await createWithSupersedes(
          {
            get: app.corpusService.get.bind(app.corpusService),
            create: app.corpusService.create.bind(app.corpusService),
            invalidate: app.validityService.invalidate.bind(app.validityService),
          },
          createInput,
          args.supersedes,
          resolvedActor,
        );
        if (!orchResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, orchResult.error) + "\n");
          return exitCode(orchResult.error);
        }
        doc = orchResult.value.doc;
        supersedeError = orchResult.value.supersedeError;
      } else {
        const result = await app.corpusService.create(createInput, { by: resolvedActor });
        if (!result.ok) {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          return exitCode(result.error);
        }
        doc = result.value;
      }

      if (args.json) {
        const data =
          supersedeError !== undefined
            ? {
                ...doc,
                supersede_error: supersedeError,
                supersede_repair_command: renderSupersedeRepairMessage(args.supersedes!, doc.slug),
              }
            : doc;
        printLine(inv.io.stdout, 
          JSON.stringify(
            { ok: true, data },
            null,
            2,
          ),
        );
      } else {
        printLine(inv.io.stdout, `Created ${doc.type} document`);
        printLine(inv.io.stdout, `  ID:     ${doc.id}`);
        printLine(inv.io.stdout, `  Slug:   ${doc.slug}`);
        printLine(inv.io.stdout, `  Title:  ${doc.title}`);
        printLine(inv.io.stdout, `  Status: ${doc.status} (v${doc.version})`);
        if (issueRefs.length > 0) printLine(inv.io.stdout, `  Issues: ${issueRefs.map((ref) => `#${ref.number}`).join(", ")}`);
        printLine(inv.io.stdout, `\nRun \`lore get ${doc.slug}\` to view the document.`);
      }

      let reported: ExitReport = 0;

      // Loud orphan (D11, never silent) — create succeeded but the follow-up
      // invalidate() failed. The new doc is real (already printed above); report a
      // nonzero exit naming the EXACT repair command.
      if (supersedeError !== undefined) {
        const repairMsg = renderSupersedeRepairMessage(args.supersedes!, doc.slug);
        inv.io.stderr.write(`Error: ${repairMsg}\n  (invalidate failed: ${formatErrorFor(inv, supersedeError)})\n`);
        reported = exitCode(supersedeError);
      }

      // Non-resolving `file_anchors` advisory (task-a-mistyped-task-file-anchor-
      // is-stored-and-consulted, Required #1). Reads the STORED, normalized
      // anchors off the created doc — never the raw `--anchor` strings — so what
      // is probed is exactly what the `noAnchorOverlap` gate will consult.
      // Non-blocking by construction: stderr only (the --json payload above is
      // already printed and stays uncorrupted), exit code untouched, and the
      // anchor is stored either way — a task legitimately anchors a file it is
      // about to create (see collectFileAnchorResolution's module header).
      const declaredAnchors = extractFileAnchors(doc as DocRecord);
      if (declaredAnchors.length > 0) {
        const report = collectFileAnchorResolution(declaredAnchors, buildFileAnchorProbeContext(inv.cwd));
        for (const line of renderFileAnchorAdvisory(report, { subject: doc.slug })) {
          inv.io.stderr.write(line + "\n");
        }
      }
      return reported;
    } finally {
      app.close();
    }
  },
});

/**
 * Assemble the `extra` payload for types that require it.
 * Returns undefined for types that carry no type-specific extra fields (prd, plan).
 * For tasks: includes plan_id (required), optionally phase (SPEC-023 AC-PHASE-2),
 * and optionally file_anchors (SPEC-042 D3 — the RAW `--anchor` strings are passed
 * through untouched here; validation + normalization happens in
 * `CorpusService._createImpl`, the single enforcement gate — never re-derived here).
 * For specs: includes spec_kind ONLY when --kind was passed explicitly — the "feature"
 * default is materialized service-side (CorpusService._createImpl), not here, so an
 * omitted --kind still returns undefined rather than pre-baking the default (SPEC-032 §3.1).
 * An invalid --kind value is passed through unvalidated; createDocInputSchema's superRefine
 * rejects it with VALIDATION_ERROR (exit 4) — see module header. Also includes
 * code_anchors ONLY when --code-anchor was passed (repeatable, `path[#Symbol]`
 * grammar — SPEC-045 D1/D6, a DISTINCT flag from task's `--anchor`); the RAW
 * strings pass through untouched here too — `CorpusService._createImpl`'s D6a
 * grammar branch is the single enforcement gate.
 * For plans: includes requires_uat ONLY when --requires-uat was passed AND true
 * (SPEC-058 hotfix) — `--requires-uat=false` or an omitted flag both leave the
 * plan's extra undefined, byte-identical to pre-hotfix behavior (REGRESSION).
 * For tasks (SPEC-069 D2/D3): includes adhoc ONLY when --adhoc was passed AND
 * true (extra.adhoc = true; `--adhoc=false`/omitted leaves it unset, same
 * "only-true-is-meaningful" shape as requires_uat above) and linkage ONLY
 * when --linkage was passed (stored VERBATIM — no trim, unlike phase, since
 * this is free-text justification prose, not a lookup key). An --adhoc task
 * has no planId, so the extra-object branch below fires on `adhoc === true`
 * as an ALTERNATIVE to the pre-SPEC-069 `planId !== undefined` gate, not a
 * replacement of it — a --plan-id task without --adhoc is unaffected.
 * For tasks (spec-declared-scope-attestation-contract-task-owned-ac-scope,
 * extended by spec-declaring-ac-scope-is-required-at-task-creation-so-the
 * §Design Decisions D2): includes ac_scope iff `--ac-scope` was PASSED at
 * least once (`acScope.passed`, resolved by `resolveAcScopeForCreate` —
 * `create-task-validation.ts`) — an omitted flag leaves the key ABSENT
 * (nobody declared a scope); a passed flag stores `acScope.ids` VERBATIM,
 * which is `[]` when every occurrence was empty/whitespace-only (an author
 * explicitly declaring "this task claims nothing", D2 — a state DISTINCT
 * from absent, not the "always non-empty" shape the pre-existing comment
 * here described before this task landed).
 */
function buildExtra(
  docType: DocType,
  decisionStatus: string | undefined,
  subType: string | undefined,
  planId: string | undefined,
  phase?: string,
  specKind?: string,
  anchors?: string[],
  codeAnchors?: string[],
  requiresUat?: boolean,
  adhoc?: boolean,
  linkage?: string,
  acScope?: ResolvedAcScope,
  governingSpec?: string,
): Record<string, unknown> | undefined {
  if (docType === "adr" && decisionStatus !== undefined) {
    return { decision_status: decisionStatus };
  }
  if (docType === "knowledge" && subType !== undefined) {
    return { sub_type: subType };
  }
  if (docType === "task" && (planId !== undefined || adhoc === true)) {
    const extra: Record<string, unknown> = {};
    if (planId !== undefined) extra["plan_id"] = planId;
    if (adhoc === true) extra["adhoc"] = true;
    // BR-1495: the service (CorpusService._createImpl) checks and normalizes it; the CLI only forwards.
    if (adhoc === true && governingSpec !== undefined) extra["governing_spec"] = governingSpec;
    if (linkage !== undefined) extra["linkage"] = linkage;
    if (phase !== undefined) {
      extra["phase"] = phase.trim();
    }
    if (anchors !== undefined && anchors.length > 0) {
      extra["file_anchors"] = anchors;
    }
    // Only a PASSED --ac-scope writes the key. An omitted flag leaves it
    // ABSENT, never `[]`: absent means nobody declared a scope, `[]` means an
    // author declared this task claims nothing (either via `--ac-scope ""`
    // at create time, spec-declaring-ac-scope-is-required-at-task-creation-
    // so-the §Design Decisions D2, or via `lore scope rm` of the final id
    // post-create), and the two get different refusals from `lore verify`
    // (spec-declared-scope-attestation-contract-task-owned-ac-scope §Contract
    // Details).
    if (acScope !== undefined && acScope.passed) {
      extra["ac_scope"] = acScope.ids;
    }
    return extra;
  }
  if (docType === "spec") {
    const extra: Record<string, unknown> = {};
    if (specKind !== undefined) extra["spec_kind"] = specKind;
    if (codeAnchors !== undefined && codeAnchors.length > 0) extra["code_anchors"] = codeAnchors;
    return Object.keys(extra).length > 0 ? extra : undefined;
  }
  if (docType === "plan" && requiresUat === true) {
    return { requires_uat: true };
  }
  return undefined;
}
