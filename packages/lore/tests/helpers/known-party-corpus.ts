/**
 * A throwaway corpus driven through the REAL CLI (`bun run packages/lore/src/index.ts`) as three kinds of party:
 * nobody (no run, no session, every identity variable stripped), an attested agent run, or the person whose human
 * session was started in it. Shared by the known-party suites (spec-every-write-is-made-by-a-known-party-an-attested-agent-run:
 * AC-HID-1, AC-HID-2).
 *
 * Public surface: {@link createPartyCorpus}, {@link PartyCorpus}, {@link LoreRun}.
 *
 * Invariants:
 *   - The corpus lives under the OS tmpdir (`mkdtemp`), never the repository's own `.lore/`; `HOME` and the lore
 *     state directory (`LORE_STATE_HOME`, where human-session token files go) are inside it too, so no test touches the
 *     developer's real `~/.local/state/lore`.
 *   - A spawn "as nobody" carries NO harness-run flag and none of `CLAUDECODE` / `CLAUDE_CODE_SESSION_ID` /
 *     `CLAUDE_SESSION_ID` / `LORE_ACTOR`: the ambient identity of whoever runs the suite never decides a verdict.
 *   - Counts and rows are read straight from the corpus file (read-only) so an assertion about "nothing was written"
 *     does not depend on a lore command.
 *
 * Side-effect class: IO (spawns processes, reads and removes its own temp directory).
 */

import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerTestRun, scrubIdentityEnv } from "./test-run-identity.js";
import { HARNESS_RUN_ENV } from "@lore/core";

const ENTRY = join(new URL("../../", import.meta.url).pathname, "src", "index.ts");

/** What one spawned `lore` produced. */
export interface LoreRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** One audit row, as stored. */
export interface StoredAuditRow {
  readonly actor: string;
  readonly action: string;
  readonly harness_run: string | null;
  readonly details: Record<string, unknown>;
}

/** One version row, as stored (identity-bearing columns only). */
export interface StoredVersionRow {
  readonly version: number;
  readonly created_by: string;
  readonly harness_run: string | null;
}

/** Who a spawn runs as. */
export type Party =
  | { readonly kind: "nobody" }
  | { readonly kind: "run"; readonly run: string }
  /** The human session started in this corpus is the only identity the process has; `marker` adds `CLAUDECODE=1`. */
  | { readonly kind: "human"; readonly marker?: boolean };

/** A throwaway corpus plus the means to drive and inspect it. */
export interface PartyCorpus {
  readonly dir: string;
  readonly home: string;
  /** Run `lore <args>` in the corpus as `party` (default: nobody); `env` adds variables to the spawn's environment. */
  lore(args: readonly string[], party?: Party, env?: Record<string, string>): LoreRun;
  /** `lore <args>` as an attested agent run that this call registers first (a fixture writer); throws on a non-zero exit. */
  setup(args: readonly string[], run?: string): LoreRun;
  /** The slug a `lore create` printed. */
  slugOf(created: LoreRun): string;
  counts(): { readonly versions: number; readonly audit: number };
  auditRows(): readonly StoredAuditRow[];
  versionRowsOf(slug: string): readonly StoredVersionRow[];
  cleanup(): void;
}

/** The fixture writer's run (registered on first use). */
const SETUP_RUN = "cc:party-corpus-setup";

function spawnLore(dir: string, home: string, args: readonly string[], party: Party, extraEnv: Record<string, string>): LoreRun {
  const env: Record<string, string | undefined> = {
    ...scrubIdentityEnv(process.env),
    HOME: home,
    LORE_STATE_HOME: join(home, "state"),
    ...extraEnv,
  };
  const argv = [...args];
  if (party.kind === "run") {
    registerTestRun(dir, party.run);
    env[HARNESS_RUN_ENV] = party.run;
  } else {
    // reason: the test run's spawn rewrite (scripts/test-known-party-spawn.ts) gives every `lore` start a registered
    // agent run; these parties are exactly the ones that must NOT have one, so the start opts out of it.
    env["LORE_TEST_IDENTITY"] = "none";
    if (party.kind === "human" && party.marker === true) env["CLAUDECODE"] = "1";
  }
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...argv], { cwd: dir, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function openReadonly(dir: string): Database {
  return new Database(join(dir, ".lore", "lore.db"), { readonly: true });
}

/**
 * Create a corpus (`lore init`, run as nobody: init needs no known party) with a PRD, a plan and nothing else.
 *
 * @param prefix - temp directory name prefix
 */
export function createPartyCorpus(prefix: string): PartyCorpus {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `${prefix}-`)));
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const corpus: PartyCorpus = {
    dir,
    home,
    lore: (args, party = { kind: "nobody" }, env = {}) => spawnLore(dir, home, args, party, env),
    setup(args, run = SETUP_RUN) {
      const result = spawnLore(dir, home, args, { kind: "run", run }, {});
      if (result.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}${result.stdout}`);
      return result;
    },
    slugOf(created) {
      const match = created.stdout.match(/Slug:\s+(\S+)/);
      if (match?.[1] === undefined) throw new Error(`no slug in: ${created.stdout}`);
      return match[1];
    },
    counts() {
      const db = openReadonly(dir);
      try {
        const versions = (db.query("SELECT COUNT(*) AS n FROM versions").get() as { n: number }).n;
        const audit = (db.query("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n;
        return { versions, audit };
      } finally {
        db.close();
      }
    },
    auditRows() {
      const db = openReadonly(dir);
      try {
        const rows = db.query("SELECT actor, action, harness_run, details FROM audit ORDER BY id").all() as Array<{
          actor: string;
          action: string;
          harness_run: string | null;
          details: string | null;
        }>;
        return rows.map((r) => ({ actor: r.actor, action: r.action, harness_run: r.harness_run, details: r.details === null ? {} : (JSON.parse(r.details) as Record<string, unknown>) }));
      } finally {
        db.close();
      }
    },
    versionRowsOf(slug) {
      const db = openReadonly(dir);
      try {
        return db
          .query("SELECT v.version AS version, v.created_by AS created_by, v.harness_run AS harness_run FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ? ORDER BY v.version")
          .all(slug) as StoredVersionRow[];
      } finally {
        db.close();
      }
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  const init = corpus.lore(["init"]);
  if (init.exitCode !== 0) throw new Error(`fixture \`lore init\` failed (${init.exitCode}): ${init.stderr}${init.stdout}`);
  return corpus;
}
