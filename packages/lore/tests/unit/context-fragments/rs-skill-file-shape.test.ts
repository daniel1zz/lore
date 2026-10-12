/** @spec_ref AC-RS-5 */
/**
 * Skill file shape (unit part of AC-RS-5, BR-1064): `lore-<id>/SKILL.md` = YAML frontmatter
 * (name, description) + lore fingerprint line + body; `isLoreSkillDir` ownership test; skills outlets uncapped.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_FRAGMENT_CAP, type Fragment } from "@lore/core";
import { renderOutlet } from "../../../src/service/context-fragments/render.js";
import { isLoreSkillDir, isLoreSkillFileBytes, parseSkillFile, renderSkillFile } from "../../../src/service/context-fragments/section.js";

function skillFragment(id: string, body: string, description = "Use when editing rules: handles \"quotes\", colons: and more."): Fragment {
  return {
    frontmatter: { id, title: `title ${id}`, audience: ["main"], mode: "static", delivery: "skill", description },
    body,
    layer: "shipped",
    path: `/fixture/${id}.md`,
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rs-skill-shape-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSkill(dirName: string, content: string): string {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  return dir;
}

function rendered(fragment: Fragment) {
  const result = renderSkillFile(fragment);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("AC-RS-5 skill file shape", () => {
  it("AC-RS-5: render -> parse round-trips name, description, id and intact hash", () => {
    const fragment = skillFragment("api-rules", "# Body\n\nline");
    const file = rendered(fragment);
    expect(file.dirName).toBe("lore-api-rules");
    const parsed = parseSkillFile(file.content);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe("api-rules");
    expect(parsed?.name).toBe("lore-api-rules");
    expect(parsed?.description).toBe(fragment.frontmatter.description);
    expect(parsed?.intact).toBe(true);
  });

  it("AC-RS-5: frontmatter carries name = lore-<id> and description, fingerprint line directly after it", () => {
    const { content } = rendered(skillFragment("x1", "body"));
    expect(content.startsWith("---\n")).toBe(true);
    const end = content.indexOf("\n---\n", 4);
    const frontmatter = content.slice(4, end);
    expect(frontmatter).toContain("name: lore-x1");
    expect(frontmatter).toContain("description:");
    const afterFrontmatter = content.slice(end + 5);
    expect(afterFrontmatter.startsWith("<!-- lore:managed fragment=x1 hash=")).toBe(true);
  });

  it("AC-RS-5: multi-line description survives the round-trip", () => {
    const description = "first line\nsecond line: with colon # and hash";
    const parsed = parseSkillFile(rendered(skillFragment("ml", "b", description)).content);
    expect(parsed?.description).toBe(description);
  });

  it("AC-RS-5: unsafe id and missing description are refused by renderSkillFile", () => {
    expect(renderSkillFile(skillFragment("bad/id", "b")).ok).toBe(false);
    const noDescription = skillFragment("ok", "b");
    const stripped: Fragment = { ...noDescription, frontmatter: { ...noDescription.frontmatter, description: undefined } };
    expect(renderSkillFile(stripped).ok).toBe(false);
  });

  it("AC-RS-5: isLoreSkillDir is true only for an intact fingerprint", () => {
    const file = rendered(skillFragment("good", "body text"));
    expect(isLoreSkillDir(writeSkill(file.dirName, file.content))).toBe(true);
  });

  it("AC-RS-5: isLoreSkillDir is false for a fingerprint-less SKILL.md", () => {
    const dir = writeSkill("lore-plain", "---\nname: lore-plain\ndescription: d\n---\nbody\n");
    expect(isLoreSkillDir(dir)).toBe(false);
  });

  it("AC-RS-5: isLoreSkillDir is false for a tampered fingerprint (hash and body edits)", () => {
    const file = rendered(skillFragment("tam", "body text"));
    const badHash = file.content.replace(/hash=[0-9a-f]{8}/, "hash=00000000");
    expect(isLoreSkillDir(writeSkill("lore-tam", badHash))).toBe(false);
    const editedBody = file.content.replace("body text", "body edited");
    expect(isLoreSkillDir(writeSkill("lore-tam2", editedBody))).toBe(false);
    const editedDescription = file.content.replace("description:", "description: hijacked ");
    expect(isLoreSkillDir(writeSkill("lore-tam3", editedDescription))).toBe(false);
  });

  it("AC-RS-5: isLoreSkillDir is false for a missing file and for a dir whose name does not match the fingerprint id", () => {
    mkdirSync(join(root, "lore-empty"));
    expect(isLoreSkillDir(join(root, "lore-empty"))).toBe(false);
    expect(isLoreSkillDir(join(root, "lore-absent"))).toBe(false);
    const file = rendered(skillFragment("real", "b"));
    expect(isLoreSkillDir(writeSkill("lore-other", file.content))).toBe(false);
  });

  it("AC-RS-5: isLoreSkillDir (disk) and isLoreSkillFileBytes (port bytes) agree on every fixture", () => {
    const file = rendered(skillFragment("agree", "body text"));
    const fixtures: Array<{ label: string; dirName: string; bytes: string; expected: boolean }> = [
      { label: "intact", dirName: file.dirName, bytes: file.content, expected: true },
      { label: "tampered hash", dirName: file.dirName, bytes: file.content.replace(/hash=[0-9a-f]{8}/, "hash=00000000"), expected: false },
      { label: "edited body", dirName: file.dirName, bytes: file.content.replace("body text", "body edited"), expected: false },
      { label: "renamed dir", dirName: "lore-renamed", bytes: file.content, expected: false },
      { label: "fingerprint-less", dirName: "lore-plain2", bytes: "---\nname: lore-plain2\ndescription: d\n---\nbody\n", expected: false },
    ];
    for (const fixture of fixtures) {
      const onDisk = isLoreSkillDir(writeSkill(fixture.dirName, fixture.bytes));
      expect(isLoreSkillFileBytes(fixture.dirName, fixture.bytes), `bytes: ${fixture.label}`).toBe(fixture.expected);
      expect(onDisk, `disk: ${fixture.label}`).toBe(isLoreSkillFileBytes(fixture.dirName, fixture.bytes));
    }
  });

  it("AC-RS-5: parseSkillFile returns null for non-skill content", () => {
    expect(parseSkillFile("no frontmatter\n")).toBeNull();
    expect(parseSkillFile("---\nname: x\n---\n")).toBeNull();
  });

  it("AC-RS-5: skills:* outlets have no cap", () => {
    const huge = skillFragment("huge", "x".repeat(SESSION_FRAGMENT_CAP * 5));
    for (const outlet of ["skills:project", "skills:user"] as const) {
      const result = renderOutlet([huge], outlet);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.chars).toBe(SESSION_FRAGMENT_CAP * 5);
    }
  });
});
