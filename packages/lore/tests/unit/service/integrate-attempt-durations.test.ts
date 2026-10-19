/**
 * Per-attempt phase durations of `lore integrate` (task-integrate-records-per-attempt-phase-durations-so-the-floor).
 *
 * A throwaway git repo (mkdtemp) with REAL git; the floor, the corpus snapshot and the clock are injected so every
 * duration is an exact number: the fake clock advances inside each injected phase (merge 120, snapshot 40, floor
 * 3000 + 4000, CAS 5). The CAS loses once (main is moved by a side commit right before the first `update-ref`), so
 * the record must hold BOTH attempts. Falsifier: the pre-change record held losses / moved_by / updated_at only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@lore/core";
import { IntegrateService, type IntegrateDeps } from "../../../src/service/integrate-service.js";
import { IntegrateLossLedger } from "../../../src/service/integrate-loss-ledger.js";
import { IntegrateAttemptLedger, medianMs } from "../../../src/service/integrate-attempt-ledger.js";
import { collectIntegrateLosses, renderIntegrateLossLines } from "../../../src/adapters/cli/status-integrate-losses.js";

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

const sh = (cwd: string, args: string[]): string => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

let root: string;
let repo: string;
let corpusDir: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lore-attempt-durations-")));
  repo = join(root, "repo");
  corpusDir = join(repo, ".lore");
  mkdirSync(repo);
  sh(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "a.txt"), "a\n");
  sh(repo, ["add", "."]);
  sh(repo, ["commit", "-q", "-m", "base"]);
  sh(repo, ["checkout", "-q", "-b", "feature"]);
  writeFileSync(join(repo, "b.txt"), "b\n");
  sh(repo, ["add", "."]);
  sh(repo, ["commit", "-q", "-m", "feature work"]);
  sh(repo, ["checkout", "-q", "main"]);
  mkdirSync(corpusDir);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("integrate records per-attempt phase durations", () => {
  it("both attempts (lost CAS, then landed) hold merge, snapshot, every floor step, CAS and the outcome; stdout prints a phase line per attempt", async () => {
    let now = 1_700_000_000_000;
    let casCalls = 0;
    const logs: string[] = [];
    const git: IntegrateDeps["git"] = (cwd, args, env) => {
      if (args[0] === "merge" && args[1] !== "--abort") now += 120;
      if (args[0] === "update-ref") {
        now += 5;
        casCalls += 1;
        if (casCalls === 1) {
          // another integration lands first: main moves under this attempt, so the real CAS below is refused by git
          const tree = sh(repo, ["rev-parse", "main^{tree}"]);
          const moved = sh(repo, ["commit-tree", tree, "-p", "main", "-m", "someone else landed"]);
          sh(repo, ["update-ref", "refs/heads/main", moved]);
        }
      }
      const r = spawnSync("git", [...args], { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY, ...env } });
      return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    };
    const service = new IntegrateService({
      git,
      corpus: { take: () => ((now += 40), ok({ takenAt: "2026-10-19T00:00:00.000Z" })), remove: () => ok(undefined) },
      runFloor: () => {
        now += 7000; // the "sleep": the floor takes 7 s of the injected clock
        return {
          status: 0,
          output: "",
          steps: [
            { step: "bun run build", exit: 0, ms: 3000 },
            { step: "bun run typecheck", exit: 0, ms: 4000 },
          ],
        };
      },
      ledger: new IntegrateLossLedger(corpusDir),
      attempts: new IntegrateAttemptLedger(corpusDir, () => "2026-10-19T00:00:00.000Z"),
      clock: () => now,
      projectRoot: repo,
      worktreesRoot: join(root, "wt"),
      log: (line) => logs.push(line),
    });

    const result = await service.integrate({ branch: "feature", sessionId: "s1", floorCommand: "true" });
    expect(result).toMatchObject({ ok: true, value: { kind: "landed", attempts: 2 } });

    const file = join(corpusDir, "integrate-attempts", "feature.json");
    const record = JSON.parse(readFileSync(file, "utf8")) as { attempts: Array<Record<string, unknown>> };
    expect(Object.keys(record).sort()).toEqual(["attempts", "branch", "schema_version", "updated_at"]);
    const attempts = record.attempts.map(({ base: _base, started_at: _started, ...rest }) => rest);
    const floor = { total_ms: 7000, steps: [{ step: "bun run build", exit: 0, ms: 3000 }, { step: "bun run typecheck", exit: 0, ms: 4000 }] };
    expect(attempts).toEqual([
      { attempt: 1, outcome: "lost_race", merge_ms: 120, corpus_snapshot_ms: 40, floor, cas_ms: 5, total_ms: 7165 },
      { attempt: 2, outcome: "landed", merge_ms: 120, corpus_snapshot_ms: 40, floor, cas_ms: 5, total_ms: 7165 },
    ]);

    const phaseLines = logs.filter((l) => l.startsWith("integrate: attempt ") && l.includes(" phases: "));
    expect(phaseLines).toEqual([
      "integrate: attempt 1/3 phases: merge 120ms | corpus-snapshot 40ms | floor 7000ms (bun run build 3000ms, bun run typecheck 4000ms) | cas 5ms | total 7165ms -> lost_race",
      "integrate: attempt 2/3 phases: merge 120ms | corpus-snapshot 40ms | floor 7000ms (bun run build 3000ms, bun run typecheck 4000ms) | cas 5ms | total 7165ms -> landed",
    ]);
    // the landing cleared the loss entry, the cost record stays (cost data exists even when nothing is lost)
    expect(existsSync(join(corpusDir, "integrate-losses", "feature.json"))).toBe(false);
    expect(existsSync(file)).toBe(true);
  });

  it("a failing floor that emits no per-step timings is recorded as ONE named step; later phases are null, never 0", async () => {
    sh(repo, ["checkout", "-q", "-b", "feature2", "main"]);
    writeFileSync(join(repo, "c.txt"), "c\n");
    sh(repo, ["add", "."]);
    sh(repo, ["commit", "-q", "-m", "feature2 work"]);
    sh(repo, ["checkout", "-q", "main"]);
    let now = 5_000;
    const git: IntegrateDeps["git"] = (cwd, args, env) => {
      const r = spawnSync("git", [...args], { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY, ...env } });
      return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    };
    const service = new IntegrateService({
      git,
      corpus: { take: () => ok({ takenAt: "2026-10-19T00:00:00.000Z" }), remove: () => ok(undefined) },
      runFloor: () => ((now += 900), { status: 7, output: "boom" }),
      ledger: new IntegrateLossLedger(corpusDir),
      attempts: new IntegrateAttemptLedger(corpusDir, () => "t"),
      clock: () => now,
      projectRoot: repo,
      worktreesRoot: join(root, "wt"),
      log: () => {},
    });
    const result = await service.integrate({ branch: "feature2", sessionId: "s1", floorCommand: "false" });
    expect(result).toMatchObject({ ok: true, value: { kind: "floor_failed", exit_status: 7 } });
    const read = new IntegrateAttemptLedger(corpusDir).read("feature2");
    expect(read.ok && read.value?.attempts.map(({ base: _b, started_at: _s, ...rest }) => rest)).toEqual([
      {
        attempt: 1,
        outcome: "floor_failed",
        merge_ms: 0,
        corpus_snapshot_ms: 0,
        floor: { total_ms: 900, steps: [{ step: "floor (no per-step timings emitted)", exit: 7, ms: 900 }] },
        cas_ms: null,
        total_ms: 900,
      },
    ]);
  });

  it("a floor step list of one named step round-trips (the no-timings fallback is never silently missing)", () => {
    const dir = mkdtempSync(join(root, "ledger-"));
    const ledger = new IntegrateAttemptLedger(dir, () => "t");
    const wrote = ledger.recordAttempt("b", {
      attempt: 1, base: "abc", started_at: "t", outcome: "floor_failed", merge_ms: 1, corpus_snapshot_ms: 2,
      floor: { total_ms: 9, steps: [{ step: "floor (no per-step timings emitted)", exit: 1, ms: 9 }] }, cas_ms: null, total_ms: 12,
    });
    expect(wrote.ok).toBe(true);
    const read = ledger.read("b");
    expect(read).toMatchObject({ ok: true, value: { attempts: [{ floor: { steps: [{ step: "floor (no per-step timings emitted)", ms: 9 }] }, cas_ms: null }] } });
  });

  it("a malformed attempt file is an error, not an empty history", () => {
    const dir = mkdtempSync(join(root, "ledger-"));
    mkdirSync(join(dir, "integrate-attempts"));
    writeFileSync(join(dir, "integrate-attempts", "x.json"), "{not json");
    expect(new IntegrateAttemptLedger(dir).read("x").ok).toBe(false);
  });

  it("keeps only the last 20 attempts of a branch", () => {
    const dir = mkdtempSync(join(root, "ledger-"));
    const ledger = new IntegrateAttemptLedger(dir, () => "t");
    for (let i = 1; i <= 25; i += 1) {
      ledger.recordAttempt("b", { attempt: i, base: "abc", started_at: "t", outcome: "landed", merge_ms: 0, corpus_snapshot_ms: 0, floor: null, cas_ms: 0, total_ms: i });
    }
    const read = ledger.read("b");
    expect(read.ok && read.value?.attempts.map((a) => a.attempt)).toEqual(Array.from({ length: 20 }, (_, i) => i + 6));
  });
});

describe("medianMs", () => {
  it("odd, even and empty", () => {
    expect(medianMs([5, 1, 3])).toBe(3);
    expect(medianMs([4, 1, 3, 2])).toBe(3); // (2+3)/2 = 2.5 -> rounded
    expect(medianMs([])).toBeNull();
  });
});

describe("lore status: per un-integrated branch, loss count and median attempt duration", () => {
  it("rows carry attempts_recorded and median_attempt_ms; the text line names both; no attempts record = null, not 0", () => {
    const dir = mkdtempSync(join(root, "status-"));
    const dbPath = join(dir, "lore.db");
    const losses = new IntegrateLossLedger(dir, () => "2026-10-19T00:00:00.000Z");
    losses.recordLoss("starving", "tip1", ["abc123456789 other"]);
    losses.recordLoss("starving", "tip1", ["def123456789 another"]);
    losses.recordLoss("unmeasured", "tip2", ["fed123456789 x"]);
    const attempts = new IntegrateAttemptLedger(dir, () => "2026-10-19T00:00:00.000Z");
    for (const total of [1_000_000, 1_080_000, 1_200_000]) {
      attempts.recordAttempt("starving", { attempt: 1, base: "b", started_at: "t", outcome: "lost_race", merge_ms: 1, corpus_snapshot_ms: 1, floor: null, cas_ms: 1, total_ms: total });
    }
    const rows = collectIntegrateLosses(dbPath);
    expect(rows.ok && rows.value.map((r) => [r.branch, r.losses, r.attempts_recorded, r.median_attempt_ms])).toEqual([
      ["starving", 2, 3, 1_080_000],
      ["unmeasured", 1, 0, null],
    ]);
    const lines = rows.ok ? renderIntegrateLossLines(rows.value) : [];
    expect(lines[1]).toBe("  starving: 2 consecutive lost races (last moved by def123456789 another); median attempt 1080.0s over 3 recorded attempt(s)");
    expect(lines[2]).toBe("  unmeasured: 1 consecutive lost race (last moved by fed123456789 x); median attempt not measured (no attempt record)");
  });
});
