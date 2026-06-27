/**
 * lore create <type> — create a new document.
 *
 * Type-specific required flags:
 *   adr       → --decision-status (proposed|accepted|deprecated|superseded)
 *   knowledge → --sub-type (ideation|retro|research|reference)
 *   task      → --parent <plan-slug-or-id> AND --plan-id <plan-slug-or-id>
 *
 * Editor flow (SPEC-003 §3.1):
 *   When --content is omitted, opens defaults.editor / $EDITOR / vi for the doc body.
 *   --content "" is accepted as explicit empty body (bypasses editor).
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { openEditor } from "../editor.js";
import type { DocType, Priority } from "@lore/core";

const VALID_TYPES: DocType[] = ["prd", "spec", "adr", "plan", "knowledge", "task"];

const ADR_DECISION_STATUSES = ["proposed", "accepted", "deprecated", "superseded"] as const;
type AdrDecisionStatus = (typeof ADR_DECISION_STATUSES)[number];

const KNOWLEDGE_SUB_TYPES = ["ideation", "retro", "research", "reference"] as const;
type KnowledgeSubType = (typeof KNOWLEDGE_SUB_TYPES)[number];

/** Flags that are only meaningful for specific types. Used to detect mismatches. */
const TYPE_SPECIFIC_FLAGS: Readonly<Record<string, readonly DocType[]>> = {
  "decision-status": ["adr"],
  "sub-type": ["knowledge"],
  "plan-id": ["task"],
};

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

    const { app, defaults } = loadLoreApp();
    try {
      const tags = args.tags
        ? args.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : [];

      // Editor flow (AC-CR-1/2): open editor when --content flag was not provided at all.
      // args.content === undefined means the flag was absent (citty does not set it).
      // args.content === "" means --content "" was passed explicitly → accepted as empty body.
      let resolvedContent: string | undefined = args.content;
      if (resolvedContent === undefined) {
        const editorResult = await openEditor({ defaults });
        if (!editorResult.ok) {
          process.stderr.write(formatError(editorResult.error) + "\n");
          process.exit(exitCode(editorResult.error));
        }
        resolvedContent = editorResult.value;
      }

      // Resolve --plan-id slug or ULID → canonical ULID before building extra
      let resolvedPlanId: string | undefined;
      if (docType === "task" && args["plan-id"]) {
        const planResolve = await app.corpusService.resolve(args["plan-id"]);
        if (!planResolve.ok) {
          process.stderr.write(formatError(planResolve.error) + "\n");
          process.exit(exitCode(planResolve.error));
        }
        resolvedPlanId = planResolve.value;
      }

      // Assemble type-specific extra object
      const extra = buildExtra(
        docType,
        args["decision-status"],
        args["sub-type"],
        resolvedPlanId,
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
        process.exit(exitCode(result.error));
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
 * Returns undefined for types that carry no type-specific extra fields (prd, spec, plan).
 */
function buildExtra(
  docType: DocType,
  decisionStatus: string | undefined,
  subType: string | undefined,
  planId: string | undefined,
): Record<string, unknown> | undefined {
  if (docType === "adr" && decisionStatus !== undefined) {
    return { decision_status: decisionStatus };
  }
  if (docType === "knowledge" && subType !== undefined) {
    return { sub_type: subType };
  }
  if (docType === "task" && planId !== undefined) {
    return { plan_id: planId };
  }
  return undefined;
}
