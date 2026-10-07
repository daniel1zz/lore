/**
 * @spec_ref AC-CTX-3, AC-CF-6
 *
 * Regression suite: `context init` -> `context refresh` idempotence once the Z1 `fragments`
 * section exists (task task-skill-implement-fix-refresh-idempotence-regression-ac-ctx).
 *
 * Root cause pinned here: `runContextInit` built its section list WITHOUT the `fragments`
 * section that `runContextRefresh` always adds, so the first refresh after init appended it
 * (+N lines) and a hand-edit of an earlier section could not leave the bytes untouched.
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

describe("AC-CTX-3 init/refresh idempotence with the Z1 fragments section", () => {
  it("HAPPY: init writes the fragments section, so shipped fragments are present right after init", async () => {
    const { fs } = await initialized();
    const content = await fs.readFile("CLAUDE.md");
    expect(content).toMatch(/<!-- lore:managed section=fragments hash=[0-9a-f]{8} -->/);
  });

  it("REGRESSION: refresh right after init, and a second refresh, are byte-identical to init's output", async () => {
    const { fs, deps } = await initialized();
    const afterInit = await fs.readFile("CLAUDE.md");

    const first = await runContextRefresh(deps, "", { scope: "project" });
    expect(first.ok).toBe(true);
    const afterFirst = await fs.readFile("CLAUDE.md");
    expect(afterFirst).toBe(afterInit);

    const second = await runContextRefresh(deps, "", { scope: "project" });
    expect(second.ok).toBe(true);
    expect(await fs.readFile("CLAUDE.md")).toBe(afterInit);
    if (second.ok) {
      expect(second.value.sections.every((s) => s.state === "unchanged")).toBe(true);
    }
  });

  it("STATE: a hand-edit inside the fragments section -> diverged_skip for it and the bytes stay untouched", async () => {
    const { fs, deps } = await initialized();
    const before = (await fs.readFile("CLAUDE.md")) ?? "";
    const marker = "<!-- lore:managed section=fragments";
    const at = before.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const bodyStart = before.indexOf("\n", at) + 1;
    const edited = before.slice(0, bodyStart) + "HAND-EDIT-MARK " + before.slice(bodyStart);
    await fs.writeFile("CLAUDE.md", edited);

    const result = await runContextRefresh(deps, "", { scope: "project" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.find((s) => s.id === "fragments")?.state).toBe("diverged_skip");
    expect(await fs.readFile("CLAUDE.md")).toBe(edited);
  });

  it("STATE: a hand-edit inside a NON-fragments managed section also leaves every byte untouched", async () => {
    const { fs, deps } = await initialized();
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
