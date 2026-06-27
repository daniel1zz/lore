/**
 * MCP tool registrations — all 16 lore_* tools.
 *
 * Architecture: Tools with input use the `registerToolWithArgs` helper defined below, which:
 *   1. Calls `server.tool(name, desc, handler)` in 3-arg form (avoids ZodRawShapeCompat type bomb)
 *   2. Immediately patches `_registeredTools[name].inputSchema = schema` on the registered tool
 *   3. At runtime the SDK then calls `handler(validatedArgs, extra)` (2-arg form), so the handler's
 *      first parameter receives the SDK-validated args directly.
 *
 * Reason: The 4-arg `server.tool(name, desc, {zodRawShape}, cb)` form triggers
 * `ShapeOutput<Args extends ZodRawShapeCompat>` — a mapped conditional type that distributes
 * `z3.infer<S> | z4.output<S>` across every property key of an inline object literal.
 * With 16 callsites × 8 SDK overloads × 39 inline Zod fields, tsc heap explodes to >7 GB and
 * OOMs. The 3-arg form skips ZodRawShapeCompat resolution entirely. Using `registerTool` with
 * `inputSchema: z.object(...)` also fails: TypeScript structurally matches `ZodObject<Shape>`
 * against `ZodRawShapeCompat` before `AnySchema`, still triggering `ShapeOutput<ZodObject<...>>`.
 * Patching `inputSchema` post-registration bypasses TypeScript inference entirely while preserving
 * correct runtime behaviour (SDK reads `tool.inputSchema` at call time, not registration time).
 * — reason: ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA §"Fast Path" Pattern 1 (implementation note)
 *
 * Public surface: `registerTools(server, app): void`
 * Invariants: one registration per tool name; every tool returns `{ content: [text] }` or
 *   `{ content: [text], isError: true }` (never throws across the MCP boundary).
 * Side-effect class: IO (reads/writes corpus via App services; no network I/O itself).
 * Source: SPEC-008 §3
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { App } from "../../app.js";
import type { LoreError } from "@lore/core";
import type { LinkType } from "@lore/core";
import { CORPUS_SCHEMA_INFO } from "./schema-info.js";

// ─── Schema Constants ────────────────────────────────────────────────────────
// Each schema is a `z.object(...)` instance (AnySchema), NOT an inline ZodRawShape literal.
// Keeping them as const-level declarations ensures tsc resolves their types once,
// not once per callsite × overload combination.
// reason: see ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA — inline raw shapes cause 912s check time

/** Valid document types accepted by all lore_* tools. */
const DOC_TYPE_ENUM = z.enum(["prd", "spec", "adr", "plan", "knowledge", "task"]);

/** Valid document status values accepted by lore_set and lore_list filters. */
const DOC_STATUS_ENUM = z.enum([
  "draft",
  "in-review",
  "approved",
  "active",
  "archived",
  "deprecated",
]);

/** Input schema for lore_create. */
export const LoreCreateSchema = z.object({
  type: DOC_TYPE_ENUM,
  title: z.string().min(1),
  content: z.string().optional(),
  parent_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.unknown()).optional(),
});

/** Input schema for lore_get. */
export const LoreGetSchema = z.object({
  id_or_slug: z.string(),
  resolve_mdx: z.boolean().optional(),
  include_navigation: z.boolean().optional(),
});

/** Input schema for lore_set. */
export const LoreSetSchema = z.object({
  id_or_slug: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  status: DOC_STATUS_ENUM.optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.unknown()).optional(),
  slug: z.string().optional(),
});

/** Input schema for lore_delete. */
export const LoreDeleteSchema = z.object({
  id_or_slug: z.string(),
  confirm: z.literal(true),
});

/** Input schema for lore_list. */
export const LoreListSchema = z.object({
  type: DOC_TYPE_ENUM.optional(),
  status: DOC_STATUS_ENUM.optional(),
  since: z.string().optional(),
  author: z.string().optional(),
  tag: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().min(0).optional(),
});

/** Input schema for lore_search. */
export const LoreSearchSchema = z.object({
  query: z.string().min(1),
  type: DOC_TYPE_ENUM.optional(),
  limit: z.number().int().positive().optional(),
});

/** Input schema for lore_tree. */
export const LoreTreeSchema = z.object({
  root: z.string().optional(),
  depth: z.number().int().positive().optional(),
});

