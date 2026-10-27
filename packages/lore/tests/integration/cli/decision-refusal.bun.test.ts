// @spawns packages/lore/src/index.ts
/**
 * AC-DR-2 — an agent's write to a non-draft target is refused without its decision (exit 4, naming each missing part, no
 * version written), on every surface that reaches the service: the CLI (`lore set`, `lore baseline set-label|depends|
 * glossary|map`), MCP `lore_set` and a direct `CorpusService.set` call; a draft spec edit, a status-only write and the same
 * write as a human party succeed and record no decision.
 * (spec-a-decision-carrying-write-records-its-decision-on-its, "Which writes carry a decision", "Refusal", D2; BR-1476)
 *
 * Real CLI against a throwaway corpus (`createPartyCorpus`: an attested agent run, and the person whose human session is
 * opened in it), real MCP server over an in-memory transport for the MCP and direct-call cases. Never the repo's own `.lore/`.
 *
 * `lore_bulk` has no verb that changes more than status (archive|deprecate|close|done), so by D2 it is never gated: the
 * MCP case below pins that a bulk archive of an approved ADR by an agent still succeeds with no decision.
 *
 * Dimensions: HAPPY (decision recorded on the version row and printed by `lore log`), NEGATIVE (each target and verb, each
 * missing part, weak-tier premise), BOUNDARY (draft spec, status-only), STATE (no version written on refusal), REGRESSION
 * (human party, never-approved node).
 *
 * MOCK RISK: none — files and processes are real; the git port is exercised by decision-premise-quote.bun.test.ts.
 *
 * Shared with T2b's AC-DR-5 (decision-refusal of rule proposals and criteria writes); only AC-DR-2 cases live here now.
 *
 * @spec_ref AC-DR-2
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CreateDocInput } from "@lore/core";
import { createApp, type App } from "../../../src/app.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { liveAmbient, liveInvocation, liveWriteContext, LIVE_TEST_RUN } from "../../live-invocation.js";
import { registerTestRun } from "../../helpers/test-run-identity.js";
import { createPartyCorpus, type LoreRun, type Party, type PartyCorpus } from "../../helpers/known-party-corpus.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const AGENT: Party = { kind: "run", run: "cc:dr2-agent" };
const HUMAN: Party = { kind: "human" };

/** A complete decision as CLI flags. */
const DECISION_FLAGS = ["--reason", "the label misleads readers", "--premise", "readers confused|issue:#41|A", "--alt", "keep the label|it is the confusion"];

const lastLine = (text: string): string => text.trim().split("\n").at(-1) ?? "";

