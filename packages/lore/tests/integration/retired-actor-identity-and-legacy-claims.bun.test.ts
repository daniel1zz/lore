// @spawns packages/lore/src/index.ts
/**
 * AC-HID-4 — the retired same-name guard setting is refused, a run-less claim is refused by the store, and the schema
 * upgrade expires the claims that name no run (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end
 * state 4; BR-1352).
 *
 * Contract under test, in throwaway corpora:
 *   - a project config naming `workflow.gates."task-claim".actor_identity` is refused by the strict config schema as an unknown key naming it, and
 *     `lore migrate config-keys` previews and (with `--apply`) removes it, leaving every other byte of the file;
 *     a second `--apply` changes nothing;
 *   - a store write of a claim that names no run returns VALIDATION_ERROR on `extra.claim.harness_run` and writes
 *     nothing (no document change, no version row, no audit row); a claim that names its run is written;
 *   - `lore migrate schema` on a corpus holding a claim with no `harness_run` key expires that claim (a version row and
 *     an audit row naming the holder and the upgrade's actor), leaves a claim that names its run alone, and a second
 *     run changes nothing.
 *
 * Dimensions: HAPPY (migrate removes the key; the upgrade expires the lease) / NEGATIVE (config refused, run-less claim
 * refused) / BOUNDARY (a null run counts as no run; a claim that names its run survives) / STATE (counts unchanged on a
 * refusal and on a repeat) / REGRESSION (a config without the key is untouched).
 *
 * MOCK RISK: none — the real CLI and a real SQLite corpus file. The pre-run lease is seeded into the stored document in
 * the exact shape the code before this change wrote (by + at, no `harness_run` key), at schema 26.
 *
 * @spec_ref AC-HID-4
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfigFromString } from "@lore/core";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { withWriteContext } from "../../src/store/write-context-store.js";
import { bareDocWriter } from "../../src/service/corpus-service.js";
import { LATEST_SCHEMA_VERSION } from "../../src/store/schema-version.js";
import { createPartyCorpus, type PartyCorpus } from "../helpers/known-party-corpus.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const AGENT_RUN = { kind: "run", run: "cc:hid4-writer" } as const;
const RETIRED_KEY = "actor_identity";
const RETIRED_BLOCK = ["workflow:", "  gates:", '    "task-claim":', "      actor_identity:", "        enabled: false", ""].join("\n");

function configPath(corpus: PartyCorpus): string {
  return join(corpus.dir, ".lore", "config.yaml");
}

function docRow(corpus: PartyCorpus, slug: string): { extra: Record<string, unknown>; version: number } {
  const db = new Database(join(corpus.dir, ".lore", "lore.db"), { readonly: true });
  try {
    const row = db.query("SELECT extra, version FROM docs WHERE slug = ?").get(slug) as { extra: string; version: number } | null;
    if (row === null) throw new Error(`no doc ${slug}`);
    return { extra: JSON.parse(row.extra) as Record<string, unknown>, version: row.version };
  } finally {
    db.close();
  }
}

/** Rewrites the stored claim lease and the schema number, the way a corpus written before this change looks. */
function seedPreRunCorpus(corpus: PartyCorpus, claims: Record<string, Record<string, unknown>>): void {
  const db = new Database(join(corpus.dir, ".lore", "lore.db"));
  try {
    for (const [slug, claim] of Object.entries(claims)) {
      const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug) as { extra: string };
      const extra = JSON.parse(row.extra) as Record<string, unknown>;
      extra["claim"] = claim;
      db.query("UPDATE docs SET extra = ? WHERE slug = ?").run(JSON.stringify(extra), slug);
    }
    db.exec("PRAGMA user_version = 26");
  } finally {
    db.close();
  }
}

