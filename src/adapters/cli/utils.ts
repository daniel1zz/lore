/**
 * Shared CLI utilities — DB discovery, error formatting, output helpers.
 * No business logic here; only terminal I/O concerns.
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import type { LoreError } from "../../core/errors.js";
import type { TreeNode } from "../../service/corpus-service.js";
import type { DocWithNavigation } from "../../service/corpus-service.js";

// ─── DB Discovery ───────────────────────────────────────────────────────────

/**
 * Walk up from cwd looking for .lore/lore.db.
 * Exits with code 1 if not found (suggests `lore init`).
 */
export function findLoreDb(): string {
  let dir = process.cwd();

  // Walk up to filesystem root
  while (true) {
    const candidate = join(dir, ".lore", "lore.db");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }

  process.stderr.write(
    "Error: No Lore database found in this directory or any parent.\n" +
    "  Run `lore init` to initialise a new Lore project here.\n",
  );
  process.exit(1);
}


// ─── Error Formatting ───────────────────────────────────────────────────────

/** Map a LoreError code to a CLI exit code per SPEC-003 §5. */
export function exitCode(error: LoreError): number {
  switch (error.code) {
    case "DOC_NOT_FOUND":
    case "SLUG_NOT_FOUND":
      return 3;
    case "VALIDATION_ERROR":
    case "SCHEMA_VIOLATION":
    case "LINK_CYCLE":
    case "DUPLICATE_SLUG":
    case "DUPLICATE_LINK":
    case "DELETE_REQUIRES_CONFIRM":
    case "INVALID_TRANSITION":
    case "PARENT_REQUIRED":
    case "INVALID_PARENT_TYPE":
      return 4;
    case "STALE_VERSION":
      return 5;
    case "STORE_ERROR":
      return 1;
    default: {
      // exhaustive check — TypeScript should warn if a code is missing
      const _exhaustive: never = error;
      void _exhaustive;
      return 1;
    }
  }
}

/** Human-readable error message with contextual suggestions. */
export function formatError(error: LoreError): string {
  switch (error.code) {
    case "DOC_NOT_FOUND": {
      const lines = [`Error: Document not found: ${error.id}`];
      if (error.suggestions && error.suggestions.length > 0) {
        lines.push(`  Suggestion: Did you mean one of: ${error.suggestions.join(", ")}?`);
      }
      lines.push("  Run `lore list` to see available documents.");
      return lines.join("\n");
    }
    case "SLUG_NOT_FOUND": {
      const lines = [`Error: Slug not found: ${error.slug}`];
      if (error.suggestions && error.suggestions.length > 0) {
        lines.push(`  Suggestion: Did you mean one of: ${error.suggestions.join(", ")}?`);
      }
      return lines.join("\n");
    }
    case "STALE_VERSION":
      return (
        `Error: Version conflict for ${error.id}.\n` +
        `  Expected version ${error.expected} but current is ${error.actual}.\n` +
        `  Run \`lore get ${error.id}\` to see the latest version.`
      );
    case "VALIDATION_ERROR":
      return `Error: Validation failed on field '${error.field}': ${error.message}`;
    case "SCHEMA_VIOLATION":
      return (
        `Error: Schema violation for type '${error.type}'.\n` +
        `  Missing required fields: ${error.missing.join(", ")}` +
        (error.extra && error.extra.length > 0
          ? `\n  Unknown fields: ${error.extra.join(", ")}`
          : "")
      );
    case "LINK_CYCLE":
      return `Error: Link would create a cycle: ${error.path.join(" → ")}`;
    case "DUPLICATE_SLUG":
      return (
        `Error: Slug '${error.slug}' already exists (used by ${error.existing_id}).\n` +
        "  Use a different title or pass a unique slug."
      );
    case "DUPLICATE_LINK":
      return `Error: Link ${error.from} → ${error.to} (${error.type}) already exists.`;
    case "DELETE_REQUIRES_CONFIRM":
      return (
        `Error: Deletion requires confirmation.\n` +
        `  Run: lore delete ${error.id} --confirm`
      );
    case "INVALID_TRANSITION":
      return (
        `Error: Cannot transition from '${error.from}' to '${error.to}'.\n` +
        `  Allowed transitions from '${error.from}': ${error.allowed.join(", ")}`
      );
    case "PARENT_REQUIRED":
      return (
        `Error: Documents of type '${error.type}' require a parent.\n` +
        "  Pass --parent <id-or-slug> to specify the parent document."
      );
    case "INVALID_PARENT_TYPE":
      return (
        `Error: Invalid parent type for '${error.child}'.\n` +
        `  Parent type '${error.parent}' is not allowed. Allowed parent types: ${error.allowed.join(", ")}`
      );
    case "STORE_ERROR":
      return `Error: Storage failure: ${error.message}`;
    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return "Error: An unexpected error occurred.";
    }
  }
}

