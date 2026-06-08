/**
 * OutlineService — MDX placeholder resolution engine.
 * Resolves self-closing MDX component tags in document content
 * by querying the corpus and returning structured data per component.
 *
 * Design: regex-based component extractor (no remark/unified/mdx dependencies).
 * Phase 1 constraint: components are self-closing, props are simple key=value.
 *
 * Source: SPEC-004, SPEC-001 §3.4
 */

import type { DocRecord, DocSummary } from "../core/types.js";
import { ok, err, type Result } from "../core/errors.js";
import type { LoreError } from "../core/errors.js";
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

/** Convert a DocRecord to a lightweight DocSummary. */
function toSummary(doc: DocRecord): DocSummary {
  return {
    id: doc.id,
    slug: doc.slug,
    type: doc.type,
    title: doc.title,
    status: doc.status,
    updated_at: doc.updated_at,
  };
}

// ─── Component Resolver Functions ───────────────────────────────────────────

type ComponentData = unknown;

function resolveChildrenOf(
  doc: DocRecord,
  props: Record<string, unknown>,
  store: StoreInterface,
): Result<ComponentData, LoreError> {
  const filters = {
    parent_id: doc.id as string,
    ...(typeof props["type"] === "string" ? { type: props["type"] as import("../core/types.js").DocType } : {}),
    ...(typeof props["status"] === "string" ? { status: props["status"] as import("../core/types.js").DocStatus } : {}),
  };

  const result = store.findMany(filters);
  if (!result.ok) return result;

  const children = result.value.map(toSummary);
  return ok({ children });
}

function resolveRecentDecisions(
  props: Record<string, unknown>,
  store: StoreInterface,
): Result<ComponentData, LoreError> {
  const limit = typeof props["limit"] === "number" ? props["limit"] : 5;
  const filters = {
    type: "adr" as import("../core/types.js").DocType,
    ...(typeof props["status"] === "string" ? { status: props["status"] as import("../core/types.js").DocStatus } : {}),
  };

  const result = store.findMany(filters);
  if (!result.ok) return result;

  // findMany already returns sorted by updated_at DESC
  const decisions = result.value.slice(0, limit).map(toSummary);
  return ok({ decisions });
}

function resolveActivePlans(
  props: Record<string, unknown>,
  store: StoreInterface,
): Result<ComponentData, LoreError> {
  const statusFilter = typeof props["status"] === "string"
    ? props["status"] as import("../core/types.js").DocStatus
    : "active" as import("../core/types.js").DocStatus;

  const result = store.findMany({
    type: "plan" as import("../core/types.js").DocType,
    status: statusFilter,
  });
  if (!result.ok) return result;

  const plans = result.value.map(toSummary);
  return ok({ plans });
}

function resolveModuleTree(
  doc: DocRecord,
  props: Record<string, unknown>,
  store: StoreInterface,
): Result<ComponentData, LoreError> {
  const maxDepth = typeof props["depth"] === "number" ? props["depth"] : 3;
  const rootId = typeof props["root"] === "string" ? props["root"] : doc.id;

  const rootResult = store.find(rootId);
  if (!rootResult.ok) return rootResult;

  if (rootResult.value === null) {
    return ok({ modules: null });
  }

  const treeResult = buildTree(rootResult.value, store, 0, maxDepth);
  if (!treeResult.ok) return treeResult;

  return ok({ modules: treeResult.value });
}

interface TreeNode {
  doc: DocSummary;
  children: TreeNode[];
}

function buildTree(
  doc: DocRecord,
  store: StoreInterface,
  currentDepth: number,
  maxDepth: number,
): Result<TreeNode, LoreError> {
  if (currentDepth >= maxDepth) {
    return ok({ doc: toSummary(doc), children: [] });
  }

  const childrenResult = store.findMany({ parent_id: doc.id });
  if (!childrenResult.ok) return childrenResult;

  const childNodes: TreeNode[] = [];
  for (const child of childrenResult.value) {
    const childTreeResult = buildTree(child, store, currentDepth + 1, maxDepth);
    if (!childTreeResult.ok) return childTreeResult;
    childNodes.push(childTreeResult.value);
  }

  return ok({ doc: toSummary(doc), children: childNodes });
}

function resolveRelatedOf(
  doc: DocRecord,
  props: Record<string, unknown>,
  store: StoreInterface,
): Result<ComponentData, LoreError> {
  const direction = (typeof props["direction"] === "string"
    ? props["direction"]
    : "both") as "in" | "out" | "both";

  const linksResult = store.findLinks(doc.id, direction);
  if (!linksResult.ok) return linksResult;

  const typeFilter = typeof props["type"] === "string" ? props["type"] : null;

  const filteredLinks = linksResult.value.filter((link) => {
    if (typeFilter !== null && link.link_type !== typeFilter) return false;
    return true;
  });

  const related: Array<DocSummary & { link_type: string }> = [];

  for (const link of filteredLinks) {
    const otherId = link.from_id === doc.id ? link.to_id : link.from_id;
    const docResult = store.find(otherId);
    if (!docResult.ok) return docResult;
    if (docResult.value !== null) {
      related.push({ ...toSummary(docResult.value), link_type: link.link_type });
    }
  }

  return ok({ related });
}

function resolveEmbed(
  props: Record<string, unknown>,
  store: StoreInterface,
): Result<ComponentData, LoreError> {
  const id = typeof props["id"] === "string" ? props["id"] : null;

  if (id === null) {
    return ok({ embedded: null, error: "Embed requires an id prop" });
  }

  const docResult = store.find(id);
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

function resolveHealthStats(
  store: StoreInterface,
): Result<ComponentData, LoreError> {
  const allResult = store.findMany({});
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
  resolve(
    doc: DocRecord,
    opts?: ResolveOpts,
  ): Result<ResolvedDoc, LoreError> {
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
      const dataResult = this.resolveComponent(name, doc, props);

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

  private resolveComponent(
    name: string,
    doc: DocRecord,
    props: Record<string, unknown>,
  ): Result<ComponentData, LoreError> {
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
