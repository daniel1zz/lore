/**
 * OutlineService — MDX placeholder resolution engine.
 * Resolves self-closing MDX component tags in document content
 * by querying the corpus and returning structured data per component.
 *
 * Design: regex-based component extractor (no remark/unified/mdx dependencies).
 * Phase 1 constraint: components are self-closing, props are simple key=value.
 *
 * Also exports `renderResolvedToMarkdown` — the SSOT pure function that splices a
 * resolve() result's structured component data back into the document's markdown
 * body (text-projection). resolve() alone only ever emits data; it never touches
 * `content`. Consumers (CLI `get`, `export-docs`) call resolve() then feed its
 * output straight into renderResolvedToMarkdown() — see SPEC-032 §3.3.
 *
 * Source: SPEC-004, SPEC-001 §3.4, SPEC-032 §3.3
 */

import type { DocRecord, DocSummary } from "@lore/core";
import { ok, err, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

// ─── Public Types ───────────────────────────────────────────────────────────

/** Resolved data + metadata for one component instance. */
export interface ResolvedComponent {
  /** Component tag name, e.g. "ChildrenOf" */
  name: string;
  /** Parsed props from the tag */
  props: Record<string, unknown>;
  /** Query result data — shape depends on component name */
  data: unknown;
  /** Byte offsets in original content */
  position: { start: number; end: number };
}

/** Warning from resolution (unknown component, missing data, etc.) */
export interface ResolutionWarning {
  message: string;
  component: string;
  position: { start: number; end: number };
}

/** Result of resolving a document's MDX placeholders. */
export interface ResolvedDoc {
  /** Original unmodified content */
  content: string;
  /** All successfully resolved components */
  resolvedComponents: ResolvedComponent[];
  /** Non-fatal warnings (stripped unknown components, missing embeds, etc.) */
  warnings: ResolutionWarning[];
}

export interface ResolveOpts {
  /** Tree expansion depth for ModuleTree and ChildrenOf depth>1. Default: 1 */
  expandDepth?: number;
}

// ─── Whitelisted Components ─────────────────────────────────────────────────

const WHITELISTED_COMPONENTS = new Set([
  "ChildrenOf",
  "RecentDecisions",
  "ActivePlans",
  "ModuleTree",
  "RelatedOf",
  "Embed",
  "HealthStats",
] as const);

// ─── Regex Patterns ─────────────────────────────────────────────────────────

/**
 * Matches self-closing MDX component tags: <ComponentName prop="val" prop2={5} />
 * Capture groups: [1] component name, [2] props string
 */
const COMPONENT_REGEX = /<([A-Z][A-Za-z0-9]*)(\s[^>]*)?\s*\/>/g;

/**
 * Matches individual props in a tag props string.
 * Supports: prop="string"  prop={number}  prop={true}
 */
const PROP_REGEX = /(\w+)=(?:"([^"]*)"|\{([^}]*)\})/g;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse all props from a props string into a plain object. */
function parseProps(propsStr: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let match: RegExpExecArray | null;
  PROP_REGEX.lastIndex = 0;

  while ((match = PROP_REGEX.exec(propsStr)) !== null) {
    const key = match[1];
    const stringVal = match[2];
    const exprVal = match[3];

    // key is always captured by group 1 — guard for noUncheckedIndexedAccess
    if (key === undefined) continue;

    if (stringVal !== undefined) {
      result[key] = stringVal;
    } else if (exprVal !== undefined) {
      const trimmed = exprVal.trim();
      if (trimmed === "true") {
        result[key] = true;
      } else if (trimmed === "false") {
        result[key] = false;
      } else {
        const num = Number(trimmed);
        result[key] = Number.isNaN(num) ? trimmed : num;
      }
    }
  }

  return result;
}

/**
 * Convert a DocRecord to a lightweight DocSummary.
 *
 * @invariant Deliberately omits `meta` — MDX placeholder rendering
 * (`renderDocBullet`/`renderDocBulletList`) only ever prints `- [type] title (status)`;
 * wiring `deriveTypeMeta` here is out of scope for SPEC-036 §2 D3 (CorpusService's
 * navigation/list projection is the one this spec upgrades). `tags`/`priority` are
 * added only to satisfy DocSummary's now-required fields.
 */
