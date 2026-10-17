// @reads assets/context/**
/**
 * @spec_ref AC-CTX-3, AC-CF-6
 *
 * Regression suite: `context init` -> `context refresh` idempotence under D15 (static main
 * fragments live in lore-owned `.claude/rules/lore-<id>.md` files, never in a CLAUDE.md Z1
 * `fragments` section). Re-baselined by task-skill-test-d15-red-static-fragments-as-lore-rules-files
 * (owner decision 2026-10-07): the former Z1 `fragments` section assertions became rules-file assertions.
 *
 * Invariant pinned here: init and refresh must agree on CLAUDE.md bytes (refresh never appends
 * anything to CLAUDE.md for fragments), and refresh is idempotent over every rules file it owns.
 *
 * Fixtures: the REAL shipped fragments (`assets/context/*.md`) seeded into an in-memory fs, so
 * "refresh twice with shipped fragments" is measured, not mocked.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { InMemoryFsPort } from "@lore/core";
import { runContextInit, runContextRefresh } from "../../../src/flows/context-flow.js";

const SHIPPED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "assets", "context");

function seedShipped(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(SHIPPED_DIR).filter((n) => n.endsWith(".md"))) {
    files[`assets/context/${name}`] = readFileSync(join(SHIPPED_DIR, name), "utf8");
  }
  return files;
}

function makeDeps(fs: InMemoryFsPort) {
  return {
    fs,
    assetsRoot: "assets",
    home: "/home/test",
    xdgConfigHome: "/home/test/.config",
    globalConfig: {},
    projectConfig: {},
  };
}

async function initialized() {
  const fs = new InMemoryFsPort(seedShipped());
  const deps = makeDeps(fs);
  const init = await runContextInit(deps, "", {});
  expect(init.ok).toBe(true);
  return { fs, deps };
}

const RULES_DIR = ".claude/rules";
const FINGERPRINT = /^<!-- lore:managed fragment=([a-z0-9-]+) hash=[0-9a-f]{8} -->\n/;

async function rulesSnapshot(fs: InMemoryFsPort): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await fs.listDir(RULES_DIR)).sort()) {
    out[name] = (await fs.readFile(`${RULES_DIR}/${name}`)) ?? "";
  }
  return out;
}

describe("AC-CTX-3 init/refresh idempotence with D15 lore rules files", () => {
  it("HAPPY: init writes no fragments section and no rules files (refresh owns rules files)", async () => {
    const { fs } = await initialized();
    const content = (await fs.readFile("CLAUDE.md")) ?? "";
    expect(content).not.toMatch(/section=fragments/);
    expect(await fs.listDir(RULES_DIR)).toEqual([]);
  });

  it("HAPPY: refresh writes one lore-<id>.md per shipped static main fragment, each with the fingerprint first line", async () => {
    const { fs, deps } = await initialized();
    const result = await runContextRefresh(deps, "", { scope: "project" });
    expect(result.ok).toBe(true);
    const names = (await fs.listDir(RULES_DIR)).sort();
    // RE-BASELINE (task-rs-t13-migration-promoted-shipped-fragments-agent-rules): the four promoted main-audience static fragments ship too.
    expect(names).toEqual([
      "lore-ac-design.md",
      "lore-corpus-workflow-close.md",
      "lore-corpus-workflow-execute.md",
      "lore-corpus-workflow-feed.md",
      "lore-corpus-workflow-overview.md",
      "lore-corpus-workflow-produce.md",
      "lore-dispatch-bundle.md",
      "lore-evidence-attestation.md",
      "lore-worktree-dispatch.md",
    ]);
    for (const name of names) {
      const body = (await fs.readFile(`${RULES_DIR}/${name}`)) ?? "";
      const m = FINGERPRINT.exec(body);
      expect(m?.[1], name).toBe(name.slice("lore-".length, -".md".length));
    }
  });

  it("REGRESSION: refresh never changes CLAUDE.md bytes after init, and a second refresh changes no rules file byte", async () => {
    const { fs, deps } = await initialized();
    const afterInit = await fs.readFile("CLAUDE.md");

    const first = await runContextRefresh(deps, "", { scope: "project" });
    expect(first.ok).toBe(true);
    expect(await fs.readFile("CLAUDE.md")).toBe(afterInit);
    const rulesAfterFirst = await rulesSnapshot(fs);
    expect(Object.keys(rulesAfterFirst).length).toBeGreaterThan(0);

    const second = await runContextRefresh(deps, "", { scope: "project" });
    expect(second.ok).toBe(true);
    expect(await fs.readFile("CLAUDE.md")).toBe(afterInit);
    expect(await rulesSnapshot(fs)).toEqual(rulesAfterFirst);
    if (second.ok) {
      expect(second.value.sections.every((s) => s.state === "unchanged")).toBe(true);
    }
  });

  it("STATE: a hand-edit of a lore rules file -> refresh reports diverged_skip and every rules byte stays untouched", async () => {
    const { fs, deps } = await initialized();
    await runContextRefresh(deps, "", { scope: "project" });
    const target = `${RULES_DIR}/lore-corpus-workflow-feed.md`;
    const before = (await fs.readFile(target)) ?? "";
    expect(before).toMatch(FINGERPRINT);
    const firstNl = before.indexOf("\n") + 1;
    const edited = before.slice(0, firstNl) + "HAND-EDIT-MARK " + before.slice(firstNl);
    await fs.writeFile(target, edited);
    const snapshot = await rulesSnapshot(fs);

    const result = await runContextRefresh(deps, "", { scope: "project" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Report shape for rules files is a spec gap (D15 says only "reports diverged_skip"): assert the state word and the fragment id appear.
    const report = JSON.stringify(result.value);
    expect(report).toContain("diverged_skip");
    expect(report).toContain("corpus-workflow-feed");
    expect(await rulesSnapshot(fs)).toEqual(snapshot);
  });

  it("STATE: a hand-edit inside a NON-fragments managed section also leaves every byte untouched", async () => {
    const { fs, deps } = await initialized();
    await runContextRefresh(deps, "", { scope: "project" });
    const before = (await fs.readFile("CLAUDE.md")) ?? "";
    const at = before.indexOf("<!-- lore:managed section=module-index");
    expect(at).toBeGreaterThan(-1);
    const bodyStart = before.indexOf("\n", at) + 1;
    const edited = before.slice(0, bodyStart) + "HAND-EDIT-MARK " + before.slice(bodyStart);
    await fs.writeFile("CLAUDE.md", edited);

    const result = await runContextRefresh(deps, "", { scope: "project" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.find((s) => s.id === "module-index")?.state).toBe("diverged_skip");
    expect(await fs.readFile("CLAUDE.md")).toBe(edited);
  });
});