describe("AC-HID-4: the retired setting is refused", () => {
  let corpus: PartyCorpus;

  beforeAll(() => {
    corpus = createPartyCorpus("hid4-config");
  });

  afterAll(() => {
    corpus.cleanup();
  });

  it("REGRESSION: a config without the retired key loads, and `migrate config-keys` finds nothing to do", () => {
    expect(corpus.lore(["list"], AGENT_RUN).exitCode).toBe(0);
    const preview = corpus.lore(["migrate", "config-keys"], AGENT_RUN);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain("no retired keys");
  });

  it("the strict config schema refuses the retired key as an unknown key, naming it", () => {
    const parsed = loadConfigFromString(`project:\n  name: demo\n${RETIRED_BLOCK}`);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(parsed.error)).toContain(RETIRED_KEY);
    }
    // The control: the same config without the key parses.
    expect(loadConfigFromString("project:\n  name: demo\n").ok).toBe(true);
  });

  it("a project config carrying the key is not rewritten by any command but `migrate config-keys`", () => {
    appendFileSync(configPath(corpus), RETIRED_BLOCK);
    const before = readFileSync(configPath(corpus), "utf8");

    corpus.lore(["list"], AGENT_RUN);

    expect(readFileSync(configPath(corpus), "utf8")).toBe(before);
  });

  it("`migrate config-keys` previews the removal without writing, then `--apply` removes the key and nothing else", () => {
    const before = readFileSync(configPath(corpus), "utf8");

    const preview = corpus.lore(["migrate", "config-keys"], AGENT_RUN);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain(RETIRED_KEY);
    expect(readFileSync(configPath(corpus), "utf8")).toBe(before);

    const applied = corpus.lore(["migrate", "config-keys", "--apply"], AGENT_RUN);
    expect(applied.exitCode).toBe(0);
    const after = readFileSync(configPath(corpus), "utf8");
    expect(after).not.toContain(RETIRED_KEY);
    expect(after).toBe(before.replace(RETIRED_BLOCK, ""));
    expect(corpus.lore(["list"], AGENT_RUN).exitCode).toBe(0);
  });

  it("STATE: a second `--apply` changes nothing", () => {
    const before = readFileSync(configPath(corpus), "utf8");

    const again = corpus.lore(["migrate", "config-keys", "--apply"], AGENT_RUN);

    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("no retired keys");
    expect(readFileSync(configPath(corpus), "utf8")).toBe(before);
  });

  it("BOUNDARY: a sibling key under the same gate survives the removal", () => {
    // The previous tests left a config without a `workflow:` section, so one block carrying both keys is valid YAML.
    const clean = readFileSync(configPath(corpus), "utf8");
    const withSibling = ["workflow:", "  gates:", '    "task-claim":', "      anchor_overlap:", "        enabled: true", "      actor_identity:", "        enabled: false", ""].join("\n");
    writeFileSync(configPath(corpus), `${clean}${withSibling}`);

    const applied = corpus.lore(["migrate", "config-keys", "--apply"], AGENT_RUN);

    expect(applied.exitCode).toBe(0);
    const after = readFileSync(configPath(corpus), "utf8");
    expect(after).not.toContain(RETIRED_KEY);
    expect(after).toBe(`${clean}${["workflow:", "  gates:", '    "task-claim":', "      anchor_overlap:", "        enabled: true", ""].join("\n")}`);
    expect(corpus.lore(["list"], AGENT_RUN).exitCode).toBe(0);
  });
});

describe("AC-HID-4: the store refuses a claim that names no run", () => {
  let corpus: PartyCorpus;
  let task: string;

  beforeAll(() => {
    corpus = createPartyCorpus("hid4-store");
    const prd = corpus.slugOf(corpus.setup(["create", "prd", "--title", "Store PRD", "--content", "root", "--no-ai"]));
    const plan = corpus.slugOf(corpus.setup(["create", "plan", "--title", "Store Plan", "--parent", prd, "--content", "x", "--no-ai"]));
    task = corpus.slugOf(
      corpus.setup(["create", "task", "--title", "Store task", "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai"]),
    );
  });

  afterAll(() => {
    corpus.cleanup();
  });

  async function writeClaim(claim: Record<string, unknown>): Promise<{ ok: boolean; error?: { code: string; field?: string } }> {
    const raw = new SQLiteStore(join(corpus.dir, ".lore", "lore.db"));
    try {
      const store = withWriteContext(raw, { identity: { harnessRun: "cc:hid4-writer", claimed: "agent:session-hid4writ", claimedSource: "run" } });
      const doc = await store.findBySlug(task);
      if (!doc.ok || doc.value === null) throw new Error(`no doc ${task}`);
      const written = await bareDocWriter(store).writeDoc({
        doc: doc.value,
        patch: { extra: { ...doc.value.extra, claim } },
        action: "update",
        changeSummary: "claim",
        auditAction: "claim",
        lock: "none",
        by: "agent:session-hid4writ",
      });
      return written.ok ? { ok: true } : { ok: false, error: written.error as { code: string; field?: string } };
    } finally {
      raw.close();
    }
  }

  it("a claim with no harness_run key returns VALIDATION_ERROR on extra.claim.harness_run and writes nothing", async () => {
    const before = { counts: corpus.counts(), row: docRow(corpus, task) };

    const refused = await writeClaim({ by: "agent:session-hid4writ", at: new Date().toISOString() });

    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("VALIDATION_ERROR");
    expect(refused.error?.field).toBe("extra.claim.harness_run");
    expect(corpus.counts()).toEqual(before.counts);
    expect(docRow(corpus, task)).toEqual(before.row);
  });

  it("BOUNDARY: a claim whose harness_run is null or empty is refused the same way", async () => {
    const before = corpus.counts();

    for (const run of [null, ""]) {
      const refused = await writeClaim({ by: "agent:session-hid4writ", at: new Date().toISOString(), harness_run: run });
      expect(refused.ok).toBe(false);
      expect(refused.error?.field).toBe("extra.claim.harness_run");
    }

    expect(corpus.counts()).toEqual(before);
  });

  it("HAPPY control: a claim that names its run is written, with a version row and an audit row", async () => {
    const before = corpus.counts();

    const written = await writeClaim({ by: "agent:session-hid4writ", at: new Date().toISOString(), harness_run: "cc:hid4-writer" });

    expect(written.ok).toBe(true);
    expect(corpus.counts().versions).toBe(before.versions + 1);
    expect(corpus.counts().audit).toBeGreaterThan(before.audit);
    expect((docRow(corpus, task).extra["claim"] as { harness_run: string }).harness_run).toBe("cc:hid4-writer");
  });
});

