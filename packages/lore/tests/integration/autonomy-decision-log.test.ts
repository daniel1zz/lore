// @spawns packages/lore/src/index.ts
/**
 * AC-AU-2 oracle — every decision is a record; re-scoring cannot cross the threshold.
 *
 * Drives DecisionService over a real SQLiteStore in a THROWAWAY corpus (mkdtemp + `lore init`), never the
 * repo's own `.lore/`. Chain verification is exercised through the real CLI (`lore status --check-decision-log`)
 * so the asserted exit codes are the product's own. Tampering opens the DB file directly: the append-only
 * triggers stop an in-product rewrite, so a tamper has to drop them first — that is the attack the chain detects.
 *
 * Halves (spec AC-AU-2): (1) same version re-scored with better facts stays escalate; (2) the same improvement on
 * a NEW version is auto; (3) tampering one row's verdict -> exit 1 naming the row; (3b) human-tty accept -> auto
 * (channel human-tty) despite an escalate record, reject -> refuse; (4) two processes deciding on one subject both
 * land with the chain intact.
 *
 * @spec_ref AC-AU-2
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { DecisionService } from "../../src/service/decision-service.js";
import type { StoreInterface } from "../../src/store/store-interface.js";
import { verifyDecisionChain } from "../../src/store/decision-log.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const SQLITE_STORE_PATH = join(PACKAGE_ROOT, "src", "store", "sqlite-store.ts");
const SERVICE_PATH = join(PACKAGE_ROOT, "src", "service", "decision-service.ts");

/** A class from @lore/core's registry; read from the registry itself so the test cannot drift from it. */
const CLASS_ID = "stash-drop";

const WEAK = { recoverability: "loss-free-by-proof", blast: "calling-session", evidence: "none", confidence: 0.95 } as const;
const STRONG = { recoverability: "loss-free-by-proof", blast: "own-or-ended-run", evidence: "lore-evaluated", confidence: 0.95 } as const;

let corpus = "";
let dbPath = "";

