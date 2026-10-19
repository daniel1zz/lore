// @reads .claude/rules/**
// @reads .claude/settings.json
// @reads .gitignore
// @reads .lore-bootstrap/.lore/.gitignore
// @reads .lore-bootstrap/.lore/config.yaml
// @reads .lore/**
// @reads .serena/.gitignore
// @reads .serena/project.yml
// @reads CHANGELOG.md
// @reads CLAUDE.md
// @reads README.md
// @reads assets/agents/lore-implementer.md
// @reads assets/agents/lore-reader.md
// @reads assets/context/**
// @reads assets/governance/claude-md-contract.md
// @reads assets/governance/seat-briefing.md
// @reads assets/hooks/**
// @reads assets/project/**
// @reads assets/skills/lore-ai-native-coding/SKILL.md
// @reads assets/skills/lore-ai-native-coding/references/**
// @reads assets/skills/lore-analyze/SKILL.md
// @reads assets/skills/lore-auto-wire/SKILL.md
// @reads assets/skills/lore-auto-wire/references/**
// @reads assets/skills/lore-auto-wire/scripts/check-tools.sh
// @reads assets/skills/lore-auto-wire/scripts/fix-path.sh
// @reads assets/skills/lore-autopilot/SKILL.md
// @reads assets/skills/lore-baseline/SKILL.md
// @reads assets/skills/lore-baseline/templates/branch.md
// @reads assets/skills/lore-baseline/templates/leaf.md
// @reads assets/skills/lore-best-practice/SKILL.md
// @reads assets/skills/lore-biz-review/SKILL.md
// @reads assets/skills/lore-bug-hunt/SKILL.md
// @reads assets/skills/lore-bug-hunt/references/agent-prompts.md
// @reads assets/skills/lore-context-optimizer/SKILL.md
// @reads assets/skills/lore-context-optimizer/references/analysis-checklist.md
// @reads assets/skills/lore-context-optimizer/references/optimization-principles.md
// @reads assets/skills/lore-deploy/SKILL.md
// @reads assets/skills/lore-deploy/references/**
// @reads assets/skills/lore-design-ui/SKILL.md
// @reads assets/skills/lore-design-ui/decisions/2026-02-01-business-scenario-style-guide.md
// @reads assets/skills/lore-design-ui/references/**
// @reads assets/skills/lore-design-ui/templates/decisions-template.md
// @reads assets/skills/lore-design-ui/templates/ui-standards-template.md
// @reads assets/skills/lore-design/SKILL.md
// @reads assets/skills/lore-design/references/**
// @reads assets/skills/lore-design/templates/design-preview.html
// @reads assets/skills/lore-diagnose/SKILL.md
// @reads assets/skills/lore-diagnose/scripts/hitl-loop.template.sh
// @reads assets/skills/lore-doctor/SKILL.md
// @reads assets/skills/lore-dogfood/SKILL.md
// @reads assets/skills/lore-dogfood/references/issue-taxonomy.md
// @reads assets/skills/lore-dogfood/templates/dogfood-report-template.md
// @reads assets/skills/lore-domain/SKILL.md
// @reads assets/skills/lore-domain/references/**
// @reads assets/skills/lore-git-workflow/SKILL.md
// @reads assets/skills/lore-git-workflow/references/**
// @reads assets/skills/lore-harness-dev/SKILL.md
// @reads assets/skills/lore-harness-dev/references/**
// @reads assets/skills/lore-improve-codebase-architecture/**
// @reads assets/skills/lore-init-context/SKILL.md
// @reads assets/skills/lore-iterative-review/SKILL.md
// @reads assets/skills/lore-iterative-review/references/fix-agent-prompt.md
// @reads assets/skills/lore-iterative-review/references/reviewer-prompts.md
// @reads assets/skills/lore-kickoff/SKILL.md
// @reads assets/skills/lore-npm-publish/SKILL.md
// @reads assets/skills/lore-npm-publish/references/first-publish.md
// @reads assets/skills/lore-npm-publish/references/prerelease.md
// @reads assets/skills/lore-npm-publish/references/workflow.md
// @reads assets/skills/lore-operate/SKILL.md
// @reads assets/skills/lore-operate/references/**
// @reads assets/skills/lore-plan/SKILL.md
// @reads assets/skills/lore-plan/references/**
// @reads assets/skills/lore-product-benchmark/SKILL.md
// @reads assets/skills/lore-product-benchmark/references/example-feature-matrix.md
// @reads assets/skills/lore-product-lens/SKILL.md
// @reads assets/skills/lore-product-lens/references/**
// @reads assets/skills/lore-product-to-prd/SKILL.md
// @reads assets/skills/lore-product/SKILL.md
// @reads assets/skills/lore-product/references/**
// @reads assets/skills/lore-project-bootstrap/SKILL.md
// @reads assets/skills/lore-project-bootstrap/references/domains/ecommerce.md
// @reads assets/skills/lore-project-bootstrap/references/domains/fintech.md
// @reads assets/skills/lore-project-bootstrap/references/domains/saas.md
// @reads assets/skills/lore-project-bootstrap/references/frameworks/**
// @reads assets/skills/lore-project-bootstrap/references/languages/python.md
// @reads assets/skills/lore-project-bootstrap/references/languages/typescript.md
// @reads assets/skills/lore-project-bootstrap/references/permission-map.md
// @reads assets/skills/lore-project-bootstrap/references/skill-map.md
// @reads assets/skills/lore-project-bootstrap/references/testing/pytest.md
// @reads assets/skills/lore-project-bootstrap/references/testing/vitest.md
// @reads assets/skills/lore-prototype/LOGIC.md
// @reads assets/skills/lore-prototype/SKILL.md
// @reads assets/skills/lore-prototype/UI.md
// @reads assets/skills/lore-refactor/SKILL.md
// @reads assets/skills/lore-refactor/references/**
// @reads assets/skills/lore-research/SKILL.md
// @reads assets/skills/lore-research/references/**
// @reads assets/skills/lore-review/SKILL.md
// @reads assets/skills/lore-review/references/**
// @reads assets/skills/lore-session-capture/SKILL.md
// @reads assets/skills/lore-session-capture/references/knowledge-types.md
// @reads assets/skills/lore-session-review/SKILL.md
// @reads assets/skills/lore-session-review/references/invariants.md
// @reads assets/skills/lore-tdd/**
// @reads assets/skills/lore-test/SKILL.md
// @reads assets/skills/lore-test/references/**
// @reads assets/skills/lore-to-issues/SKILL.md
// @reads assets/skills/lore-triage/AGENT-BRIEF.md
// @reads assets/skills/lore-triage/OUT-OF-SCOPE.md
// @reads assets/skills/lore-triage/SKILL.md
// @reads assets/skills/lore-uat/SKILL.md
// @reads assets/skills/lore-uat/references/**
// @reads assets/skills/lore-uat/templates/acceptance-report.md
// @reads assets/skills/lore-uat/templates/journey.yaml
// @reads assets/skills/lore-write-a-skill/SKILL.md
// @reads assets/skills/lore/SKILL.md
// @reads assets/skills/shared/**
// @reads bun.lock
// @reads bunfig.toml
// @reads docs/requirements/**
// @reads hooks/**
// @reads lore.tree.yaml
// @reads lore.tree.yaml.example
// @reads npm-pkg/postinstall.mjs
// @reads package.json
// @reads packages/core/**
// @reads packages/dashboard/**
// @reads packages/lore/**
// @reads scripts/**
// @reads tsconfig.base.json
// @reads tsconfig.json
// @reads vitest.config.ts
// @reads vitest.node-files.ts
// @reads vitest.node.config.ts
// @reads vitest.shared.ts
// @reads workspace-aliases.ts
/**
 * Unit + fixture-tree suite for `scripts/check-no-nul-bytes.ts`
 * (`task-literal-nul-bytes-in-two-scripts-source-files-one-is`) — the
 * mechanism-root guard against a raw NUL byte landing in a git-tracked TEXT
 * source file. Git's binary-sniff heuristic reads only the first 8000 bytes
 * of a file; a raw NUL anywhere in that window makes the WHOLE file render
 * as `Bin 0 -> N bytes` with no diff at all — unreviewable, in a repo whose
 * entire review discipline is diff-based. See that script's module header
 * for the full mechanism and why this lives as a vitest test (picked up
 * unconditionally by `bun run test`/`test:vitest`) rather than a
 * `hooks/pre-push` check (which is corpus-specific and fails OPEN without a
 * lore corpus).
 *
 * Every pure-predicate case here drives the function directly against an
 * injected fixture — no subprocess, no git. The `main()` suites below use a
 * REAL throwaway `git init` fixture tree (`mkdtemp` + `git add`, never a
 * commit — `git ls-files` reads the index, not history) because `main`'s own
 * job is specifically to enumerate what GIT considers tracked, which no
 * amount of mocking `readFileSync` can substitute for.
 *
 * Coverage (six dimensions):
 *   HAPPY — a NUL-free buffer/fixture-tree reports zero violations;
 *     `main()` exits 0 against a clean throwaway git tree AND against THIS
 *     repo's own real tracked tree (the task's own "run the new guard
 *     against the real tree -> exit 0" oracle, proven here rather than
 *     merely asserted); an extensionless shebang script IS scanned.
 *   NEGATIVE — a byte that is not 0 is never misreported as a NUL; an
 *     UNTRACKED file containing a raw NUL is not scanned at all (git
 *     `ls-files` scope, not a filesystem walk).
 *   BOUNDARY — a NUL at byte 0 and at the final byte are both found; more
 *     than one NUL in a file are all reported, in ascending order; a
 *     1-byte buffer is correctly NOT a shebang.
 *   ERROR — introducing a raw NUL into a tracked scratch file makes
 *     `main()` exit 1 and NAME the offending file with its EXACT byte
 *     offset (the task's "demonstrated failure" requirement — computed via
 *     `prefix.length`, never hand-counted, per this repo's failure-first
 *     verification discipline); removing the byte restores exit 0 (the
 *     control half, proving the FIXTURE, not leftover state, tripped the
 *     guard); scanning a nonexistent candidate path throws
 *     `NulByteCheckError` rather than silently reporting clean.
 *   STATE — `main()` is read-only and idempotent: running it twice against
 *     an unchanged tree reports the identical exit code.
 *   REGRESSION — a non-allowlisted extension (e.g. a `.png` binary asset)
 *     is never scanned even when its content happens to contain a NUL, and
 *     neither is an extensionless, non-shebang file — the allowlist must
 *     never become a source of false positives on legitimate binary assets.
 *
 * @spec_ref task-literal-nul-bytes-in-two-scripts-source-files-one-is
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  findNulByteOffsets,
  hasNoExtension,
  hasShebang,
  hasTextSourceExtension,
  main,
  NulByteCheckError,
  scanTrackedFilesForNulBytes,
} from "../check-no-nul-bytes.js";

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

/** A fresh, empty `git init`'d directory — never committed to; `git ls-files` reads the INDEX, so a plain `git add` is enough to make a file "tracked". */
function makeGitFixture(): string {
  const dir = makeScratchDir("check-no-nul-bytes-git-");
  const init = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  return dir;
}

