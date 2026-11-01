// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by (BR-807 as modified, BR-1528)
 *
 * `lore init` seeds one approved template document per shipped seed and nothing else, whoever runs it: a run with no
 * known party records the templates under the setup run (`api-key:lore-init`), never skips them.
 *
 * Coverage:
 *   HAPPY:      init as nobody leaves exactly one approved template per shipped seed
 *   HAPPY:      a seeded slot resolves through `template show`
 *   STATE:      the templates carry the setup run as author and run; `--json` reports the count
 *   REGRESSION: the tree check treats the parentless templates as placed
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPartyCorpus, type PartyCorpus } from "../helpers/known-party-corpus.js";
import { scrubIdentityEnv } from "../helpers/test-run-identity.js";
import { readShippedTemplateSeeds } from "../../src/adapters/cli/template-seeds.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const ENTRY = join(new URL("../../", import.meta.url).pathname, "src", "index.ts");

const seeds = (() => {
  const read = readShippedTemplateSeeds();
  if (!read.ok) throw new Error(JSON.stringify(read.error));
  return read.value;
})();

const corpora: PartyCorpus[] = [];
const scratch: string[] = [];
function corpus(prefix: string): PartyCorpus {
  const made = createPartyCorpus(prefix);
  corpora.push(made);
  return made;
}
afterAll(() => {
  for (const made of corpora) made.cleanup();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

interface ListedDoc {
  readonly slug: string;
  readonly type: string;
  readonly status: string;
}

function listed(made: PartyCorpus): ListedDoc[] {
  const run = made.lore(["list", "--json", "--limit", "500"]);
  expect(run.exitCode, run.stderr + run.stdout).toBe(0);
  return (JSON.parse(run.stdout) as { data: { docs: ListedDoc[] } }).data.docs;
}

describe("BR-807 as modified: lore init seeds one approved template per shipped seed", () => {
  it("the shipped seed set holds 27 slots", () => {
    expect(seeds).toHaveLength(27);
  });

  it("init as nobody (no run, no session) seeds every template, approved, and nothing else", () => {
    const made = corpus("init-seeds-nobody");
    const docs = listed(made);
    expect(docs.filter((doc) => doc.type !== "template")).toEqual([]);
    expect(docs).toHaveLength(seeds.length);
    expect(docs.every((doc) => doc.status === "approved")).toBe(true);
    expect(new Set(docs.map((doc) => doc.slug)).size).toBe(seeds.length);
  });

  it("a no-party init records the templates under the setup run, never unattested", () => {
    const made = corpus("init-seeds-actor");
    const rows = made.versionRowsOf("task-template");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.created_by === "lore-init" && row.harness_run === "api-key:lore-init")).toBe(true);
  });

  it("init --json reports how many templates it seeded", () => {
    const fresh = realpathSync(mkdtempSync(join(tmpdir(), "init-seeds-json-")));
    scratch.push(fresh);
    mkdirSync(join(fresh, "home"), { recursive: true });
    const proc = Bun.spawnSync(["bun", "run", ENTRY, "init", "--json"], {
      cwd: fresh,
      env: { ...scrubIdentityEnv(process.env), HOME: join(fresh, "home"), LORE_STATE_HOME: join(fresh, "home", "state"), LORE_TEST_IDENTITY: "none" } as Record<string, string>,
    });
    expect(proc.exitCode, proc.stderr.toString() + proc.stdout.toString()).toBe(0);
    const report = JSON.parse(proc.stdout.toString().trim().split("\n").pop() ?? "") as { data: { templates: { seeded: number } } };
    expect(report.data.templates.seeded).toBe(seeds.length);
  });

  it("every seeded slot resolves a template through `template show`", () => {
    const made = corpus("init-seeds-resolve");
    const task = made.lore(["template", "show", "task", "--json"]);
    expect(task.exitCode, task.stderr + task.stdout).toBe(0);
    const specTech = made.lore(["template", "show", "spec", "--kind", "tech", "--json"]);
    expect(specTech.exitCode, specTech.stderr + specTech.stdout).toBe(0);
  });

  it("the tree check does not report the parentless templates as orphans", () => {
    const made = corpus("init-seeds-tree");
    const tree = made.lore(["status", "--check-tree"]);
    expect(tree.stdout + tree.stderr).not.toMatch(/template-\S*.*(orphan|unplaced|not placed)/i);
  });
});