function toSummary(doc: DocRecord): DocSummary {
  return {
    id: doc.id,
    slug: doc.slug,
    type: doc.type,
    title: doc.title,
    status: doc.status,
    updated_at: doc.updated_at,
    tags: doc.tags,
    priority: doc.priority,
  };
}

// ─── Component Resolver Functions ───────────────────────────────────────────

type ComponentData = unknown;

async function resolveChildrenOf(
  doc: DocRecord,
  props: Record<string, unknown>,
  store: StoreInterface,
): Promise<Result<ComponentData, LoreError>> {
  const filters = {
    parent_id: doc.id as string,
    ...(typeof props["type"] === "string" ? { type: props["type"] as import("@lore/core").DocType } : {}),
    ...(typeof props["status"] === "string" ? { status: props["status"] as import("@lore/core").DocStatus } : {}),
  };

  const result = await store.findMany(filters);
  if (!result.ok) return result;

  const children = result.value.map(toSummary);
  return ok({ children });
}

async function resolveRecentDecisions(
  props: Record<string, unknown>,
  store: StoreInterface,
): Promise<Result<ComponentData, LoreError>> {
  const limit = typeof props["limit"] === "number" ? props["limit"] : 5;
  const filters = {
    type: "adr" as import("@lore/core").DocType,
    ...(typeof props["status"] === "string" ? { status: props["status"] as import("@lore/core").DocStatus } : {}),
  };

  const result = await store.findMany(filters);
  if (!result.ok) return result;

  // findMany already returns sorted by updated_at DESC
  const decisions = result.value.slice(0, limit).map(toSummary);
  return ok({ decisions });
}

async function resolveActivePlans(
  props: Record<string, unknown>,
  store: StoreInterface,
): Promise<Result<ComponentData, LoreError>> {
  const statusFilter = typeof props["status"] === "string"
    ? props["status"] as import("@lore/core").DocStatus
    : "active" as import("@lore/core").DocStatus;

  const result = await store.findMany({
    type: "plan" as import("@lore/core").DocType,
    status: statusFilter,
  });
  if (!result.ok) return result;

  const plans = result.value.map(toSummary);
  return ok({ plans });
}

async function resolveModuleTree(
  doc: DocRecord,
  props: Record<string, unknown>,
  store: StoreInterface,
): Promise<Result<ComponentData, LoreError>> {
  const maxDepth = typeof props["depth"] === "number" ? props["depth"] : 3;
  const rootId = typeof props["root"] === "string" ? props["root"] : doc.id;

  const rootResult = await store.find(rootId);
  if (!rootResult.ok) return rootResult;

  if (rootResult.value === null) {
    return ok({ modules: null });
  }

  const treeResult = await buildTree(rootResult.value, store, 0, maxDepth);
  if (!treeResult.ok) return treeResult;

  return ok({ modules: treeResult.value });
}

interface TreeNode {
  doc: DocSummary;
  children: TreeNode[];
}

async function buildTree(
  doc: DocRecord,
  store: StoreInterface,
  currentDepth: number,
  maxDepth: number,
): Promise<Result<TreeNode, LoreError>> {
  if (currentDepth >= maxDepth) {
    return ok({ doc: toSummary(doc), children: [] });
  }

  const childrenResult = await store.findMany({ parent_id: doc.id });
  if (!childrenResult.ok) return childrenResult;

  const childNodes: TreeNode[] = [];
  for (const child of childrenResult.value) {
    const childTreeResult = await buildTree(child, store, currentDepth + 1, maxDepth);
    if (!childTreeResult.ok) return childTreeResult;
    childNodes.push(childTreeResult.value);
  }

  return ok({ doc: toSummary(doc), children: childNodes });
}

