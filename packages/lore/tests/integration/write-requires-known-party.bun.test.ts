// @spawns packages/lore/src/index.ts
/**
 * AC-HID-1 — a write with no known party is refused and writes nothing
 * (spec-every-write-is-made-by-a-known-party-an-attested-agent-run; BR-1351, BR-1055).
 *
 * Contract under test, in a throwaway corpus with EVERY identity variable stripped and no human session:
 *   - `lore claim`, `lore set` and `lore evidence` each exit 4, name `lore session start --human` AND `lore setup`,
 *     and leave the version and audit counts exactly as they were;
 *   - `lore get` and `lore list` still exit 0 (reads are never refused for identity);
 *   - an MCP write call WITHOUT `harness_run` is refused the same way and writes nothing;
 *   - a write naming a harness run the registry does not know exits 4 (never downgraded to an unattested write).
 *
 * Dimensions: NEGATIVE (the three refusals, MCP, unregistered run), HAPPY (reads, and the same writes succeed for a
 * registered run: the controls that make a refusal mean "no party", not "broken fixture"), STATE (counts unchanged),
 * BOUNDARY (an agent-harness marker alone, with no run, is not a party), REGRESSION (init needs no party).
 *
 * MOCK RISK: none — the real CLI and the real `lore --mcp-server` over stdio against a real corpus file.
 *
 * @spec_ref AC-HID-1
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { createPartyCorpus, type LoreRun, type PartyCorpus } from "../helpers/known-party-corpus.js";
import { registerTestRun, scrubIdentityEnv } from "../helpers/test-run-identity.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const ENTRY = join(new URL("../../", import.meta.url).pathname, "src", "index.ts");

/** The two remedies every refusal must name (BR-1351). */
function expectNamesBothRemedies(run: LoreRun): void {
  expect(run.stderr).toContain("lore session start --human");
  expect(run.stderr).toContain("lore setup");
}

describe("AC-HID-1: a write with no known party is refused before anything is written", () => {
  let corpus: PartyCorpus;
  let task: string;
  let prd: string;

  beforeAll(() => {
    corpus = createPartyCorpus("hid1");
    prd = corpus.slugOf(corpus.setup(["create", "prd", "--title", "Known party PRD", "--content", "root", "--no-ai"]));
    const plan = corpus.slugOf(corpus.setup(["create", "plan", "--title", "Known party plan", "--parent", prd, "--content", "x", "--no-ai"]));
    task = corpus.slugOf(
      corpus.setup(["create", "task", "--title", "Known party task", "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai"]),
    );
  });

  afterAll(() => corpus.cleanup());

  it("lore claim exits 4 naming both remedies and writes nothing", () => {
    const before = corpus.counts();
    const result = corpus.lore(["claim", task]);
    expect(result.exitCode).toBe(4);
    expectNamesBothRemedies(result);
    expect(corpus.counts()).toEqual(before);
  });

  it("lore set exits 4 naming both remedies and writes nothing", () => {
    const before = corpus.counts();
    const result = corpus.lore(["set", prd, "--title", "Renamed by nobody"]);
    expect(result.exitCode).toBe(4);
    expectNamesBothRemedies(result);
    expect(corpus.counts()).toEqual(before);
  });

  it("lore evidence exits 4 naming both remedies and writes nothing", () => {
    const before = corpus.counts();
    const result = corpus.lore(["evidence", task, "--oracle", "manual", "--command", "true", "--result", "pass"]);
    expect(result.exitCode).toBe(4);
    expectNamesBothRemedies(result);
    expect(corpus.counts()).toEqual(before);
  });

  it("lore get and lore list still exit 0 (reads are never refused for identity)", () => {
    expect(corpus.lore(["get", prd]).exitCode).toBe(0);
    expect(corpus.lore(["list"]).exitCode).toBe(0);
  });

  it("an agent-harness marker with no attested run is not a party either: still exit 4, still nothing written", () => {
    const before = corpus.counts();
    const result = corpus.lore(["set", prd, "--title", "Renamed under a bare marker"], { kind: "nobody" }, { CLAUDECODE: "1" });
    expect(result.exitCode).toBe(4);
    expectNamesBothRemedies(result);
    expect(corpus.counts()).toEqual(before);
  });

  it("a write naming a harness run the registry does not know exits 4 and writes nothing (never downgraded)", () => {
    const before = corpus.counts();
    // reason: NOT registered through `registerTestRun` — the whole point is that the registry has never seen it.
    const result = Bun.spawnSync(["bun", "run", ENTRY, "--harness-run", "cc:never-registered", "set", prd, "--title", "Renamed by a ghost"], {
      cwd: corpus.dir,
      env: { ...scrubIdentityEnv(process.env), HOME: corpus.home, LORE_STATE_HOME: join(corpus.home, "state") },
    });
    const stderr = result.stderr.toString();
    expect(result.exitCode).toBe(4);
    expect(stderr).toContain("cc:never-registered");
    expect(stderr).toContain("lore session start --human");
    expect(stderr).toContain("lore setup");
    expect(corpus.counts()).toEqual(before);
  });

  it("CONTROL: the same lore set by a registered agent run succeeds and is stamped with its run (the refusals mean 'no party')", () => {
    const run = "cc:hid1-control";
    const before = corpus.counts();
    const result = corpus.lore(["set", prd, "--title", "Renamed by a registered run"], { kind: "run", run });
    expect(result.exitCode).toBe(0);
    expect(corpus.counts().versions).toBe(before.versions + 1);
    const latest = corpus.versionRowsOf(prd).at(-1);
    expect(latest?.harness_run).toBe(run);
  });

  it("an MCP write call without harness_run is refused the same way and writes nothing; with one it succeeds", async () => {
    const env = Object.fromEntries(
      Object.entries({ ...scrubIdentityEnv(process.env), HOME: corpus.home, LORE_STATE_HOME: join(corpus.home, "state") }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const transport = new StdioClientTransport({ command: "bun", args: ["run", ENTRY, "--mcp-server"], cwd: corpus.dir, env });
    const client = new Client({ name: "hid1", version: "0.0.0" });
    await client.connect(transport);
    try {
      const before = corpus.counts();
      const refused = await client.callTool({
        name: "lore_create",
        arguments: { type: "knowledge", title: "Written by nobody over MCP", content: "body", extra: { sub_type: "reference" } },
      });
      expect(refused.isError).toBe(true);
      const text = JSON.stringify(refused.content);
      expect(text).toContain("lore session start --human");
      expect(text).toContain("lore setup");
      expect(corpus.counts()).toEqual(before);

      const run = "cc:hid1-mcp";
      registerTestRun(corpus.dir, run);
      const accepted = await client.callTool({
        name: "lore_create",
        arguments: { harness_run: run, type: "knowledge", title: "Written by a run over MCP", content: "body", extra: { sub_type: "reference" } },
      });
      expect(accepted.isError ?? false).toBe(false);
      expect(corpus.counts().audit).toBeGreaterThan(before.audit);
    } finally {
      await client.close();
    }
  });
});
