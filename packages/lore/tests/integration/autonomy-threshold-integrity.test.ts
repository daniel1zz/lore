// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/integration/fixtures/autonomy-decide-driver.ts
// @reads hooks/pre-push
// @reads assets/project/pre-push
// @reads packages/lore/src/service/**
/**
 * AC-AU-9 oracle — thresholds are governed data and fail safe.
 *
 * Everything runs in THROWAWAY corpora (mkdtemp + `lore init`), never the repo's own `.lore/`. The CLI is the real one
 * (`bun run src/index.ts`, cwd and HOME inside the temp tree); the "edit outside lore" is a direct bun:sqlite write
 * against the corpus database, the human answer is the real `lore decide` flow on a real pseudo-terminal.
 *
 * Halves (spec AC-AU-9): (1) the stored thresholds edited directly in the database -> the next decide() of a normally
 * auto class escalates with reason threshold-integrity; (2) `lore status` fails naming the integrity break; (3) the
 * human-tty accept of the integrity decision restores auto; (4) control: thresholds changed THROUGH lore keep the chain
 * valid. Beyond the halves: the record is seeded once as a recorded governance write; decide() reads the governed
 * record (a tightening changes the verdict); a loosening escalates as governance-loosen until a human accepts it; a
 * deleted record row fails safe; a rebuilt chain does not reproduce a head already pushed; the mirror file; no
 * service-layer reader takes thresholds from the code seed.
 *
 * @spec_ref AC-AU-9
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { DecisionService } from "../../src/service/decision-service.js";
import { computeDecisionEntryHash, type DecisionLogRow } from "../../src/store/decision-log.js";
import { ignoredPathsOutsideRegenerableSet } from "../../src/service/worktree-cleanup.js";
import { checkAutonomyMirror, exportAutonomyMirror } from "../../../../scripts/export-autonomy-mirror.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const DRIVER_TS = join(PACKAGE_ROOT, "tests", "integration", "fixtures", "autonomy-decide-driver.ts");
const NONCE_RE = /Confirmation code: ([A-Z0-9]{8})/;

/** Facts that score 0.9 for stash-drop (min of R 0.9, B 1, E 1, C 0.97) — auto against the seeded 0.8 threshold. */
const AUTO_FACTS = { recoverability: "loss-free-by-proof", blast: "own-or-ended-run", evidence: "lore-evaluated", confidence: 0.97 } as const;

const created: string[] = [];
afterAll(() => {
  for (const dir of created) if (dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
});

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface Corpus {
  readonly dir: string;
  readonly dbPath: string;
}

function cleanEnv(dir: string): Record<string, string> {
  return { PATH: process.env["PATH"] ?? "", HOME: dir, EDITOR: "true" };
}

function lore(corpus: Corpus, args: string[]): Run {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd: corpus.dir, env: cleanEnv(corpus.dir), encoding: "utf8", timeout: 60_000 });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? -1 };
}