async function resolveRelatedOf(
  doc: DocRecord,
  props: Record<string, unknown>,
  store: StoreInterface,
): Promise<Result<ComponentData, LoreError>> {
  const direction = (typeof props["direction"] === "string"
    ? props["direction"]
    : "both") as "in" | "out" | "both";

  const linksResult = await store.findLinks(doc.id, direction);
  if (!linksResult.ok) return linksResult;

  const typeFilter = typeof props["type"] === "string" ? props["type"] : null;

  const filteredLinks = linksResult.value.filter((link) => {
    if (typeFilter !== null && link.link_type !== typeFilter) return false;
    return true;
  });

  const related: Array<DocSummary & { link_type: string }> = [];

  for (const link of filteredLinks) {
    const otherId = link.from_id === doc.id ? link.to_id : link.from_id;
    const docResult = await store.find(otherId);
    if (!docResult.ok) return docResult;
    if (docResult.value !== null) {
      related.push({ ...toSummary(docResult.value), link_type: link.link_type });
    }
  }

  return ok({ related });
}

async function resolveEmbed(
  props: Record<string, unknown>,
  store: StoreInterface,
): Promise<Result<ComponentData, LoreError>> {
  const id = typeof props["id"] === "string" ? props["id"] : null;

  if (id === null) {
    return ok({ embedded: null, error: "Embed requires an id prop" });
  }

  const docResult = await store.find(id);
  if (!docResult.ok) return docResult;

  if (docResult.value === null) {
    // Graceful degradation — not an error, just null data
    return ok({ embedded: null, notFound: id });
  }

  const section = typeof props["section"] === "string" ? props["section"] : null;
  const content = section !== null
    ? extractSection(docResult.value.content, section)
    : docResult.value.content;

  return ok({
    embedded: {
      id: docResult.value.id,
      title: docResult.value.title,
      content,
    },
  });
}

/** Extract a markdown section (heading + body) from content. */
function extractSection(content: string, heading: string): string {
  const lines = content.split("\n");
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch !== null) {
      if (inSection) break;
      const headingText = headingMatch[2];
      if (headingText !== undefined && headingText.trim() === heading) {
        inSection = true;
        sectionLines.push(line);
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join("\n");
}

async function resolveHealthStats(
  store: StoreInterface,
): Promise<Result<ComponentData, LoreError>> {
  const allResult = await store.findMany({});
  if (!allResult.ok) return allResult;

  const docs = allResult.value;
  const total = docs.length;

  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let stale = 0;
  let orphans = 0;

  for (const doc of docs) {
    byType[doc.type] = (byType[doc.type] ?? 0) + 1;
    byStatus[doc.status] = (byStatus[doc.status] ?? 0) + 1;

    if (doc.updated_at < thirtyDaysAgo) {
      stale += 1;
    }
    if (doc.parent_id === null && doc.type !== "prd") {
      orphans += 1;
    }
  }

  return ok({
    stats: {
      total,
      by_type: byType,
      by_status: byStatus,
      stale,
      orphans,
    },
  });
}

// ─── OutlineService ─────────────────────────────────────────────────────────

export class OutlineService {
  private readonly store: StoreInterface;

  constructor(store: StoreInterface) {
    this.store = store;
  }

  /**
   * Resolve all MDX placeholder components in a document's content.
   *
   * Unknown components are stripped with a warning.
   * Store errors propagate as Result errors.
   * Missing embeds degrade gracefully (null data + warning).
   */
  async resolve(
    doc: DocRecord,
    opts?: ResolveOpts,
  ): Promise<Result<ResolvedDoc, LoreError>> {
    const resolvedComponents: ResolvedComponent[] = [];
    const warnings: ResolutionWarning[] = [];

    COMPONENT_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = COMPONENT_REGEX.exec(doc.content)) !== null) {
      const fullMatch = match[0];
      const name = match[1];
      const propsStr = match[2] ?? "";

      // group 0 and group 1 are always present when regex matches
      if (fullMatch === undefined || name === undefined) continue;

      const position = { start: match.index, end: match.index + fullMatch.length };

      if (!WHITELISTED_COMPONENTS.has(name as typeof WHITELISTED_COMPONENTS extends Set<infer T> ? T : never)) {
        warnings.push({
          message: `Unknown component <${name} /> stripped from output`,
          component: name,
          position,
        });
        continue;
      }

      const props = parseProps(propsStr);
      const dataResult = await this.resolveComponent(name, doc, props);

      if (!dataResult.ok) {
        return dataResult;
      }

      resolvedComponents.push({
        name,
        props,
        data: dataResult.value,
        position,
      });
    }

    return ok({
      content: doc.content,
      resolvedComponents,
      warnings,
    });
  }

  private async resolveComponent(
    name: string,
    doc: DocRecord,
    props: Record<string, unknown>,
  ): Promise<Result<ComponentData, LoreError>> {
    switch (name) {
      case "ChildrenOf":
        return resolveChildrenOf(doc, props, this.store);
      case "RecentDecisions":
        return resolveRecentDecisions(props, this.store);
      case "ActivePlans":
        return resolveActivePlans(props, this.store);
      case "ModuleTree":
        return resolveModuleTree(doc, props, this.store);
      case "RelatedOf":
        return resolveRelatedOf(doc, props, this.store);
      case "Embed":
        return resolveEmbed(props, this.store);
      case "HealthStats":
        return resolveHealthStats(this.store);
      default:
        // Unreachable — whitelist check happens before this call
        return err({ code: "STORE_ERROR", message: `Unhandled component: ${name}` });
    }
  }
}

