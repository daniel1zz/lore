// @spawns packages/lore/src/index.ts
/**
 * AC-DX-1 — `lore anchor rm` on a spec or knowledge document that is not a draft, by an agent run, carries a decision
 * (exit exactly 4 naming each missing part, the anchor stays, no version written); a complete decision removes the anchor
 * and sits on the version row the removal creates; a draft spec, a human party and `lore anchor add` need none.
 * (spec-decision-records-cover-code-anchor-removal-and-keep, BR-1491; resolves #483)
 *
 * Real CLI against a throwaway corpus (`createPartyCorpus`); never the repo's own `.lore/`.
 *
 * Dimensions: HAPPY (decision recorded on the version row), NEGATIVE (each target, each missing part), BOUNDARY (draft
 * spec, anchor add), STATE (anchor and version count unchanged on refusal), REGRESSION (human party).
 *
 * @spec_ref AC-DX-1
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { createPartyCorpus, type LoreRun, type Party, type PartyCorpus } from "../../helpers/known-party-corpus.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const AGENT: Party = { kind: "run", run: "cc:dx1-agent" };
const HUMAN: Party = { kind: "human" };

const DECISION_FLAGS = ["--reason", "the anchored symbol no longer exists", "--premise", "symbol gone|issue:#483|A", "--alt", "keep the anchor|it would report drift forever"];

describe("AC-DX-1: an agent's anchor removal on a non-draft document carries a decision", () => {
  let corpus: PartyCorpus;
  let spec: string;
  let knowledge: string;
  let draftSpec: string;
  let humanSpec: string;

  function sql<T>(body: (db: Database) => T): T {
    const db = new Database(join(corpus.dir, ".lore", "lore.db"));
    try {
      return body(db);
    } finally {
      db.close();
    }
  }

  const versionsOf = (slug: string): number =>
    sql((db) => (db.query("SELECT COUNT(*) AS n FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ?").get(slug) as { n: number }).n);

  const anchorsOf = (slug: string): string[] =>
    sql((db) => {
      const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as { extra: string };
      return ((JSON.parse(row.extra) as { code_anchors?: string[] }).code_anchors ?? []);
    });

  const latestDecision = (slug: string): { reason: string; premises: unknown[]; alternatives: unknown[] } | null =>
    sql((db) => {
      const row = db
        .query("SELECT v.decision AS decision FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ? ORDER BY v.version DESC LIMIT 1")
        .get(slug) as { decision: string | null } | null;
      return row?.decision == null ? null : (JSON.parse(row.decision) as { reason: string; premises: unknown[]; alternatives: unknown[] });
    });

  const approveDoc = (slug: string): void => sql((db) => void db.query("UPDATE docs SET status = 'approved' WHERE slug = ?").run(slug));

  function expectRefusalNaming(run: LoreRun, parts: readonly ("reason" | "premise" | "alternative")[]): void {
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(4);
    expect(run.stderr).toContain("decision");
    for (const part of ["reason", "premise", "alternative"] as const) {
      const needle = part === "premise" ? "premise of tier S..C" : part === "alternative" ? "alternative (" : "reason (";
      if (parts.includes(part)) expect(run.stderr, `names ${part}`).toContain(needle);
      else expect(run.stderr, `does not name ${part}`).not.toContain(needle);
    }
  }

  beforeAll(() => {
    corpus = createPartyCorpus("dx1");
    const makeSpec = (title: string): string => corpus.slugOf(corpus.setup(["create", "spec", "--title", title, "--no-ai", "--content", "## Goal\n\nbody"]));
    spec = makeSpec("DX approved spec");
    draftSpec = makeSpec("DX draft spec");
    humanSpec = makeSpec("DX human spec");
    knowledge = corpus.slugOf(corpus.setup(["create", "knowledge", "--title", "DX approved knowledge", "--no-ai", "--content", "a fact about things"]));
    for (const slug of [spec, draftSpec, humanSpec, knowledge]) {
      corpus.setup(["anchor", "add", slug, "src/a.ts#Alpha", "src/b.ts#Beta"]);
    }
    for (const slug of [spec, humanSpec, knowledge]) approveDoc(slug);
    expect(corpus.lore(["session", "start", "--human", "dana"]).exitCode).toBe(0);
  });

  afterAll(() => corpus.cleanup());

  for (const kind of ["spec", "knowledge"] as const) {
    const slugOf = (): string => (kind === "spec" ? spec : knowledge);

    it(`on an approved ${kind} with no decision: exit 4 naming reason, premise and alternative; anchor stays, no version`, () => {
      const before = versionsOf(slugOf());
      const run = corpus.lore(["anchor", "rm", slugOf(), "src/a.ts#Alpha"], AGENT);
      expectRefusalNaming(run, ["reason", "premise", "alternative"]);
      expect(anchorsOf(slugOf())).toEqual(["src/a.ts#Alpha", "src/b.ts#Beta"]);
      expect(versionsOf(slugOf())).toBe(before);
    });

    it(`on an approved ${kind} with only a reason: exit 4 naming premise and alternative, not reason`, () => {
      const run = corpus.lore(["anchor", "rm", slugOf(), "src/a.ts#Alpha", "--reason", "gone"], AGENT);
      expectRefusalNaming(run, ["premise", "alternative"]);
      expect(anchorsOf(slugOf())).toEqual(["src/a.ts#Alpha", "src/b.ts#Beta"]);
    });

    it(`on an approved ${kind} with reason and premise but no alternative: exit 4 naming alternative only`, () => {
      const run = corpus.lore(["anchor", "rm", slugOf(), "src/a.ts#Alpha", "--reason", "gone", "--premise", "symbol gone|issue:#483|A"], AGENT);
      expectRefusalNaming(run, ["alternative"]);
      expect(anchorsOf(slugOf())).toEqual(["src/a.ts#Alpha", "src/b.ts#Beta"]);
    });

    it(`on an approved ${kind} with a weak-tier premise: exit 4 naming premise of tier S..C`, () => {
      const run = corpus.lore(
        ["anchor", "rm", slugOf(), "src/a.ts#Alpha", "--reason", "gone", "--premise", "symbol gone|issue:#483|E", "--alt", "keep|drift"],
        AGENT,
      );
      expectRefusalNaming(run, ["premise"]);
      expect(anchorsOf(slugOf())).toEqual(["src/a.ts#Alpha", "src/b.ts#Beta"]);
    });

    it(`on an approved ${kind} with a complete decision: anchor removed and the decision is on the new version row`, () => {
      const before = versionsOf(slugOf());
      const run = corpus.lore(["anchor", "rm", slugOf(), "src/a.ts#Alpha", ...DECISION_FLAGS], AGENT);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(anchorsOf(slugOf())).toEqual(["src/b.ts#Beta"]);
      expect(versionsOf(slugOf())).toBe(before + 1);
      const decision = latestDecision(slugOf());
      expect(decision?.reason).toBe("the anchored symbol no longer exists");
      expect(decision?.premises).toHaveLength(1);
      expect(decision?.alternatives).toHaveLength(1);
    });

    it(`anchor add on an approved ${kind} needs no decision`, () => {
      const run = corpus.lore(["anchor", "add", slugOf(), "src/c.ts#Gamma"], AGENT);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(anchorsOf(slugOf())).toContain("src/c.ts#Gamma");
    });
  }

  it("on a draft spec an agent removes an anchor with no decision", () => {
    const run = corpus.lore(["anchor", "rm", draftSpec, "src/a.ts#Alpha"], AGENT);
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    expect(anchorsOf(draftSpec)).toEqual(["src/b.ts#Beta"]);
    expect(latestDecision(draftSpec)).toBeNull();
  });

  it("a human party removes an anchor from an approved spec with no decision", () => {
    const run = corpus.lore(["anchor", "rm", humanSpec, "src/a.ts#Alpha"], HUMAN);
    expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    expect(anchorsOf(humanSpec)).toEqual(["src/b.ts#Beta"]);
    expect(latestDecision(humanSpec)).toBeNull();
  });
});