/** A fresh throwaway corpus whose threshold record is seeded (`lore autonomy show`). */
function newCorpus(seeded = true): Corpus {
  const dir = mkdtempSync(join(tmpdir(), "lore-au9-"));
  created.push(dir);
  const corpus: Corpus = { dir, dbPath: join(dir, ".lore", "lore.db") };
  const init = lore(corpus, ["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  if (seeded) {
    const shown = lore(corpus, ["autonomy", "show"]);
    if (shown.exitCode !== 0) throw new Error(`lore autonomy show failed: ${shown.stderr}`);
  }
  return corpus;
}

async function withService<T>(corpus: Corpus, fn: (service: DecisionService) => Promise<T>): Promise<T> {
  const store = new SQLiteStore(corpus.dbPath);
  try {
    return await fn(new DecisionService({ store, executorRun: null }));
  } finally {
    store.close();
  }
}

/** One stash-drop decision with auto-grade facts; returns the raw decision and the effective verdict. */
async function decideStash(corpus: Corpus, subject: string) {
  return withService(corpus, async (service) => {
    const out = await service.decide("stash-drop", { id: subject, version: "v1" }, AUTO_FACTS);
    if (!out.ok) throw new Error(`decide failed: ${JSON.stringify(out.error)}`);
    return out.value;
  });
}

function sqlite<T>(corpus: Corpus, fn: (db: Database) => T): T {
  const db = new Database(corpus.dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Edits the stored record OUTSIDE lore: stash-drop's threshold 0.8 -> 0.1, straight in the database. */
function tamperThreshold(corpus: Corpus): void {
  sqlite(corpus, (db) => {
    const row = db.query("SELECT content FROM autonomy_thresholds WHERE id = 1").get() as { content: string };
    const record = JSON.parse(row.content);
    record.classes["stash-drop"].threshold = 0.1;
    db.run("UPDATE autonomy_thresholds SET content = ? WHERE id = 1", [JSON.stringify(record)]);
  });
}

function storedRecord(corpus: Corpus): { classes: Record<string, Record<string, unknown>>; worktreeRemoveRegenerable: string[] } {
  return sqlite(corpus, (db) => JSON.parse((db.query("SELECT content FROM autonomy_thresholds WHERE id = 1").get() as { content: string }).content));
}

function decisionRows(corpus: Corpus): { class: string; subject_id: string; verdict: string; channel: string; facts: string; reasons: string }[] {
  return sqlite(corpus, (db) => db.query("SELECT class, subject_id, verdict, channel, facts, reasons FROM decision_log ORDER BY id").all() as never);
}

interface PtyResult {
  readonly code: number;
  readonly output: string;
}

/** Runs `cmd` on a real pseudo-terminal and types the confirmation code back when it appears. */
async function ptyAccept(corpus: Corpus, args: string[]): Promise<PtyResult> {
  let output = "";
  let typed = false;
  const proc = Bun.spawn(args, {
    cwd: corpus.dir,
    env: cleanEnv(corpus.dir),
    terminal: {
      cols: 120,
      rows: 40,
      data(_terminal: unknown, chunk: Uint8Array) {
        output += new TextDecoder().decode(chunk);
        const match = typed ? null : NONCE_RE.exec(output);
        if (match?.[1] !== undefined) {
          typed = true;
          proc.terminal?.write(`${match[1]}\n`);
        }
      },
    },
  });
  const timer = setTimeout(() => proc.kill(), 45_000);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, output };
}

async function pendingOf(corpus: Corpus, className: string): Promise<number> {
  return withService(corpus, async (service) => {
    const pending = await service.listPending();
    if (!pending.ok) throw new Error("listPending failed");
    const row = pending.value.find((p) => p.class === className);
    if (row === undefined) throw new Error(`no pending ${className} decision: ${JSON.stringify(pending.value.map((p) => p.class))}`);
    return row.id;
  });
}

describe("AC-AU-9 thresholds are governed data and fail safe", () => {
  it("seeds the record ONCE from the code table as a recorded governance write, dist-npm/ included", () => {
    const corpus = newCorpus();
    expect(lore(corpus, ["autonomy", "show"]).exitCode).toBe(0); // idempotent: a second show writes nothing
    const writes = decisionRows(corpus).filter((r) => r.class === "autonomy-threshold-write");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]?.facts ?? "{}")).toMatchObject({ op: "seed", loosened: [], tightened: [] });
    const record = storedRecord(corpus);
    expect(record.classes["stash-drop"]).toMatchObject({ tier: "normal", threshold: 0.8, priorConfidence: 0.95 });
    expect(record.classes["governance-loosen"]).toMatchObject({ tier: "human-always" });
    expect(record.worktreeRemoveRegenerable).toContain("dist-npm/");
    const shown = JSON.parse(lore(corpus, ["autonomy", "show", "--json"]).stdout);
    expect(shown.data.integrity.state).toBe("intact");
  }, 120_000);

  it("(1) the stored thresholds edited directly in the database -> a normally-auto class escalates with reason threshold-integrity", async () => {
    const corpus = newCorpus();
    const before = await decideStash(corpus, "stash-before");
    expect(before.decision.verdict).toBe("auto"); // control: the same facts are auto while the record is intact
    expect(before.effective.verdict).toBe("auto");

    tamperThreshold(corpus);
    const after = await decideStash(corpus, "stash-after");
    expect(after.decision.verdict).toBe("escalate");
    expect(after.effective.verdict).toBe("escalate");
    expect(after.decision.score).toBe(0);
    expect(after.decision.reasons[0]).toMatch(/^threshold-integrity: hash_mismatch/);

    // every class, not only the edited one: worktree-remove with its own auto-grade facts
    const other = await withService(corpus, async (service) => {
      const out = await service.decide("worktree-remove", { id: "/tmp/wt", version: "v1" }, { ...AUTO_FACTS, confidence: 0.97 });
      if (!out.ok) throw new Error("decide failed");
      return out.value;
    });
    expect(other.decision.verdict).toBe("escalate");
    expect(other.decision.reasons[0]).toMatch(/^threshold-integrity/);

    // exactly one pending integrity decision, opened once for this content
    const integrity = decisionRows(corpus).filter((r) => r.class === "threshold-integrity");
    expect(integrity).toHaveLength(1);
    expect(integrity[0]).toMatchObject({ verdict: "escalate", channel: "machine" });
  }, 120_000);

  it("(2) lore status fails naming the integrity break; an intact record passes", async () => {
    const corpus = newCorpus();
    const intact = lore(corpus, ["status", "--check-autonomy-thresholds"]);
    expect(intact.exitCode).toBe(0);
    expect(intact.stdout).toMatch(/intact/);
    expect(lore(corpus, ["status"]).exitCode).toBe(0);

    tamperThreshold(corpus);
    const flagged = lore(corpus, ["status", "--check-autonomy-thresholds"]);
    expect(flagged.exitCode).toBe(1);
    expect(flagged.stdout).toMatch(/INTEGRITY BREAK.*threshold-integrity: hash_mismatch/);
    const plain = lore(corpus, ["status"]);
    expect(plain.exitCode).toBe(1);
    expect(plain.stdout).toMatch(/Autonomy thresholds: INTEGRITY BREAK/);
    const json = JSON.parse(lore(corpus, ["status", "--check-autonomy-thresholds", "--json"]).stdout);
    expect(json.data.autonomy_thresholds).toMatchObject({ state: "broken", reason: "hash_mismatch" });
  }, 120_000);

  it("(3) the human-tty accept of the integrity decision restores auto; a later edit needs a new accept", async () => {
    const corpus = newCorpus();
    tamperThreshold(corpus);
    const escalated = await decideStash(corpus, "during-break");
    expect(escalated.effective.verdict).toBe("escalate");

    const id = await pendingOf(corpus, "threshold-integrity");
    // an agent-grade (non-TTY) attempt cannot answer it
    const refused = lore(corpus, ["decide", String(id), "--accept"]);
    expect(refused.exitCode).toBe(4);
    expect(lore(corpus, ["status", "--check-autonomy-thresholds"]).exitCode).toBe(1);

    const accepted = await ptyAccept(corpus, ["bun", "run", DRIVER_TS, corpus.dbPath, String(id), "--accept", "reviewed the edit"]);
    expect(accepted.code).toBe(0);
    const restored = await decideStash(corpus, "after-accept");
    expect(restored.decision.verdict).toBe("auto");
    expect(restored.effective.verdict).toBe("auto");
    const status = lore(corpus, ["status", "--check-autonomy-thresholds"]);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toMatch(/CONFIRMED/);

    // the accept covers exactly the content the human saw: another edit breaks it again
    sqlite(corpus, (db) => {
      const record = storedRecord(corpus);
      record.classes["stash-drop"] = { ...record.classes["stash-drop"], threshold: 0.2 };
      db.run("UPDATE autonomy_thresholds SET content = ? WHERE id = 1", [JSON.stringify(record)]);
    });
    expect(lore(corpus, ["status", "--check-autonomy-thresholds"]).exitCode).toBe(1);
    const again = await decideStash(corpus, "after-second-edit");
    expect(again.decision.verdict).toBe("escalate");
  }, 180_000);

  it("(4) control: thresholds changed THROUGH lore keep the chain valid and the verdicts honest", async () => {
    const corpus = newCorpus();
    const tightened = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.95"]);
    expect(tightened.exitCode).toBe(0);
    expect(tightened.stdout).toMatch(/stash-drop\.threshold: 0\.8 -> 0\.95/);
    expect(lore(corpus, ["status", "--check-autonomy-thresholds"]).exitCode).toBe(0);
    expect(lore(corpus, ["status", "--check-decision-log"]).exitCode).toBe(0);
    expect(storedRecord(corpus).classes["stash-drop"]?.["threshold"]).toBe(0.95);

    // decide() reads the GOVERNED value, not the code seed: 0.9 < 0.95 now escalates
    const strict = await decideStash(corpus, "stricter");
    expect(strict.decision.verdict).toBe("escalate");
    expect(strict.decision.threshold).toBe(0.95);
    expect(strict.decision.reasons.join(" ")).not.toMatch(/threshold-integrity/);

    const writes = decisionRows(corpus).filter((r) => r.class === "autonomy-threshold-write");
    expect(writes.map((r) => JSON.parse(r.facts).op)).toEqual(["seed", "tighten"]);
    expect(lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.95"]).stdout).toMatch(/No change/);
  }, 120_000);

  it("a loosening escalates as governance-loosen and applies only after a human-tty accept of that exact proposal", async () => {
    const corpus = newCorpus();
    const loosen = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.5"]);
    expect(loosen.exitCode).toBe(7);
    expect(loosen.stderr).toMatch(/governance-loosen/);
    expect(storedRecord(corpus).classes["stash-drop"]?.["threshold"]).toBe(0.8);
    const id = await pendingOf(corpus, "governance-loosen");

    expect((await ptyAccept(corpus, ["bun", "run", DRIVER_TS, corpus.dbPath, String(id), "--accept"])).code).toBe(0);
    // a DIFFERENT loosening is not covered by that accept
    expect(lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.4"]).exitCode).toBe(7);
    // the same proposal applies
    const applied = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.5"]);
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toMatch(/approved by human decision record/);
    expect(storedRecord(corpus).classes["stash-drop"]?.["threshold"]).toBe(0.5);
    expect(lore(corpus, ["status", "--check-autonomy-thresholds"]).exitCode).toBe(0);
  }, 240_000);

  it("a widened regenerable set is a loosening; narrowing it applies and the governed set reaches the ignored-path rule", async () => {
    const corpus = newCorpus();
    expect(lore(corpus, ["autonomy", "regenerable", "add", "build-cache/"]).exitCode).toBe(7);
    expect(storedRecord(corpus).worktreeRemoveRegenerable).not.toContain("build-cache/");

    expect(lore(corpus, ["autonomy", "regenerable", "rm", "dist-npm/"]).exitCode).toBe(0);
    const governed = await withService(corpus, async (service) => {
      const out = await service.governed();
      if (!out.ok) throw new Error("governed failed");
      return out.value;
    });
    expect(governed.regenerablePatterns).not.toContain("dist-npm/");
    expect(governed.regenerablePatterns).toContain("node_modules/");
    expect(ignoredPathsOutsideRegenerableSet(["dist-npm/", "node_modules/"], governed.regenerablePatterns)).toEqual(["dist-npm/"]);
    expect(lore(corpus, ["autonomy", "regenerable", "rm", "never-there/"]).exitCode).toBe(4);
  }, 120_000);

  it("a deleted record row fails safe (record_missing) and `lore autonomy set` refuses to write over a broken record", async () => {
    const corpus = newCorpus();
    sqlite(corpus, (db) => db.run("DELETE FROM autonomy_thresholds"));
    const out = await decideStash(corpus, "no-record");
    expect(out.decision.verdict).toBe("escalate");
    expect(out.decision.reasons[0]).toMatch(/threshold-integrity: record_missing/);
    const refused = lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.99"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toMatch(/integrity/);
  }, 120_000);

  it("an unseeded corpus runs on the code seed, and a record row planted without its write record is a break", async () => {
    const corpus = newCorpus(false);
    expect((await decideStash(corpus, "unseeded")).decision.verdict).toBe("auto");
    expect(lore(corpus, ["status", "--check-autonomy-thresholds"]).exitCode).toBe(0);
    sqlite(corpus, (db) => db.run("INSERT INTO autonomy_thresholds (id, content, updated_at) VALUES (1, '{}', 'now')"));
    const planted = await decideStash(corpus, "planted");
    expect(planted.decision.verdict).toBe("escalate");
    expect(planted.decision.reasons[0]).toMatch(/threshold-integrity: no_write_record/);
  }, 120_000);

  it("pre-push: a decision log rebuilt from scratch is a clean chain yet does NOT reproduce a head already pushed", async () => {
    const corpus = newCorpus();
    await decideStash(corpus, "one");
    const recorded = lore(corpus, ["autonomy", "verify-pushed-heads", "--record"]);
    expect(recorded.exitCode).toBe(0);
    expect(existsSync(join(corpus.dir, ".lore", "autonomy-pushed-heads.json"))).toBe(true);
    await decideStash(corpus, "two"); // the log grows past the pushed head: still reproduced
    expect(lore(corpus, ["autonomy", "verify-pushed-heads"]).exitCode).toBe(0);

    // rebuild: change a row's timestamp and recompute EVERY hash so the chain verifies from genesis
    sqlite(corpus, (db) => {
      db.run("DROP TRIGGER decision_log_no_update");
      const rows = db.query("SELECT * FROM decision_log ORDER BY id").all() as DecisionLogRow[];
      let prev = "";
      for (const row of rows) {
        const next = { ...row, ts: row.id === 1 ? "2001-01-01T00:00:00.000Z" : row.ts };
        const hash = computeDecisionEntryHash(next, prev);
        db.run("UPDATE decision_log SET ts = ?, prev_hash = ?, entry_hash = ? WHERE id = ?", [next.ts, prev, hash, row.id]);
        prev = hash;
      }
    });
    expect(lore(corpus, ["status", "--check-decision-log"]).exitCode).toBe(0); // the chain alone cannot tell
    const rewritten = lore(corpus, ["autonomy", "verify-pushed-heads"]);
    expect(rewritten.exitCode).toBe(1);
    expect(rewritten.stderr).toMatch(/does NOT reproduce 1 head/);
    expect(rewritten.stderr).toMatch(/head_hash_differs/);
  }, 120_000);

  it("pre-push: a malformed ledger is an error, never an empty ledger", () => {
    const corpus = newCorpus();
    spawnSync("sh", ["-c", `printf 'not json' > ${join(corpus.dir, ".lore", "autonomy-pushed-heads.json")}`]);
    const r = lore(corpus, ["autonomy", "verify-pushed-heads"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/unreadable/);
  }, 120_000);

  it("both byte-identical pre-push hooks run the threshold check and the pushed-heads check", () => {
    const shipped = readFileSync(join(REPO_ROOT, "hooks", "pre-push"), "utf8");
    const scaffold = readFileSync(join(REPO_ROOT, "assets", "project", "pre-push"), "utf8");
    expect(scaffold).toBe(shipped);
    expect(shipped).toContain("lore status --check-autonomy-thresholds");
    expect(shipped).toContain("lore autonomy verify-pushed-heads --record");
  });

  it("the record is mirrored as a git-tracked file; export refuses a broken record and check reports drift", async () => {
    const corpus = newCorpus();
    const repoRoot = mkdtempSync(join(tmpdir(), "lore-au9-mirror-"));
    created.push(repoRoot);
    const mirrorPath = join(repoRoot, ".lore", "autonomy-mirror.json");

    expect(await checkAutonomyMirror(corpus.dbPath, repoRoot)).toMatchObject({ ok: false, kind: "drift" }); // seeded, never exported
    const exported = await exportAutonomyMirror(corpus.dbPath, repoRoot);
    expect(exported.ok).toBe(true);
    const mirror = JSON.parse(readFileSync(mirrorPath, "utf8"));
    expect(mirror.thresholds.classes["stash-drop"].threshold).toBe(0.8);
    expect(mirror.thresholds.worktreeRemoveRegenerable).toContain("dist-npm/");
    expect(mirror.integrity).toBe("intact");
    expect(mirror.decision_chain_head).toMatchObject({ head_id: 1, count: 1 });
    expect(await checkAutonomyMirror(corpus.dbPath, repoRoot)).toMatchObject({ ok: true });
    const mtime = statSync(mirrorPath).mtimeMs;
    expect(await exportAutonomyMirror(corpus.dbPath, repoRoot)).toMatchObject({ ok: true, message: expect.stringContaining("already current") });
    expect(statSync(mirrorPath).mtimeMs).toBe(mtime);

    expect(lore(corpus, ["autonomy", "set", "stash-drop", "--threshold", "0.95"]).exitCode).toBe(0);
    expect(await checkAutonomyMirror(corpus.dbPath, repoRoot)).toMatchObject({ ok: false, kind: "drift" });
    expect((await exportAutonomyMirror(corpus.dbPath, repoRoot)).ok).toBe(true);
    expect(await checkAutonomyMirror(corpus.dbPath, repoRoot)).toMatchObject({ ok: true });

    const before = readFileSync(mirrorPath, "utf8");
    tamperThreshold(corpus);
    const refused = await exportAutonomyMirror(corpus.dbPath, repoRoot);
    expect(refused).toMatchObject({ ok: false, kind: "refused" });
    expect(readFileSync(mirrorPath, "utf8")).toBe(before); // nothing laundered into the tracked file
    expect(await checkAutonomyMirror(corpus.dbPath, repoRoot)).toMatchObject({ ok: false, kind: "refused" });
  }, 120_000);

  it("no service-layer reader takes thresholds, priors or regenerable patterns from the code seed", () => {
    const serviceDir = join(PACKAGE_ROOT, "src", "service");
    const offenders: string[] = [];
    for (const name of readdirSync(serviceDir).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(serviceDir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/OPERATION_CLASS_REGISTRY|WORKTREE_REMOVE_REGENERABLE_PATTERNS/.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