// ─── Text Projection (renderResolvedToMarkdown) ────────────────────────────

/** Render one `DocSummary` as a markdown bullet: `- [type] title (status)`. */
function renderDocBullet(doc: DocSummary): string {
  return `- [${doc.type}] ${doc.title} (${doc.status})`;
}

/** Render a list of `DocSummary` as bullets, or a labeled empty-state line. */
function renderDocBulletList(docs: DocSummary[], emptyLabel: string): string {
  return docs.length > 0 ? docs.map(renderDocBullet).join("\n") : `_(${emptyLabel})_`;
}

/**
 * Pull a `DocSummary[]` out of resolver data at `key`, defensively.
 * Resolver data is `unknown` by contract (see `ComponentData`) — malformed/missing
 * shapes degrade to an empty array rather than throwing (graceful degradation,
 * matching resolveEmbed's null-data precedent).
 */
function extractDocSummaries(data: unknown, key: string): DocSummary[] {
  if (typeof data !== "object" || data === null) return [];
  const value = (data as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as DocSummary[]) : [];
}

/** `RelatedOf` resolver data shape: a DocSummary plus the link's type. */
type RelatedDocSummary = DocSummary & { link_type: string };

function extractRelatedDocs(data: unknown): RelatedDocSummary[] {
  if (typeof data !== "object" || data === null) return [];
  const value = (data as Record<string, unknown>)["related"];
  return Array.isArray(value) ? (value as RelatedDocSummary[]) : [];
}

function renderRelatedList(related: RelatedDocSummary[]): string {
  if (related.length === 0) return "_(no related docs)_";
  return related
    .map((r) => `- [${r.type}] ${r.title} (${r.status}) — ${r.link_type}`)
    .join("\n");
}

/** Render one `ModuleTree` node + its children as a nested markdown list. */
function renderModuleTreeNode(node: TreeNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const line = `${indent}- [${node.doc.type}] ${node.doc.title} (${node.doc.status})`;
  if (node.children.length === 0) return line;
  return [line, ...node.children.map((child) => renderModuleTreeNode(child, depth + 1))].join("\n");
}

function renderModuleTree(data: unknown): string {
  if (typeof data !== "object" || data === null) return "_(module tree unavailable)_";
  const modules = (data as Record<string, unknown>)["modules"];
  if (modules === null || modules === undefined) return "_(module tree root not found)_";
  return renderModuleTreeNode(modules as TreeNode, 0);
}

