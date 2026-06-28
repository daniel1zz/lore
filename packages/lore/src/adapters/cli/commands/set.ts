/**
 * lore set <id> — update specific fields on a document.
 *
 * Editor flow (SPEC-003 §3.1, AC-SET-1):
 *   When no flags are provided, fetches the current doc, opens defaults.editor / $EDITOR / vi
 *   pre-populated with the current content. If the user saves unchanged content, prints
 *   "no changes" and exits 0 without bumping the version number.
 *
 * Non-editor flow (AC-SET-2):
 *   When any of --title, --status, --content, --content-file, --priority, --tags is provided,
 *   applies those fields directly via corpusService.set() (no editor is opened).
 *
 * --content-file <path>:
 *   Reads the file at <path> and uses its full contents as the new content.
 *   Workaround for Bug A: citty/mri treats `---` as an option terminator when it appears
 *   as the value of a `--content VALUE` pair. --content-file avoids this by reading from disk.
 *   Mutually exclusive with --content (exit 2 if both passed).
 *   File not found or unreadable → exit 4 (VALIDATION_ERROR).
 */

import { readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { openEditor } from "../editor.js";
import type { DocStatus, Priority } from "@lore/core";

export default defineCommand({
  meta: {
    name: "set",
    description: "Update specific fields on a document",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID or slug",
      required: true,
    },
    title: {
      type: "string",
      description: "New title",
    },
    status: {
      type: "string",
      description: "New status: draft | in-review | approved | active | archived | deprecated",
    },
    content: {
      type: "string",
      description: "New content (markdown)",
    },
    "content-file": {
      type: "string",
      description:
        "Path to file whose full contents become the new content. Mutually exclusive with --content.",
    },
    priority: {
      type: "string",
      description: "New priority: critical | high | medium | low",
    },
    tags: {
      type: "string",
      description: "Comma-separated tags (replaces existing)",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    // Mutex guard: --content and --content-file are mutually exclusive (exit 2 per Bug A spec).
    if (args.content !== undefined && args["content-file"] !== undefined) {
      process.stderr.write(
        "Error: --content and --content-file are mutually exclusive. Pass only one.\n",
      );
      process.exit(2);
    }

    const { app, defaults } = loadLoreApp();
    try {
      const patch: Record<string, unknown> = {};
      if (args.title !== undefined) patch["title"] = args.title;
      if (args.status !== undefined) patch["status"] = args.status as DocStatus;
      if (args.content !== undefined) patch["content"] = args.content;
      // reason: --content-file reads from disk and assigns as content, bypassing the mri
      // argv-terminator bug that drops content starting with `---` (Bug A fix, SPEC-003 §3.1).
      if (args["content-file"] !== undefined) {
        let fileContent: string;
        try {
          fileContent = readFileSync(args["content-file"], "utf8");
        } catch (e) {
          process.stderr.write(
            `Error: cannot read --content-file '${args["content-file"]}': ${e instanceof Error ? e.message : String(e)}\n`,
          );
          process.exitCode = 4;
          return;
        }
        patch["content"] = fileContent;
      }
      if (args.priority !== undefined) patch["priority"] = args.priority as Priority;
      if (args.tags !== undefined) {
        patch["tags"] = args.tags.split(",").map((t: string) => t.trim()).filter(Boolean);
      }

      if (Object.keys(patch).length === 0) {
        // No flags provided — open editor pre-populated with current content (AC-SET-1)
        const resolvedId = await app.corpusService.resolve(args.id);
        if (!resolvedId.ok) {
          process.stderr.write(formatError(resolvedId.error) + "\n");
          process.exitCode = exitCode(resolvedId.error);
          return;
        }
        const getResult = await app.corpusService.get(resolvedId.value);
        if (!getResult.ok) {
          process.stderr.write(formatError(getResult.error) + "\n");
          process.exitCode = exitCode(getResult.error);
          return;
        }
        const currentDoc = getResult.value.doc;

        const editorResult = await openEditor({
          initialContent: currentDoc.content,
          defaults,
        });
        if (!editorResult.ok) {
          process.stderr.write(formatError(editorResult.error) + "\n");
          process.exitCode = exitCode(editorResult.error);
          return;
        }

        const newContent = editorResult.value;

        // If the content is unchanged, skip the service call entirely (AC-SET-1)
        if (newContent === currentDoc.content) {
          process.stdout.write("no changes\n");
          return;
        }

        patch["content"] = newContent;
      }

      const result = await app.corpusService.set(args.id, patch);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Updated ${doc.slug} → v${doc.version}`);
      }
    } finally {
      app.close();
    }
  },
});
