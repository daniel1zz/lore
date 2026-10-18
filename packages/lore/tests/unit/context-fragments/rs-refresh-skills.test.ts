/**
 * @spec_ref AC-RS-5
 * Spec: spec-rule-store-git-tracked-fragment-selection-on-demand-skill (Scope 6, BR-1064, BR-1060)
 *
 * `runContextRefresh` writes `lore-<id>/SKILL.md` for `skills:<scope>` fragments, prunes a
 * fingerprinted skill dir whose fragment is gone, never touches a fingerprint-less `lore-*` dir,
 * and refuses a fragment whose dir name shadows a shipped lore skill, all under the D8 CAS.
 *
 * MOCK RISK: in-memory fs models read/write ordering only, not directories or a kernel race;
 * the real port's directory behaviour is covered by the spawned-lore e2e (AC-RS-10).
 */

import { describe, expect, it } from "vitest";
import { InMemoryFsPort } from "@lore/core";
import type { FsWritePort } from "@lore/core";
import { runContextRefresh } from "../../../src/flows/context-flow.js";
import { parseSkillFile } from "../../../src/service/context-fragments/section.js";

const skillFragment = (id: string, description: string, body: string): string =>
  `---\nid: ${id}\ntitle: ${id}\naudience: [main]\nmode: static\ndelivery: skill\ndescription: ${description}\n---\n${body}\n`;

const PROJECT_DIR = ".claude/skills";
const FOO_PATH = `${PROJECT_DIR}/lore-foo/SKILL.md`;

/** Records every write/delete so "zero writes" is measured, not assumed. */
class RecordingFs implements FsWritePort {
  ops: string[] = [];
  constructor(readonly inner: InMemoryFsPort) {}
  readFile(path: string) {
    return this.inner.readFile(path);
  }
  exists(path: string) {
    return this.inner.exists(path);
  }
  listDir(path: string) {
    return this.inner.listDir(path);
  }
  async writeFile(path: string, content: string) {
    this.ops.push(`write ${path}`);
    return this.inner.writeFile(path, content);
  }
  async deleteFile(path: string) {
    this.ops.push(`delete ${path}`);
    return this.inner.deleteFile(path);
  }
}

function setup(files: Record<string, string>, extra: { shippedSkillNames?: readonly string[] } = {}) {
  const fs = new RecordingFs(new InMemoryFsPort(files));
  const deps = {
    fs,
    assetsRoot: "assets",
    home: "/home/test",
    xdgConfigHome: "/home/test/.config",
    globalConfig: {},
    projectConfig: {},
    ...extra,
  };
  return { fs, deps };
}

const PROJECT_FRAGMENT_FOO = { ".lore/context/foo.md": skillFragment("foo", "Use when doing foo work", "Foo body.") };

