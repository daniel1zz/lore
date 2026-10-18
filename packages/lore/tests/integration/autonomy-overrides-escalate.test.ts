// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/**
/**
 * AC-AU-7 oracle — an override the actor can set is DECIDED, not granted.
 *
 * `approve --override-judgment/--override-no-judgment`, `done --override-attestation`, `ac exempt` (and `verify --yes`,
 * covered at the service seam in tests/unit/service/verify-runner-service.test.ts) each call decide() with their class;
 * an escalate verdict exits 4, writes nothing else, opens a pending decision and prints its id and the
 * `lore decide <id>` line (never a nonce).
 *
 * Everything runs in THROWAWAY corpora (mkdtemp + `lore init`), never the repo's own `.lore/`. The CLI is the real one;
 * the human answer is the real `lore decide` flow driven through the injectable human-channel ports (the same seam the
 * AC-AU-8 oracle uses), so no agent identity is involved in granting it.
 *
 * Halves (spec AC-AU-7): (1) approve --override-judgment on a spec whose judgment is reject -> exit 4, pending decision
 * named, spec still draft; (2) after a human-tty accept the same command -> exit 0; (3) done --override-attestation with
 * no attested pass -> exit 4 pending; (4) control: a corpus whose override-judgment prior was raised through a human-tty
 * governance decision -> approve --override-judgment exits 0 with an auto decision record.
 * Beyond the halves: --override-no-judgment, ac exempt, a human reject, nothing written on escalation, no nonce printed.
 *
 * @spec_ref AC-AU-7
 */
import { afterAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { citeSpecViaCli, loreRunnerFor } from "../helpers/cli-live-rule.js";
import { lore, newCorpus, readLog, removeCorpora, runDecide, type Corpus, type Run } from "./fixtures/autonomy-calibration-helpers.js";
import { loosenOverrideClassesViaCli } from "./fixtures/autonomy-override-helpers.js";

afterAll(removeCorpora);

interface DocJson {
  readonly id: string;
  readonly slug: string;
  readonly version: number;
  readonly status: string;
}

function ok(corpus: Corpus, args: string[]): Run {
  const r = lore(corpus, args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function getDoc(corpus: Corpus, slug: string): DocJson {
  return (JSON.parse(ok(corpus, ["get", slug, "--json"]).stdout) as { data: { doc: DocJson } }).data.doc;
}

/** A spec with one script AC that cites a live rule, so only the judgment gate stands between it and approval. */
function newCorpusWithSpec(prefix: string): { corpus: Corpus; spec: DocJson } {
  const corpus = newCorpus(prefix);
  const prd = JSON.parse(ok(corpus, ["create", "prd", "--title", "Root PRD", "--content", "x", "--json"]).stdout) as { data: { slug: string } };
  const created = JSON.parse(ok(corpus, ["create", "spec", "--title", "Overridden Spec", "--content", "## Overview\n\nBody.", "--json"]).stdout) as { data: { slug: string } };
  const slug = created.data.slug;
  ok(corpus, ["ac", "add", slug, "AC-1", "--statement", "the parser round-trips every fixture file", "--mode", "script", "--oracle", "test", "--command", "true"]);
  citeSpecViaCli(loreRunnerFor((args) => lore(corpus, args), corpus.dir), corpus.dir, prd.data.slug, slug, "AC-1");
  return { corpus, spec: getDoc(corpus, slug) };
}

/** Direct insert into `review_judgments` — the fact approve()'s gate reads (no AI judge is invoked). */
function insertJudgment(corpus: Corpus, spec: DocJson, decision: "approve" | "reject"): string {
  const id = `judgment-au7-${Math.random().toString(36).slice(2, 10)}`;
  const db = new Database(corpus.dbPath);
  try {
    db.run(
      `INSERT INTO review_judgments (id, doc_id, doc_version, decision, confidence, reasons, checks, blocking_questions,
         judge_provider, judge_model, judge_prompt_version, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, spec.id, spec.version, decision, 0.9, JSON.stringify([{ dimension: "completeness", finding: "seeded" }]), JSON.stringify([{ check: "schema", outcome: "pass" }]), "[]", "test-judge", "test-model", "v1", new Date().toISOString(), "ai:test-judge:test-model:v1"],
    );
  } finally {
    db.close();
  }
  return id;
}

/** A corpus holding the root PRD an --adhoc task needs as parent, plus one adhoc task; returns the task slug. */
function newCorpusWithAdhocTask(prefix: string, title: string): { corpus: Corpus; slug: string } {
  const corpus = newCorpus(prefix);
  ok(corpus, ["create", "prd", "--title", "Root PRD", "--content", "x", "--json"]);
  const created = JSON.parse(ok(corpus, ["create", "task", "--title", title, "--adhoc", "--ac-scope", "", "--content", "body", "--no-ai", "--json"]).stdout) as { data: { slug: string } };
  return { corpus, slug: created.data.slug };
}

function pendingIdOf(run: Run): number {
  const id = Number(/Pending decision (\d+) created/.exec(run.stderr)?.[1]);
  expect(id, run.stderr).toBeGreaterThan(0);
  return id;
}

const DECISION_ROWS_OF = async (corpus: Corpus, classId: string) => (await readLog(corpus)).filter((r) => r.class === classId);

describe("AC-AU-7 half 1+2: approve --override-judgment is decided; a human-tty accept lets the same command through", () => {
  it("(1) agent run, reject judgment -> exit 4 naming the pending decision and `lore decide <id>`; spec still draft; no nonce printed", async () => {
    const { corpus, spec } = newCorpusWithSpec("lore-au7-h1-");
    const judgmentId = insertJudgment(corpus, spec, "reject");
    expect(lore(corpus, ["approve", spec.slug]).exitCode, "the reject blocks a plain approve").toBe(4);

    const r = lore(corpus, ["approve", spec.slug, "--override-judgment", judgmentId]);
    expect(r.exitCode, r.stderr).toBe(4);
    const pendingId = pendingIdOf(r);
    expect(r.stderr).toContain(`lore decide ${pendingId}`);
    expect(r.stderr).toContain("override-judgment");
    expect(r.stderr + r.stdout).not.toMatch(/Confirmation code|nonce/i);
    expect(getDoc(corpus, spec.slug)).toMatchObject({ status: "draft", version: spec.version });

    const pending = JSON.parse(ok(corpus, ["pending", "--json"]).stdout) as { data: unknown };
    expect(JSON.stringify(pending.data)).toContain("override-judgment");
    expect((await DECISION_ROWS_OF(corpus, "override-judgment")).every((row) => row.verdict === "escalate")).toBe(true);
  }, 180_000);

  it("(2) after a human-tty accept of that decision the SAME command exits 0 and the spec is approved", async () => {
    const { corpus, spec } = newCorpusWithSpec("lore-au7-h2-");
    const judgmentId = insertJudgment(corpus, spec, "reject");
    const args = ["approve", spec.slug, "--override-judgment", judgmentId];
    const first = lore(corpus, args);
    expect(first.exitCode).toBe(4);
    const pendingId = pendingIdOf(first);

    const answered = await runDecide(corpus, pendingId, "accept");
    expect(answered.code, answered.stderr).toBe(0);

    const second = lore(corpus, args);
    expect(second.exitCode, second.stderr).toBe(0);
    expect(getDoc(corpus, spec.slug).status).toBe("approved");
    const rows = await DECISION_ROWS_OF(corpus, "override-judgment");
    expect(rows.some((row) => row.channel === "human-tty" && row.verdict === "auto")).toBe(true);
  }, 180_000);

  it("a human REJECT keeps the override refused: exit 4, nothing approved", async () => {
    const { corpus, spec } = newCorpusWithSpec("lore-au7-rej-");
    const judgmentId = insertJudgment(corpus, spec, "reject");
    const args = ["approve", spec.slug, "--override-judgment", judgmentId];
    const pendingId = pendingIdOf(lore(corpus, args));
    expect((await runDecide(corpus, pendingId, "reject")).code).toBe(0);
    const again = lore(corpus, args);
    expect(again.exitCode, again.stderr).toBe(4);
    expect(again.stderr).toMatch(/refused/i);
    expect(getDoc(corpus, spec.slug).status).toBe("draft");
  }, 180_000);

  it("--override-no-judgment (a doc with zero judgments) is decided too: exit 4 pending, spec draft", () => {
    const { corpus, spec } = newCorpusWithSpec("lore-au7-nojudg-");
    const r = lore(corpus, ["approve", spec.slug, "--override-no-judgment"]);
    expect(r.exitCode, r.stderr).toBe(4);
    expect(pendingIdOf(r)).toBeGreaterThan(0);
    expect(getDoc(corpus, spec.slug).status).toBe("draft");
  }, 180_000);
});

describe("AC-AU-7 half 3: done --override-attestation with no attested pass escalates", () => {
  it("(3) exit 4, pending decision named, task not archived, no evidence or status written", async () => {
    const { corpus, slug } = newCorpusWithAdhocTask("lore-au7-h3-", "Manual Task");
    ok(corpus, ["evidence", slug, "--oracle", "manual", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"]);
    const before = getDoc(corpus, slug);

    const r = lore(corpus, ["done", slug, "--override-attestation", "verified by hand in staging", "--declare-no-new-tests", "this task adds no test"]);
    expect(r.exitCode, r.stderr).toBe(4);
    const pendingId = pendingIdOf(r);
    expect(r.stderr).toContain(`lore decide ${pendingId}`);
    expect(r.stderr).toContain("override-attestation");
    expect(getDoc(corpus, slug)).toMatchObject({ status: before.status, version: before.version });
    const rows = await DECISION_ROWS_OF(corpus, "override-attestation");
    expect(rows.map((row) => row.verdict)).toEqual(["escalate"]);

    // after the human accepts, the same command archives the task
    expect((await runDecide(corpus, pendingId, "accept")).code).toBe(0);
    const again = lore(corpus, ["done", slug, "--override-attestation", "verified by hand in staging", "--declare-no-new-tests", "this task adds no test"]);
    expect(again.exitCode, again.stderr).toBe(0);
    expect(getDoc(corpus, slug).status).toBe("archived");
  }, 180_000);

  it("CONTROL: a task already holding a pass that the floor accepts never asks decide() for override-attestation", async () => {
    const { corpus, slug } = newCorpusWithAdhocTask("lore-au7-h3c-", "Plain Task");
    // no override flag at all: the floor refuses (exit 4) WITHOUT any decision row of the override class
    const r = lore(corpus, ["done", slug]);
    expect(r.exitCode).toBe(4);
    expect(await DECISION_ROWS_OF(corpus, "override-attestation")).toEqual([]);
  }, 180_000);
});

describe("AC-AU-7 ac exempt is decided", () => {
  it("exit 4 + pending decision, no exemption row written; after a human accept the same command grants it", async () => {
    const { corpus, spec } = newCorpusWithSpec("lore-au7-exempt-");
    // the exemption cap is floor(10% of live criteria): ten live criteria allow one exemption
    for (let n = 2; n <= 10; n++) {
      ok(corpus, ["ac", "add", spec.slug, `AC-${n}`, "--statement", `criterion ${n} that stays uncited`, "--mode", "script", "--oracle", "test", "--command", "true"]);
    }
    const args = ["ac", "exempt", spec.slug, "AC-2", "--reason", "no rule exists for this yet", "--expires", "2099-01-01T00:00:00Z"];
    const r = lore(corpus, args);
    expect(r.exitCode, r.stderr).toBe(4);
    const pendingId = pendingIdOf(r);
    expect(r.stderr).toContain("ac-exempt");
    const exemptionRows = () => {
      const db = new Database(corpus.dbPath, { readonly: true });
      try {
        return (db.query("SELECT COUNT(*) AS n FROM ac_exemptions").get() as { n: number }).n;
      } finally {
        db.close();
      }
    };
    expect(exemptionRows()).toBe(0);

    expect((await runDecide(corpus, pendingId, "accept")).code).toBe(0);
    const granted = lore(corpus, args);
    expect(granted.exitCode, granted.stderr).toBe(0);
    expect(exemptionRows()).toBe(1);
  }, 180_000);
});

describe("AC-AU-7 half 4 (control): a class loosened through a human-tty governance decision lets the override through", () => {
  it("(4) override-judgment prior raised by the human -> approve --override-judgment exits 0 with an AUTO machine decision record", async () => {
    const { corpus, spec } = newCorpusWithSpec("lore-au7-h4-");
    await loosenOverrideClassesViaCli(corpus.dir, ["override-judgment"]);
    const judgmentId = insertJudgment(corpus, spec, "reject");

    const r = lore(corpus, ["approve", spec.slug, "--override-judgment", judgmentId]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(getDoc(corpus, spec.slug).status).toBe("approved");
    const rows = await DECISION_ROWS_OF(corpus, "override-judgment");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "auto", channel: "machine", subject_id: spec.slug });
    expect(JSON.parse(rows[0]?.facts ?? "{}")).toMatchObject({ recoverability: "reversible", blast: "calling-session", evidence: "lore-evaluated" });
  }, 240_000);
});