describe("AC-HID-4: the schema upgrade expires the claims that name no run", () => {
  let corpus: PartyCorpus;
  let legacy: string;
  let nullRun: string;
  let attested: string;

  beforeAll(() => {
    corpus = createPartyCorpus("hid4-upgrade");
    const prd = corpus.slugOf(corpus.setup(["create", "prd", "--title", "Upgrade PRD", "--content", "root", "--no-ai"]));
    const plan = corpus.slugOf(corpus.setup(["create", "plan", "--title", "Upgrade Plan", "--parent", prd, "--content", "x", "--no-ai"]));
    const make = (title: string): string =>
      corpus.slugOf(corpus.setup(["create", "task", "--title", title, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai"]));
    legacy = make("Legacy lease");
    nullRun = make("Null-run lease");
    attested = make("Attested lease");
    const at = new Date().toISOString();
    seedPreRunCorpus(corpus, {
      [legacy]: { by: "alice", at },
      [nullRun]: { by: "bob", at, harness_run: null },
      [attested]: { by: "carol", at, harness_run: "cc:hid4-carol" },
    });
  });

  afterAll(() => {
    corpus.cleanup();
  });

  it("the seed has no harness_run key on the legacy lease (a seed carrying one would be a different case)", () => {
    expect(docRow(corpus, legacy).extra["claim"]).not.toHaveProperty("harness_run");
  });

  it("a command on the older corpus is refused until the schema is upgraded", () => {
    const refused = corpus.lore(["list"], AGENT_RUN);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("lore migrate schema");
  });

  it("`migrate schema --dry-run` lists what is pending and expires nothing", () => {
    const dry = corpus.lore(["migrate", "schema", "--dry-run"], AGENT_RUN);

    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain("migration-027");
    expect(docRow(corpus, legacy).extra["claim"]).toBeDefined();
  });

  it("`migrate schema` expires the run-less leases with a version row and an audit row each, and keeps the lease that names its run", () => {
    const before = corpus.counts();

    const upgraded = corpus.lore(["migrate", "schema"], AGENT_RUN);

    expect(upgraded.exitCode).toBe(0);
    expect(upgraded.stdout).toContain(`${LATEST_SCHEMA_VERSION}`);
    expect(upgraded.stdout).toContain(legacy);
    expect(docRow(corpus, legacy).extra["claim"]).toBeUndefined();
    expect(docRow(corpus, nullRun).extra["claim"]).toBeUndefined();
    expect((docRow(corpus, attested).extra["claim"] as { harness_run: string }).harness_run).toBe("cc:hid4-carol");

    const after = corpus.counts();
    expect(after.versions).toBe(before.versions + 2);
    const releases = corpus.auditRows().filter((row) => row.action === "release");
    expect(releases).toHaveLength(2);
    expect(releases.map((row) => row.details["previous_holder"]).sort()).toEqual(["alice", "bob"]);
    for (const row of releases) expect(row.details["reason"]).toBe("expired_pre_run_claim");
    // The version row keeps who held the expired lease: the history says what was expired, never silence.
    expect(corpus.versionRowsOf(legacy).at(-1)?.created_by).toBeDefined();
  });

  it("STATE: a second `migrate schema` changes nothing", () => {
    const before = { counts: corpus.counts(), legacy: docRow(corpus, legacy), attested: docRow(corpus, attested) };

    const again = corpus.lore(["migrate", "schema"], AGENT_RUN);

    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("nothing pending");
    expect(corpus.counts()).toEqual(before.counts);
    expect(docRow(corpus, legacy)).toEqual(before.legacy);
    expect(docRow(corpus, attested)).toEqual(before.attested);
  });

  it("the upgraded corpus is usable and a fresh claim names its run", () => {
    expect(corpus.lore(["claim", legacy], AGENT_RUN).exitCode).toBe(0);
    expect((docRow(corpus, legacy).extra["claim"] as { harness_run: string }).harness_run).toBe(AGENT_RUN.run);
  });
});