function gitAdd(dir: string, ...relativePaths: string[]): void {
  const result = spawnSync("git", ["add", ...relativePaths], { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git add ${relativePaths.join(" ")} failed: ${result.stderr}`);
}

describe("check-no-nul-bytes: findNulByteOffsets", () => {
  it("HAPPY: finds a single NUL at its exact byte offset", () => {
    expect(findNulByteOffsets(Buffer.from("a\0b"))).toEqual([1]);
  });

  it("HAPPY: an empty buffer reports zero offsets", () => {
    expect(findNulByteOffsets(Buffer.alloc(0))).toEqual([]);
  });

  it("BOUNDARY: NUL at byte 0 and at the final byte are both found, in ascending order", () => {
    expect(findNulByteOffsets(Buffer.from([0x00, 0x61, 0x62, 0x00]))).toEqual([0, 3]);
  });

  it("BOUNDARY: more than one NUL in a single buffer are all reported, in order", () => {
    expect(findNulByteOffsets(Buffer.from("a\0b\0c\0d"))).toEqual([1, 3, 5]);
  });

  it("NEGATIVE: a byte that is NOT 0 (e.g. 0x01, a space) is never misreported as a NUL", () => {
    expect(findNulByteOffsets(Buffer.from([0x01, 0x20, 0x41]))).toEqual([]);
  });
});

describe("check-no-nul-bytes: hasShebang", () => {
  it("HAPPY: a real shebang is detected", () => {
    expect(hasShebang(Buffer.from("#!/bin/sh\necho hi\n"))).toBe(true);
  });

  it("NEGATIVE: ordinary source with no shebang is not misdetected", () => {
    expect(hasShebang(Buffer.from("export const x = 1;\n"))).toBe(false);
  });

  it("BOUNDARY: a 1-byte buffer (too short to contain '#!') is not a shebang", () => {
    expect(hasShebang(Buffer.from("#"))).toBe(false);
  });
});

describe("check-no-nul-bytes: hasTextSourceExtension / hasNoExtension", () => {
  it("HAPPY: a .ts file matches the text-source allowlist", () => {
    expect(hasTextSourceExtension("scripts/check-no-nul-bytes.ts")).toBe(true);
  });

  it("HAPPY: the .gitignore dotfile matches the allowlist by name, at any depth", () => {
    expect(hasTextSourceExtension(".gitignore")).toBe(true);
    expect(hasTextSourceExtension("packages/dashboard/.gitignore")).toBe(true);
  });

  it("NEGATIVE: a non-allowlisted extension (e.g. a binary asset) does not match", () => {
    expect(hasTextSourceExtension("packages/dashboard/public/favicon.png")).toBe(false);
  });

  it("REGRESSION: hasNoExtension correctly distinguishes an extensionless path from one with a dot", () => {
    expect(hasNoExtension("hooks/pre-push")).toBe(true);
    expect(hasNoExtension("scripts/build.ts")).toBe(false);
  });
});

describe("check-no-nul-bytes: scanTrackedFilesForNulBytes (injected fixture, no git)", () => {
  it("HAPPY: a clean text-source file reports zero violations", () => {
    const dir = makeScratchDir("check-no-nul-bytes-scan-");
    writeFileSync(join(dir, "clean.ts"), "export const a = 1;\n");
    expect(scanTrackedFilesForNulBytes(dir, ["clean.ts"])).toEqual([]);
  });

  it("ERROR: a raw NUL in a scanned file is reported with its EXACT byte offset (computed, not hand-counted)", () => {
    const dir = makeScratchDir("check-no-nul-bytes-scan-");
    const prefix = "const k = `a";
    const suffix = "b`;\n";
    const dirty = Buffer.concat([Buffer.from(prefix), Buffer.from([0x00]), Buffer.from(suffix)]);
    writeFileSync(join(dir, "dirty.ts"), dirty);
    expect(scanTrackedFilesForNulBytes(dir, ["dirty.ts"])).toEqual([{ path: "dirty.ts", offsets: [prefix.length] }]);
  });

  it("HAPPY: an extensionless shebang script IS scanned and its NUL reported", () => {
    const dir = makeScratchDir("check-no-nul-bytes-scan-");
    writeFileSync(join(dir, "myhook"), Buffer.from("#!/bin/sh\necho a\0b\n"));
    const violations = scanTrackedFilesForNulBytes(dir, ["myhook"]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.path).toBe("myhook");
  });

  it("REGRESSION: a non-allowlisted extension is skipped even when its content contains a NUL", () => {
    const dir = makeScratchDir("check-no-nul-bytes-scan-");
    writeFileSync(join(dir, "asset.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]));
    expect(scanTrackedFilesForNulBytes(dir, ["asset.png"])).toEqual([]);
  });

  it("REGRESSION: an extensionless, non-shebang file is skipped even when its content contains a NUL", () => {
    const dir = makeScratchDir("check-no-nul-bytes-scan-");
    writeFileSync(join(dir, "README"), Buffer.from([0x68, 0x69, 0x00]));
    expect(scanTrackedFilesForNulBytes(dir, ["README"])).toEqual([]);
  });

  it("ERROR: a nonexistent candidate path throws NulByteCheckError, never a silent skip", () => {
    const dir = makeScratchDir("check-no-nul-bytes-scan-");
    expect(() => scanTrackedFilesForNulBytes(dir, ["does-not-exist.ts"])).toThrow(NulByteCheckError);
  });
});

describe("check-no-nul-bytes: main() — real git fixture tree", () => {
  it("HAPPY: a clean fixture tree exits 0", () => {
    const dir = makeGitFixture();
    writeFileSync(join(dir, "clean.ts"), "export const a = 1;\n");
    gitAdd(dir, "clean.ts");
    expect(main(dir)).toBe(0);
  });

  it("NEGATIVE: an UNTRACKED file with a raw NUL is not scanned at all (git ls-files scope, not a filesystem walk)", () => {
    const dir = makeGitFixture();
    writeFileSync(join(dir, "tracked.ts"), "export const a = 1;\n");
    gitAdd(dir, "tracked.ts");
    writeFileSync(join(dir, "untracked.ts"), Buffer.from("const x = `a\0b`;\n")); // deliberately never `git add`ed
    expect(main(dir)).toBe(0);
  });

  it("STATE: main() is read-only/idempotent — running it twice against an unchanged tree reports the identical result", () => {
    const dir = makeGitFixture();
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    gitAdd(dir, "a.ts");
    expect(main(dir)).toBe(main(dir));
  });

  it("ERROR + demonstrated-failure control (task AC): introducing a raw NUL makes main() exit 1 and NAME the file with its byte offset; removing it restores exit 0", () => {
    const dir = makeGitFixture();
    const relativePath = "scratch.ts";
    const target = join(dir, relativePath);

    writeFileSync(target, "export const a = 1;\n");
    gitAdd(dir, relativePath);
    expect(main(dir)).toBe(0); // control: the clean fixture is genuinely green before any NUL is introduced

    const prefix = "export const a = `x";
    const suffix = "y`;\n";
    writeFileSync(target, Buffer.concat([Buffer.from(prefix), Buffer.from([0x00]), Buffer.from(suffix)]));
    gitAdd(dir, relativePath);
    expect(main(dir)).toBe(1); // red: the guard trips on the injected NUL
    expect(scanTrackedFilesForNulBytes(dir, [relativePath])).toEqual([{ path: relativePath, offsets: [prefix.length] }]); // NAMED, with its exact offset

    writeFileSync(target, "export const a = 1;\n");
    gitAdd(dir, relativePath);
    expect(main(dir)).toBe(0); // green again: the FIXTURE (not leftover state) was what tripped the guard
  });
});

describe("check-no-nul-bytes: real repo tree (task oracle)", () => {
  it("HAPPY: exits 0 against THIS checkout's own git-tracked tree, after the fix", () => {
    expect(main()).toBe(0);
  });
});
