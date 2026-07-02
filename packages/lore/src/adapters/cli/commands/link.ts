/**
 * lore link <from> <to> [--type <type>] [--infer] — create a link between two documents.
 *
 * Manual mode (default):
 *   Requires --type <link_type>. Valid types: parent | implements | informs |
 *   supersedes | relates-to | blocks. Defaults to "relates-to" when omitted.
 *
 * AI inference mode (SPEC-019 AC-LINK-AI-1):
 *   --infer: ask the AI provider to pick the link type from both documents' titles
 *   and first 500 chars of body. Parses the provider's response (trim + lowercase +
 *   linkTypeSchema.safeParse). Invalid response → exit 6, no link created.
 *   --infer is always an explicit AI request — no resolveAiDefault surface check;
 *   the flag itself is the user's opt-in (there is no default AI in lore link).
 *   Valid link type returned but link would cycle → exit 4 (CorpusService.link enforces).
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import type { LinkType } from "@lore/core";

const VALID_LINK_TYPES: LinkType[] = [
  "parent",
  "implements",
  "informs",
  "supersedes",
  "relates-to",
  "blocks",
];

export default defineCommand({
  meta: {
    name: "link",
    description: "Create a link between two documents",
  },
  args: {
    from: {
      type: "positional",
      description: "Source document ID or slug",
      required: true,
    },
    to: {
      type: "positional",
      description: "Target document ID or slug",
      required: true,
    },
    type: {
      type: "string",
      description: `Link type: ${VALID_LINK_TYPES.join(" | ")} (default: relates-to)`,
      default: "relates-to",
    },
    infer: {
      type: "boolean",
      description:
        "Use AI to infer the link type from both documents' content. " +
        "Mutually exclusive with --type when --infer is explicit. " +
        "Invalid AI response → exit 6.",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const hasInfer = args.infer === true;

    const { app } = loadLoreApp();
    try {
      // ─── AI inference path (SPEC-019 AC-LINK-AI-1) ────────────────────────────
      if (hasInfer) {
        const showSpinner = process.stderr.isTTY && !args.json;

        // Fetch both documents for AI context
        const fromResolve = await app.corpusService.resolve(args.from);
        if (!fromResolve.ok) {
          process.stderr.write(formatError(fromResolve.error) + "\n");
          process.exitCode = exitCode(fromResolve.error);
          return;
        }
        const fromGet = await app.corpusService.get(fromResolve.value);
        if (!fromGet.ok) {
          process.stderr.write(formatError(fromGet.error) + "\n");
          process.exitCode = exitCode(fromGet.error);
          return;
        }
        const fromDoc = fromGet.value.doc;

        const toResolve = await app.corpusService.resolve(args.to);
        if (!toResolve.ok) {
          process.stderr.write(formatError(toResolve.error) + "\n");
          process.exitCode = exitCode(toResolve.error);
          return;
        }
        const toGet = await app.corpusService.get(toResolve.value);
        if (!toGet.ok) {
          process.stderr.write(formatError(toGet.error) + "\n");
          process.exitCode = exitCode(toGet.error);
          return;
        }
        const toDoc = toGet.value.doc;

        if (showSpinner) {
          process.stderr.write(
            `⏳ Inferring link type via ${app.aiProviderService.activeProviderName}...\n`,
          );
        }

        const inferResult = await app.aiProviderService.inferLinkType(fromDoc, toDoc, {
          caller_surface: app.callerSurface,
        });

        if (!inferResult.ok) {
          // reason: invalid link type or provider error → exit 6 (AI_PROVIDER_ERROR),
          // consistent with AC-LINK-AI-2 and AC-AI-FAIL-1. No link is created.
          process.stderr.write(formatError(inferResult.error) + "\n");
          process.exitCode = exitCode(inferResult.error);
          return;
        }

        const inferredType = inferResult.value.linkType;

        if (showSpinner) {
          process.stderr.write(`✓ Inferred link type: ${inferredType}\n`);
        }

        // Create the link with the inferred type (CorpusService.link enforces cycle check → exit 4)
        const linkResult = await app.corpusService.link(args.from, args.to, inferredType);
        if (!linkResult.ok) {
          process.stderr.write(formatError(linkResult.error) + "\n");
          process.exitCode = exitCode(linkResult.error);
          return;
        }

        const link = linkResult.value;
        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: link }, null, 2));
        } else {
          console.log(
            `Linked ${link.from_id.slice(0, 8)}… → ${link.to_id.slice(0, 8)}… ` +
              `(${link.link_type}) [inferred]`,
          );
        }
        return;
      }

      // ─── Manual path (unchanged from pre-SPEC-019) ────────────────────────────
      const linkType = (args.type ?? "relates-to") as LinkType;

      if (!VALID_LINK_TYPES.includes(linkType)) {
        process.stderr.write(
          `Error: Invalid link type '${linkType}'. Valid types: ${VALID_LINK_TYPES.join(", ")}\n`,
        );
        process.exit(2);
      }

      const result = await app.corpusService.link(args.from, args.to, linkType);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const link = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: link }, null, 2));
      } else {
        console.log(`Linked ${link.from_id.slice(0, 8)}… → ${link.to_id.slice(0, 8)}… (${link.link_type})`);
      }
    } finally {
      app.close();
    }
  },
});
