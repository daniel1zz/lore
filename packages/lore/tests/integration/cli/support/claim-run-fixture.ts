/**
 * Shared fixture for the claim/release-by-run RED suites.
 *
 * @spec_ref AC-RID-12, AC-RID-13, AC-RID-14
 *   (spec-run-identity-slice-1-harness-attested-runs-attested D1/D2/D6/D11; BR-1040..BR-1043)
 *
 * Every suite drives the REAL CLI (`bun run packages/lore/src/index.ts`) against its own
 * mkdtemp corpus created with `lore init` — never the repo's own `.lore/`.
 *
 * Why direct SQLite access exists here (and only here):
 *   - a LEGACY claim (stored before migration 016: no `harness_run` key at all) and a STALE
 *     claim cannot be produced through the CLI — the CLI always writes the new shape and
 *     stamps "now". Seeding them is the only way to reach BR-1042 and the stale-takeover rule.
 *   - phase documents are not creatable through `lore create` (migration-created only), so
 *     the phase target is created through the real `createApp` composition root.
 *
 * MOCK RISK (seeding): a hand-written legacy claim could drift from what pre-016 code wrote.
 * The shape used is exactly `taskClaimSchema` as it exists today (by/at only, no session id,
 * no harness_run key), which is what an old `lore claim` without session env wrote.
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { patchLoreConfig } from "../../../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../../src/app.js";
import type { App } from "../../../../src/app.js";
import type { CreateDocInput } from "@lore/core";
import { sessionIdOfActor } from "../../../helpers/session-actor";
import { liveAmbient, liveWriteContext } from "../../../live-invocation.js";

const PACKAGE_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(PACKAGE_ROOT, "src", "index.ts");

export type Kind = "task" | "phase";
export const KINDS: Kind[] = ["task", "phase"];

/** Exit code of CLAIM_CONFLICT (utils.ts::exitCode — same family as STALE_VERSION). */
export const CLAIM_CONFLICT_EXIT = 5;

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface StoredClaim {
  by: string;
  at: string;
  harness_run?: string | null;
  [key: string]: unknown;
}

/** Run ids per spec D2: Claude Code main run = `cc:<session>`. */
export const R1 = "cc:rid-sess-one";
export const R2 = "cc:rid-sess-two";

function cleanEnv(dir: string, actor?: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: dir, CLAUDECODE: "1" };
  // The ambient identity/session of whoever runs this suite must never decide a verdict.
  for (const name of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "LORE_GATE_BYPASS"]) {
    delete env[name];
  }
  // BR-1055: no `--by`; a fixture writer is named through the SESSION tier. `actor` is the RESOLVED name
  // (`agent:session-<id8>`, as `sessionActorFor` builds it); the session id whose first 8 characters are that
  // `<id8>` resolves to exactly that name.
  if (actor !== undefined) env["CLAUDE_CODE_SESSION_ID"] = sessionIdOfActor(actor);
  return env;
}

