/**
 * Mode-routed skills advertise their argument contract in the description (issue #213).
 *
 * A skill whose body routes on `$0` takes the FIRST token of its args as the mode. The
 * description is the only text a caller sees before the body loads, so it must state that
 * contract and list every mode — else a prose args string becomes a bogus mode, the whole
 * body loads, and the skill refuses. The mode set is derived from `references/mode-*.md`,
 * so adding or removing a mode file without updating the description turns this red.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const SKILLS_DIR = resolve(__dirname, "../../../../../assets/skills");

/** Matches the advertised contract and captures the `|`-separated mode list. */
const ARGS_CONTRACT = /Args: '<mode> \[context\]' — the FIRST token is the mode, one of: ([a-z0-9|-]+)\./;

interface ModeSkill {
  readonly name: string;
  readonly description: string;
  readonly modes: readonly string[];
}

function modeRoutedSkills(): ModeSkill[] {
  const out: ModeSkill[] = [];
  for (const name of readdirSync(SKILLS_DIR).sort()) {
    const skillFile = join(SKILLS_DIR, name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const text = readFileSync(skillFile, "utf8");
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (match === null) throw new Error(`${skillFile}: missing frontmatter`);
    const body = match[2] ?? "";
    if (!body.includes("$0")) continue;
    const frontmatter = parseYaml(match[1] ?? "") as { description?: unknown };
    if (typeof frontmatter.description !== "string") throw new Error(`${skillFile}: description is not a string`);
    const refs = join(SKILLS_DIR, name, "references");
    const modes = existsSync(refs)
      ? readdirSync(refs)
          .filter((f) => /^mode-.+\.md$/.test(f))
          .map((f) => f.slice("mode-".length, -".md".length))
          .sort()
      : [];
    out.push({ name, description: frontmatter.description, modes });
  }
  return out;
}

describe("mode-routed skill argument contract (#213)", () => {
  const skills = modeRoutedSkills();

  it("finds the mode-routed skills (guards against a vacuous pass)", () => {
    expect(skills.length).toBeGreaterThanOrEqual(11);
  });

  it.each(skills.map((s) => [s.name, s] as const))("%s advertises its first-token mode contract", (_name, skill) => {
    expect(skill.modes.length, `${skill.name} routes on $0 but has no references/mode-*.md`).toBeGreaterThan(0);
    const contract = ARGS_CONTRACT.exec(skill.description);
    expect(contract, `${skill.name} description lacks the Args contract`).not.toBeNull();
    const advertised = (contract?.[1] ?? "").split("|").sort();
    expect(advertised).toEqual(skill.modes);
  });
});
