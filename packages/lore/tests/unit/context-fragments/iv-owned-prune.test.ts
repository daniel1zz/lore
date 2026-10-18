/**
 * @spec_ref AC-IV-1, AC-IV-2
 * @layer unit
 *
 * Owned-only rules prune (BR-1176, spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D1):
 * a user-scope refresh deletes a `lore-*.md` only when the file's own header proves it was written from
 * the SAME fragment source folders and its body is untouched. Doubt means keep and report.
 * Never touches disk: every fs is an InMemoryFsPort, so the developer's real ~/.claude/rules is unreachable.
 */
import { describe, expect, it } from "vitest";
import { InMemoryFsPort } from "@lore/core";
import { runContextRefresh } from "../../../src/flows/context-flow.js";
import { renderRulesFile } from "../../../src/service/context-fragments/section.js";

const HOME = "/home/test";
const RULES_DIR = `${HOME}/.claude/rules`;

function fragmentMd(id: string, body: string): string {
  return `---\nid: ${id}\ntitle: ${id} rule\naudience: [main]\nmode: static\n---\n${body}\n`;
}

function depsFor(fs: InMemoryFsPort, userConfigDir: string) {
  return {
    fs,
    assetsRoot: "assets",
    userConfigDir,
    home: HOME,
    xdgConfigHome: `${HOME}/.config`,
    globalConfig: {},
    projectConfig: {},
    claudeSettings: { read: async () => ({}) },
  } as unknown as Parameters<typeof runContextRefresh>[0];
}