// ─── Table Output ───────────────────────────────────────────────────────────

/** Render a simple fixed-width table with aligned columns. */
export function formatTable(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const widths = headers.map((_, colIdx) =>
    Math.max(...allRows.map((r) => (r[colIdx] ?? "").length)),
  );

  const separator = widths.map((w) => "─".repeat(w)).join("  ");
  const headerLine = headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join("  ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => (cell ?? "").padEnd(widths[i] ?? 0)).join("  "),
  );

  return [headerLine, separator, ...dataLines].join("\n");
}

// ─── Tree Output ────────────────────────────────────────────────────────────

/** Render a doc tree with Unicode box-drawing characters. */
export function formatTree(node: TreeNode, prefix: string = ""): string {
  const label = `${node.doc.id.slice(0, 8)}… ${node.doc.title} (${node.doc.status})`;
  const lines: string[] = [prefix === "" ? label : label];

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const isLast = i === node.children.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";
    const childLines = formatTreeChildren(child, childPrefix);
    lines.push(prefix + connector + childLines[0]);
    for (let j = 1; j < childLines.length; j++) {
      lines.push(prefix + childLines[j]);
    }
  }

  return lines.join("\n");
}

function formatTreeChildren(node: TreeNode, prefix: string): string[] {
  const label = `${node.doc.id.slice(0, 8)}… ${node.doc.title} (${node.doc.status})`;
  const lines: string[] = [label];

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const isLast = i === node.children.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");
    const childLines = formatTreeChildren(child, childPrefix);
    lines.push(prefix + connector + childLines[0]);
    for (let j = 1; j < childLines.length; j++) {
      lines.push(prefix + childLines[j]);
    }
  }

  return lines;
}

// ─── Navigation Footer ──────────────────────────────────────────────────────

/** Render the navigation footer section for `lore get` output. */
export function formatNavigation(nav: DocWithNavigation["navigation"]): string {
  const lines: string[] = ["── Navigation " + "─".repeat(50)];

  if (nav.parent) {
    lines.push(`Parent:   ${nav.parent.id.slice(0, 8)}… ${nav.parent.title}`);
  } else {
    lines.push("Parent:   (none)");
  }

  if (nav.siblings.length > 0) {
    const sibStr = nav.siblings
      .slice(0, 5)
      .map((s) => `${s.id.slice(0, 8)}… ${s.title}`)
      .join(", ");
    lines.push(`Siblings: ${sibStr}`);
  } else {
    lines.push("Siblings: (none)");
  }

  if (nav.children.length > 0) {
    const childStr = nav.children
      .slice(0, 5)
      .map((c) => `${c.id.slice(0, 8)}… ${c.title}`)
      .join(", ");
    lines.push(`Children: ${childStr}`);
  } else {
    lines.push("Children: (none)");
  }

  if (nav.related.length > 0) {
    const relStr = nav.related
      .slice(0, 5)
      .map((r) => `${r.id.slice(0, 8)}… ${r.title} (${r.link_type})`)
      .join(", ");
    lines.push(`Related:  ${relStr}`);
  }

  return lines.join("\n");
}

// ─── Relative Time ──────────────────────────────────────────────────────────

/** Format ISO timestamp as relative time string ("2h ago", "3d ago"). */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