/** Spawns the real CLI. `run` is passed as the global `--harness-run <id>` flag (D1), placed before the verb. */
export function runLore(args: string[], dir: string, run?: string, actor?: string): RunResult {
  const argv = run === undefined ? args : ["--harness-run", run, ...args];
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...argv], { cwd: dir, env: cleanEnv(dir, actor) });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], dir: string): RunResult {
  const r = runLore(args, dir);
  if (r.exitCode !== 0) {
    throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  }
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

/**
 * Registers a run through `lore run register` (does NOT exist before the paired
 * implementation task — that absence is part of the red). Harness ids are passed, the run id
 * is DERIVED by lore (D2: `cc:<session>` / `cc:<session>:<agent>`), then read back with
 * `lore run show` so a test never proceeds on a run that was not actually registered.
 */
const registered = new Set<string>();
export function registerRun(dir: string, runId: string): void {
  const key = `${dir}\0${runId}`;
  if (registered.has(key)) return;
  const [prefix, session, agent] = runId.split(":");
  if (prefix !== "cc" || session === undefined) throw new Error(`fixture only knows cc:<session>[:<agent>] ids: ${runId}`);
  const reg = runLore(
    ["run", "register", "--harness", "claude-code", "--session", session, ...(agent !== undefined ? ["--agent-id", agent, "--agent-type", "lore-implementer"] : [])],
    dir,
  );
  if (reg.exitCode !== 0) {
    throw new Error(`\`lore run register\` for ${runId} failed (${reg.exitCode}) — run registration is missing: ${reg.stderr}${reg.stdout}`);
  }
  // Contract pinned by run-register.bun.test.ts: `run show --json` => { ok: true, data: <RunRecord> }, camelCase fields.
  const show = runLore(["run", "show", runId, "--json"], dir);
  const shown = show.exitCode === 0 ? (JSON.parse(show.stdout) as { ok?: boolean; data?: { id?: string } }) : undefined;
  if (shown?.ok !== true || shown.data?.id !== runId) {
    throw new Error(`run ${runId} is not registered after \`lore run register\` (show exit ${show.exitCode}): ${show.stderr}${show.stdout}`);
  }
  registered.add(key);
}

export interface Corpus {
  readonly dir: string;
  /** Creates a fresh, unclaimed task or phase and returns its slug. `anchors` (task only) declares `file_anchors`. */
  newTarget(kind: Kind, anchors?: readonly string[]): Promise<string>;
  cleanup(): void;
}

export async function createCorpus(opts: { claimGates?: "enabled" | "disabled" } = {}): Promise<Corpus> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rid-claim-")));
  // Deliberately NOT a git repository: `lore release` on a task whose claim recorded no
  // --worktree is refused from inside a git repo (uncommitted-worktree guard, unrelated to
  // run identity). The corpus lives under the OS tmpdir, outside any repository.
  mustRun(["init"], dir);
  // Pre-flight gates (anchor overlap, actor-identity guard on os-fallback names) are not under
  // test: disable the two claim gates so ONLY the claim-conflict decision can refuse a claim.
  // `claimGates: "enabled"` keeps them ON for suites whose subject IS the claim gate (BR-1056 overlap by run).
  if (opts.claimGates !== "enabled") {
    patchLoreConfig(
      dir,
      ["workflow:", "  gates:", "    task-claim:", "      enabled: false", "    phase-claim:", "      enabled: false", ""].join("\n"),
    );
  }

  const prd = slugOf(mustRun(["create", "prd", "--title", "RID PRD", "--content", "root", "--no-ai"], dir).stdout);
  const plan = slugOf(
    mustRun(["create", "plan", "--title", "RID Plan", "--parent", prd, "--content", "x", "--no-ai"], dir).stdout,
  );
  let counter = 0;

  const withApp = async <T>(fn: (app: App) => Promise<T>): Promise<T> => {
    const app = createApp(join(dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext()) as App;
    try {
      return await fn(app);
    } finally {
      app.close();
    }
  };

  return {
    dir,
    async newTarget(kind: Kind, anchors: readonly string[] = []): Promise<string> {
      counter += 1;
      if (kind === "task") {
        return slugOf(
          mustRun(
            ["create", "task", "--title", `RID Task ${counter}`, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai", ...anchors.flatMap((a) => ["--anchor", a])],
            dir,
          ).stdout,
        );
      }
      return withApp(async (app) => {
        const planDoc = await app.corpusService.get(plan);
        if (!planDoc.ok) throw new Error(`plan lookup failed: ${JSON.stringify(planDoc.error)}`);
        const created = await app.corpusService.create({
          type: "phase",
          title: `RID Phase ${counter}`,
          parent_id: planDoc.value.doc.id,
          content: "## Phase",
          extra: { plan_id: planDoc.value.doc.id, file_anchors: [] },
        } as unknown as CreateDocInput);
        if (!created.ok) throw new Error(`phase create failed: ${JSON.stringify(created.error)}`);
        return created.value.slug;
      });
    },
    cleanup(): void {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ─── CLI verbs ──────────────────────────────────────────────────────────────

/** `by` is the RESOLVED writer name the spawn runs as (`sessionActorFor(...)`), injected through the session tier. */
export function claim(dir: string, target: string, by: string, opts: { run?: string; steal?: boolean } = {}): RunResult {
  return runLore(["claim", target, ...(opts.steal === true ? ["--steal"] : [])], dir, opts.run, by);
}

export function release(dir: string, target: string, by: string, opts: { run?: string; force?: boolean } = {}): RunResult {
  return runLore(["release", target, ...(opts.force === true ? ["--force"] : [])], dir, opts.run, by);
}

// ─── Direct corpus access (see header for why) ──────────────────────────────

function openDb(dir: string, readonly: boolean): Database {
  return new Database(join(dir, ".lore", "lore.db"), readonly ? { readonly: true } : undefined);
}

export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** The stored claim lease, parsed exactly as persisted (so an absent key stays absent). */
export function getClaim(dir: string, slug: string): StoredClaim | undefined {
  const db = openDb(dir, true);
  try {
    const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as { extra: string } | null;
    if (row === null) throw new Error(`no doc ${slug}`);
    return (JSON.parse(row.extra) as { claim?: StoredClaim }).claim;
  } finally {
    db.close();
  }
}

/** Overwrites (or, with null, removes) the stored claim lease. Used for legacy / stale seeding only. */
export function seedClaim(dir: string, slug: string, claimValue: Record<string, unknown> | null): void {
  const db = openDb(dir, false);
  try {
    const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as { extra: string } | null;
    if (row === null) throw new Error(`no doc ${slug}`);
    const extra = JSON.parse(row.extra) as Record<string, unknown>;
    if (claimValue === null) delete extra["claim"];
    else extra["claim"] = claimValue;
    db.query("UPDATE docs SET extra = ? WHERE slug = ?").run(JSON.stringify(extra), slug);
  } finally {
    db.close();
  }
}

/** Rewrites only the lease timestamp of the stored claim (ages a real, CLI-written claim). */
export function ageClaim(dir: string, slug: string, minutes: number): void {
  const current = getClaim(dir, slug);
  if (current === undefined) throw new Error(`no claim to age on ${slug}`);
  seedClaim(dir, slug, { ...current, at: minutesAgo(minutes) });
}

/**
 * Text of the NEWEST history entries for `slug`: its latest version row's non-body columns
 * (summary, author, harness_run…) and the corpus's latest audit row (details, actor…).
 * `extra`/`content` are excluded so a claim body can't satisfy "history names the run" by
 * accident — the run must be recorded as history, not merely sit in the document.
 */
export function latestHistory(dir: string, slug: string): string {
  const db = openDb(dir, true);
  try {
    const doc = db.query("SELECT id FROM docs WHERE slug = ?").get(slug) as { id: string } | null;
    if (doc === null) throw new Error(`no doc ${slug}`);
    const version = db.query("SELECT * FROM versions WHERE doc_id = ? ORDER BY version DESC LIMIT 1").get(doc.id) as Record<string, unknown>;
    const audit = db.query("SELECT * FROM audit ORDER BY rowid DESC LIMIT 1").get() as Record<string, unknown>;
    const { extra: _extra, content: _content, ...versionColumns } = version;
    return JSON.stringify({ version: versionColumns, audit });
  } finally {
    db.close();
  }
}
