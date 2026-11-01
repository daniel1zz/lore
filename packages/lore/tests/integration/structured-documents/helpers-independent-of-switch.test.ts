// @reads assets/project/lore-config-template.yaml
// @reads assets/project/reference-transaction
// @reads packages/lore/src/adapters/cli/commands/rule.ts
// @reads scripts/check-unclaimed-oracle.ts
// @spawns packages/lore/src/index.ts
// @spawns-external git builds throwaway git repositories the fixtures run against
/**
 * task-t14-shared-test-helpers-and-fixtures-create-templated: the shared test helpers create their documents with FIELDS
 * from the approved template, so they work with `workflow.structured_documents.require_create` ON (BR-1528). Each case turns
 * the switch ON in its own corpus BEFORE the helper builds anything, then uses the helper; a helper that still creates with
 * `--content` is refused exit 4 and throws.
 *
 * Throwaway corpora only (mkdtemp + `lore init`), never the repository's own `.lore/`.
 *
 * Coverage:
 *   HAPPY:      parented-create (service, CLI, async CLI), cli-live-rule, claim-branch-task, own-diff-fixture, coverage-mini-corpus,
 *               baseline-items-corpus and gh-issue-stub build their fixtures with the switch ON; the one-fields-file helper
 *               returns a file that creates a document and a service `extra` that creates one
 *   NEGATIVE:   the probe really has the switch ON: a plain `lore create prd` with a body is refused exit 4 in the same corpus
 *   BOUNDARY:   a (type, kind) with no shipped template throws, never falls back to a body
 *   STATE:      a second ensureRequirementsDoc call reuses the first document (no second create)
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { asCliRun, ensureRequirementsDocId, ensureRequirementsDocSlugAsync } from "../../helpers/parented-create.js";
import { asyncLoreRunnerFor, citeSpecViaAsyncCli, ensureLiveRuleViaAsyncCli } from "../../helpers/cli-live-rule.js";
import { claimBranchTask } from "../../helpers/claim-branch-task.js";
import { OwnDiffFixture } from "../../helpers/own-diff-fixture.js";
import { buildMiniCorpus } from "../../helpers/coverage-mini-corpus.js";
import { createItemsCorpus } from "../../helpers/baseline-items-corpus.js";
import { makeIssueFixture } from "../../helpers/gh-issue-stub.js";
import { readLoreConfig } from "../../helpers/patch-lore-config.js";
import { createStructuredRig, type StructuredRig } from "../../helpers/structured-corpus.js";
import { armRequireCreate, requireCreateConfig } from "../../helpers/structured-docs.js";
import { templatedExtra, templatedFieldsArgs, templatedFill } from "../../helpers/templated-create.js";

const rigs: StructuredRig[] = [];
const dirs: string[] = [];
afterAll(() => {
  for (const rig of rigs) rig.cleanup();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function armedRig(): Promise<StructuredRig> {
  const rig = await createStructuredRig("t14-probe");
  rigs.push(rig);
  armRequireCreate(rig);
  expect(switchOf(rig.dir)).toBe(true);
  return rig;
}

function switchOf(dir: string): unknown {
  const workflow = readLoreConfig(dir)["workflow"] as { structured_documents?: { require_create?: unknown } } | undefined;
  return workflow?.structured_documents?.require_create;
}

describe("shared helpers create templated documents with the switch ON", () => {
  it("NEGATIVE: the probe corpus really refuses a create with a body", async () => {
    const rig = await armedRig();
    const refused = await rig.lore(["create", "prd", "--title", "Plain", "--no-ai", "--content", "body"]);
    expect(refused.exitCode).toBe(4);
  });

  it("HAPPY: parented-create (service and async CLI) and STATE: the second call reuses the first document", async () => {
    const rig = await armedRig();
    const id = await rig.withApp((app) => ensureRequirementsDocId(app.corpusService), requireCreateConfig());
    expect(id).toMatch(/^[0-9A-Z]{26}$/);
    const before = await rig.countDocs();
    const slug = await ensureRequirementsDocSlugAsync(async (args) => {
      const ran = await rig.lore(args);
      return { stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode };
    });
    expect(slug).toMatch(/^prd-/);
    expect(await rig.countDocs()).toBe(before);
    const again = await rig.withApp((app) => ensureRequirementsDocId(app.corpusService), requireCreateConfig());
    expect(again).toBe(id);
    expect(asCliRun({ stdout: "", stderr: "", code: 0 }).exitCode).toBe(0);
  });

  it("HAPPY: parented-create creates the requirements document by CLI when the corpus has none", async () => {
    const rig = await armedRig();
    const slug = await ensureRequirementsDocSlugAsync(async (args) => {
      const ran = await rig.lore(args);
      return { stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode };
    });
    expect(slug).toMatch(/^prd-/);
  });

  it("HAPPY: cli-live-rule builds a baseline tree and one live rule", async () => {
    const rig = await armedRig();
    const lore = asyncLoreRunnerFor((args) => rig.lore(args), rig.dir);
    const prd = await ensureRequirementsDocSlugAsync(async (args) => {
      const ran = await rig.lore(args);
      return { stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode };
    });
    const rule = await ensureLiveRuleViaAsyncCli(lore, rig.dir, prd);
    expect(rule).toMatch(/^BR-\d+$/);
    expect(citeSpecViaAsyncCli).toBeTypeOf("function");
  }, 60_000);

  it("HAPPY: own-diff-fixture creates its PRD, plan and task, and claim-branch-task claims one", () => {
    const fixture = new OwnDiffFixture(["  structured_documents:", "    require_create: true"]);
    try {
      expect(switchOf(fixture.dir)).toBe(true);
      const task = fixture.createTask("Probe task", [], "check");
      expect(task).toMatch(/^task-/);
      const claimed = claimBranchTask(
        (args) => {
          const ran = fixture.lore(args, { CLAUDE_CODE_SESSION_ID: "probe-claim" });
          return { status: ran.exitCode, out: ran.text };
        },
        fixture.dir,
        "probe-branch",
        "check",
      );
      expect(claimed).toMatch(/^task-/);
    } finally {
      fixture.dispose();
    }
  }, 120_000);

  it("HAPPY: coverage-mini-corpus builds its baseline tree", async () => {
    const corpus = await buildMiniCorpus({ requireCreate: true });
    try {
      expect(switchOf(corpus.dir)).toBe(true);
      expect(corpus.leafA).toMatch(/^baseline-/);
    } finally {
      corpus.dispose();
    }
  }, 120_000);

  it("HAPPY: baseline-items-corpus builds an approved leaf and adds another", async () => {
    const corpus = await createItemsCorpus("t14-items", { requireCreate: true });
    try {
      expect(switchOf(corpus.dir)).toBe(true);
      const second = await corpus.addLeaf("Second leaf");
      expect(second).toMatch(/^baseline-/);
    } finally {
      corpus.cleanup();
    }
  }, 120_000);

  it("HAPPY: gh-issue-stub builds a corpus with its root PRD", async () => {
    const fixture = await makeIssueFixture([], { dirsToClean: dirs, requireCreate: true });
    expect(switchOf(fixture.dir)).toBe(true);
    const prds = await fixture.run(["list", "--type", "prd", "--json"], "worker");
    expect(prds.exitCode).toBe(0);
    expect((JSON.parse(prds.stdout) as { data: { docs: unknown[] } }).data.docs).toHaveLength(1);
  }, 120_000);
});

describe("templated-create", () => {
  it("HAPPY: the fields-file args create a document with the switch ON", async () => {
    const rig = await armedRig();
    const created = await rig.lore(["create", "prd", "--title", "From fields", "--no-ai", ...templatedFieldsArgs("prd")]);
    expect(created.exitCode).toBe(0);
  });

  it("HAPPY: the service extra creates a document with the switch ON", async () => {
    const rig = await armedRig();
    const made = await rig.withApp(
      (app) => app.corpusService.create({ type: "prd", title: "From extra", extra: templatedExtra("prd") } as never),
      requireCreateConfig(),
    );
    expect(made.ok).toBe(true);
  });

  it("STATE: overrides replace top-level fields and a dimensions override replaces the answers", () => {
    const base = templatedFill("prd");
    const key = Object.keys(base.fields)[0]!;
    const overridden = templatedFill("prd", { fields: { [key]: "override" }, dimensions: [] });
    expect(overridden.fields[key]).toBe("override");
    expect(overridden.dimensions).toEqual([]);
  });

  it("BOUNDARY: a type or kind with no shipped template throws", () => {
    expect(() => templatedFill("prd", { kind: "no-such-kind" })).toThrow(/no shipped seed/);
    expect(() => templatedFieldsArgs("no-such-type")).toThrow(/no shipped seed/);
  });
});
