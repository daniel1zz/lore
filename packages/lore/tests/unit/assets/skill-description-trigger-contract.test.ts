// @reads .claude/skills/lore/SKILL.md
// @reads assets/skills/**
/**
 * Shipped skill descriptions state WHEN to use the skill (BR-1099, spec
 * spec-shipped-skill-descriptions-state-when-to-use-the-skill).
 *
 * A skill's `description` is the only text an agent sees before choosing a skill, so it
 * must be a trigger statement: opens with "Use when", stays short, redirects only to skills
 * lore ships, and never shares a quoted trigger phrase with another skill. The checks are
 * pure functions over `{ name, description }` so the negative controls (AC-SD-6) exercise
 * exactly the code the real scan (AC-SD-1..5) uses.
 *
 * The mode `Args:` suffix is owned by skill-mode-arg-contract.test.ts and is stripped here.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = resolve(__dirname, "../../../../..");
const SKILLS_DIR = join(REPO_ROOT, "assets/skills");
const MAX_CORE_LENGTH = 500;
const MIN_SKILLS_SCANNED = 40;

interface SkillDescription {
  readonly name: string;
  readonly description: string;
}

interface Violation {
  readonly skill: string;
  readonly rule: string;
  readonly detail: string;
}

/** Neighbour pairs that must name each other (standard rule 5). */
const NEIGHBOUR_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["lore-kickoff", "lore-auto-wire"],
  ["lore-kickoff", "lore-project-bootstrap"],
  ["lore-auto-wire", "lore-project-bootstrap"],
  ["lore-design", "lore-design-ui"],
  ["lore-refactor", "lore-improve-codebase-architecture"],
  ["lore-baseline", "lore-domain"],
  ["lore-analyze", "lore-product-lens"],
  ["lore-biz-review", "lore-domain"],
];

/** English words that follow "use" without being a skill name ("use when ..."). */
const USE_STOPWORDS = new Set(["when", "this", "the", "it", "a", "an", "as", "to", "of", "case", "cases", "whenever", "these", "those", "only", "if"]);

