/**
 * Shared CLI utilities — error formatting and output helpers.
 * No business logic here; only terminal I/O concerns.
 *
 * Public surface:
 *   - exitCode() / formatError() — error presentation
 *   - formatTable() / formatTree() / formatNavigation() / relativeTime() — output helpers
 *
 * Note: DB discovery and App construction live in `loader.ts` to avoid
 * importing bun:sqlite into this module (vitest cannot resolve bun:sqlite).
 * CLI commands that need an App instance should import from `loader.ts`.
 *
 * Side-effect class: pure (no IO, no process.exit)
 *
 * Source: SPEC-003 §5
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { userInfo } from "os";
import { z } from "zod";
import { evidenceEntrySchema, taskClaimSchema, isClaimStale } from "@lore/core";
import type { DocRecord, LoreError } from "@lore/core";
import type { TreeNode } from "../../service/corpus-service.js";
import type { DocWithNavigation } from "../../service/corpus-service.js";

const evidenceArraySchema = z.array(evidenceEntrySchema);

// ─── DB Discovery (used only by loader.ts) ──────────────────────────────────

/**
 * Walk up from cwd looking for .lore/lore.db.
 * Exits with code 1 if not found (suggests `lore init`).
 *
 * @returns absolute path to the lore.db file
 */
export function findLoreDbPath(): string {
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

/**
 * Map a LoreError code to a CLI exit code per SPEC-003 §5.
 *
 * @param error - LoreError from a service call
 * @returns numeric exit code (1 | 3 | 4 | 5)
 */
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
    // reason: CLAIM_CONFLICT is a write-contention error like STALE_VERSION — both mean
    // "someone else won the race, re-read and retry" — mapped to the same exit code.
    // Source: SPEC-025 §4 AC-WF-3
    case "CLAIM_CONFLICT":
      return 5;
    case "AI_PROVIDER_ERROR":
      // reason: exit 6 reserved for AI provider failures — distinct from generic store/validation
      // errors so callers can detect AI-specific failures without parsing stderr (SPEC-017 §3.4)
      return 6;
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

/**
 * Human-readable error message with contextual suggestions.
 *
 * @param error - LoreError from a service call
 * @param opts.aiHasNoFallback - Pass `true` from a caller whose command has NO non-AI mode
 *   (currently only `lore assess`, SPEC-026 §3 D5). When set, an AI_PROVIDER_ERROR renders
 *   assess-specific recovery guidance instead of the default "Retry with --no-ai" hint —
 *   suggesting `--no-ai` to a command that always exits 2 on it is actively misleading
 *   (SPEC-029 AC-AR-5). Every other caller (create/set/link) DOES have a non-AI editor
 *   fallback, so they omit this option and keep the original hint.
 * @returns formatted string for stderr output
 */
export function formatError(error: LoreError, opts?: { aiHasNoFallback?: boolean }): string {
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
    case "AI_PROVIDER_ERROR": {
      // Multi-line format per SPEC-017 §3.4: provider name, exit code, stderr excerpt, retry hint
      const lines = [
        `Error: AI provider${error.provider ? ` "${error.provider}"` : ""} failed.`,
        `  ${error.message}`,
      ];
      if (error.exit_code !== undefined) {
        lines.push(`  exit code: ${error.exit_code}`);
      }
      if (error.stderr) {
        lines.push(`  stderr: ${error.stderr}`);
      }
      if (opts?.aiHasNoFallback) {
        // reason: assess has no non-AI mode (SPEC-026 §3 D5) — suggesting --no-ai here would
        // send the user straight into another exit-2 contradiction (SPEC-029 AC-AR-5).
        lines.push("  This command has no non-AI fallback. To recover:");
        lines.push("    1. Retry the command — the failure may be transient.");
        lines.push(
          "    2. Check `ai.provider` in .lore/config.yaml and that the configured provider " +
            "(e.g. the `claude` binary) is installed and reachable.",
        );
        lines.push("    3. Inspect the raw AI output above (already included in the message) for clues.");
      } else {
        lines.push("  Retry with --no-ai to use the editor instead.");
      }
      return lines.join("\n");
    }
    case "STORE_ERROR":
      return `Error: Storage failure: ${error.message}`;
    case "CLAIM_CONFLICT":
      return (
        `Error: Task ${error.id} is claimed by '${error.holder}' (claimed ${error.age_minutes}m ago).\n` +
        "  Pass --steal (claim) or --force (release) to override, or wait for the lease to expire."
      );
    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return "Error: An unexpected error occurred.";
    }
  }
}

// ─── Actor Resolution ───────────────────────────────────────────────────────

/**
 * Resolve the acting user identity for `claim` / `release` / `evidence` commands.
 * Resolution order (first non-empty wins):
 *   1. --by flag (explicit, always wins)
 *   2. $LORE_ACTOR environment variable
 *   3. OS username (os.userInfo().username)
 *
 * @param explicit - Value of the --by flag, if the user passed one
 * @returns Resolved actor identity string (never empty — OS username is always available)
 * @example
 *   resolveActor(undefined) // => "$LORE_ACTOR" or OS username
 *   resolveActor("alice")   // => "alice"
 */