/** Input schema for lore_link. */
export const LoreLinkSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z
    .enum(["parent", "implements", "informs", "supersedes", "relates-to", "blocks"])
    .optional()
    .default("relates-to"),
});

/** Input schema for lore_log. */
export const LoreLogSchema = z.object({
  id_or_slug: z.string(),
  limit: z.number().int().positive().optional(),
});

/** Input schema for lore_diff. */
export const LoreDiffSchema = z.object({
  id_or_slug: z.string(),
  from: z.number().int().positive().optional(),
  to: z.number().int().positive().optional(),
});

/** Input schema for lore_pending. */
export const LorePendingSchema = z.object({
  author: z.string().optional(),
  type: DOC_TYPE_ENUM.optional(),
});

/** Input schema for lore_approve. */
export const LoreApproveSchema = z.object({
  id_or_slug: z.string(),
  reviewer: z.string().optional(),
});

/** Input schema for lore_context_bundle. */
export const LoreContextBundleSchema = z.object({
  id_or_slug: z.string(),
  max_depth: z.number().int().positive().optional(),
});

/** Input schema for lore_batch. */
export const LoreBatchSchema = z.object({
  // reason: op uses z.string() (not enum) so unknown ops reach executeBatchOp's default
  // case and return { ok: false } in results instead of failing the entire batch request.
  operations: z.array(
    z.object({
      op: z.string(),
      args: z.record(z.unknown()),
    }),
  ),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wraps a value as MCP text content.
 * @param value - Any JSON-serializable value
 * @returns MCP CallToolResult with one text content item
 */
function textContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Wraps a LoreError as an MCP error response.
 * @param error - Structured LoreError from a service Result
 * @returns MCP CallToolResult with isError=true
 */
function errorContent(error: LoreError) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(error) }],
    isError: true as const,
  };
}

// ─── Tool Registration Helper ─────────────────────────────────────────────────

/**
 * Internal type for accessing McpServer's registered tool registry.
 * Provides access to `inputSchema` field that is patched post-registration.
 * Cast chain: McpServer → unknown → McpToolRegistry (avoids private-field collision).
 * reason: registerToolWithArgs helper needs to write inputSchema after 3-arg registration
 */
type McpToolRegistry = {
  _registeredTools: Record<string, { inputSchema?: unknown }>;
};

/**
 * Registers an MCP tool with typed input validation using the 3-arg form.
 *
 * Strategy:
 *   1. Calls `server.tool(name, desc, handler)` in 3-arg form — TypeScript sees
 *      `handler: (extra: RequestHandlerExtra) => Promise<CallToolResult>`, so it never
 *      evaluates `ShapeOutput<ZodRawShapeCompat>` (the source of the tsc OOM).
 *   2. Immediately patches `_registeredTools[name].inputSchema = schema` so the SDK's
 *      `executeToolHandler` takes the `handler(validatedArgs, extra)` branch at runtime.
 *   3. The handler's first parameter therefore receives the SDK-validated args (typed T),
 *      not `RequestHandlerExtra`. The second arg (extra) is ignored by our handlers.
 *
 * @param server - McpServer instance (accessed via internal _registeredTools for patch)
 * @param name - Tool name (must match MCP tool list)
 * @param desc - Tool description shown to clients
 * @param schema - Zod schema for input validation (used by SDK at call time)
 * @param handler - Typed handler receiving validated args of type T
 *
 * @throws Never — all errors are returned as `{ isError: true }` MCP responses
 *
 * reason: ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA §"Fast Path" Pattern 1 (post-registration patch)
 * fence: do NOT change to 4-arg form or registerTool(inputSchema: z.object(...)) —
 *   those trigger ShapeOutput<ZodRawShapeCompat> which OOMs tsc at 4 GB heap.
 */
function registerToolWithArgs<T>(
  server: McpServer,
  name: string,
  desc: string,
  schema: z.ZodType<T>,
  handler: (args: T) => Promise<CallToolResult>,
): void {
  // Step 1: 3-arg registration — avoids ZodRawShapeCompat inference entirely
  // The handler is cast to () => Promise<CallToolResult> so TypeScript resolves
  // it as ToolCallback<undefined> (no ShapeOutput computation).
  server.tool(name, desc, handler as unknown as () => Promise<CallToolResult>);

  // Step 2: Post-registration inputSchema patch — restores correct runtime routing.
  // The SDK reads tool.inputSchema at CALL TIME (not registration time), so patching
  // here ensures validateToolInput → handler(validatedArgs, extra) path is taken.
  const registry = server as unknown as McpToolRegistry;
  const registered = registry._registeredTools[name];
  if (registered) {
    registered.inputSchema = schema;
  }
}

