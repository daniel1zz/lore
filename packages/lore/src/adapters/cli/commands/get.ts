/**
 * lore get <id-or-slug> — display a document with navigation footer.
 *
 * MDX placeholder splicing (SPEC-032 §3.3): unless --raw, this command calls
 * OutlineService.resolve(doc) itself and feeds the result into
 * renderResolvedToMarkdown() before printing — the same adapter-level thin-pipe
 * pattern already used by the HTTP (`?resolveMdx=true`) and MCP (`lore_get`)
 * surfaces. CorpusService.get() does NOT perform this resolution (see its
 * GetOpts.resolve_mdx JSDoc) — services never cross-import, so the splice must
 * happen here, not inside CorpusService.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatNavigation } from "../utils.js";
import { renderResolvedToMarkdown } from "../../../service/outline-service.js";
import type { ResolvedComponent } from "../../../service/outline-service.js";

export default defineCommand({
  meta: {
    name: "get",
    description: "Get a document by ID or slug",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID or slug",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    raw: {
      type: "boolean",
      description: "Skip MDX resolution",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      const result = await app.corpusService.get(args.id);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const { doc, navigation } = result.value;

      // Splice MDX placeholders unless --raw. A resolution failure (store error)
      // degrades to the raw body rather than aborting `get` — the doc + navigation
      // are still valuable output even if placeholder data couldn't be fetched.
      let displayBody = doc.content;
      let resolvedComponents: ResolvedComponent[] | undefined;
      if (!args.raw) {
        const resolveResult = await app.outlineService.resolve(doc);
        if (resolveResult.ok) {
          resolvedComponents = resolveResult.value.resolvedComponents;
          displayBody = renderResolvedToMarkdown(resolveResult.value);
        }
      }

      if (args.json) {
        const data = resolvedComponents !== undefined
          ? { ...result.value, resolved_components: resolvedComponents }
          : result.value;
        console.log(JSON.stringify({ ok: true, data }, null, 2));
        return;
      }

      // Human-readable display
      const divider = "─".repeat(60);
      console.log(`── ${doc.id.slice(0, 8)}… ${doc.title} ${divider.slice(0, 40)}`);
      console.log(
        `Type: ${doc.type} | Status: ${doc.status} | Priority: ${doc.priority} | v${doc.version}`,
      );
      console.log(
        `Created: ${doc.created_at.slice(0, 10)} by ${doc.created_by} | Updated: ${doc.updated_at.slice(0, 10)}`,
      );
      if (doc.tags.length > 0) {
        console.log(`Tags: ${doc.tags.join(", ")}`);
      }
      console.log("");
      console.log(displayBody || "(no content)");
      console.log("");
      console.log(formatNavigation(navigation));
    } finally {
      app.close();
    }
  },
});
