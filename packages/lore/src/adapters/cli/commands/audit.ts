/**
 * lore audit [<doc>] [--actor <a>] [--action <x>] [--since <t>] [--limit <n>] [--json]
 * lore audit --verify [--since <t>] [--json]
 * lore audit anchor [--json]
 * lore audit arm [--confirm] [--json]
 *
 * Read/verify surface over the audit table (SPEC-035 §2; chain-integrity +
 * anchor added SPEC-079 G3):
 *   - `lore audit <doc>` — per-doc decision trail (who/what/when/basis, joined
 *     judgment summary when action="judge").
 *   - `lore audit --actor <a> --action <x> --since <t>` — filtered query (maps
 *     1:1 to AuditFilters); `<doc>` and filters may be combined.
 *   - `lore audit --verify [--since <t>]` — completeness oracle PLUS a
 *     whole-table chain-integrity walk and (when `.lore/audit-anchor.json`
 *     exists) an external-anchor cross-check: exit 0 iff all three are
 *     clean, exit 4 otherwise (itemized misses / the first chain break /
 *     an anchor mismatch). `--since` overrides the configured
 *     `audit.verify_since` watermark for the COMPLETENESS join only — the
 *     chain walk is never bounded by it (SPEC-079 G3, see AuditService's
 *     own `@invariant`).
 *   - `lore audit anchor [--json]` — pins the current chain head
 *     `(head_id, head_hash, entry_count)` to `.lore/audit-anchor.json` at
 *     the corpus root (git-tracked — see the root `.gitignore` exception),
 *     the external trust root a rewritten/rewound chain is checked against
 *     on every future `--verify` run. `anchor` is dispatched by POSITIONAL
 *     VALUE (`args.doc === "anchor"`), NOT a citty `subCommands` entry —
 *     citty routes ANY first non-flag token through `subCommands` when one
 *     is declared, which would break every existing `lore audit <doc-slug>`
 *     invocation (see `commands/feed.ts`'s identical
 *     `session-resume`/`phase-start`/`task-start` positional-dispatch
 *     precedent). Safe because a doc's `slug` is always `{type}-{kebab}`
 *     and a ULID is always 26 chars — the bare literal `"anchor"` can never
 *     collide with a real doc address. Fails loud (`VALIDATION_ERROR` → exit
 *     4) on an empty audit table rather than writing a degenerate anchor.
 *
 *   - `lore audit arm [--confirm]` — the per-corpus state-binding arming step (SPEC-143
 *     AC-CT-3, R13). Without `--confirm` it is READ-ONLY: it prints how many existing
 *     runner-attested rows would become `unbound` (refused by the floors) and exits 0.
 *     With `--confirm` it writes the single `state-binding-armed` audit row (idempotent) and
 *     reports the same numbers. Dispatched by positional value like `anchor`. Run it only
 *     after the runner writes stamps; arming earlier refuses every new stamp-less row.
 *
 * AI-authored entries (action="judge") carry `created_by`/`actor` encoded as
 * `ai:{provider}:{model}:{prompt_version}` (SPEC-034 §2) — rendered here via
 * `parseAuditActor` so human output never shows the raw encoded string.
 *
 * Exit codes: 0 = success (or verify/anchor clean), 3 = DOC_NOT_FOUND (bad
 *   <doc>), 4 = VALIDATION_ERROR | verify found misses/a chain break/an
 *   anchor mismatch, 1 = STORE_ERROR.
 *
 * Source: SPEC-035 §2, SPEC-079 G3
 */

import { writeFileSync } from "fs";

import { defineLoreCommand } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { resolveConsumerCorpusRoot } from "../report-issue-wiring.js";
import { exitCode, formatErrorFor, formatTable, parsePositiveIntArg, resolveActor } from "../utils.js";
import { parseAuditActor, type AuditEntry } from "@lore/core";
import type { AuditFilters } from "../../../store/store-interface.js";
import type { AuditMiss } from "../../../service/audit-service.js";
import { auditAnchorFilePath, readAuditAnchorFile, type AuditAnchorFile } from "../../../service/audit-verify-runner.js";
import { invocationOf } from "../command-invocation.js";
import { resolveTrackedWriteRoot } from "../working-tree-root.js";
import { printLine } from "../output.js";

// ─── SPEC-079 G3 — `.lore/audit-anchor.json` ───────────────────────────────
//
// The file contract (schema, path, reader) lives in service/audit-verify-runner.ts and is shared by this command
// and the HTTP/MCP verify surfaces, so every surface reads the anchor the same way. This command writes it
// (`lore audit anchor`) and reads it (`lore audit --verify`).

/** Render `created_by`/`actor` for display — decodes AI judge identities (SPEC-034 §2). */
function formatActor(actor: string): string {
  const parsed = parseAuditActor(actor);
  return parsed.kind === "ai"
    ? `ai:${parsed.judge.provider}/${parsed.judge.model}@${parsed.judge.prompt_version}`
    : parsed.name;
}