async function refreshUser(fs: InMemoryFsPort, userConfigDir: string) {
  const result = await runContextRefresh(depsFor(fs, userConfigDir), "", { scope: "user" } as never);
  if (!result.ok) throw new Error(`refresh failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function states(report: { rules: Array<{ id: string; state: string }> }): Record<string, string> {
  return Object.fromEntries(report.rules.map((rule) => [rule.id, rule.state]));
}

/** Legacy-shape (no source identity) bytes for a fragment, exactly as lore wrote them before BR-1176. */
function legacyBytes(id: string, body: string): string {
  const fragment = { frontmatter: { id }, body: `${body}\n`, path: `${id}.md` } as never;
  const rendered = renderRulesFile(fragment);
  if (!rendered.ok) throw new Error(rendered.error.message);
  return rendered.value.content;
}

describe("AC-IV-1 a refresh from a different fragment source deletes no lore-*.md", () => {
  it("AC-IV-1 NEGATIVE: files recorded from source A survive a refresh reading source B, exit ok, reported foreign_skip", async () => {
    const fs = new InMemoryFsPort({
      "/cfgA/context/alpha.md": fragmentMd("alpha", "ALPHA-BODY"),
      "/cfgA/context/beta.md": fragmentMd("beta", "BETA-BODY"),
      "/cfgB/context/gamma.md": fragmentMd("gamma", "GAMMA-BODY"),
    });
    await refreshUser(fs, "/cfgA");
    const alphaBefore = await fs.readFile(`${RULES_DIR}/lore-alpha.md`);
    expect(alphaBefore).toContain("ALPHA-BODY");

    const report = await refreshUser(fs, "/cfgB");

    expect(await fs.readFile(`${RULES_DIR}/lore-alpha.md`)).toBe(alphaBefore);
    expect(await fs.readFile(`${RULES_DIR}/lore-beta.md`)).toContain("BETA-BODY");
    expect(states(report)).toMatchObject({ alpha: "foreign_skip", beta: "foreign_skip", gamma: "created" });
  });

  it("AC-IV-1 BOUNDARY: a selected fragment whose file belongs to another source is kept, not overwritten", async () => {
    const fs = new InMemoryFsPort({
      "/cfgA/context/alpha.md": fragmentMd("alpha", "FROM-A"),
      "/cfgB/context/alpha.md": fragmentMd("alpha", "FROM-B"),
    });
    await refreshUser(fs, "/cfgA");
    const report = await refreshUser(fs, "/cfgB");
    expect(await fs.readFile(`${RULES_DIR}/lore-alpha.md`)).toContain("FROM-A");
    expect(states(report)).toEqual({ alpha: "foreign_skip" });
  });

  it("AC-IV-1 REGRESSION: same source, fragment removed -> the owned, untouched file is still pruned", async () => {
    const fs = new InMemoryFsPort({ "/cfgA/context/alpha.md": fragmentMd("alpha", "ALPHA-BODY") });
    await refreshUser(fs, "/cfgA");
    await fs.deleteFile("/cfgA/context/alpha.md");
    const report = await refreshUser(fs, "/cfgA");
    expect(await fs.readFile(`${RULES_DIR}/lore-alpha.md`)).toBeNull();
    expect(states(report)).toEqual({ alpha: "pruned" });
  });
});

describe("AC-IV-2 a hand-edited, deselected file is kept", () => {
  it("AC-IV-2 HAPPY: edited deselected file -> diverged_skip and kept; unedited deselected sibling -> pruned", async () => {
    const fs = new InMemoryFsPort({
      "/cfgA/context/edited.md": fragmentMd("edited", "EDITED-BODY"),
      "/cfgA/context/clean.md": fragmentMd("clean", "CLEAN-BODY"),
    });
    await refreshUser(fs, "/cfgA");
    const original = (await fs.readFile(`${RULES_DIR}/lore-edited.md`)) as string;
    const handEdited = `${original}MY OWN NOTE\n`;
    await fs.writeFile(`${RULES_DIR}/lore-edited.md`, handEdited);
    await fs.deleteFile("/cfgA/context/edited.md");
    await fs.deleteFile("/cfgA/context/clean.md");

    const report = await refreshUser(fs, "/cfgA");

    expect(await fs.readFile(`${RULES_DIR}/lore-edited.md`)).toBe(handEdited);
    expect(await fs.readFile(`${RULES_DIR}/lore-clean.md`)).toBeNull();
    expect(states(report)).toEqual({ edited: "diverged_skip", clean: "pruned" });
  });
});

describe("AC-IV-1 / AC-IV-2 legacy files (no source identity)", () => {
  it("AC-IV-1 legacy: selected and byte-equal to this refresh's render -> adopted (rewritten with source identity)", async () => {
    const fs = new InMemoryFsPort({
      "/cfgA/context/alpha.md": fragmentMd("alpha", "ALPHA-BODY"),
      [`${RULES_DIR}/lore-alpha.md`]: legacyBytes("alpha", "ALPHA-BODY"),
    });
    const report = await refreshUser(fs, "/cfgA");
    expect(await fs.readFile(`${RULES_DIR}/lore-alpha.md`)).toMatch(/^<!-- lore:managed fragment=alpha hash=[0-9a-f]{8} source=\S+ -->\n/);
    expect(states(report)).toEqual({ alpha: "updated" });
  });

  it("AC-IV-2 legacy: deselected legacy file is kept and reported legacy_skip", async () => {
    const legacy = legacyBytes("ghost", "GHOST-BODY");
    const fs = new InMemoryFsPort({
      "/cfgA/context/alpha.md": fragmentMd("alpha", "ALPHA-BODY"),
      [`${RULES_DIR}/lore-ghost.md`]: legacy,
    });
    const report = await refreshUser(fs, "/cfgA");
    expect(await fs.readFile(`${RULES_DIR}/lore-ghost.md`)).toBe(legacy);
    expect(states(report)).toMatchObject({ ghost: "legacy_skip", alpha: "created" });
  });

  it("AC-IV-2 legacy: selected legacy file whose body differs from this render is kept, legacy_skip", async () => {
    const legacy = legacyBytes("alpha", "OLDER-BODY");
    const fs = new InMemoryFsPort({
      "/cfgA/context/alpha.md": fragmentMd("alpha", "ALPHA-BODY"),
      [`${RULES_DIR}/lore-alpha.md`]: legacy,
    });
    const report = await refreshUser(fs, "/cfgA");
    expect(await fs.readFile(`${RULES_DIR}/lore-alpha.md`)).toBe(legacy);
    expect(states(report)).toEqual({ alpha: "legacy_skip" });
  });

  it("AC-IV-2 legacy: a lore-*.md with no parseable header is kept, legacy_skip", async () => {
    const fs = new InMemoryFsPort({
      "/cfgA/context/alpha.md": fragmentMd("alpha", "ALPHA-BODY"),
      [`${RULES_DIR}/lore-mine.md`]: "# my own file that happens to start with lore-\n",
    });
    const report = await refreshUser(fs, "/cfgA");
    expect(await fs.readFile(`${RULES_DIR}/lore-mine.md`)).toBe("# my own file that happens to start with lore-\n");
    expect(states(report)).toMatchObject({ mine: "legacy_skip" });
  });
});