describe("AC-DR-2: the CLI refuses an agent's non-draft write without its decision", () => {
  let corpus: PartyCorpus;
  let adr: string;
  let adrForStatus: string;
  let adrForHuman: string;
  let spec: string;
  let draftSpec: string;
  let root: string;
  let branch: string;
  let leaf: string;
  let ruleId: string;

  const dbPath = (): string => join(corpus.dir, ".lore", "lore.db");

  function sql<T>(body: (db: Database) => T): T {
    const db = new Database(dbPath());
    try {
      return body(db);
    } finally {
      db.close();
    }
  }

  const versionsOf = (slug: string): number =>
    sql((db) => (db.query("SELECT COUNT(*) AS n FROM versions v JOIN docs d ON d.id = v.doc_id WHERE d.slug = ?").get(slug) as { n: number }).n);

  /** The `decision` column of a doc's latest version row, parsed (null when the column is NULL). */
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
      if (parts.includes(part)) expect(run.stderr, `names ${part}`).toContain(part === "premise" ? "premise of tier S..C" : part === "alternative" ? "alternative (" : "reason (");
    }
  }

  beforeAll(() => {
    corpus = createPartyCorpus("dr2");
    const prd = corpus.slugOf(corpus.setup(["create", "prd", "--title", "DR PRD", "--content", "root", "--no-ai"]));
    const makeAdr = (title: string): string =>
      corpus.slugOf(corpus.setup(["create", "adr", "--title", title, "--decision-status", "accepted", "--no-ai", "--content", "# Decision\n\nwe chose A"]));
    adr = makeAdr("DR ADR one");
    adrForStatus = makeAdr("DR ADR two");
    adrForHuman = makeAdr("DR ADR three");
    spec = corpus.slugOf(corpus.setup(["create", "spec", "--title", "DR locked spec", "--no-ai", "--content", "## Goal\n\nbody"]));
    draftSpec = corpus.slugOf(corpus.setup(["create", "spec", "--title", "DR draft spec", "--no-ai", "--content", "## Goal\n\nbody"]));
    for (const slug of [adr, adrForStatus, adrForHuman, spec]) approveDoc(slug);

    const node = (parent: string, kind: string, label: string): string => {
      const made = corpus.setup(["baseline", "add", parent, "--node", kind, "--label", label, "--title", `DR ${label}`]);
      const slug = made.stdout.match(/Created baseline \w+ (\S+) \(/)?.[1];
      if (slug === undefined) throw new Error(`no slug in: ${made.stdout}`);
      return slug;
    };
    root = node(prd, "root", "Root");
    branch = node(root, "branch", "Branch");
    leaf = node(branch, "leaf", "Leaf");
    const otherLeaf = node(branch, "leaf", "Other leaf");
    const ruleAdded = corpus.setup(["rule", "add", otherLeaf, "--statement", "A claim is refused when it names no owner.", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "an unowned claim is refused"]);
    const id = ruleAdded.stdout.match(/\b(BR-\d+)\b/)?.[1];
    if (id === undefined) throw new Error(`no rule id in: ${ruleAdded.stdout}`);
    ruleId = id;
    // The three nodes the tests write to get an approved version (what `lore approve` would leave): no pending marker, approved.
    sql((db) =>
      void db
        .query("UPDATE docs SET status = 'approved', extra = json_remove(extra, '$.pending') WHERE slug IN (?, ?, ?)")
        .run(root, branch, leaf),
    );
    // A person opens a session and proposes a revision, so each node has an approved version AND a pending revision.
    expect(corpus.lore(["session", "start", "--human", "dana"]).exitCode).toBe(0);
    expect(corpus.lore(["baseline", "set-label", leaf, "Leaf, revised"], HUMAN).exitCode).toBe(0);
    expect(corpus.lore(["baseline", "glossary", "add", branch, "--term", "Owner", "--meaning", "who holds the claim"], HUMAN).exitCode).toBe(0);
  });

  afterAll(() => corpus.cleanup());

  describe("lore set", () => {
    it("on an approved ADR (a correction) with no decision: exit 4 naming reason, premise and alternative; no version written", () => {
      const before = versionsOf(adr);
      const run = corpus.lore(["set", adr, "--content", "# Decision\n\nwe chose B", "--correction", "typo"], AGENT);
      expectRefusalNaming(run, ["reason", "premise", "alternative"]);
      expect(versionsOf(adr)).toBe(before);
    });

    it("on an approved spec (a correction) with no decision: exit 4, no version written", () => {
      const before = versionsOf(spec);
      const run = corpus.lore(["set", spec, "--content", "## Goal\n\nbody, corrected", "--correction", "typo"], AGENT);
      expectRefusalNaming(run, ["reason", "premise", "alternative"]);
      expect(versionsOf(spec)).toBe(before);
    });

    it("on a baseline node with an approved version and a pending revision: exit 4, no version written", () => {
      const before = versionsOf(leaf);
      const run = corpus.lore(["set", leaf, "--content", "a new leaf body"], AGENT);
      expectRefusalNaming(run, ["reason", "premise", "alternative"]);
      expect(versionsOf(leaf)).toBe(before);
    });

    it("names ONLY what is missing: a reason and a premise given, the alternative missing", () => {
      const run = corpus.lore(["set", adr, "--content", "x", "--correction", "typo", "--reason", "r", "--premise", "c|issue:#3|A"], AGENT);
      expectRefusalNaming(run, ["alternative"]);
      expect(run.stderr).not.toContain("reason (");
      expect(run.stderr).not.toContain("premise of tier");
    });

    it("a premise of tier D alone is not a premise of tier S..C", () => {
      const run = corpus.lore(["set", adr, "--content", "x", "--correction", "typo", "--reason", "r", "--premise", "c|issue:#3|D", "--alt", "o|w"], AGENT);
      expectRefusalNaming(run, ["premise"]);
    });

    it("a malformed premise flag is refused (exit 4) naming the flag, never dropped", () => {
      const run = corpus.lore(["set", adr, "--content", "x", "--correction", "typo", "--premise", "no source or tier"], AGENT);
      expect(run.exitCode).toBe(4);
      expect(run.stderr).toContain("--premise");
    });

    it("with a complete decision the correction lands and the version row records it; `lore log` prints it", () => {
      const run = corpus.lore(["set", adr, "--content", "# Decision\n\nwe chose B", "--correction", "typo", ...DECISION_FLAGS], AGENT);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      const stored = latestDecision(adr);
      expect(stored?.reason).toBe("the label misleads readers");
      expect(stored?.premises).toHaveLength(1);
      expect(stored?.alternatives).toHaveLength(1);
      const log = corpus.lore(["log", adr], AGENT);
      expect(log.stdout).toContain("the label misleads readers");
    });

    it("a draft spec edit by the agent succeeds with no decision", () => {
      const run = corpus.lore(["set", draftSpec, "--content", "## Goal\n\nedited while a draft"], AGENT);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(latestDecision(draftSpec)).toBeNull();
    });

    it("a status-only write by the agent on an approved ADR succeeds with no decision", () => {
      const run = corpus.lore(["set", adrForStatus, "--status", "archived"], AGENT);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(latestDecision(adrForStatus)).toBeNull();
    });

    it("the same correction as a human party succeeds and records no decision", () => {
      const run = corpus.lore(["set", adrForHuman, "--content", "# Decision\n\nwe chose C", "--correction", "typo"], HUMAN);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(latestDecision(adrForHuman)).toBeNull();
    });
  });

  describe("lore baseline set-label | depends | glossary | map on a node with an approved version", () => {
    const verbs: ReadonlyArray<{ name: string; args: () => string[] }> = [
      { name: "set-label", args: () => ["baseline", "set-label", leaf, "Leaf, third label"] },
      { name: "depends", args: () => ["baseline", "depends", leaf, "--add", ruleId] },
      { name: "glossary add", args: () => ["baseline", "glossary", "add", branch, "--term", "Claim", "--meaning", "a lease on a task"] },
      { name: "glossary rm", args: () => ["baseline", "glossary", "rm", branch, "--term", "Owner"] },
      { name: "map", args: () => ["baseline", "map", leaf, "--command", "ac add"] },
    ];

    it.each(verbs)("$name with no decision: exit 4 naming each missing part; no version written", ({ args }) => {
      const before = versionsOf(leaf) + versionsOf(branch);
      const run = corpus.lore(args(), AGENT);
      expectRefusalNaming(run, ["reason", "premise", "alternative"]);
      expect(versionsOf(leaf) + versionsOf(branch)).toBe(before);
    });

    it("a reason alone still refuses, naming the premise and the alternative", () => {
      const run = corpus.lore(["baseline", "set-label", leaf, "Leaf, fourth label", "--reason", "clearer"], AGENT);
      expectRefusalNaming(run, ["premise", "alternative"]);
      expect(run.stderr).not.toContain("reason (");
    });

    it.each(verbs)("$name with a complete decision lands, and the version row records the decision", ({ args }) => {
      const run = corpus.lore([...args(), ...DECISION_FLAGS], AGENT);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      const decided = [leaf, branch].map(latestDecision).filter((d) => d !== null);
      expect(decided.at(-1)?.reason).toBe("the label misleads readers");
    });

    it("the same set-label as a human party succeeds and records no decision", () => {
      const run = corpus.lore(["baseline", "set-label", leaf, "Leaf, by a person"], HUMAN);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
      expect(latestDecision(leaf)?.reason).not.toBe("by a person");
    });

    it("a never-approved node is a draft: the agent's set-label needs no decision", () => {
      const draftRoot = corpus.setup(["baseline", "add", corpus.slugOf(corpus.setup(["create", "prd", "--title", "DR PRD 2", "--content", "r", "--no-ai"])), "--node", "root", "--label", "R2", "--title", "DR R2"]);
      const slug = draftRoot.stdout.match(/Created baseline \w+ (\S+) \(/)?.[1] as string;
      const run = corpus.lore(["baseline", "set-label", slug, "R2 renamed"], AGENT);
      expect(run.exitCode, `${run.stdout}${run.stderr}`).toBe(0);
    });
  });

  it("sanity: the refusals above never made the final line of a failed run a success banner", () => {
    const run = corpus.lore(["set", adr, "--content", "y", "--correction", "typo"], AGENT);
    expect(lastLine(run.stdout)).not.toMatch(/^Updated /);
  });
});

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}
const textOf = (r: ToolResult): string => r.content.map((c) => c.text).join("\n");

