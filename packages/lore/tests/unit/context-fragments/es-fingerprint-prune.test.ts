/**
 * @spec_ref AC-ES-3
 * @layer unit
 *
 * Rules-file ownership by intact fingerprint (BR-1176, spec-process-state-end-state D3): a deselected
 * `lore-*.md` is pruned iff its managed header parses and its body hash still matches; a hand-edited file
 * is kept as diverged_skip. The header carries only fragment and hash. All fs access is in-memory.
 */
import { describe, expect, it } from "vitest";
import { InMemoryFsPort } from "@lore/core";
import { runContextRefresh } from "../../../src/flows/context-flow.js";

const HOME = "/home/test";
const USER_RULES = `${HOME}/.claude/rules`;
const PROJECT_RULES = ".claude/rules";
const HEADER = /^<!-- lore:managed fragment=(\S+) hash=[0-9a-f]{8} -->\n/;

function fragmentMd(id: string, body: string): string {
  return `---\nid: ${id}\ntitle: ${id} rule\ninject: [launch]\n---\n${body}\n`;
}

function depsFor(fs: InMemoryFsPort) {
  return {
    fs,
    assetsRoot: "assets",
    userConfigDir: "/cfg",
    home: HOME,
    xdgConfigHome: `${HOME}/.config`,
    globalConfig: {},
    projectConfig: {},
    claudeSettings: { read: async () => ({}) },
  } as unknown as Parameters<typeof runContextRefresh>[0];
}

async function refresh(fs: InMemoryFsPort, scope: "user" | "project") {
  const options = scope === "user" ? { scope } : { scope, rulesOnly: true };
  const result = await runContextRefresh(depsFor(fs), "", options as never);
  if (!result.ok) throw new Error(`refresh failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function states(report: { rules: Array<{ id: string; state: string }> }): Record<string, string> {
  return Object.fromEntries(report.rules.map((rule) => [rule.id, rule.state]));
}

const SCOPES = [
  { scope: "user", dir: USER_RULES, source: "/cfg/context" },
  { scope: "project", dir: PROJECT_RULES, source: "assets/context" },
] as const;

describe.each(SCOPES)("AC-ES-3 $scope scope", ({ scope, dir, source }) => {
  it("HAPPY: header carries only fragment and hash; a deselected intact file is pruned", async () => {
    const fs = new InMemoryFsPort({ [`${source}/alpha.md`]: fragmentMd("alpha", "ALPHA-BODY") });
    await refresh(fs, scope);
    expect(await fs.readFile(`${dir}/lore-alpha.md`)).toMatch(HEADER);
    await fs.deleteFile(`${source}/alpha.md`);
    const report = await refresh(fs, scope);
    expect(await fs.readFile(`${dir}/lore-alpha.md`)).toBeNull();
    expect(states(report)).toEqual({ alpha: "pruned" });
  });

  it("NEGATIVE: a hand-edited deselected file is kept as diverged_skip, an intact sibling is pruned", async () => {
    const fs = new InMemoryFsPort({
      [`${source}/edited.md`]: fragmentMd("edited", "EDITED-BODY"),
      [`${source}/clean.md`]: fragmentMd("clean", "CLEAN-BODY"),
    });
    await refresh(fs, scope);
    const edited = `${await fs.readFile(`${dir}/lore-edited.md`)}MY NOTE\n`;
    await fs.writeFile(`${dir}/lore-edited.md`, edited);
    await fs.deleteFile(`${source}/edited.md`);
    await fs.deleteFile(`${source}/clean.md`);
    const report = await refresh(fs, scope);
    expect(await fs.readFile(`${dir}/lore-edited.md`)).toBe(edited);
    expect(states(report)).toEqual({ edited: "diverged_skip", clean: "pruned" });
  });

  it("REGRESSION: an interim-build header with an extra source= token is kept as diverged_skip, never deleted", async () => {
    const fs = new InMemoryFsPort({ [`${source}/alpha.md`]: fragmentMd("alpha", "ALPHA-BODY") });
    await refresh(fs, scope);
    const current = (await fs.readFile(`${dir}/lore-alpha.md`)) as string;
    const interim = current.replace(/ -->\n/, " source=user%3D%2Fcfg -->\n");
    expect(interim).not.toBe(current);
    await fs.writeFile(`${dir}/lore-alpha.md`, interim);
    await fs.deleteFile(`${source}/alpha.md`);
    const report = await refresh(fs, scope);
    expect(await fs.readFile(`${dir}/lore-alpha.md`)).toBe(interim);
    expect(states(report)).toEqual({ alpha: "diverged_skip" });
  });

  it("BOUNDARY: a headerless lore-*.md is kept as diverged_skip; only the five outcomes exist", async () => {
    const fs = new InMemoryFsPort({ [`${source}/alpha.md`]: fragmentMd("alpha", "ALPHA-BODY") });
    await fs.writeFile(`${dir}/lore-mine.md`, "# mine\n");
    const first = await refresh(fs, scope);
    const second = await refresh(fs, scope);
    expect(await fs.readFile(`${dir}/lore-mine.md`)).toBe("# mine\n");
    const allowed = new Set(["created", "updated", "unchanged", "diverged_skip", "pruned"]);
    for (const outcome of [...first.rules, ...second.rules]) expect(allowed.has(outcome.state)).toBe(true);
    expect(states(second)).toEqual({ alpha: "unchanged", mine: "diverged_skip" });
  });
});