// ─── Tool Registrations ──────────────────────────────────────────────────────

/**
 * Registers all 16 lore_* MCP tools on the given server.
 *
 * Tools with input use `registerToolWithArgs` (avoids ZodRawShapeCompat type bomb).
 * Tools without input (`lore_schema`, `lore_status`) use plain `server.tool(name, desc, cb)`.
 *
 * @param server - The McpServer instance to register tools on
 * @param app - The composition root providing access to all services
 */
export function registerTools(server: McpServer, app: App): void {
  const { corpusService, versionService, reviewService, outlineService } = app;

  // lore_create
  registerToolWithArgs(server, "lore_create", "Create a new document in the Lore corpus", LoreCreateSchema, async (args) => {
    const result = await corpusService.create(args);
    if (!result.ok) return errorContent(result.error);
    const { id, slug, type, status, version } = result.value;
    return textContent({ id, slug, type, status, version });
  });

  // lore_get
  registerToolWithArgs(server, "lore_get", "Get a document by ID or slug, with optional navigation and MDX resolution", LoreGetSchema, async (args) => {
    const { id_or_slug, resolve_mdx, include_navigation } = args;
    // reason: exactOptionalPropertyTypes — only pass resolve_mdx when defined to avoid
    // assigning `undefined` to `GetOpts.resolve_mdx?: boolean` (which excludes undefined)
    const opts = resolve_mdx !== undefined ? { resolve_mdx } : {};
    const result = await corpusService.get(id_or_slug, opts);
    if (!result.ok) return errorContent(result.error);

    const payload: Record<string, unknown> = { doc: result.value.doc };
    if (include_navigation !== false) {
      payload["navigation"] = result.value.navigation;
    }
    if (resolve_mdx) {
      const resolveResult = await outlineService.resolve(result.value.doc);
      if (resolveResult.ok) {
        payload["resolved_components"] = resolveResult.value.resolvedComponents;
      }
    }
    return textContent(payload);
  });

  // lore_set
  registerToolWithArgs(server, "lore_set", "Patch (update) an existing document", LoreSetSchema, async (args) => {
    const { id_or_slug, ...patch } = args;
    const result = await corpusService.set(id_or_slug, patch);
    if (!result.ok) return errorContent(result.error);
    return textContent({ doc: result.value, version: result.value.version });
  });

  // lore_delete
  registerToolWithArgs(server, "lore_delete", "Soft-delete a document (requires confirm: true)", LoreDeleteSchema, async (args) => {
    const result = await corpusService.delete(args.id_or_slug, args.confirm);
    if (!result.ok) return errorContent(result.error);
    return textContent(result.value);
  });

  // lore_list
  registerToolWithArgs(server, "lore_list", "List documents matching optional filters", LoreListSchema, async (args) => {
    const { type, status, since, author, tag, limit, offset } = args;
    const filters = {
      ...(type !== undefined ? { type } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(author !== undefined ? { created_by: author } : {}),
      ...(tag !== undefined ? { tags: [tag] } : {}),
    };
    const result = await corpusService.list(filters);
    if (!result.ok) return errorContent(result.error);
    const docs = limit !== undefined
      ? result.value.docs.slice(offset ?? 0, (offset ?? 0) + limit)
      : result.value.docs;
    return textContent({ docs, total: result.value.total });
  });

  // lore_search
  registerToolWithArgs(server, "lore_search", "Full-text search across the corpus", LoreSearchSchema, async (args) => {
    const { query, type, limit } = args;
    const filters = type !== undefined ? { type } : {};
    const result = await corpusService.search(query, filters);
    if (!result.ok) return errorContent(result.error);
    const results = limit !== undefined ? result.value.results.slice(0, limit) : result.value.results;
    return textContent({ results });
  });

  // lore_tree
  registerToolWithArgs(server, "lore_tree", "Get the document tree from a root (or first PRD)", LoreTreeSchema, async (args) => {
    // reason: exactOptionalPropertyTypes — only pass depth when defined
    const opts = args.depth !== undefined ? { depth: args.depth } : {};
    const result = await corpusService.tree(args.root, opts);
    if (!result.ok) return errorContent(result.error);
    return textContent({ tree: result.value });
  });

  // lore_link
  registerToolWithArgs(server, "lore_link", "Create a link between two documents", LoreLinkSchema, async (args) => {
    // reason: args.type is declared `optional().default()` — TypeScript may widen to include
    // undefined due to ZodDefault inference quirk; the ?? fallback ensures a valid LinkType.
    const linkType = (args.type ?? "relates-to") as LinkType;
    const result = await corpusService.link(args.from, args.to, linkType);
    if (!result.ok) return errorContent(result.error);
    return textContent({ link: result.value });
  });

  // lore_log
  registerToolWithArgs(server, "lore_log", "Get version history for a document", LoreLogSchema, async (args) => {
    // reason: exactOptionalPropertyTypes — only pass limit when defined
    const opts = args.limit !== undefined ? { limit: args.limit } : {};
    const result = await versionService.log(args.id_or_slug, opts);
    if (!result.ok) return errorContent(result.error);
    return textContent({ entries: result.value });
  });

  // lore_diff
  registerToolWithArgs(server, "lore_diff", "Compute a diff between two versions of a document", LoreDiffSchema, async (args) => {
    // reason: exactOptionalPropertyTypes — only pass from/to when defined
    const opts = {
      ...(args.from !== undefined ? { from: args.from } : {}),
      ...(args.to !== undefined ? { to: args.to } : {}),
    };
    const result = await versionService.diff(args.id_or_slug, opts);
    if (!result.ok) return errorContent(result.error);
    return textContent({ diff: result.value });
  });

  // lore_pending
  registerToolWithArgs(server, "lore_pending", "List documents pending review (status=draft)", LorePendingSchema, async (args) => {
    // reason: exactOptionalPropertyTypes — only pass author/type when defined
    const filters = {
      ...(args.author !== undefined ? { author: args.author } : {}),
      ...(args.type !== undefined ? { type: args.type } : {}),
    };
    const result = await reviewService.pending(filters);
    if (!result.ok) return errorContent(result.error);
    return textContent({ docs: result.value });
  });

  // lore_approve
  registerToolWithArgs(server, "lore_approve", "Approve a document, transitioning it from draft to approved", LoreApproveSchema, async (args) => {
    // reason: exactOptionalPropertyTypes — only pass reviewer when defined
    const opts = args.reviewer !== undefined ? { reviewer: args.reviewer } : {};
    const result = await reviewService.approve(args.id_or_slug, opts);
    if (!result.ok) return errorContent(result.error);
    return textContent({ doc: result.value });
  });

  // lore_schema — no input parameters; 3-arg form (correct for 0-arg tools)
  // reason: static info tool, no arguments needed
  server.tool(
    "lore_schema",
    "Return static corpus schema information (doc types, link types, required fields)",
    async () => {
      return textContent(CORPUS_SCHEMA_INFO);
    },
  );

  // lore_context_bundle
  registerToolWithArgs(server, "lore_context_bundle", "Get a document plus its parent, linked specs, related ADRs, and active plans", LoreContextBundleSchema, async (args) => {
    const targetResult = await corpusService.get(args.id_or_slug);
    if (!targetResult.ok) return errorContent(targetResult.error);

    const { doc, navigation } = targetResult.value;
    const linkedSpecs = navigation.related.filter((r) => r.type === "spec");
    const relatedAdrs = navigation.related.filter((r) => r.type === "adr");
    const plansResult = await corpusService.list({ type: "plan", status: "active" });
    const activePlans = plansResult.ok ? plansResult.value.docs : [];

    return textContent({ target: doc, linked_specs: linkedSpecs, related_adrs: relatedAdrs, active_plans: activePlans });
  });

  // lore_batch
  registerToolWithArgs(server, "lore_batch", "Execute multiple operations in sequence", LoreBatchSchema, async (args) => {
    const results: unknown[] = [];
    for (const operation of args.operations) {
      const opResult = await executeBatchOp(operation.op, operation.args, app);
      results.push(opResult);
    }
    return textContent({ results });
  });

  // lore_status — no input parameters; 3-arg form (correct for 0-arg tools)
  // reason: aggregate query tool, no arguments needed
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

/**
 * Executes a single named operation within a lore_batch call.
 * Returns a structured `{ ok, value }` or `{ ok, error }` result object.
 *
 * @param op - Operation name (create | get | set | delete | list | search | link)
 * @param args - Raw arguments from the batch operation entry
 * @param app - The composition root providing corpus service
 * @returns A plain-object result suitable for inclusion in the batch results array
 */
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