describe("AC-DR-2: MCP lore_set, a direct CorpusService.set call and lore_bulk (the same service)", () => {
  let tmpRoot: string;
  let dbPath: string;
  let app: App;
  let client: Client;
  let adrId: string;
  let adrSlug: string;

  const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> =>
    (await client.callTool({ name, arguments: args })) as unknown as ToolResult;

  const versionCount = (id: string): number => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return (db.query("SELECT COUNT(*) AS n FROM versions WHERE doc_id = ?").get(id) as { n: number }).n;
    } finally {
      db.close();
    }
  };

  beforeAll(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "lore-dr2-mcp-"));
    mkdirSync(join(tmpRoot, ".lore"), { recursive: true });
    dbPath = join(tmpRoot, ".lore", "lore.db");
    app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    registerTestRun(tmpRoot, LIVE_TEST_RUN);
    const created = await app.corpusService.create({
      type: "adr",
      title: "MCP ADR",
      content: "# Decision\n\nwe chose A",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    if (!created.ok) throw new Error(`adr: ${JSON.stringify(created.error)}`);
    adrId = created.value.id;
    adrSlug = created.value.slug;
    // reason: approving an ADR needs a review judgment (a gate this suite is not about); the status is seeded, as the CLI half does.
    const seed = new Database(dbPath);
    try {
      seed.query("UPDATE docs SET status = 'approved' WHERE id = ?").run(adrId);
    } finally {
      seed.close();
    }
    const approved = await app.corpusService.get(adrId);
    if (!approved.ok || approved.value.doc.status !== "approved") throw new Error(`approve fixture failed: ${JSON.stringify(approved)}`);

    const server = new McpServer({ name: "lore", version: "0.0.0-test" });
    registerTools(server, app, undefined, liveInvocation());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    app.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("MCP lore_set on an approved ADR with a correction and no decision is refused naming the parts; no version written", async () => {
    const before = versionCount(adrId);
    const res = await call("lore_set", { id_or_slug: adrSlug, content: "# Decision\n\nwe chose B", correction: { reason: "typo" }, harness_run: LIVE_TEST_RUN });
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("decision");
    expect(text).toContain("reason");
    expect(text).toContain("premise of tier S..C");
    expect(text).toContain("alternative");
    expect(versionCount(adrId)).toBe(before);
  });

  it("a direct CorpusService.set call by an agent refuses the same way", async () => {
    const before = versionCount(adrId);
    const res = await app.corpusService.set(adrId, { content: "# Decision\n\nwe chose C" }, { correction: { reason: "typo" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ code: "VALIDATION_ERROR", field: "decision" });
    expect(versionCount(adrId)).toBe(before);
  });

  it("a direct call carrying a complete decision lands and the version row records it", async () => {
    const res = await app.corpusService.set(
      adrId,
      { content: "# Decision\n\nwe chose D" },
      {
        correction: { reason: "typo" },
        decision: {
          reason: "the record named the wrong store",
          premises: [{ claim: "issue 52 shows the wrong store", tier: "A", source: { kind: "issue", number: 52 } }],
          alternatives: [{ option: "leave it", why_rejected: "the record would stay wrong" }],
        },
      },
    );
    expect(res.ok, JSON.stringify(res.ok ? "" : res.error)).toBe(true);
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("SELECT decision FROM versions WHERE doc_id = ? ORDER BY version DESC LIMIT 1").get(adrId) as { decision: string | null };
      expect(JSON.parse(row.decision as string).reason).toBe("the record named the wrong store");
    } finally {
      db.close();
    }
  });

  it("lore_bulk archive (status only) of the approved ADR by an agent succeeds with no decision: no bulk verb changes more than status", async () => {
    const res = await call("lore_bulk", { ids: [adrSlug], verb: "archive", apply: true, reason: "superseded by a newer record", harness_run: LIVE_TEST_RUN });
    expect(res.isError, textOf(res)).not.toBe(true);
    const rows = (JSON.parse(textOf(res)) as { rows: { outcome?: string; ok?: boolean }[] }).rows;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain("decision");
  });
});
