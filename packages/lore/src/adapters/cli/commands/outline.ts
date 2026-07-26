/**
 * lore outline — SPEC-080 C1/C4 structured PRD outline + plan-close sync
 * exemption verb family. Thin pipe over `PrdOutlineService` — zero business
 * logic here (upsert/CAS/validation rules all live in the service; see its
 * module header). Mirrors `lore ac`/`lore requirement` one tier up.
 *
 * Subcommands:
 *   set    <prd> --section <key> --title <t> --tier <core|domain>
 *          --direction <text> [--decision-pointer <adr-slug> repeatable]
 *          [--constraint <text> repeatable] [--link <slug:rel> repeatable]
 *            Single-entry CAS upsert (`PrdOutlineService.outlineSet`, always
 *            called with `{ create: true }` — see below). An existing entry
 *            with a matching `section` is replaced wholesale; every sibling
 *            entry is carried through byte-identical.
 *   list   <prd> [--json]
 *            List declared outline entries in declaration order.
 *   rm     <prd> <section>
 *            Remove a declared entry by its `section` key.
 *   exempt <plan> --reason <text> [--by <name>]
 *            Record an audited plan-close sync exemption
 *            (`plan.extra.prd_sync_exempt`). `--reason` is required — a
 *            missing/blank value is a CLI usage error (exit 2), never
 *            forwarded to the service as an empty string.
 *
 * All subcommands accept --json for machine-readable output.
 * Exit codes per SPEC-003 §5 (via utils.ts::exitCode):
 *   0 = success
 *   2 = CLI usage error (missing --reason on `exempt`; unknown flag via the
 *       SPEC-051 strict-flag seam)
 *   3 = DOC_NOT_FOUND
 *   4 = VALIDATION_ERROR (not a prd/plan target, malformed entry, unknown
 *       section on `rm`, blank reason reaching the service)
 *   5 = STALE_VERSION
 *
 * @invariant `set` always passes `{ create: true }` to `outlineSet` — the
 *   CLI verb is upsert-shaped by design (a human/agent authoring a section
 *   for the first time should not need a separate "create" ceremony); the
 *   service's own default (update-only, reject unmatched `section`) exists
 *   to protect OTHER, non-CLI callers from an accidental new entry, not this
 *   adapter (SPEC-080 C1, `PrdOutlineService.outlineSet`'s own invariant
 *   doc). This is a parameter-default choice, not a business rule — the
 *   actual upsert/CAS logic still lives entirely in the service.
 *
 * Source: SPEC-080 C1, C4; adapters/cli/CLAUDE.md thin-adapter invariant
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import type { OutlineEntry, OutlineLinkRel } from "@lore/core";
import type { PrdOutlineService } from "../../../service/prd-outline-service.js";
import type { App } from "../../../app.js";

/**
 * `App.prdOutlineService` is typed optional only to keep pre-existing
 * hand-built App test stubs (outside this task's file anchors) compiling —
 * see `AcService`'s identical guard in `commands/ac.ts`. `loadLoreApp()`
 * (this adapter's only App source) always returns a fully-wired App from
 * `createApp`, so this assertion never actually fires in the CLI.
 */
function requireOutlineService(app: App): PrdOutlineService {
  if (app.prdOutlineService === undefined) {
    throw new Error("Internal error: PrdOutlineService not wired on App");
  }
  return app.prdOutlineService;
}