export function coreOf(description: string): string {
  return description.replace(/\sArgs: '<mode>[\s\S]*$/, "");
}

/**
 * Quoted trigger phrases. A quote opens only at the start or after whitespace / `(` / `,`,
 * and closes only before a non-letter, so apostrophes in "don't" / "skill's" are not phrases.
 */
export function quotedPhrases(text: string): string[] {
  const phrases: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const prev = i === 0 ? " " : (text[i - 1] ?? " ");
    if ((ch === "'" || ch === '"') && /[\s(,]/.test(prev)) {
      let close = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] !== ch) continue;
        const next = text[j + 1] ?? " ";
        if (!/\p{L}/u.test(next)) {
          close = j;
          break;
        }
      }
      if (close !== -1) {
        const phrase = text.slice(i + 1, close).trim().toLowerCase();
        if (/[\p{L}]/u.test(phrase)) phrases.push(phrase);
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return phrases;
}

/** Skill names a description points at: redirect targets plus every `lore-*` token. */
export function referencedSkills(description: string): string[] {
  const refs = new Set<string>();
  for (const m of description.matchAll(/\buse\s+`?([a-z][a-z0-9-]*)`?/g)) {
    const target = m[1] ?? "";
    if (!USE_STOPWORDS.has(target)) refs.add(target);
  }
  for (const m of description.matchAll(/(?:^|[\s(`])\/([a-z][a-z0-9-]*)/g)) refs.add(m[1] ?? "");
  for (const m of description.matchAll(/\blore-[a-z0-9]+(?:-[a-z0-9]+)*/g)) refs.add(m[0]);
  return [...refs];
}

export function checkOpening(skills: readonly SkillDescription[]): Violation[] {
  return skills
    .filter((s) => !coreOf(s.description).startsWith("Use when"))
    .map((s) => ({ skill: s.name, rule: "opening", detail: `core starts with "${coreOf(s.description).slice(0, 40)}"` }));
}

export function checkLength(skills: readonly SkillDescription[]): Violation[] {
  return skills
    .filter((s) => coreOf(s.description).length > MAX_CORE_LENGTH)
    .map((s) => ({ skill: s.name, rule: "length", detail: `core is ${coreOf(s.description).length} chars (max ${MAX_CORE_LENGTH})` }));
}

export function checkReferences(skills: readonly SkillDescription[], shipped: ReadonlySet<string>): Violation[] {
  const out: Violation[] = [];
  for (const s of skills) {
    for (const ref of referencedSkills(s.description)) {
      if (!shipped.has(ref)) out.push({ skill: s.name, rule: "reference", detail: `references "${ref}", which lore does not ship` });
    }
  }
  return out;
}

export function checkPhraseCollisions(skills: readonly SkillDescription[]): Violation[] {
  const owners = new Map<string, Set<string>>();
  for (const s of skills) {
    for (const phrase of quotedPhrases(coreOf(s.description))) {
      const set = owners.get(phrase) ?? new Set<string>();
      set.add(s.name);
      owners.set(phrase, set);
    }
  }
  return [...owners]
    .filter(([, set]) => set.size > 1)
    .map(([phrase, set]) => ({ skill: [...set].sort().join(" + "), rule: "phrase-collision", detail: `"${phrase}" claimed by ${set.size} skills` }));
}

export function checkNeighbours(skills: readonly SkillDescription[]): Violation[] {
  const byName = new Map(skills.map((s) => [s.name, s.description] as const));
  const out: Violation[] = [];
  for (const [a, b] of NEIGHBOUR_PAIRS) {
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const text = byName.get(from);
      if (text === undefined) out.push({ skill: from, rule: "neighbour", detail: "skill is not shipped" });
      else if (!text.includes(to)) out.push({ skill: from, rule: "neighbour", detail: `does not name ${to}` });
    }
  }
  return out;
}

function frontmatterOf(file: string): { description: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(file, "utf8"));
  if (match === null) throw new Error(`${file}: missing frontmatter`);
  const fm = parseYaml(match[1] ?? "") as { description?: unknown };
  if (typeof fm.description !== "string") throw new Error(`${file}: description is not a string`);
  return { description: fm.description, body: match[2] ?? "" };
}

function shippedSkills(): SkillDescription[] {
  return readdirSync(SKILLS_DIR)
    .sort()
    .filter((name) => existsSync(join(SKILLS_DIR, name, "SKILL.md")))
    .map((name) => ({ name, description: frontmatterOf(join(SKILLS_DIR, name, "SKILL.md")).description }));
}

/** The lore-analyze description as shipped before this standard (no trigger at all). */
const OLD_LORE_ANALYZE =
  "Deep analysis skill using world-class thinking methodologies.  Applies First Principles, MECE, Systems Thinking, Inversion, 5 Whys,  Second-Order Effects, and Steelmanning to any high-level topic —  strategy, business, product, decisions, or abstract problems.  NOT for code-level analysis (use review/diagnose for that).\n";

const skills = shippedSkills();
const shipped = new Set(skills.map((s) => s.name));

function expectClean(violations: readonly Violation[]): void {
  expect(violations.map((v) => `${v.skill}: [${v.rule}] ${v.detail}`)).toEqual([]);
}

describe("shipped skill descriptions state when to use the skill (BR-1099)", () => {
  it("AC-SD-1: every core description starts with 'Use when' (and the scan is not vacuous)", () => {
    expect(skills.length).toBeGreaterThanOrEqual(MIN_SKILLS_SCANNED);
    expectClean(checkOpening(skills));
  });

  it("AC-SD-2: every core description is at most 500 characters", () => {
    expectClean(checkLength(skills));
  });

  it("AC-SD-3: every redirect target and lore-* token is a shipped skill directory", () => {
    expectClean(checkReferences(skills, shipped));
  });

  it("AC-SD-4: no quoted trigger phrase is claimed by two skills", () => {
    expectClean(checkPhraseCollisions(skills));
  });

  it("AC-SD-5: neighbour pairs name each other", () => {
    expectClean(checkNeighbours(skills));
  });

  describe("AC-SD-6: negative controls hit the same checkers as the real scan", () => {
    const base = "Use when the user wants a thing done. NOT for other things (use lore-review).";

    it("AC-SD-6a: the old lore-analyze description has no 'Use when' and dangling redirects", () => {
      const old = [{ name: "lore-analyze", description: OLD_LORE_ANALYZE }];
      expect(checkOpening(old).length).toBeGreaterThan(0);
      expect(checkReferences(old, shipped).map((v) => v.detail).join("|")).toContain('"review"');
    });

    it("AC-SD-6b: a 501-char core is a length violation, a 500-char core is not", () => {
      const pad = (n: number) => ({ name: "x", description: "Use when " + "a".repeat(n - "Use when ".length) });
      expect(checkLength([pad(501)]).length).toBe(1);
      expect(checkLength([pad(500)]).length).toBe(0);
      expect(checkLength([{ name: "x", description: pad(500).description + " Args: '<mode> [context]' — the FIRST token is the mode, one of: a|b." }]).length).toBe(0);
    });

    it("AC-SD-6c: 'use verify' is a dangling redirect, 'use lore-review' is not", () => {
      const bad = [{ name: "x", description: "Use when checking one change. NOT for tests (use verify)." }];
      expect(checkReferences(bad, shipped).length).toBe(1);
      expect(checkReferences([{ name: "x", description: base }], shipped).length).toBe(0);
    });

    it("AC-SD-6d: two descriptions quoting 'new project' collide; apostrophes do not create phrases", () => {
      const a = { name: "a", description: "Use when the user says 'new project'." };
      const b = { name: "b", description: "Use when the user says 'New Project ' or similar." };
      expect(checkPhraseCollisions([a, b]).length).toBe(1);
      expect(checkPhraseCollisions([a, { name: "c", description: "Use when the user says 'other thing'." }]).length).toBe(0);
      expect(quotedPhrases("Use when it's NEXT session's AI, don't fail, or 'audit the agent's behavior'.")).toEqual(["audit the agent's behavior"]);
    });
  });

  it("AC-SD-7: the lore skill has no repo copy and the authoring guide states the standard", () => {
    // assets/skills/lore is the single source; a hand-synced .claude/skills/lore copy drifts (issue #218).
    expect(existsSync(join(REPO_ROOT, ".claude/skills/lore/SKILL.md"))).toBe(false);
    const guide = frontmatterOf(join(SKILLS_DIR, "lore-write-a-skill/SKILL.md")).body;
    expect(guide).toContain("Use when");
    expect(guide).toMatch(/500[- ]char/);
  });
});
