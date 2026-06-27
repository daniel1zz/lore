/**
 * lore set <id> — update specific fields on a document.
 *
 * Editor flow (SPEC-003 §3.1, AC-SET-1):
 *   When no flags are provided, fetches the current doc, opens defaults.editor / $EDITOR / vi
 *   pre-populated with the current content. If the user saves unchanged content, prints
 *   "no changes" and exits 0 without bumping the version number.
 *
 * Non-editor flow (AC-SET-2):
 *   When any of --title, --status, --content, --priority, --tags is provided, applies
 *   those fields directly via corpusService.set() (no editor is opened).
 */

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
    const { app, defaults } = loadLoreApp();
    try {
      const patch: Record<string, unknown> = {};
      if (args.title !== undefined) patch["title"] = args.title;
      if (args.status !== undefined) patch["status"] = args.status as DocStatus;
      if (args.content !== undefined) patch["content"] = args.content;
      if (args.priority !== undefined) patch["priority"] = args.priority as Priority;
      if (args.tags !== undefined) {
        patch["tags"] = args.tags.split(",").map((t: string) => t.trim()).filter(Boolean);
      }

      if (Object.keys(patch).length === 0) {
        // No flags provided — open editor pre-populated with current content (AC-SET-1)
        const resolvedId = await app.corpusService.resolve(args.id);
        if (!resolvedId.ok) {
          process.stderr.write(formatError(resolvedId.error) + "\n");
          process.exit(exitCode(resolvedId.error));
        }
        const getResult = await app.corpusService.get(resolvedId.value);
        if (!getResult.ok) {
          process.stderr.write(formatError(getResult.error) + "\n");
          process.exit(exitCode(getResult.error));
        }
        const currentDoc = getResult.value.doc;

        const editorResult = await openEditor({
          initialContent: currentDoc.content,
          defaults,
        });
        if (!editorResult.ok) {
          process.stderr.write(formatError(editorResult.error) + "\n");
          process.exit(exitCode(editorResult.error));
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
        process.exit(exitCode(result.error));
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
