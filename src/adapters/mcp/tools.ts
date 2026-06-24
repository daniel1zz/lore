/**
 * MCP tool registrations — all 16 lore_* tools.
 * Each tool: parse Zod schema → call service → return MCP content.
 * Error handling: Result.error → { isError: true, content: [text] }
 * Source: SPEC-008 §3
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { App } from "../../app.js";
import type { LoreError } from "../../core/errors.js";
import { CORPUS_SCHEMA_INFO } from "./schema-info.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function textContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorContent(error: LoreError) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(error) }],
    isError: true as const,
  };
}

// ─── Tool Registrations ──────────────────────────────────────────────────────

export function registerTools(server: McpServer, app: App): void {
  const { corpusService, versionService, reviewService, outlineService } = app;

  // lore_create
  server.tool(
    "lore_create",
    "Create a new document in the Lore corpus",
    {
      type: z.enum(["prd", "spec", "adr", "plan", "knowledge", "task"]),
      title: z.string().min(1),
      content: z.string().optional(),
      parent_id: z.string().optional(),
      tags: z.array(z.string()).optional(),
      extra: z.record(z.unknown()).optional(),
    },
    async (args) => {
      const result = await corpusService.create(args);
      if (!result.ok) return errorContent(result.error);
      const { id, slug, type, status, version } = result.value;
      return textContent({ id, slug, type, status, version });
    },
  );

  // lore_get
  server.tool(
    "lore_get",
    "Get a document by ID or slug, with optional navigation and MDX resolution",
    {
      id_or_slug: z.string(),
      resolve_mdx: z.boolean().optional(),
      include_navigation: z.boolean().optional(),
    },
    async (args) => {
      const result = await corpusService.get(args.id_or_slug, {
        resolve_mdx: args.resolve_mdx,
      });
      if (!result.ok) return errorContent(result.error);

      const payload: Record<string, unknown> = { doc: result.value.doc };
      if (args.include_navigation !== false) {
        payload["navigation"] = result.value.navigation;
      }

      if (args.resolve_mdx) {
        const resolveResult = await outlineService.resolve(result.value.doc);
        if (resolveResult.ok) {
          payload["resolved_components"] = resolveResult.value.resolvedComponents;
        }
      }

      return textContent(payload);
    },
  );

  // lore_set
  server.tool(
    "lore_set",
    "Patch (update) an existing document",
    {
      id_or_slug: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
      status: z
        .enum(["draft", "in-review", "approved", "active", "archived", "deprecated"])
        .optional(),
      tags: z.array(z.string()).optional(),
      extra: z.record(z.unknown()).optional(),
      slug: z.string().optional(),
    },
    async (args) => {
      const { id_or_slug, ...patch } = args;
      const result = await corpusService.set(id_or_slug, patch);
      if (!result.ok) return errorContent(result.error);
      return textContent({ doc: result.value, version: result.value.version });
    },
  );

  // lore_delete
  server.tool(
    "lore_delete",
    "Soft-delete a document (requires confirm: true)",
    {
      id_or_slug: z.string(),
      confirm: z.literal(true),
    },
    async (args) => {
      const result = await corpusService.delete(args.id_or_slug, args.confirm);
      if (!result.ok) return errorContent(result.error);
      return textContent(result.value);
    },
  );

  // lore_list
  server.tool(
    "lore_list",
    "List documents matching optional filters",
    {
      type: z
        .enum(["prd", "spec", "adr", "plan", "knowledge", "task"])
        .optional(),
      status: z
        .enum(["draft", "in-review", "approved", "active", "archived", "deprecated"])
        .optional(),
      since: z.string().optional(),
      author: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().min(0).optional(),
    },
    async (args) => {
      const filters = {
        ...(args.type !== undefined ? { type: args.type } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.since !== undefined ? { since: args.since } : {}),
        ...(args.author !== undefined ? { created_by: args.author } : {}),
        ...(args.tag !== undefined ? { tags: [args.tag] } : {}),
      };
      const result = await corpusService.list(filters);
      if (!result.ok) return errorContent(result.error);

      const docs = args.limit !== undefined
        ? result.value.docs.slice(args.offset ?? 0, (args.offset ?? 0) + args.limit)
        : result.value.docs;

      return textContent({ docs, total: result.value.total });
    },
  );

  // lore_search
  server.tool(
    "lore_search",
    "Full-text search across the corpus",
    {
      query: z.string().min(1),
      type: z
        .enum(["prd", "spec", "adr", "plan", "knowledge", "task"])
        .optional(),
      limit: z.number().int().positive().optional(),
    },
    async (args) => {
      const filters = args.type !== undefined ? { type: args.type } : {};
      const result = await corpusService.search(args.query, filters);
      if (!result.ok) return errorContent(result.error);

      const results = args.limit !== undefined
        ? result.value.results.slice(0, args.limit)
        : result.value.results;

      return textContent({ results });
    },
  );

  // lore_tree
  server.tool(
    "lore_tree",
    "Get the document tree from a root (or first PRD)",
    {
      root: z.string().optional(),
      depth: z.number().int().positive().optional(),
    },
    async (args) => {
      const result = await corpusService.tree(args.root, { depth: args.depth });
      if (!result.ok) return errorContent(result.error);
      return textContent({ tree: result.value });
    },
  );

  // lore_link
  server.tool(
    "lore_link",
    "Create a link between two documents",
    {
      from: z.string(),
      to: z.string(),
      type: z
        .enum(["parent", "implements", "informs", "supersedes", "relates-to", "blocks"])
        .optional()
        .default("relates-to"),
    },
    async (args) => {
      const result = await corpusService.link(args.from, args.to, args.type);
      if (!result.ok) return errorContent(result.error);
      return textContent({ link: result.value });
    },
  );

  // lore_log
  server.tool(
    "lore_log",
    "Get version history for a document",
    {
      id_or_slug: z.string(),
      limit: z.number().int().positive().optional(),
    },
    async (args) => {
      const result = await versionService.log(args.id_or_slug, {
        limit: args.limit,
      });
      if (!result.ok) return errorContent(result.error);
      return textContent({ entries: result.value });
    },
  );

  // lore_diff
  server.tool(
    "lore_diff",
    "Compute a diff between two versions of a document",
    {
      id_or_slug: z.string(),
      from: z.number().int().positive().optional(),
      to: z.number().int().positive().optional(),
    },
    async (args) => {
      const result = await versionService.diff(args.id_or_slug, {
        from: args.from,
        to: args.to,
      });
      if (!result.ok) return errorContent(result.error);
      return textContent({ diff: result.value });
    },
  );

  // lore_pending
  server.tool(
    "lore_pending",
    "List documents pending review (status=draft)",
    {
      author: z.string().optional(),
      type: z
        .enum(["prd", "spec", "adr", "plan", "knowledge", "task"])
        .optional(),
    },
    async (args) => {
      const result = await reviewService.pending({
        author: args.author,
        type: args.type,
      });
      if (!result.ok) return errorContent(result.error);
      return textContent({ docs: result.value });
    },
  );

  // lore_approve
  server.tool(
    "lore_approve",
    "Approve a document, transitioning it from draft to approved",
    {
      id_or_slug: z.string(),
      reviewer: z.string().optional(),
    },
    async (args) => {
      const result = await reviewService.approve(args.id_or_slug, {
        reviewer: args.reviewer,
      });
      if (!result.ok) return errorContent(result.error);
      return textContent({ doc: result.value });
    },
  );

  // lore_schema — no input parameters, use 3-arg form to avoid ZodRawShapeCompat overload
  server.tool(
    "lore_schema",
    "Return static corpus schema information (doc types, link types, required fields)",
    async () => {
      return textContent(CORPUS_SCHEMA_INFO);
    },
  );

  // lore_context_bundle
  server.tool(
    "lore_context_bundle",
    "Get a document plus its parent, linked specs, related ADRs, and active plans",
    {
      id_or_slug: z.string(),
      max_depth: z.number().int().positive().optional(),
    },
    async (args) => {
      const targetResult = await corpusService.get(args.id_or_slug);
      if (!targetResult.ok) return errorContent(targetResult.error);

      const { doc, navigation } = targetResult.value;

      // Collect linked specs and related ADRs from navigation
      const linkedSpecs = navigation.related.filter((r) => r.type === "spec");
      const relatedAdrs = navigation.related.filter((r) => r.type === "adr");

      // Active plans
      const plansResult = await corpusService.list({ type: "plan", status: "active" });
      const activePlans = plansResult.ok ? plansResult.value.docs : [];

      return textContent({
        target: doc,
        linked_specs: linkedSpecs,
        related_adrs: relatedAdrs,
        active_plans: activePlans,
      });
    },
  );

  // lore_batch
  server.tool(
    "lore_batch",
    "Execute multiple operations in sequence",
    {
      operations: z.array(
        z.object({
          op: z.enum([
            "create",
            "get",
            "set",
            "delete",
            "list",
            "search",
            "link",
          ]),
          args: z.record(z.unknown()),
        }),
      ),
    },
    async (args) => {
      const results: unknown[] = [];

      for (const operation of args.operations) {
        const opResult = await executeBatchOp(operation.op, operation.args, app);
        results.push(opResult);
      }

      return textContent({ results });
    },
  );

  // lore_status — no input parameters, use 3-arg form to avoid ZodRawShapeCompat overload
  server.tool(
    "lore_status",
    "Get corpus statistics (total docs, by type, by status)",
    async () => {
      const result = await corpusService.status();
      if (!result.ok) return errorContent(result.error);
      return textContent(result.value);
    },
  );
}

// ─── Batch Operation Executor ────────────────────────────────────────────────

async function executeBatchOp(
  op: string,
  args: Record<string, unknown>,
  app: App,
): Promise<unknown> {
  const { corpusService } = app;

  switch (op) {
    case "create": {
      const r = await corpusService.create(args as Parameters<typeof corpusService.create>[0]);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "get": {
      const idOrSlug = args["id_or_slug"];
      if (typeof idOrSlug !== "string") return { ok: false, error: "id_or_slug required" };
      const r = await corpusService.get(idOrSlug);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "set": {
      const idOrSlug = args["id_or_slug"];
      if (typeof idOrSlug !== "string") return { ok: false, error: "id_or_slug required" };
      const { id_or_slug: _id, ...patch } = args;
      void _id;
      const r = await corpusService.set(idOrSlug, patch);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "delete": {
      const idOrSlug = args["id_or_slug"];
      if (typeof idOrSlug !== "string") return { ok: false, error: "id_or_slug required" };
      const r = await corpusService.delete(idOrSlug, args["confirm"] === true);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "list": {
      const r = await corpusService.list({});
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "search": {
      const query = args["query"];
      if (typeof query !== "string") return { ok: false, error: "query required" };
      const r = await corpusService.search(query);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "link": {
      const from = args["from"];
      const to = args["to"];
      if (typeof from !== "string" || typeof to !== "string") {
        return { ok: false, error: "from and to required" };
      }
      const type = typeof args["type"] === "string" ? args["type"] : "relates-to";
      const r = await corpusService.link(from, to, type as Parameters<typeof corpusService.link>[2]);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    default:
      return { ok: false, error: `Unknown operation: ${op}` };
  }
}