export default defineCommand({
  meta: {
    name: "outline",
    description: "Manage a PRD's structured outline and plan-close sync exemptions (SPEC-080)",
  },
  subCommands: {
    set: defineCommand({
      meta: { name: "set", description: "Upsert a single outline entry on a PRD" },
      args: {
        prd: {
          type: "positional",
          description: "PRD document ID or slug",
          required: true,
        },
        section: {
          type: "string",
          description: "Stable section key, e.g. 'distribution'",
          required: true,
        },
        title: {
          type: "string",
          description: "Rendered heading for this entry",
          required: true,
        },
        tier: {
          type: "string",
          description: "Budget tier: core | domain",
          required: true,
        },
        direction: {
          type: "string",
          description: "Bounded summary prose",
          required: true,
        },
        "decision-pointer": {
          type: "string",
          description: "[repeatable] ADR slug this entry's narrative embeds/depends on",
        },
        constraint: {
          type: "string",
          description: "[repeatable] Hard invariant (not general narrative)",
        },
        link: {
          type: "string",
          description: "[repeatable] 'slug:rel' pointer, rel one of detail|landing-spec|adr",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const candidate = buildOutlineEntryCandidate(args);
          const result = await requireOutlineService(app).outlineSet(args.prd as string, candidate, {
            create: true,
          });

          if (!result.ok) {
            if (args.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
            else process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
            return;
          }

          console.log(
            `Set outline entry "${args.section as string}" on ${args.prd as string} (${result.value.length} entries).`,
          );
        } finally {
          app.close();
        }
      },
    }),

    list: defineCommand({
      meta: { name: "list", description: "List a PRD's declared outline entries" },
      args: {
        prd: {
          type: "positional",
          description: "PRD document ID or slug",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const result = await requireOutlineService(app).outlineList(args.prd as string);

          if (!result.ok) {
            if (args.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
            else process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
            return;
          }

          if (result.value.length === 0) {
            console.log("No outline entries declared on this PRD.");
            return;
          }

          renderOutlineList(result.value);
        } finally {
          app.close();
        }
      },
    }),

    rm: defineCommand({
      meta: { name: "rm", description: "Remove a declared outline entry by section key" },
      args: {
        prd: {
          type: "positional",
          description: "PRD document ID or slug",
          required: true,
        },
        section: {
          type: "positional",
          description: "Section key to remove",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const result = await requireOutlineService(app).outlineRm(args.prd as string, args.section as string);

          if (!result.ok) {
            if (args.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
            else process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
            return;
          }

          console.log(`Removed outline entry "${args.section as string}" from ${args.prd as string}.`);
          if (result.value.length > 0) {
            renderOutlineList(result.value);
          } else {
            console.log("No outline entries remaining.");
          }
        } finally {
          app.close();
        }
      },
    }),

    exempt: defineCommand({
      meta: { name: "exempt", description: "Record an audited plan-close sync exemption" },
      args: {
        plan: {
          type: "positional",
          description: "Plan document ID or slug",
          required: true,
        },
        reason: {
          type: "string",
          description: "Required justification for the exemption",
        },
        by: {
          type: "string",
          description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        // reason is a CLI usage error when missing/blank (exit 2), not forwarded
        // to the service (which would surface it as VALIDATION_ERROR, exit 4) —
        // mirrors evidence.ts's mutual-flag usage-error convention.
        if (typeof args.reason !== "string" || args.reason.trim().length === 0) {
          process.stderr.write("Error: --reason is required and must not be blank.\n");
          process.exitCode = 2;
          return;
        }

        const { app } = loadLoreApp();
        try {
          const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
          const result = await requireOutlineService(app).exempt(args.plan as string, {
            reason: args.reason,
            by,
          });

          if (!result.ok) {
            if (args.json) console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
            else process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
            return;
          }

          console.log(`Recorded plan-close sync exemption for ${args.plan as string}: ${result.value.reason}`);
        } finally {
          app.close();
        }
      },
    }),
  },
});

// ─── Input Assembly ──────────────────────────────────────────────────────────

/**
 * Assemble a candidate outline entry from raw CLI args — deliberately
 * untyped (`unknown` at the `PrdOutlineService` boundary): `outlineEntrySchema`
 * is the single source of truth for shape validation. This function only
 * shapes the object (incl. citty's single-value/array normalization for
 * repeatable flags and `slug:rel` link-pair parsing); it does not validate.
 */
function buildOutlineEntryCandidate(args: Record<string, unknown>): unknown {
  return {
    section: args.section as string,
    title: args.title as string,
    tier: args.tier as string,
    direction: args.direction as string,
    decision_pointers: toStringArray(args["decision-pointer"]),
    constraints: toStringArray(args.constraint),
    links: toStringArray(args.link).map(parseLinkPair),
  };
}

/**
 * citty yields a string for one occurrence of a repeatable flag, an array for
 * ≥2, and `undefined` for zero — normalize to a string array (mirrors
 * `ac.ts`'s `--covers` handling).
 */
function toStringArray(raw: unknown): string[] {
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw as string[];
  return [];
}

/**
 * Parses a `--link "slug:rel"` value into `{ slug, rel }`. Splits on the
 * FIRST colon only (a slug never contains one, per `slugSchema`) — passed
 * through untyped when malformed so `outlineEntrySchema`'s discriminated
 * `rel` enum surfaces the actual bad value in its VALIDATION_ERROR, not a
 * CLI-side pre-check.
 */
function parseLinkPair(raw: string): { slug: string; rel: string } {
  const idx = raw.indexOf(":");
  if (idx === -1) return { slug: raw, rel: "" };
  return { slug: raw.slice(0, idx), rel: raw.slice(idx + 1) as OutlineLinkRel };
}

// ─── Output Helpers ──────────────────────────────────────────────────────────

function renderOutlineList(entries: OutlineEntry[]): void {
  for (const entry of entries) {
    console.log(`  ${entry.section} — ${entry.title} [${entry.tier}]`);
  }
}
