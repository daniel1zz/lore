/**
 * lore create <type> — create a new document.
 *
 * Type-specific required flags:
 *   adr       → --decision-status (proposed|accepted|deprecated|superseded)
 *   knowledge → --sub-type (ideation|retro|research|reference)
 *   task      → --parent <plan-slug-or-id> AND --plan-id <plan-slug-or-id>
 *
 * Type-specific OPTIONAL flags:
 *   spec      → --kind (feature|tech|design); defaults to "feature" when omitted
 *               (materialized by CorpusService._createImpl, not this command).
 *               An invalid value flows through to createDocInputSchema and surfaces
 *               as VALIDATION_ERROR (exit 4) — unlike --decision-status/--sub-type,
 *               --kind is NOT pre-validated here since it is optional, not required.
 *               Source: SPEC-032 §3.1
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
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { openEditor } from "../editor.js";
import type { DocType, KnowledgeSubType, Priority } from "@lore/core";
import { KNOWLEDGE_SUB_TYPES, SPEC_KINDS } from "@lore/core";

const VALID_TYPES: DocType[] = ["prd", "spec", "adr", "plan", "knowledge", "task"];

const ADR_DECISION_STATUSES = ["proposed", "accepted", "deprecated", "superseded"] as const;
type AdrDecisionStatus = (typeof ADR_DECISION_STATUSES)[number];

// reason: SPEC-041 §3 D4 drive-by SSOT repair — this list used to be a hand-copied
// literal that had already drifted from `@lore/core`'s `KNOWLEDGE_SUB_TYPES` (missing
// "prompt"/"skill"). Now imported directly so CLI validation can never diverge again.
// "assessment"/"handoff" are listed for --help discoverability but are NOT manually
// completable via this command:
//   - "assessment" — knowledgeExtraSchema's superRefine requires a Zod-valid
//     extra.assessment payload that `lore create` has no flag to supply; only
//     `lore assess` writes sub_type="assessment" docs.
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
};

/** citty/mri yields a single string for one occurrence of a repeatable flag, an array for ≥2, or `undefined` for zero. Normalizes to a string array. */
function normalizeRepeatable(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

export default defineCommand({
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
      description: "Parent document ID or slug",
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
        "[task only, repeatable] Declare a file_anchors entry (repo-relative POSIX path; trailing '/' = directory scope). Validated + normalized by CorpusService (SPEC-042 D3).",
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
  async run({ args }) {
    const docType = args.type as DocType;

    if (!VALID_TYPES.includes(docType)) {
      process.stderr.write(
        `Error: Invalid type '${args.type}'. Valid types: ${VALID_TYPES.join(", ")}\n`,
      );
      process.exit(2);
    }

    if (!args.title) {
      process.stderr.write("Error: --title is required.\n");
      process.exit(2);
    }

    // Reject empty string passed explicitly to --parent (citty parses "" as string "").
    if (args.parent !== undefined && args.parent.trim() === "") {
      process.stderr.write(
        "Error: --parent received empty string. Pass a valid document ID or slug, or omit the flag.\n",
      );
      process.exit(2);
    }

    // Reject type-flag mismatches: e.g. `lore create prd --decision-status accepted`
    for (const [flag, allowedTypes] of Object.entries(TYPE_SPECIFIC_FLAGS)) {
      const flagValue = args[flag as keyof typeof args];
      if (flagValue !== undefined && !allowedTypes.includes(docType)) {
        process.stderr.write(
          `Error: --${flag} is only valid for type(s): ${allowedTypes.join(", ")} (got '${docType}').\n`,
        );
        process.exit(2);
      }
    }

    // Validate type-specific required flags before hitting the service layer
    if (docType === "adr") {
      const ds = args["decision-status"];
      if (!ds) {
        process.stderr.write(
          `Error: --decision-status is required for type 'adr'.\n` +
            `  Valid values: ${ADR_DECISION_STATUSES.join(" | ")}\n`,
        );
        process.exit(2);
      }
      if (!ADR_DECISION_STATUSES.includes(ds as AdrDecisionStatus)) {
        process.stderr.write(
          `Error: Invalid --decision-status '${ds}'.\n` +
            `  Valid values: ${ADR_DECISION_STATUSES.join(" | ")}\n`,
        );
        process.exit(2);
      }
    }

    if (docType === "knowledge") {
      const st = args["sub-type"];
      if (!st) {
        process.stderr.write(
          `Error: --sub-type is required for type 'knowledge'.\n` +
            `  Valid values: ${KNOWLEDGE_SUB_TYPES.join(" | ")}\n`,
        );
        process.exit(2);
      }
      if (!KNOWLEDGE_SUB_TYPES.includes(st as KnowledgeSubType)) {
        process.stderr.write(
          `Error: Invalid --sub-type '${st}'.\n` +
            `  Valid values: ${KNOWLEDGE_SUB_TYPES.join(" | ")}\n`,
        );
        process.exit(2);
      }
    }

    if (docType === "task" && !args["plan-id"]) {
      process.stderr.write(
        `Error: --plan-id is required for type 'task'.\n` +
          `  Pass the plan document's ID or slug.\n`,
      );
      process.exit(2);
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
    const _rawArgv = process.argv.slice(2);
    const _hasExplicitAi = _rawArgv.includes("--ai");
    const _hasExplicitNoAi = _rawArgv.includes("--no-ai");

    if (_hasExplicitAi && _hasExplicitNoAi) {
      process.stderr.write(
        "Error: --ai and --no-ai are mutually exclusive. Pass only one.\n",
      );
      process.exit(2);
    }

    const explicitAi: boolean | undefined = _hasExplicitAi
      ? true
      : _hasExplicitNoAi
        ? false
        // fallback: use citty-parsed args.ai (valid for programmatic invocation where
        // process.argv was not set; undefined when flag not present since no default).
        : (args.ai as boolean | undefined);

    const { app, defaults } = loadLoreApp();
    try {
      const tags = args.tags
        ? args.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : [];

      // Mutex guard: --content and --content-file are mutually exclusive (exit 2 per Bug A spec).
      if (args.content !== undefined && args["content-file"] !== undefined) {
        process.stderr.write(
          "Error: --content and --content-file are mutually exclusive. Pass only one.\n",
        );
        process.exit(2);
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
      // reason: --content-file reads from disk and assigns as content, bypassing the mri
      // argv-terminator bug that drops content starting with `---` (Bug A fix, SPEC-003 §3.1).
      if (resolvedContent === undefined && args["content-file"] !== undefined) {
        try {
          resolvedContent = readFileSync(args["content-file"], "utf8");
        } catch (e) {
          process.stderr.write(
            `Error: cannot read --content-file '${args["content-file"]}': ${e instanceof Error ? e.message : String(e)}\n`,
          );
          process.exitCode = 4;
          return;
        }
      }
      if (resolvedContent === undefined) {
        // SPEC-024: resolve AI default from surface + explicit flag + config
        const { ai: useAi, source: aiSource } = app.resolveAiDefault(explicitAi);

        if (!useAi) {
          // No-AI path: fall back to editor (SPEC-003 §3.1 / AC-AI-2)
          const editorResult = await openEditor({ defaults });
          if (!editorResult.ok) {
            process.stderr.write(formatError(editorResult.error) + "\n");
            process.exitCode = exitCode(editorResult.error);
            return;
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

          const showSpinner = process.stderr.isTTY && !args.json;
          const aiService = app.aiProviderService;
          if (showSpinner) {
            process.stderr.write(`⏳ Generating via ${aiService.activeProviderName}...\n`);
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
            process.stderr.write(formatError(aiResult.error) + "\n");
            process.exitCode = exitCode(aiResult.error);
            return;
          }

          resolvedContent = aiResult.value.content;
          if (showSpinner) {
            process.stderr.write(
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
          process.stderr.write(formatError(planResolve.error) + "\n");
          process.exitCode = exitCode(planResolve.error);
          return;
        }
        resolvedPlanId = planResolve.value;
      }

      // Assemble type-specific extra object
      const extra = buildExtra(
        docType,
        args["decision-status"],
        args["sub-type"],
        resolvedPlanId,
        args.phase,
        args.kind,
        normalizeRepeatable(args.anchor),
      );

      const result = await app.corpusService.create({
        type: docType,
        title: args.title,
        ...(args.parent !== undefined ? { parent_id: args.parent } : {}),
        content: resolvedContent,
        priority: (args.priority as Priority) ?? "medium",
        ...(tags.length > 0 ? { tags } : {}),
        ...(extra !== undefined ? { extra } : {}),
      });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Created ${doc.type} document`);
        console.log(`  ID:     ${doc.id}`);
        console.log(`  Slug:   ${doc.slug}`);
        console.log(`  Title:  ${doc.title}`);
        console.log(`  Status: ${doc.status} (v${doc.version})`);
        console.log(`\nRun \`lore get ${doc.slug}\` to view the document.`);
      }
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
 * rejects it with VALIDATION_ERROR (exit 4) — see module header.
 */
function buildExtra(
  docType: DocType,
  decisionStatus: string | undefined,
  subType: string | undefined,
  planId: string | undefined,
  phase?: string,
  specKind?: string,
  anchors?: string[],
): Record<string, unknown> | undefined {
  if (docType === "adr" && decisionStatus !== undefined) {
    return { decision_status: decisionStatus };
  }
  if (docType === "knowledge" && subType !== undefined) {
    return { sub_type: subType };
  }
  if (docType === "task" && planId !== undefined) {
    const extra: Record<string, unknown> = { plan_id: planId };
    if (phase !== undefined) {
      extra["phase"] = phase.trim();
    }
    if (anchors !== undefined && anchors.length > 0) {
      extra["file_anchors"] = anchors;
    }
    return extra;
  }
  if (docType === "spec" && specKind !== undefined) {
    return { spec_kind: specKind };
  }
  return undefined;
}