describe("AC-RS-5 refresh writes and prunes skill folders", () => {
  it("AC-RS-5 writes lore-<id>/SKILL.md with a description in the frontmatter and a fingerprint", async () => {
    const { fs, deps } = setup(PROJECT_FRAGMENT_FOO);
    const result = await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = await fs.readFile(FOO_PATH);
    expect(written).not.toBeNull();
    expect(written).toContain("description: Use when doing foo work");
    expect(written).toMatch(/\n<!-- lore:managed fragment=foo hash=[0-9a-f]{8} -->\n/);
    const parsed = parseSkillFile(written ?? "");
    expect(parsed?.intact).toBe(true);
    expect(result.value.skills).toEqual([{ id: "foo", path: FOO_PATH, state: "created" }]);
  });

  it("AC-RS-5 a second refresh writes nothing (idempotent)", async () => {
    const { fs, deps } = setup(PROJECT_FRAGMENT_FOO);
    await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    fs.ops.length = 0;
    const again = await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    expect(again.ok && again.value.skills.map((s) => s.state)).toEqual(["unchanged"]);
    expect(fs.ops).toEqual([]);
  });

  it("AC-RS-5 prunes a fingerprinted skill dir whose fragment is gone", async () => {
    const { fs, deps } = setup(PROJECT_FRAGMENT_FOO);
    await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    await fs.inner.deleteFile(".lore/context/foo.md");
    const result = await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    expect(result.ok && result.value.skills).toEqual([{ id: "foo", path: FOO_PATH, state: "pruned" }]);
    expect(await fs.readFile(FOO_PATH)).toBeNull();
  });

  it("AC-RS-5 leaves a fingerprint-less lore-plan/ byte-unchanged while pruning its fingerprinted sibling", async () => {
    const handMade = "---\nname: lore-plan\ndescription: shipped plan skill\n---\nShipped body, no fingerprint.\n";
    const { fs, deps } = setup({ ...PROJECT_FRAGMENT_FOO, [`${PROJECT_DIR}/lore-plan/SKILL.md`]: handMade });
    await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    await fs.inner.deleteFile(".lore/context/foo.md");
    const result = await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(`${PROJECT_DIR}/lore-plan/SKILL.md`)).toBe(handMade);
    expect(await fs.readFile(FOO_PATH)).toBeNull();
    expect(fs.ops.filter((op) => op.includes("lore-plan"))).toEqual([]);
  });

  it("AC-RS-5 a fingerprinted SKILL.md copied into a differently named lore-* dir is not pruned", async () => {
    const { fs, deps } = setup(PROJECT_FRAGMENT_FOO);
    await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    const copied = (await fs.readFile(FOO_PATH)) ?? "";
    await fs.inner.writeFile(`${PROJECT_DIR}/lore-copy/SKILL.md`, copied);
    const result = await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(`${PROJECT_DIR}/lore-copy/SKILL.md`)).toBe(copied);
    expect(fs.ops.filter((op) => op.includes("lore-copy"))).toEqual([]);
  });

  it("AC-RS-5 a hand-edited skill file is diverged_skip and never overwritten or pruned", async () => {
    const { fs, deps } = setup(PROJECT_FRAGMENT_FOO);
    await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    const edited = `${(await fs.readFile(FOO_PATH)) ?? ""}hand edit\n`;
    await fs.inner.writeFile(FOO_PATH, edited);
    const diverged = await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    expect(diverged.ok && diverged.value.skills.map((s) => s.state)).toEqual(["diverged_skip"]);
    await fs.inner.deleteFile(".lore/context/foo.md");
    await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    expect(await fs.readFile(FOO_PATH)).toBe(edited);
  });

  it("AC-RS-5 refuses fragment id plan with zero writes (VALIDATION_ERROR), shipped names injected", async () => {
    const { fs, deps } = setup(
      {
        ".lore/context/plan.md": skillFragment("plan", "Use when planning", "Plan body."),
        ".lore/context/aaa-rule.md": "---\nid: aaa-rule\ntitle: A\naudience: [main]\nmode: static\n---\nRule body.\n",
      },
      { shippedSkillNames: ["lore-plan"] },
    );
    const result = await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(fs.ops).toEqual([]);
  });

  it("AC-RS-5 derives shipped names from <assetsRoot>/skills when none are injected", async () => {
    const { fs, deps } = setup({
      ".lore/context/plan.md": skillFragment("plan", "Use when planning", "Plan body."),
      "assets/skills/lore-plan/SKILL.md": "---\nname: lore-plan\ndescription: x\n---\nshipped\n",
    });
    const result = await runContextRefresh(deps, "", { scope: "project", rulesOnly: true });
    expect(result.ok).toBe(false);
    expect(fs.ops).toEqual([]);
  });

  it("AC-RS-5 user scope writes to <home>/.claude/skills from the user layer only", async () => {
    const { fs, deps } = setup({
      "/home/test/.config/lore/context/uskill.md": skillFragment("uskill", "Use when user thing", "User body."),
      ...PROJECT_FRAGMENT_FOO,
    });
    const result = await runContextRefresh(deps, "", { scope: "user" });
    expect(result.ok).toBe(true);
    expect(await fs.readFile("/home/test/.claude/skills/lore-uskill/SKILL.md")).toContain("description: Use when user thing");
    expect(await fs.readFile("/home/test/.claude/skills/lore-foo/SKILL.md")).toBeNull();
  });

  it("AC-RS-5 CAS: a skill file changed between read and write returns CONFLICT with zero writes", async () => {
    const files = { ...PROJECT_FRAGMENT_FOO };
    const inner = new InMemoryFsPort(files);
    const first = new RecordingFs(inner);
    const baseDeps = { assetsRoot: "assets", home: "/home/test", xdgConfigHome: "/home/test/.config", globalConfig: {}, projectConfig: {} };
    await runContextRefresh({ fs: first, ...baseDeps }, "", { scope: "project", rulesOnly: true });
    // change the fragment so the next refresh plans an update, and interleave a foreign write on the skill file
    await inner.writeFile(".lore/context/foo.md", skillFragment("foo", "Use when doing foo work", "Foo body v2."));
    let reads = 0;
    const racing = new RecordingFs(inner);
    const originalRead = racing.readFile.bind(racing);
    racing.readFile = async (path: string) => {
      const value = await originalRead(path);
      if (path === FOO_PATH && ++reads === 1) await inner.writeFile(FOO_PATH, "# someone else\n");
      return value;
    };
    const result = await runContextRefresh({ fs: racing, ...baseDeps }, "", { scope: "project", rulesOnly: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("CONFLICT");
    expect(racing.ops).toEqual([]);
    expect(await inner.readFile(FOO_PATH)).toBe("# someone else\n");
  });
});
