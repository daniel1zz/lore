/**
 * Unit suite for the refresh flow's package-file and managed-part-format failures
 * (baseline-refresh-the-managed-part BR-883, BR-881): a malformed package file or an older-lore
 * (fingerprint-less) managed part fails the refresh loud and writes nothing; a missing package file is
 * stated in the commands section, never rendered as an empty scripts list.
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   task-refresh-fails-loud-on-a-malformed-package-file-refuses
 */

import { describe, expect, it } from "vitest";
import { CLAUDE_MD_MARKER_END, CLAUDE_MD_MARKER_START, InMemoryFsPort } from "@lore/core";
import { runContextInit, runContextRefresh } from "../../../src/flows/context-flow.js";

async function initialised(files: Record<string, string>): Promise<InMemoryFsPort> {
  const fs = new InMemoryFsPort(files);
  const init = await runContextInit({ fs }, "", {});
  expect(init.ok).toBe(true);
  return fs;
}

describe("runContextRefresh — package file (BR-883)", () => {
  it("ERROR: invalid JSON in package.json fails the refresh naming the file; CLAUDE.md is not written", async () => {
    const fs = await initialised({});
    const before = await fs.readFile("CLAUDE.md");
    await fs.writeFile("package.json", "{ not json");

    const result = await runContextRefresh({ fs }, "");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("package.json is not valid JSON");
    expect(await fs.readFile("CLAUDE.md")).toBe(before);
  });

  it("ERROR: a malformed scripts list fails the refresh naming the file and the schema error; CLAUDE.md is not written", async () => {
    const fs = await initialised({});
    const before = await fs.readFile("CLAUDE.md");
    await fs.writeFile("package.json", JSON.stringify({ scripts: ["build"] }));

    const result = await runContextRefresh({ fs }, "");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("package.json has an invalid shape");
    expect(result.error.message).toContain("scripts");
    expect(await fs.readFile("CLAUDE.md")).toBe(before);
  });

  it("ERROR: --check on a malformed package.json fails too, never reports a clean tree", async () => {
    const fs = await initialised({});
    await fs.writeFile("package.json", "oops");
    const result = await runContextRefresh({ fs }, "", { check: true });
    expect(result.ok).toBe(false);
  });

  it("STATE: no package.json at all is stated in the commands section, not rendered as 'no scripts marked'", async () => {
    const fs = await initialised({});
    const result = await runContextRefresh({ fs }, "");
    expect(result.ok).toBe(true);
    const content = (await fs.readFile("CLAUDE.md")) ?? "";
    expect(content).toContain("This project has no package.json");
    expect(content).not.toContain("No scripts are marked as documented");
  });

  it("STATE: a valid package.json with no marker keeps the 'No scripts are marked' pointer", async () => {
    const fs = await initialised({ "package.json": JSON.stringify({ scripts: { build: "x" } }) });
    const content = (await fs.readFile("CLAUDE.md")) ?? "";
    expect(content).toContain("No scripts are marked as documented");
    expect(content).not.toContain("has no package.json");
  });
});

describe("runContextRefresh — managed-part format (BR-881)", () => {
  it("ERROR: an older-lore zone with no fingerprint is refused naming the repair; the file is not rewritten", async () => {
    const legacy = `# Mine\n\n${CLAUDE_MD_MARKER_START}\nplain old managed prose\n${CLAUDE_MD_MARKER_END}\n`;
    const fs = new InMemoryFsPort({ "CLAUDE.md": legacy });

    const result = await runContextRefresh({ fs }, "");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("carries no fingerprint");
    expect(result.error.message).toContain("Repair: delete the zone");
    expect(await fs.readFile("CLAUDE.md")).toBe(legacy);
  });
});
