#!/usr/bin/env bun
/**
 * One-process corpus reader for `check-ac-oracle-ownership.ts`
 * (`task-check-ac-oracle-ownership-scans-only-what-changed-so-the`).
 *
 * Purpose: print every spec's slug, status, criteria and red-first declarations as ONE JSON
 * document, read in-process from the spec documents (the data `lore ac list` reads). Replaces one `lore ac list <spec> --json` spawn per spec — measured as the whole cost
 * of the check (the test-file scan is under 0.1 s), so the check stays exact with no cache and
 * no partial scan.
 * Public surface: `readCorpusSpecAcs` (IO), `CorpusDumpError`, and the stdout JSON shape `CorpusDump`.
 * Invariants: any unreadable spec fails the whole dump (exit 1) — never a partial dump (AS-17).
 * Side-effect class: IO (read-only corpus access). A separate file because `createApp` imports
 * `bun:sqlite`, which vitest-run test files must not import transitively.
 *
 * Usage: bun scripts/check-ac-oracle-ownership-corpus.ts   (cwd = the corpus root)
 */

import { specAcceptanceCriteriaSchema } from "@lore/core";
import { ambientOfInvocation, createApp, type App } from "../packages/lore/src/app.js";
import { resolveEntryInvocation } from "../packages/lore/src/adapters/cli/run-cli.js";
import { findLoreDbPath } from "../packages/lore/src/adapters/cli/utils.js";

export interface CorpusDumpSpec {
  readonly slug: string;
  readonly status: string;
  readonly criteria: readonly { id: string; verify?: { mode?: string | undefined; command?: string | undefined } | undefined }[];
  readonly allow_missing_declarations: readonly { ac_id: string; reason: string }[];
}
export interface CorpusDump {
  readonly specs: readonly CorpusDumpSpec[];
}

/** Thrown when a spec's criteria cannot be read; carries the slug so the failure names its cause. */
export class CorpusDumpError extends Error {
  constructor(
    readonly slug: string,
    message: string,
  ) {
    super(`${slug}: ${message}`);
    this.name = "CorpusDumpError";
  }
}

/**
 * Reads every spec of the corpus behind `app` with its criteria. Criteria and red-first
 * declarations are read straight off `spec.extra` with the SAME rules `AcService.listCriteria`
 * applies (`specAcceptanceCriteriaSchema` safeParse, unparseable -> `[]`; well-formed
 * `allow_missing_path_declarations` entries only). reason: `listCriteria` also walks every plan
 * and task of the spec for coverage facts this check never reads — measured 88 s for 223 specs.
 * `scripts/tests/check-ac-oracle-ownership-bulk.test.ts` pins the two readers to equal output.
 */
export async function readCorpusSpecAcs(app: App): Promise<CorpusDump> {
  const listed = await app.corpusService.listFull({ type: "spec" });
  if (!listed.ok) throw new CorpusDumpError("(list)", JSON.stringify(listed.error));
  const specs: CorpusDumpSpec[] = [];
  for (const doc of listed.value.docs) {
    if (doc.status === "deprecated") {
      specs.push({ slug: doc.slug, status: doc.status, criteria: [], allow_missing_declarations: [] });
      continue;
    }
    const parsed = specAcceptanceCriteriaSchema.safeParse(doc.extra["acceptance_criteria"]);
    const criteria = parsed.success ? parsed.data : [];
    const rawDecls = doc.extra["allow_missing_path_declarations"];
    const declarations: { ac_id: string; reason: string }[] = [];
    for (const entry of Array.isArray(rawDecls) ? rawDecls : []) {
      if (typeof entry !== "object" || entry === null) continue;
      const row = entry as Record<string, unknown>;
      if (typeof row["ac_id"] === "string" && typeof row["reason"] === "string" && typeof row["declared_at"] === "string") {
        declarations.push({ ac_id: row["ac_id"], reason: row["reason"] });
      }
    }
    specs.push({
      slug: doc.slug,
      status: doc.status,
      criteria: criteria.map((c) => ({
        id: c.id,
        ...(c.verify === undefined ? {} : c.verify.mode === "script" ? { verify: { mode: c.verify.mode, command: c.verify.command } } : { verify: { mode: c.verify.mode } }),
      })),
      allow_missing_declarations: declarations,
    });
  }
  return { specs };
}

if (import.meta.main) {
  try {
    const inv = await resolveEntryInvocation(process.argv.slice(2));
    const app = createApp(findLoreDbPath(inv.io, inv), undefined, ambientOfInvocation(inv), { identity: inv.identity });
    const dump = await readCorpusSpecAcs(app);
    process.stdout.write(JSON.stringify(dump));
    process.exit(0);
  } catch (e) {
    console.error(`check-ac-oracle-ownership-corpus: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