/** Render `Embed` resolver data — degrades to a labeled line for every non-happy case. */
function renderEmbed(data: unknown): string {
  if (typeof data !== "object" || data === null) return "_(embed unavailable)_";
  const record = data as Record<string, unknown>;
  if (typeof record["error"] === "string") return `_(embed error: ${record["error"]})_`;
  if (typeof record["notFound"] === "string") return `_(embed not found: ${record["notFound"]})_`;
  const embedded = record["embedded"];
  if (typeof embedded !== "object" || embedded === null) return "_(embed not found)_";
  const e = embedded as Record<string, unknown>;
  const title = typeof e["title"] === "string" ? e["title"] : "(untitled)";
  const content = typeof e["content"] === "string" ? e["content"] : "";
  return `**${title}**\n\n${content}`;
}

/** Render `HealthStats` resolver data as a markdown summary list. */
function renderHealthStats(data: unknown): string {
  if (typeof data !== "object" || data === null) return "_(health stats unavailable)_";
  const stats = (data as Record<string, unknown>)["stats"];
  if (typeof stats !== "object" || stats === null) return "_(health stats unavailable)_";
  const s = stats as Record<string, unknown>;
  const total = typeof s["total"] === "number" ? s["total"] : 0;
  const stale = typeof s["stale"] === "number" ? s["stale"] : 0;
  const orphans = typeof s["orphans"] === "number" ? s["orphans"] : 0;
  const byType = typeof s["by_type"] === "object" && s["by_type"] !== null
    ? (s["by_type"] as Record<string, number>)
    : {};
  const byStatus = typeof s["by_status"] === "object" && s["by_status"] !== null
    ? (s["by_status"] as Record<string, number>)
    : {};
  const byTypeStr = Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", ") || "(none)";
  const byStatusStr = Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(", ") || "(none)";
  return [
    `- Total: ${total}`,
    `- By type: ${byTypeStr}`,
    `- By status: ${byStatusStr}`,
    `- Stale (>30d): ${stale}`,
    `- Orphans: ${orphans}`,
  ].join("\n");
}

/**
 * Dispatch one resolved component to its deterministic markdown rendering.
 * `component.name` is guaranteed whitelisted by resolve() (only whitelisted
 * components are ever pushed into `resolvedComponents`); the default branch is
 * unreachable in practice but degrades to a labeled string rather than throwing.
 */
function renderComponentMarkdown(component: ResolvedComponent): string {
  switch (component.name) {
    case "ChildrenOf":
      return renderDocBulletList(extractDocSummaries(component.data, "children"), "no children");
    case "RecentDecisions":
      return renderDocBulletList(extractDocSummaries(component.data, "decisions"), "no recent decisions");
    case "ActivePlans":
      return renderDocBulletList(extractDocSummaries(component.data, "plans"), "no active plans");
    case "ModuleTree":
      return renderModuleTree(component.data);
    case "RelatedOf":
      return renderRelatedList(extractRelatedDocs(component.data));
    case "Embed":
      return renderEmbed(component.data);
    case "HealthStats":
      return renderHealthStats(component.data);
    default:
      return `_(unknown component: ${component.name})_`;
  }
}

/**
 * Splice a resolve() result's structured component data back into the document's
 * markdown body — the "text projection" step resolve() alone never performs.
 *
 * Walks `resolvedComponents` in DESCENDING `position.start` order. Byte offsets
 * stay valid throughout because `resolve()`'s regex matches are non-overlapping
 * (each is consumed once by `COMPONENT_REGEX.exec`'s advancing lastIndex) and a
 * descending walk never mutates content before an offset it still needs to read.
 * Pure — no store access, no IO; operates only on already-resolved data.
 *
 * @param resolved - Output of `OutlineService.resolve()` for one document.
 * @returns Markdown with every whitelisted placeholder replaced by its rendering;
 *   unchanged `resolved.content` when there are no resolved components.
 * @example
 *   const resolved = await outlineService.resolve(doc);
 *   if (resolved.ok) console.log(renderResolvedToMarkdown(resolved.value));
 */
export function renderResolvedToMarkdown(resolved: ResolvedDoc): string {
  let content = resolved.content;
  const byPositionDescending = [...resolved.resolvedComponents].sort(
    (a, b) => b.position.start - a.position.start,
  );
  for (const component of byPositionDescending) {
    const rendering = renderComponentMarkdown(component);
    content = content.slice(0, component.position.start) + rendering + content.slice(component.position.end);
  }
  return content;
}
