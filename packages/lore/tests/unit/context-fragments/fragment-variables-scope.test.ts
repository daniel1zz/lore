// @spawns packages/lore/src/index.ts
/**
 * @spec_ref AC-CV-3
 *
 * RED tests (spec-lore-owned-agent-context-is-generated-from-templates-and, D5, BR-1096, BR-902):
 *   (1) an INVOCATION variable (a value only the caller can supply) is refused at every fragment outlet
 *       with VALIDATION_ERROR naming the variable and the outlet - even when the caller supplies a value;
 *   (2) project rules files depend only on shipped + project fragments and the lore binary version: the same
 *       repo rendered under two different HOME directories (different user fragments, different global
 *       config) yields byte-identical project files.
 *
 * Future API (all missing today, so every test is RED): `expandFragments` (src/service/context-fragments/expand.ts,
 * signature documented in fragment-variables.test.ts), `LORE_CONTEXT_VARIABLES`
 * (src/service/context-variables-registry.ts), `CAPTURE_TAIL_CHARS` from @lore/core.
 * The injected registry below is a test fixture; the spec requires the registry to be a parameter everywhere.
 *
 * Spawned CLI = the SOURCE entry `bun packages/lore/src/index.ts`, HOME=<mkdtemp>; never the installed lore,
 * never this repo's `.lore/`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CAPTURE_TAIL_CHARS, OUTLET_IDS, type ContextVariable, type Fragment, type OutletId } from "@lore/core";
import { expandFragments } from "../../../src/service/context-fragments/expand.js";
import { LORE_CONTEXT_VARIABLES } from "../../../src/service/context-variables-registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LORE_SRC_ENTRY = join(HERE, "../../../src/index.ts");
const SPAWN_TIMEOUT_MS = 60_000;

const sandboxes: string[] = [];
afterAll(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  sandboxes.push(dir);
  return dir;
}

/** Injected registry: one code variable (every outlet) and one invocation variable supplied only by `setup:settings-hook`. */
const INJECTED: readonly ContextVariable[] = [
  {
    name: "fixed_value",
    source: "code",
    outlets: ["rules:project", "rules:user", "skills:project", "skills:user", "hook:subagent-start"],
    describe: "test code variable",
    value: () => "FIXED-42",
  },
  {
    name: "caller_dir",
    source: "invocation",
    outlets: ["setup:settings-hook"],
    describe: "test invocation variable supplied only by the settings-hook outlet",
  },
];

function fragment(id: string, body: string): Fragment {
  return {
    frontmatter: { id, title: `T ${id}`, audience: ["main"], mode: "static" },
    body,
    layer: "project",
    path: `.lore/context/${id}.md`,
    bodyLineOffset: 6,
  } as unknown as Fragment;
}

const FRAGMENT_OUTLETS: readonly OutletId[] = ["rules:project", "skills:project", "rules:user", "hook:subagent-start"];

