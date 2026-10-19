// @spawns packages/lore/src/index.ts
// @reads assets/context/**
// @reads packages/lore/tests/fixtures/context-variables/pre-change-rules/**
/**
 * @spec_ref AC-CV-2
 *
 * RED tests (spec-lore-owned-agent-context-is-generated-from-templates-and, D2-D5, D10): a fragment may
 * name `{{lore:<name>}}`; lore fills the registered value in at every fragment outlet BEFORE fingerprinting,
 * duplicate-line detection and the hook cap, so `refresh`, `check` and `render` cannot disagree.
 *
 * Future API these tests pin (nothing below exists yet; every test is RED for the missing implementation):
 *   - `expandFragments(fragments, outlet, ctx, registry)` in `src/service/context-fragments/expand.ts`
 *       fragments: readonly Fragment[]            outlet: OutletId
 *       ctx:       { invocation: Readonly<Record<string, string>> }   (per-fragment path / lineOffset are
 *                  derived by the helper from each Fragment; the caller supplies only invocation values)
 *       returns    Result<readonly Fragment[], LoreError>: same fragments with `body` expanded, input untouched.
 *   - `LORE_CONTEXT_VARIABLES` from `src/service/context-variables-registry.ts` (registry INSTANCE).
 *   - `CAPTURE_TAIL_CHARS` exported from `@lore/core` (moves there from adapters/evidence-capture.ts).
 *
 * Fixture roots are mkdtemp directories; `assets/` and this repo's `.lore/` are only ever read, never written.
 * Spawned CLI = the SOURCE entry `bun packages/lore/src/index.ts` with HOME=<mkdtemp> (never the installed lore).
 *
 * KNOWN SPEC DISCREPANCY: AC-CV-2 says `lore fragments check --json` "exits 1"; today's verb exits 4 (the
 * VALIDATION_ERROR family, CHECK_FAILED_EXIT, pinned by rs-status-check-fragments.bun.test.ts). The
 * duplicate test below asserts 4 (non-zero, unchanged contract) rather than forcing a contract change.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CAPTURE_TAIL_CHARS, type Fragment, type OutletId } from "@lore/core";
import { discoverFragments } from "../../../src/service/context-fragments/discover.js";
import { expandFragments } from "../../../src/service/context-fragments/expand.js";
import { renderOutlet } from "../../../src/service/context-fragments/render.js";
import {
  parseRulesFile,
  parseSkillFile,
  renderRulesFile,
  renderSkillFile,
} from "../../../src/service/context-fragments/section.js";
import { LORE_CONTEXT_VARIABLES, configVariableValues } from "../../../src/service/context-variables-registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LORE_SRC_ENTRY = join(HERE, "../../../src/index.ts");
const ASSETS_CONTEXT = join(HERE, "../../../../../assets/context");
const GOLDEN_DIR = join(HERE, "../../fixtures/context-variables/pre-change-rules");
const EMPTY_CTX = { invocation: {} } as const;
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

function fragment(id: string, body: string, extra: Record<string, unknown> = {}): Fragment {
  return {
    frontmatter: { id, title: `T ${id}`, audience: ["main"], mode: "static", ...extra },
    body,
    layer: "project",
    path: `.lore/context/${id}.md`,
    bodyLineOffset: 6,
  } as unknown as Fragment;
}

function sha8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

function mustExpand(fragments: readonly Fragment[], outlet: OutletId): readonly Fragment[] {
  const result = expandFragments(fragments, outlet, EMPTY_CTX, LORE_CONTEXT_VARIABLES);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

const ROOT_CLAUDE_MD =
  "# P\n\n" +
  ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
    .map((heading) => `## ${heading}\n\nshort\n`)
    .join("\n");

function fragmentFile(id: string, audience: string, mode: string, body: string): string {
  return `---\nid: ${id}\ntitle: T ${id}\naudience: [${audience}]\nmode: ${mode}\n---\n${body}`;
}

interface Sandbox {
  readonly repo: string;
  readonly home: string;
}

/** A fresh repo after `lore init` (no git needed) with a minimal root CLAUDE.md, plus an empty HOME. */
function makeSandbox(): Sandbox {
  const repo = tmp("lore-fv-repo-");
  const home = tmp("lore-fv-home-");
  const init = lore({ repo, home }, "init");
  if (init.status !== 0) throw new Error(`lore init failed (${init.status}): ${init.stderr}`);
  writeFileSync(join(repo, "CLAUDE.md"), ROOT_CLAUDE_MD);
  mkdirSync(join(repo, ".lore", "context"), { recursive: true });
  return { repo, home };
}