function runLore(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: corpus,
    env: { ...process.env, HOME: corpus, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}

function freshService(file: string): { service: DecisionService; store: SQLiteStore } {
  const store = new SQLiteStore(file);
  return { service: new DecisionService({ store, executorRun: "run-test" }), store };
}

beforeAll(() => {
  corpus = mkdtempSync(join(tmpdir(), "lore-au2-"));
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  dbPath = join(corpus, ".lore", "lore.db");
});

afterAll(() => {
  if (corpus.startsWith(tmpdir())) rmSync(corpus, { recursive: true, force: true });
});

describe("AC-AU-2 decision log", () => {
  it("(1)+(2) worst-of per version: better facts on the SAME version stay escalate, a NEW version is auto", async () => {
    const { service, store } = freshService(dbPath);
    try {
      const subject = { id: "stash@{0}", version: "sha-aaa" };
      const first = await service.decide(CLASS_ID, subject, WEAK);
      expect(first.ok && first.value.decision.verdict).toBe("escalate");
      const second = await service.decide(CLASS_ID, subject, STRONG);
      expect(second.ok && second.value.decision.verdict).toBe("auto"); // this call's own facts are fine...
      expect(second.ok && second.value.effective.verdict).toBe("escalate"); // ...but the version stays escalate
      const effective = await service.effectiveVerdict(CLASS_ID, subject);
      expect(effective.ok && effective.value?.verdict).toBe("escalate");

      const otherVersion = await service.decide(CLASS_ID, { id: subject.id, version: "sha-bbb" }, STRONG);
      expect(otherVersion.ok && otherVersion.value.effective).toMatchObject({ verdict: "auto", channel: "machine" });
      // control: the first version is still escalate after the other version landed
      const still = await service.effectiveVerdict(CLASS_ID, subject);
      expect(still.ok && still.value?.verdict).toBe("escalate");
    } finally {
      store.close();
    }
  });

  it("every decide() call appends one record carrying class, subject, version, facts, factors, score, threshold, verdict, executor run, channel", async () => {
    const { service, store } = freshService(dbPath);
    try {
      const before = await store.listDecisionLog();
      const subject = { id: "fields-subject", version: "v1" };
      const out = await service.decide(CLASS_ID, subject, STRONG);
      expect(out.ok).toBe(true);
      const after = await store.listDecisionLog();
      if (!before.ok || !after.ok || !out.ok) throw new Error("store read failed");
      expect(after.value.length).toBe(before.value.length + 1);
      const row = after.value[after.value.length - 1]!;
      expect(row).toMatchObject({
        class: CLASS_ID,
        subject_id: "fields-subject",
        subject_version: "v1",
        verdict: out.value.decision.verdict,
        score: out.value.decision.score,
        threshold: out.value.decision.threshold,
        executor_run: "run-test",
        channel: "machine",
      });
      expect(JSON.parse(row.facts)).toEqual(STRONG);
      expect(JSON.parse(row.factors)).toEqual(out.value.decision.factors);
      expect(row.prev_hash).toBe(before.value[before.value.length - 1]?.entry_hash ?? "");
    } finally {
      store.close();
    }
  });

  it("refuse (unknown class) is recorded too, and an empty version is refused before anything is written", async () => {
    const { service, store } = freshService(dbPath);
    try {
      const out = await service.decide("no-such-class", { id: "x", version: "v1" }, {});
      expect(out.ok && out.value.decision.verdict).toBe("refuse");
      expect(out.ok && out.value.effective.verdict).toBe("refuse");
      const count = (await store.listDecisionLog()) as { ok: true; value: unknown[] };
      const bad = await service.decide(CLASS_ID, { id: "x", version: "" }, STRONG);
      expect(!bad.ok && bad.error.code).toBe("VALIDATION_ERROR");
      const countAfter = (await store.listDecisionLog()) as { ok: true; value: unknown[] };
      expect(countAfter.value.length).toBe(count.value.length);
    } finally {
      store.close();
    }
  });

  it("(3b) a human-tty accept makes the version auto (channel human-tty) over an escalate record; a reject makes it refuse", async () => {
    const { service, store } = freshService(dbPath);
    try {
      const accepted = { id: "human-accept", version: "v1" };
      await service.decide(CLASS_ID, accepted, WEAK);
      expect((await service.effectiveVerdict(CLASS_ID, accepted)).ok).toBe(true);
      const before = await service.effectiveVerdict(CLASS_ID, accepted);
      expect(before.ok && before.value?.verdict).toBe("escalate");
      const recorded = await service.recordHumanTtyUngated(CLASS_ID, accepted, "auto");
      expect(recorded.ok).toBe(true);
      const after = await service.effectiveVerdict(CLASS_ID, accepted);
      expect(after.ok && after.value).toMatchObject({ verdict: "auto", channel: "human-tty" });

      // a LATER machine escalate does not undo the human decision; a later human reject does
      await service.decide(CLASS_ID, accepted, WEAK);
      const stillAuto = await service.effectiveVerdict(CLASS_ID, accepted);
      expect(stillAuto.ok && stillAuto.value?.verdict).toBe("auto");
      await service.recordHumanTtyUngated(CLASS_ID, accepted, "refuse");
      const rejected = await service.effectiveVerdict(CLASS_ID, accepted);
      expect(rejected.ok && rejected.value).toMatchObject({ verdict: "refuse", channel: "human-tty" });

      // control: the human decision is per version
      const other = await service.effectiveVerdict(CLASS_ID, { id: accepted.id, version: "v2" });
      expect(other.ok && other.value).toBeNull();
    } finally {
      store.close();
    }
  });

  it("an agent-asserted record never takes precedence", async () => {
    const store = new InMemoryStore();
    const service = new DecisionService({ store: store as StoreInterface, executorRun: null });
    const subject = { id: "agent-subject", version: "v1" };
    await service.decide(CLASS_ID, subject, WEAK);
    await store.appendDecisionRecord({
      ts: "2026-01-01T00:00:00.000Z",
      class: CLASS_ID,
      subject_id: subject.id,
      subject_version: subject.version,
      facts: "{}",
      factors: "{}",
      score: 1,
      threshold: null,
      verdict: "auto",
      reasons: "[]",
      executor_run: null,
      channel: "agent-asserted",
    });
    const effective = await service.effectiveVerdict(CLASS_ID, subject);
    expect(effective.ok && effective.value).toMatchObject({ verdict: "escalate", channel: "machine" });
  });

  it("InMemoryStore chains identically (verifyDecisionChain clean over its rows)", async () => {
    const store = new InMemoryStore();
    const service = new DecisionService({ store: store as StoreInterface, executorRun: null });
    await service.decide(CLASS_ID, { id: "m", version: "v1" }, WEAK);
    await service.decide(CLASS_ID, { id: "m", version: "v1" }, STRONG);
    const rows = await store.listDecisionLog();
    expect(rows.ok && verifyDecisionChain(rows.value)).toEqual({ clean: true, checked: 2 });
  });

  it("the append-only triggers refuse an in-product UPDATE and DELETE", () => {
    const db = new Database(dbPath);
    try {
      expect(() => db.run("UPDATE decision_log SET verdict = 'auto' WHERE id = 1")).toThrow(/append-only/);
      expect(() => db.run("DELETE FROM decision_log WHERE id = 1")).toThrow(/append-only/);
    } finally {
      db.close();
    }
  });

  it("(4) two processes deciding on one subject both land and the chain is intact", async () => {
    const script = join(corpus, "decide-child.ts");
    writeFileSync(
      script,
      [
        `const { SQLiteStore } = await import(${JSON.stringify(SQLITE_STORE_PATH)});`,
        `const { DecisionService } = await import(${JSON.stringify(SERVICE_PATH)});`,
        `const [dbFile, tag] = process.argv.slice(2);`,
        `const store = new SQLiteStore(dbFile);`,
        `const service = new DecisionService({ store, executorRun: "child-" + tag });`,
        `for (let i = 0; i < 15; i++) {`,
        `  const r = await service.decide("stash-drop", { id: "concurrent-subject", version: "v1" }, { recoverability: "loss-free-by-proof", blast: "own-or-ended-run", evidence: "lore-evaluated", confidence: 0.95 });`,
        `  if (!r.ok) { console.error(JSON.stringify(r.error)); process.exit(1); }`,
        `}`,
        `store.close();`,
        `console.log("child-done " + tag);`,
      ].join("\n"),
      "utf8",
    );
    const { service, store } = freshService(dbPath);
    try {
      const before = await store.listDecisionLog();
      if (!before.ok) throw new Error("store read failed");
      const runChild = (tag: string): Promise<{ code: number; out: string }> =>
        new Promise((resolve) => {
          const child = spawn("bun", [script, dbPath, tag], { cwd: corpus, env: { ...process.env, HOME: corpus }, stdio: ["ignore", "pipe", "pipe"] });
          let out = "";
          child.stdout.on("data", (c: Buffer) => (out += c.toString()));
          child.stderr.on("data", (c: Buffer) => (out += c.toString()));
          child.once("close", (code) => resolve({ code: code ?? 1, out }));
        });
      const [a, b] = await Promise.all([runChild("a"), runChild("b")]);
      expect(a).toMatchObject({ code: 0 });
      expect(b).toMatchObject({ code: 0 });
      const after = await store.listDecisionLog({ class: CLASS_ID, subject_id: "concurrent-subject", subject_version: "v1" });
      if (!after.ok) throw new Error("store read failed");
      expect(after.value.length).toBe(30);
      expect(new Set(after.value.map((r) => r.executor_run))).toEqual(new Set(["child-a", "child-b"]));
      const verified = await service.verifyChain();
      expect(verified.ok && verified.value.clean).toBe(true);
      const all = await store.listDecisionLog();
      expect(all.ok && all.value.length).toBe(before.value.length + 30);
    } finally {
      store.close();
    }
  }, 60_000);

  it("(3) CLI: intact chain exits 0; tampering one row's verdict exits 1 naming that row; deleting a row exits 1 too", async () => {
    const clean = runLore(["status", "--check-decision-log"]);
    expect({ exit: clean.exitCode, out: clean.stdout }).toMatchObject({ exit: 0 });
    expect(clean.stdout).toContain("chain intact");

    const { store } = freshService(dbPath);
    const rows = await store.listDecisionLog();
    store.close();
    if (!rows.ok) throw new Error("store read failed");
    const target = rows.value.find((r) => r.verdict === "escalate");
    if (target === undefined) throw new Error("no escalate row to tamper with");

    const db = new Database(dbPath);
    try {
      db.run("DROP TRIGGER decision_log_no_update");
      db.run("UPDATE decision_log SET verdict = 'auto' WHERE id = ?", [target.id]);
    } finally {
      db.close();
    }
    const tampered = runLore(["status", "--check-decision-log"]);
    expect(tampered.exitCode).toBe(1);
    expect(tampered.stdout).toContain(`row ${target.id}`);
    expect(tampered.stdout).toContain("hash_mismatch");
    const asJson = runLore(["status", "--check-decision-log", "--json"]);
    expect(asJson.exitCode).toBe(1);
    expect(JSON.parse(asJson.stdout).data.decision_log).toMatchObject({ clean: false, break: { id: target.id, reason: "hash_mismatch" } });

    // plain `lore status` names the finding too, without changing its own exit code
    const plain = runLore(["status"]);
    expect(plain.stdout).toContain(`CHAIN BROKEN at row ${target.id}`);

    // restore the row, then delete a middle row: prev-link break
    const db2 = new Database(dbPath);
    try {
      db2.run("UPDATE decision_log SET verdict = 'escalate' WHERE id = ?", [target.id]);
      expect(runLore(["status", "--check-decision-log"]).exitCode).toBe(0); // control: restoring heals it
      db2.run("DROP TRIGGER decision_log_no_delete");
      const victim = rows.value[2]!;
      db2.run("DELETE FROM decision_log WHERE id = ?", [victim.id]);
      const next = rows.value[3]!;
      const deleted = runLore(["status", "--check-decision-log"]);
      expect(deleted.exitCode).toBe(1);
      expect(deleted.stdout).toContain(`row ${next.id}`);
      expect(deleted.stdout).toContain("prev_link_mismatch");
    } finally {
      db2.close();
    }
  }, 120_000);
});