describe("AC-CV-3 invocation variables are refused at every fragment outlet", () => {
  it("liveness: the injected registry's code variable still expands at a fragment outlet (the refusal below is about the invocation variable only)", () => {
    const result = expandFragments([fragment("ok", "v={{lore:fixed_value}}\n")], "rules:project", { invocation: {} }, INJECTED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.body).toBe("v=FIXED-42\n");
  });

  for (const outlet of FRAGMENT_OUTLETS) {
    it(`NEGATIVE ${outlet}: {{lore:caller_dir}} -> VALIDATION_ERROR naming the variable and the outlet`, () => {
      const result = expandFragments(
        [fragment("uses-invocation", "first\npath is {{lore:caller_dir}}\n")],
        outlet,
        { invocation: {} },
        INJECTED,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      const message = "message" in result.error ? String(result.error.message) : "";
      expect(message).toContain("caller_dir");
      expect(message).toContain(outlet);
      expect(message).toContain(".lore/context/uses-invocation.md");
    });

    it(`NEGATIVE ${outlet}: supplying a value in ctx.invocation does NOT make the variable allowed here`, () => {
      const result = expandFragments(
        [fragment("uses-invocation", "path is {{lore:caller_dir}}\n")],
        outlet,
        { invocation: { caller_dir: "/somewhere" } },
        INJECTED,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const message = "message" in result.error ? String(result.error.message) : "";
      expect(message).toContain("caller_dir");
      expect(message).toContain(outlet);
    });
  }

  it("BOUNDARY skills:user: the fifth fragment outlet refuses it too", () => {
    const result = expandFragments([fragment("u", "{{lore:caller_dir}}\n")], "skills:user", { invocation: {} }, INJECTED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect("message" in result.error ? String(result.error.message) : "").toContain("skills:user");
  });

  it("STATE: one refused fragment fails the whole set (a clean sibling is not returned half-expanded)", () => {
    const result = expandFragments(
      [fragment("clean", "v={{lore:fixed_value}}\n"), fragment("dirty", "{{lore:caller_dir}}\n")],
      "rules:project",
      { invocation: {} },
      INJECTED,
    );
    expect(result.ok).toBe(false);
  });

  it("REGRESSION on the shipped registry: no invocation variable in LORE_CONTEXT_VARIABLES lists any fragment outlet", () => {
    expect(LORE_CONTEXT_VARIABLES.length).toBeGreaterThan(0); // liveness: registry is non-empty
    const invocation = LORE_CONTEXT_VARIABLES.filter((variable) => variable.source === "invocation");
    for (const variable of invocation) {
      for (const outlet of OUTLET_IDS) {
        expect(variable.outlets as readonly string[], `${variable.name} must not be allowed at ${outlet}`).not.toContain(outlet);
      }
    }
  });
});

// ─── project determinism across HOME directories (BR-902, BR-1096) ───────────────────────────────

const ROOT_CLAUDE_MD =
  "# P\n\n" +
  ["What This Is", "Commands", "Architecture"]
    .map((heading) => `## ${heading}\n\nshort\n`)
    .join("\n");

function fragmentFile(id: string, body: string): string {
  return `---\nid: ${id}\ntitle: T ${id}\naudience: [main]\nmode: static\n---\n${body}`;
}

function lore(repo: string, home: string, ...args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home };
  for (const key of ["XDG_CONFIG_HOME", "LORE_CONFIG_HOME", "CLAUDE_CONFIG_DIR"]) delete env[key];
  return spawnSync("bun", [LORE_SRC_ENTRY, ...args], { cwd: repo, env, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS });
}

function readProjectRules(repo: string): Record<string, string> {
  const dir = join(repo, ".claude", "rules");
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter((n) => n.startsWith("lore-")).sort()) out[name] = readFileSync(join(dir, name), "utf8");
  return out;
}

/** A HOME with its own user-layer fragment and its own global lore config (`~/.config/lore`). */
function makeHome(label: string, userBody: string, globalConfigYaml: string): string {
  const home = tmp(`lore-fvs-home-${label}-`);
  const configDir = join(home, ".config", "lore");
  mkdirSync(join(configDir, "context"), { recursive: true });
  writeFileSync(join(configDir, "context", `user-${label}.md`), fragmentFile(`user-${label}`, `User-only rule ${label} {{lore:capture_tail_chars}}.\n`));
  writeFileSync(join(configDir, "config.yaml"), globalConfigYaml);
  return home;
}

describe("AC-CV-3 project rules files are byte-identical under different HOME directories", () => {
  it(
    "same repo, two HOMEs (different user fragments + global config): project lore-*.md bytes are equal and contain the expanded value",
    () => {
      const repo = tmp("lore-fvs-repo-");
      const homeA = makeHome("alpha", "unused", "context:\n  language: en\n");
      const homeB = makeHome("beta", "unused", "context:\n  language: zh\n");
      const init = lore(repo, homeA, "init");
      expect(init.status, init.stderr).toBe(0);
      writeFileSync(join(repo, "CLAUDE.md"), ROOT_CLAUDE_MD);
      mkdirSync(join(repo, ".lore", "context"), { recursive: true });
      writeFileSync(join(repo, ".lore", "context", "proj-tail.md"), fragmentFile("proj-tail", "Project tail is {{lore:capture_tail_chars}} chars.\n"));

      const first = lore(repo, homeA, "context", "refresh");
      expect(first.status, first.stderr).toBe(0);
      const rulesA = readProjectRules(repo);

      rmSync(join(repo, ".claude"), { recursive: true, force: true });
      const second = lore(repo, homeB, "context", "refresh");
      expect(second.status, second.stderr).toBe(0);
      const rulesB = readProjectRules(repo);

      expect(Object.keys(rulesA).length).toBeGreaterThan(0); // liveness: something was rendered
      expect(rulesB).toEqual(rulesA);
      // the project fragment's variable really expanded (the part that is RED today) ...
      expect(rulesA["lore-proj-tail.md"]).toContain(`Project tail is ${String(CAPTURE_TAIL_CHARS)} chars.`);
      expect(rulesA["lore-proj-tail.md"]).not.toContain("{{lore:");
      // ... and no user-only fragment leaked into the project outlet
      expect(Object.keys(rulesA).some((name) => name.startsWith("lore-user-"))).toBe(false);
    },
    SPAWN_TIMEOUT_MS * 3,
  );

  it(
    "user rules files DO follow the user's HOME: each HOME's ~/.claude/rules holds its own user fragment with the value expanded",
    () => {
      const repo = tmp("lore-fvs-repo-user-");
      const homeA = makeHome("alpha", "unused", "context:\n  language: en\n");
      const init = lore(repo, homeA, "init");
      expect(init.status, init.stderr).toBe(0);
      const refresh = lore(repo, homeA, "context", "refresh", "--scope", "user");
      expect(refresh.status, refresh.stderr).toBe(0);
      const userFile = join(homeA, ".claude", "rules", "lore-user-alpha.md");
      expect(existsSync(userFile)).toBe(true);
      const content = readFileSync(userFile, "utf8");
      expect(content).toContain(`User-only rule alpha ${String(CAPTURE_TAIL_CHARS)}.`);
      expect(content).not.toContain("{{lore:");
    },
    SPAWN_TIMEOUT_MS * 2,
  );

  it(
    "NEGATIVE: a project fragment naming an unregistered variable fails for BOTH homes with the same message (the failure is home-independent)",
    () => {
      const repo = tmp("lore-fvs-repo-bad-");
      const homeA = makeHome("alpha", "unused", "context:\n  language: en\n");
      const homeB = makeHome("beta", "unused", "context:\n  language: zh\n");
      expect(lore(repo, homeA, "init").status).toBe(0);
      writeFileSync(join(repo, "CLAUDE.md"), ROOT_CLAUDE_MD);
      mkdirSync(join(repo, ".lore", "context"), { recursive: true });
      writeFileSync(join(repo, ".lore", "context", "badvar.md"), fragmentFile("badvar", "line\n{{lore:nope}}\n"));
      const a = lore(repo, homeA, "context", "refresh");
      const b = lore(repo, homeB, "context", "refresh");
      expect(a.status).toBe(4);
      expect(b.status).toBe(4);
      expect(a.stderr).toContain("nope");
      expect(b.stderr).toBe(a.stderr);
      expect(readProjectRules(repo)).toEqual({});
    },
    SPAWN_TIMEOUT_MS * 2,
  );
});