function writeProjectFragment(sb: Sandbox, file: string, text: string): void {
  writeFileSync(join(sb.repo, ".lore", "context", file), text);
}

function lore(sb: Sandbox, ...args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: sb.home };
  for (const key of ["XDG_CONFIG_HOME", "LORE_CONFIG_HOME", "CLAUDE_CONFIG_DIR"]) delete env[key];
  return spawnSync("bun", [LORE_SRC_ENTRY, ...args], { cwd: sb.repo, env, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS });
}

function loreRulesFiles(repo: string): string[] {
  const dir = join(repo, ".claude", "rules");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith("lore-")) : [];
}

describe("AC-CV-2 fragment outlets expand {{lore:<name>}} before fingerprinting", () => {
  it("liveness: CAPTURE_TAIL_CHARS is exported by @lore/core as a positive integer", () => {
    expect(typeof CAPTURE_TAIL_CHARS).toBe("number");
    expect(Number.isInteger(CAPTURE_TAIL_CHARS)).toBe(true);
    expect(CAPTURE_TAIL_CHARS).toBeGreaterThan(0);
  });

  it("HAPPY rules outlet: the rules file holds String(CAPTURE_TAIL_CHARS), no '{{lore:', fingerprint hash = hash(expanded body)", () => {
    const source = fragment("tail", "Evidence tail keeps {{lore:capture_tail_chars}} chars.\nSecond line.\n");
    const [expanded] = mustExpand([source], "rules:project");
    const render = renderRulesFile(expanded as Fragment);
    expect(render.ok).toBe(true);
    if (!render.ok) return;
    expect(render.value.content).toContain(`Evidence tail keeps ${String(CAPTURE_TAIL_CHARS)} chars.`);
    expect(render.value.content).not.toContain("{{lore:");

    const expandedRest = `Evidence tail keeps ${String(CAPTURE_TAIL_CHARS)} chars.\nSecond line.\n`;
    const rawRest = source.body;
    const parsed = parseRulesFile(render.value.content);
    expect(parsed).not.toBeNull();
    expect(parsed?.intact).toBe(true);
    expect(parsed?.recordedHash).toBe(sha8(expandedRest));
    expect(parsed?.recordedHash).not.toBe(sha8(rawRest)); // not fingerprinted over the raw template
  });

  it("HAPPY skills outlet: the SKILL.md holds String(CAPTURE_TAIL_CHARS), no '{{lore:', fingerprint covers frontmatter + expanded body", () => {
    const source = fragment("tailskill", "Tail window: {{lore:capture_tail_chars}}.\n", {
      delivery: "skill",
      description: "How the evidence tail works",
    });
    const [expanded] = mustExpand([source], "skills:project");
    const render = renderSkillFile(expanded as Fragment);
    expect(render.ok).toBe(true);
    if (!render.ok) return;
    expect(render.value.content).toContain(`Tail window: ${String(CAPTURE_TAIL_CHARS)}.`);
    expect(render.value.content).not.toContain("{{lore:");
    const parsed = parseSkillFile(render.value.content);
    expect(parsed?.intact).toBe(true);
  });

  it("HAPPY hook:subagent-start: the rendered block holds String(CAPTURE_TAIL_CHARS) and no '{{lore:'", () => {
    const source = fragment("helper-tail", "Helpers: tail is {{lore:capture_tail_chars}} chars.\n", {
      audience: ["subagent:*"],
      mode: "dynamic",
    });
    const expanded = mustExpand([source], "hook:subagent-start");
    const block = renderOutlet(expanded, "hook:subagent-start");
    expect(block.ok).toBe(true);
    if (!block.ok) return;
    expect(block.value.text).toContain(`tail is ${String(CAPTURE_TAIL_CHARS)} chars.`);
    expect(block.value.text).not.toContain("{{lore:");
  });

  it("BOUNDARY hook block size: chars are counted on the EXPANDED text (the 27-char token counts as its value's length)", () => {
    const source = fragment("cap-probe", "{{lore:capture_tail_chars}}\n", { audience: ["subagent:*"], mode: "dynamic" });
    const expanded = mustExpand([source], "hook:subagent-start");
    const block = renderOutlet(expanded, "hook:subagent-start");
    expect(block.ok).toBe(true);
    if (!block.ok) return;
    expect(block.value.chars).toBe(String(CAPTURE_TAIL_CHARS).length + 1);
  });

  it("REGRESSION: a body without '{{lore:' passes through expandFragments byte-identical, input fragments untouched", () => {
    const body = "Plain line.\n{{file_list}} stays.\n{{ lore:capture_tail_chars }} stays too.\n{{lore:Bad-Name}} stays.\n";
    const source = fragment("plain", body);
    const before = JSON.stringify(source);
    const expanded = mustExpand([source], "rules:project");
    expect(expanded[0]?.body).toBe(body);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("BOUNDARY: an empty fragment list expands to an empty list; expansion is deterministic across calls", () => {
    expect(mustExpand([], "rules:project")).toEqual([]);
    const source = fragment("det", "n={{lore:capture_tail_chars}}\n");
    expect(mustExpand([source], "rules:project")).toEqual(mustExpand([source], "rules:project"));
  });

  it("NEGATIVE: an unregistered variable makes expandFragments return VALIDATION_ERROR naming the fragment path and the name", () => {
    const result = expandFragments([fragment("bad", "ok line\nuses {{lore:nope}} here\n")], "rules:project", EMPTY_CTX, LORE_CONTEXT_VARIABLES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = "message" in result.error ? String(result.error.message) : "";
    expect(message).toContain(".lore/context/bad.md");
    expect(message).toContain("nope");
  });

  it("NEGATIVE all-or-nothing: one bad fragment among good ones fails the whole set (no partial expansion returned)", () => {
    const good = fragment("good", "n={{lore:capture_tail_chars}}\n");
    const bad = fragment("bad", "{{lore:nope}}\n");
    const result = expandFragments([good, bad], "rules:project", EMPTY_CTX, LORE_CONTEXT_VARIABLES);
    expect(result.ok).toBe(false);
  });
});

describe("AC-CV-2 fragments without '{{lore:' render byte-identical to the pre-change golden fixtures", () => {
  it("every committed golden equals the post-change render of the shipped static main fragment of the same id", async () => {
    const nodeFs = {
      exists: async (path: string) => existsSync(path),
      readFile: async (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null),
      listDir: async (path: string) => (existsSync(path) ? readdirSync(path) : []),
    };
    const discovered = await discoverFragments(nodeFs, {
      shipped: ASSETS_CONTEXT,
      user: join(tmpdir(), "lore-fv-no-user-layer"),
      project: join(tmpdir(), "lore-fv-no-project-layer"),
    });
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) return;
    const goldens = readdirSync(GOLDEN_DIR).filter((name) => name.endsWith(".md"));
    expect(goldens.length).toBeGreaterThanOrEqual(9); // liveness: the fixture set is non-empty
    const staticMain = discovered.value.filter(
      (f) => f.frontmatter.mode === "static" && f.frontmatter.audience.includes("main") && f.frontmatter.delivery !== "skill",
    );
    expect(staticMain.map((f) => `${f.frontmatter.id}.md`).sort()).toEqual([...goldens].sort());

    for (const source of staticMain) {
      // reason: worktree-dispatch names the configured floor via {{lore:integrate_floor}}; its golden is the render for a project with none set.
      const result = expandFragments([source], "rules:project", { invocation: configVariableValues({}, {}, "rules:project") }, LORE_CONTEXT_VARIABLES);
      if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
      const render = renderRulesFile(result.value[0] as Fragment);
      expect(render.ok).toBe(true);
      if (!render.ok) continue;
      const golden = readFileSync(join(GOLDEN_DIR, `${source.frontmatter.id}.md`), "utf8");
      expect(render.value.content, `rules file for ${source.frontmatter.id}`).toBe(golden);
    }
  });
});

describe("AC-CV-2 spawned CLI (source entry, HOME=<mkdtemp>)", () => {
  it(
    "refresh over an unregistered variable exits 4, names .lore/context/<file>:<line> and the name, and writes no lore rules file",
    () => {
      const sb = makeSandbox();
      // body starts on file line 7 (after the 6-line frontmatter block); the variable sits on line 8
      writeProjectFragment(sb, "badvar.md", fragmentFile("badvar", "main", "static", "first body line\nuses {{lore:nope}} here\n"));
      const refresh = lore(sb, "context", "refresh");
      expect(refresh.status).toBe(4);
      expect(refresh.stderr).toMatch(/\.lore\/context\/badvar\.md:8\b/);
      expect(refresh.stderr).toContain("nope");
      expect(loreRulesFiles(sb.repo)).toEqual([]);

      // control: the SAME repo without the bad fragment refreshes fine, so exit 4 above came from the variable
      rmSync(join(sb.repo, ".lore", "context", "badvar.md"));
      const control = lore(sb, "context", "refresh");
      expect(control.status, control.stderr).toBe(0);
      expect(loreRulesFiles(sb.repo).length).toBeGreaterThan(0);
    },
    SPAWN_TIMEOUT_MS * 2,
  );

  it(
    "refresh expands a registered variable into the project rules file and fingerprints the expanded body",
    () => {
      const sb = makeSandbox();
      writeProjectFragment(sb, "tailrule.md", fragmentFile("tailrule", "main", "static", "Tail is {{lore:capture_tail_chars}} chars.\n"));
      const refresh = lore(sb, "context", "refresh");
      expect(refresh.status, refresh.stderr).toBe(0);
      const content = readFileSync(join(sb.repo, ".claude", "rules", "lore-tailrule.md"), "utf8");
      expect(content).toContain(`Tail is ${String(CAPTURE_TAIL_CHARS)} chars.`);
      expect(content).not.toContain("{{lore:");
      expect(parseRulesFile(content)?.intact).toBe(true);
      expect(parseRulesFile(content)?.recordedHash).toBe(sha8(`Tail is ${String(CAPTURE_TAIL_CHARS)} chars.\n`));
      // idempotent: a second refresh leaves the bytes alone
      const again = lore(sb, "context", "refresh");
      expect(again.status, again.stderr).toBe(0);
      expect(readFileSync(join(sb.repo, ".claude", "rules", "lore-tailrule.md"), "utf8")).toBe(content);
    },
    SPAWN_TIMEOUT_MS * 2,
  );

  it(
    "fragments render (hook:subagent-start) prints the expanded value from the binary, never the token",
    () => {
      const sb = makeSandbox();
      writeProjectFragment(sb, "helpertail.md", fragmentFile("helpertail", '"subagent:*"', "dynamic", "Helper tail is {{lore:capture_tail_chars}} chars.\n"));
      const render = lore(sb, "fragments", "render", "--outlet", "hook:subagent-start", "--agent-type", "lore-reader");
      expect(render.status, render.stderr).toBe(0);
      const payload = JSON.parse(render.stdout) as { hookSpecificOutput: { additionalContext: string } };
      expect(payload.hookSpecificOutput.additionalContext).toContain(`Helper tail is ${String(CAPTURE_TAIL_CHARS)} chars.`);
      expect(payload.hookSpecificOutput.additionalContext).not.toContain("{{lore:");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "fragments check --json: two fragments whose lines are equal only AFTER expansion report a duplicate_line naming both ids (exit 4, see header note on 'exits 1')",
    () => {
      const sb = makeSandbox();
      writeProjectFragment(sb, "dup-a.md", fragmentFile("dup-a", "main", "static", "Evidence tail keeps {{lore:capture_tail_chars}} chars.\n"));
      writeProjectFragment(sb, "dup-b.md", fragmentFile("dup-b", "main", "static", `Evidence tail keeps ${String(CAPTURE_TAIL_CHARS)} chars.\n`));
      const refresh = lore(sb, "context", "refresh"); // check also measures rules-file drift, so write the files first
      expect(refresh.status, refresh.stderr).toBe(0);
      const check = lore(sb, "fragments", "check", "--json");
      expect(check.status).toBe(4);
      const report = JSON.parse(check.stdout) as { ok: boolean; data: { findings: { kind: string; message: string }[] } };
      expect(report.ok).toBe(false);
      const duplicates = report.data.findings.filter((finding) => finding.kind === "duplicate_line");
      expect(duplicates.length).toBeGreaterThanOrEqual(1);
      const named = duplicates.map((finding) => finding.message).join("\n");
      expect(named).toContain("dup-a");
      expect(named).toContain("dup-b");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "fragments check --json NEGATIVE control: lines that stay different after expansion produce no duplicate_line and exit 0",
    () => {
      const sb = makeSandbox();
      writeProjectFragment(sb, "dup-a.md", fragmentFile("dup-a", "main", "static", "Evidence tail keeps {{lore:capture_tail_chars}} chars.\n"));
      writeProjectFragment(sb, "dup-b.md", fragmentFile("dup-b", "main", "static", `Evidence tail keeps ${String(CAPTURE_TAIL_CHARS + 1)} chars.\n`));
      const refresh = lore(sb, "context", "refresh");
      expect(refresh.status, refresh.stderr).toBe(0);
      const check = lore(sb, "fragments", "check", "--json");
      expect(check.status, check.stderr).toBe(0);
      const report = JSON.parse(check.stdout) as { ok: boolean; data: { findings: { kind: string }[] } };
      expect(report.data.findings.filter((finding) => finding.kind === "duplicate_line")).toEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "fragments check over an unregistered variable fails with the same file:line + name (check and refresh cannot disagree, D10)",
    () => {
      const sb = makeSandbox();
      writeProjectFragment(sb, "badvar.md", fragmentFile("badvar", "main", "static", "first body line\nuses {{lore:nope}} here\n"));
      const check = lore(sb, "fragments", "check", "--json");
      expect(check.status).toBe(4);
      const combined = `${check.stdout}\n${check.stderr}`;
      expect(combined).toMatch(/\.lore\/context\/badvar\.md:8\b/);
      expect(combined).toContain("nope");
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("AC-CV-2 error line is counted in the FILE even for flow-style frontmatter", () => {
  it("ERROR: a bad {{lore:nope}} after flow-style YAML, a blank line and a comment names its exact file line", async () => {
    const dir = tmp("lore-fv-flow-");
    const project = join(dir, "project");
    mkdirSync(project, { recursive: true });
    const text = [
      "---", // 1
      "id: flowy", // 2
      "title: Flowy", // 3
      "audience: [main]", // 4
      "", // 5
      "# a comment inside the frontmatter", // 6
      "when: {language: [zh]}", // 7
      "mode: static", // 8
      "---", // 9
      "first body line", // 10
      "bad {{lore:nope}} here", // 11
      "",
    ].join("\n");
    writeFileSync(join(project, "flowy.md"), text);
    const nodeFs = {
      exists: async (path: string) => existsSync(path),
      readFile: async (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null),
      listDir: async (path: string) => (existsSync(path) ? readdirSync(path) : []),
    };
    const discovered = await discoverFragments(nodeFs, {
      shipped: join(dir, "no-shipped"),
      user: join(dir, "no-user"),
      project,
    });
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) return;
    const [flowy] = discovered.value;
    expect(flowy?.bodyLineOffset).toBe(9);
    const result = expandFragments(discovered.value, "rules:project", EMPTY_CTX, LORE_CONTEXT_VARIABLES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain(`${join(project, "flowy.md")}:11`);
  });
});