/** One-line summary of an audit entry's `details`, surfacing judgment_ref when present. */
function summarizeDetails(entry: AuditEntry): string {
  const details = entry.details ?? {};
  if (typeof details["judgment_ref"] === "string") {
    return `judgment:${details["judgment_ref"]}`;
  }
  const json = JSON.stringify(details);
  return json.length > 60 ? `${json.slice(0, 57)}...` : json;
}

export default defineLoreCommand({
  meta: {
    name: "audit",
    description: "Query the audit trail, verify its completeness/chain-integrity, or anchor the chain head",
  },
  args: {
    doc: {
      type: "positional",
      description: "Document ID or slug — show its decision trail. The literal 'anchor' pins the chain head to .lore/audit-anchor.json instead; 'arm' reports (or with --confirm writes) the state-binding arming row",
      required: false,
    },
    actor: {
      type: "string",
      description: "Filter by actor (exact match; e.g. 'alice' or 'ai:claude-cli:claude-sonnet-5:v1')",
    },
    action: {
      type: "string",
      description: "Filter by action (create|update|delete|approve|reject|restore|claim|release|evidence|judge)",
    },
    since: {
      type: "string",
      description: "ISO 8601 — only entries at/after this time (query mode) or verify watermark override",
    },
    limit: {
      type: "string",
      description: "Max entries to return (query mode only)",
    },
    verify: {
      type: "boolean",
      description: "Run the completeness oracle instead of a query (versions⋈audit reconcile)",
    },
    confirm: {
      type: "boolean",
      description: "With `arm`: actually write the state-binding-armed audit row (default is a read-only impact report)",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      // ── arm branch (positional value "arm", same dispatch as "anchor") ──
      if (args.doc === "arm") {
        const stateBinding = app.stateBindingService;
        if (stateBinding === undefined) {
          inv.io.stderr.write("Error: stateBindingService is not wired on this App (internal wiring error)\n");
          return 1;
        }
        const result = args.confirm
          ? await stateBinding.arm({ actor: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user), nowIso: new Date().toISOString() })
          : await stateBinding.reportImpact();
        if (!result.ok) {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          return exitCode(result.error);
        }
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
          return 0;
        }
        const value = result.value;
        if ("status" in value && value.status === "already_armed") {
          printLine(inv.io.stdout, `State binding already armed (audit row id ${value.arming_rev}); nothing written.`);
          return 0;
        }
        const report = "status" in value ? value.report : value;
        printLine(inv.io.stdout, 
          `${report.would_become_unbound_rows} attested row(s) in ${report.would_become_unbound_docs} doc(s) ` +
            `would become UNBOUND (audit_id_unresolved) and be refused by the floors once armed ` +
            `(${report.attested_rows} attested of ${report.evidence_rows} evidence rows in ${report.docs_with_evidence} docs; ` +
            `${report.unresolved_evidence_rows} evidence rows have no resolvable audit id).`,
        );
        if (report.would_become_unbound_slugs.length > 0) {
          printLine(inv.io.stdout, `Docs: ${report.would_become_unbound_slugs.join(", ")}`);
        }
        if ("status" in value) {
          printLine(inv.io.stdout, `Armed: wrote state-binding-armed audit row id ${value.arming_rev}.`);
        } else {
          printLine(inv.io.stdout, "Report only — nothing written. Re-run with --confirm to arm this corpus.");
        }
        return 0;
      }

      // ── anchor branch (positional value "anchor" — see module header for
      // why this is a positional-value dispatch, not a citty subCommand) ──
      if (args.doc === "anchor") {
        const headResult = await app.auditService.getChainHead();
        if (!headResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, headResult.error) + "\n");
          return exitCode(headResult.error);
        }

        const anchorFile: AuditAnchorFile = {
          head_id: headResult.value.head_id,
          head_hash: headResult.value.head_hash,
          entry_count: headResult.value.entry_count,
          anchored_at: new Date().toISOString(),
        };
        // reason: INT-T5 — audit-anchor.json is tracked; pin the head in the invoking working tree, while the
        // chain head itself was read from the shared corpus above.
        const anchorRoot = resolveTrackedWriteRoot(inv.cwd, resolveConsumerCorpusRoot(inv.io, inv));
        if (!anchorRoot.ok) {
          inv.io.stderr.write(formatErrorFor(inv, anchorRoot.error) + "\n");
          return exitCode(anchorRoot.error);
        }
        writeFileSync(auditAnchorFilePath(anchorRoot.value),`${JSON.stringify(anchorFile, null, 2)}\n`, "utf8");

        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: anchorFile }, null, 2));
        } else {
          printLine(inv.io.stdout, 
            `Anchored audit chain head (id ${anchorFile.head_id}, ${anchorFile.entry_count} entr${anchorFile.entry_count === 1 ? "y" : "ies"}) → .lore/audit-anchor.json`,
          );
        }
        return 0;
      }

      // ── --verify branch ─────────────────────────────────────────────────
      if (args.verify) {
        // reason: INT-T5 — the anchor file is tracked, so it is read from the same invoking working tree it is written to.
        const anchorRoot = resolveTrackedWriteRoot(inv.cwd, resolveConsumerCorpusRoot(inv.io, inv));
        if (!anchorRoot.ok) {
          inv.io.stderr.write(formatErrorFor(inv, anchorRoot.error) + "\n");
          return exitCode(anchorRoot.error);
        }
        const anchorRead = readAuditAnchorFile(anchorRoot.value);
        if (!anchorRead.ok) {
          inv.io.stderr.write(`Error: ${anchorRead.error.code === "VALIDATION_ERROR" ? anchorRead.error.message : formatErrorFor(inv, anchorRead.error)}\n`);
          return 4;
        }
        const anchor = anchorRead.value;

        const result = await app.auditService.verify({
          ...(args.since !== undefined ? { since: args.since } : {}),
          ...(anchor !== undefined ? { anchor } : {}),
        });
        if (!result.ok) {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          return exitCode(result.error);
        }

        const { clean, misses, since, chain, anchor: anchorResult } = result.value;

        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { clean, misses, since, chain, anchor: anchorResult } }, null, 2));
          return clean ? 0 : 4;
        }

        if (misses.length === 0) {
          printLine(inv.io.stdout, `Audit trail is complete since ${since} — no missing entries.`);
        } else {
          printLine(inv.io.stdout, `Audit trail is INCOMPLETE since ${since} — ${misses.length} missing entr${misses.length === 1 ? "y" : "ies"}:`);
          const headers = ["Doc ID", "Version", "Action", "Created At"];
          const rows = misses.map((m: AuditMiss) => [m.doc_id, `v${m.version}`, m.action, m.created_at]);
          printLine(inv.io.stdout, formatTable(headers, rows));
        }

        if (chain.clean) {
          printLine(inv.io.stdout, `Chain integrity: clean (${chain.checked} entr${chain.checked === 1 ? "y" : "ies"} checked).`);
        } else if (chain.break !== undefined) {
          printLine(inv.io.stdout, 
            `Chain integrity: BROKEN at audit row id ${chain.break.id} (${chain.break.reason}) — ${chain.checked} entr${chain.checked === 1 ? "y" : "ies"} checked before the break.`,
          );
        }

        if (anchorResult.status === "absent") {
          printLine(inv.io.stdout, "Anchor: none set — run `lore audit anchor` to pin a trust root.");
        } else if (anchorResult.status === "clean") {
          printLine(inv.io.stdout, `Anchor: verified (head id ${anchorResult.head_id}).`);
        } else {
          printLine(inv.io.stdout, 
            `Anchor: MISMATCH (${anchorResult.reason}) — expected head id ${anchorResult.head_id} hash ${anchorResult.head_hash}. The chain may have been rewritten or rewound since anchoring.`,
          );
        }

        return clean ? 0 : 4;
      }

      // ── query branch ─────────────────────────────────────────────────────
      // BUG-007 audit: an unvalidated NaN --limit reaches the store's `LIMIT ?`
      // bind and throws a bare bun:sqlite "datatype mismatch" — validate first.
      let limitValue: number | undefined;
      if (args.limit !== undefined) {
        const limitResult = parsePositiveIntArg(args.limit, "--limit", { min: 1 });
        if (!limitResult.ok) {
          inv.io.stderr.write(limitResult.message + "\n");
          return 2;
        }
        limitValue = limitResult.value;
      }

      const filters: AuditFilters = {
        ...(args.actor !== undefined ? { actor: args.actor } : {}),
        ...(args.action !== undefined ? { action: args.action } : {}),
        ...(args.since !== undefined ? { since: args.since } : {}),
        ...(limitValue !== undefined ? { limit: limitValue } : {}),
      };

      if (args.doc !== undefined) {
        const resolveResult = await app.corpusService.resolve(args.doc);
        if (!resolveResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, resolveResult.error) + "\n");
          return exitCode(resolveResult.error);
        }
        filters.doc_id = resolveResult.value;
      }

      const result = await app.auditService.query(filters);
      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const entries = result.value;

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { entries, total: entries.length } }, null, 2));
        return 0;
      }

      if (entries.length === 0) {
        printLine(inv.io.stdout, "No audit entries found.");
        return 0;
      }

      const headers = ["Timestamp", "Actor", "Action", "Details"];
      const rows = entries.map((e) => [
        e.timestamp.slice(0, 19).replace("T", " "),
        formatActor(e.actor),
        e.action,
        summarizeDetails(e),
      ]);

      printLine(inv.io.stdout, args.doc !== undefined ? `Audit trail for ${args.doc}:` : "Audit trail:");
      printLine(inv.io.stdout, formatTable(headers, rows));
    } finally {
      app.close();
    }
    return 0;
  },
});