export function resolveActor(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== "") return explicit;
  const envActor = process.env["LORE_ACTOR"];
  if (envActor !== undefined && envActor.trim() !== "") return envActor;
  return userInfo().username;
}

// ─── Task Workflow Badges (SPEC-025 AC-WF-9) ────────────────────────────────

/**
 * Render a `[claimed:by(stale) ✔n]`-style badge for a task row in `lore list` /
 * `lore tree`. Reads task.extra.claim / task.extra.verification_evidence directly
 * (no service round trip — this is presentation, not a domain query) and validates
 * each via the same Zod schemas the store enforces, so malformed extra silently
 * renders no badge rather than throwing.
 *
 * @param doc - Full task DocRecord (must include `extra` — DocSummary lacks it)
 * @param nowIso - Current time (ISO 8601) for claim staleness computation
 * @param ttlMinutes - Claim TTL in minutes — pass `app.taskWorkflowService.claimTtlMinutes`
 * @returns `""` when the task has neither a claim nor evidence; otherwise a
 *   bracketed badge string with a leading space, ready to append to a row label
 * @example
 *   formatWorkflowBadge(task, new Date().toISOString(), 120)
 *   // " [claimed:alice ✔3]" or " [claimed:bob (stale) ✘1]" or ""
 */
export function formatWorkflowBadge(doc: DocRecord, nowIso: string, ttlMinutes: number): string {
  const parts: string[] = [];

  const claimRaw = doc.extra["claim"];
  if (claimRaw !== undefined && claimRaw !== null) {
    const parsedClaim = taskClaimSchema.safeParse(claimRaw);
    if (parsedClaim.success) {
      const stale = isClaimStale(parsedClaim.data, nowIso, ttlMinutes);
      parts.push(`claimed:${parsedClaim.data.by}${stale ? " (stale)" : ""}`);
    }
  }

  const evidenceRaw = doc.extra["verification_evidence"];
  if (Array.isArray(evidenceRaw) && evidenceRaw.length > 0) {
    const parsedEvidence = evidenceArraySchema.safeParse(evidenceRaw);
    if (parsedEvidence.success && parsedEvidence.data.length > 0) {
      const last = parsedEvidence.data[parsedEvidence.data.length - 1];
      if (last !== undefined) {
        parts.push(last.result === "fail" ? `✘${parsedEvidence.data.length}` : `✔${parsedEvidence.data.length}`);
      }
    }
  }

  return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
}

// ─── Table Output ───────────────────────────────────────────────────────────

/**
 * Render a simple fixed-width table with aligned columns.
 *
 * @param headers - column header labels
 * @param rows - data rows (arrays of strings matching header count)
 * @returns formatted multi-line string ready for console output
 */
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

/**
 * Render a doc tree with Unicode box-drawing characters.
 *
 * @param node - root TreeNode from CorpusService.getTree()
 * @param prefix - indentation prefix (empty string for root)
 * @param badges - optional DocId → workflow badge string lookup (AC-WF-9); rows
 *   whose id is absent from the map render with no badge. Default empty (no
 *   badges) keeps this fully backward-compatible with pre-SPEC-025 callers.
 * @returns multi-line string with tree connectors
 */
export function formatTree(
  node: TreeNode,
  prefix: string = "",
  badges: ReadonlyMap<string, string> = new Map(),
): string {
  const label = `${node.doc.id.slice(0, 8)}… ${node.doc.title} (${node.doc.status})${badges.get(node.doc.id) ?? ""}`;
  const lines: string[] = [prefix === "" ? label : label];

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const isLast = i === node.children.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";
    const childLines = formatTreeChildren(child, childPrefix, badges);
    lines.push(prefix + connector + childLines[0]);
    for (let j = 1; j < childLines.length; j++) {
      lines.push(prefix + childLines[j]);
    }
  }

  return lines.join("\n");
}

function formatTreeChildren(
  node: TreeNode,
  prefix: string,
  badges: ReadonlyMap<string, string>,
): string[] {
  const label = `${node.doc.id.slice(0, 8)}… ${node.doc.title} (${node.doc.status})${badges.get(node.doc.id) ?? ""}`;
  const lines: string[] = [label];

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const isLast = i === node.children.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");
    const childLines = formatTreeChildren(child, childPrefix, badges);
    lines.push(prefix + connector + childLines[0]);
    for (let j = 1; j < childLines.length; j++) {
      lines.push(prefix + childLines[j]);
    }
  }

  return lines;
}

// ─── Navigation Footer ──────────────────────────────────────────────────────

/**
 * Render the navigation footer section for `lore get` output.
 *
 * @param nav - navigation section from DocWithNavigation
 * @returns formatted multi-line string
 */
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

/**
 * Format ISO timestamp as relative time string ("2h ago", "3d ago").
 *
 * @param iso - ISO 8601 timestamp string
 * @returns human-readable relative time
 */
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
