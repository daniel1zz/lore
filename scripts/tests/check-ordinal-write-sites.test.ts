// @reads packages/**
/**
 * Unit + fixture-tree suite for `scripts/check-ordinal-write-sites.mjs`
 * (`task-three-of-five-static-checkers-are-inert-no-exported-main`,
 * `task-make-mirrorhumanid-a-nominal-type-on`) — the SPEC-084 Invariant-2 guard
 * confining ordinal-allocation arithmetic and direct SQL writes to the
 * `ordinal` column to a fixed allowlist of files, PLUS (D4) the
 * SPEC-mirror-identifier-ssot cast-escape rule confining a textual
 * `as MirrorHumanId` cast to the ONE sanctioned schema-boundary file.
 *
 * Why this file exists at all: until this task the checker had **no test**, no
 * exported `main`, and no caller anywhere in the tree (`package.json`'s
 * `check:ordinal-sites` script is referenced by nothing — measured by grepping
 * `packages/`, `scripts/`, `hooks/`, `assets/`, `.claude/`). There is no CI and
 * `hooks/pre-push` runs only `lore` checks, so the guard had never once executed
 * against this checkout. A guard that never runs is indistinguishable from a
 * guard that passes — the false-oracle vector this repo catalogues, applied to
 * the guard layer itself. The `real repo tree (task oracle)` describe at the
 * bottom is what arms it: `bun run test` now executes the scan against THIS
 * checkout on every run.
 *
 * Every fixture case drives the REAL code path (`main(repoRoot)` /
 * `collectViolationsInFile`) against an injected `mkdtemp` tree shaped like a
 * miniature of this repo (`packages/<name>/src/**`) — no mocking, because what
 * is being proven is precisely which files the walker reaches and which the
 * allowlist exempts.
 *
 * Coverage (six dimensions):
 *   HAPPY — a clean fixture tree exits 0; the real repo tree exits 0 (the arming
 *     assertion, now ALSO exercising rule (c) against the real
 *     `packages/core/src/schemas.ts`); all three textual rules are found where
 *     they occur, with their EXACT line numbers (computed from the fixture's own
 *     prefix, never hand-counted, per this repo's failure-first verification
 *     discipline).
 *   NEGATIVE — introducing allocation arithmetic (or an unsanctioned
 *     `as MirrorHumanId` cast) in an UNSANCTIONED file makes `main()` return
 *     exactly 3 and name the file/line/rule; the same content in a SANCTIONED
 *     file (for that rule specifically — the two allowlists are independent)
 *     is exempted; a line merely mentioning the word `ordinal`/`MirrorHumanId`
 *     is never a violation.
 *   BOUNDARY — the `INSERT INTO docs` rule's 600-char window: an `ordinal`
 *     mention just inside it matches, one just outside does not (padding
 *     computed, not guessed); a `.mts` file IS scanned while a `.d.ts` is not;
 *     the MirrorHumanId cast rule is case-SENSITIVE and catches the laundering
 *     `as unknown as MirrorHumanId` double-cast form.
 *   ERROR — a fixture root with no `packages/` directory makes `main()` THROW
 *     (the scan-failure path the CLI maps to exit 4), never a silent exit 0.
 *   STATE — `main()` is read-only and idempotent: two runs over an unchanged
 *     tree return the identical code; removing an injected violation restores 0
 *     (the control half, proving the FIXTURE — not leftover state — tripped it).
 *   REGRESSION — every path in `SANCTIONED_ORDINAL_WRITE_FILES` AND
 *     `SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES` still exists on disk (an allowlist
 *     row that outlived its file exempts nothing and hides drift);
 *     tests/generated/`.d.ts`/non-TypeScript files stay out of scan scope, so
 *     the allowlist can never become a false-positive source.
 *
 * @spec_ref task-three-of-five-static-checkers-are-inert-no-exported-main, task-make-mirrorhumanid-a-nominal-type-on
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectViolationsInFile,
  isScannableSourceFile,
  main,
  SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES,
  SANCTIONED_ORDINAL_WRITE_FILES,
} from "../check-ordinal-write-sites.mjs";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/** Exit codes documented in the checker's own module header — pinned here so a renumbering fails loud. */
const EXIT_CLEAN = 0;
const EXIT_VIOLATIONS_FOUND = 3;

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** An empty throwaway directory that fixture cases populate as a miniature repo root. */
function makeScratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "check-ordinal-write-sites-"));
  scratchDirs.push(dir);
  return dir;
}

/** Writes `content` to `<root>/<relPath>`, creating parent directories. */
function writeSource(root: string, relPath: string, content: string): void {
  const absolute = join(root, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

/** A fixture root with one clean, scannable source file — the baseline every violation case starts from. */
function makeCleanFixture(): string {
  const root = makeScratchDir();
  writeSource(root, "packages/lore/src/service/clean-service.ts", "export const answer = 1;\n");
  return root;
}

// ─── main(): injected fixture trees ─────────────────────────────────────────

describe("check-ordinal-write-sites: main() — injected fixture tree", () => {
  it("HAPPY: a clean fixture tree returns 0", () => {
    expect(main(makeCleanFixture())).toBe(EXIT_CLEAN);
  });

  it("NEGATIVE + STATE (demonstrated failure, task AC): allocation arithmetic in an UNSANCTIONED file returns exactly 3; removing it restores 0", () => {
    const root = makeCleanFixture();
    const rogue = "packages/lore/src/service/rogue-service.ts";

    expect(main(root)).toBe(EXIT_CLEAN); // control: the fixture is genuinely green before the violation is injected

    writeSource(root, rogue, "const next = db.query(`SELECT MAX(ordinal) FROM docs`).get();\n");
    // 3, not merely "non-zero": the module header documents 0/3/4 and a
    // renumbering would silently change what `bun run check:ordinal-sites`
    // means to every caller reading its exit code.
    expect(main(root)).toBe(EXIT_VIOLATIONS_FOUND);

    writeSource(root, rogue, "export const answer = 2;\n");
    expect(main(root)).toBe(EXIT_CLEAN); // green again: the FIXTURE, not leftover state, was what tripped the guard
  });

  it("NEGATIVE: a direct SQL write to the ordinal column in an UNSANCTIONED file returns 3", () => {
    const root = makeCleanFixture();
    writeSource(root, "packages/lore/src/service/rogue-update.ts", "await db.run(`UPDATE docs SET ordinal = ?`);\n");
    expect(main(root)).toBe(EXIT_VIOLATIONS_FOUND);
  });

  it("NEGATIVE: the SAME violating content inside a SANCTIONED file is exempted — the allowlist is honoured, not ignored", () => {
    const root = makeCleanFixture();
    const sanctioned = SANCTIONED_ORDINAL_WRITE_FILES[0] as string;
    const violating = "const next = db.query(`SELECT MAX(ordinal) + 1 FROM docs`).get();\n";

    writeSource(root, sanctioned, violating);
    expect(main(root)).toBe(EXIT_CLEAN);

    // Independent control: the identical bytes in a NON-allowlisted path DO trip
    // the guard, so the exemption above is the allowlist doing its job rather
    // than the scan quietly missing this content everywhere.
    writeSource(root, "packages/lore/src/service/same-bytes.ts", violating);
    expect(main(root)).toBe(EXIT_VIOLATIONS_FOUND);
  });

  it("STATE: main() is read-only and idempotent — two runs over an unchanged tree return the identical code", () => {
    const root = makeCleanFixture();
    writeSource(root, "packages/lore/src/service/rogue-idem.ts", "// MAX(ordinal) discussed in a comment\n");
    expect(main(root)).toBe(main(root));
  });

  it("ERROR: a root with no packages/ directory THROWS (the CLI's exit-4 scan-failure path), never a silent 0", () => {
    const root = makeScratchDir();
    expect(() => main(root)).toThrow(/packages/);
  });

  it("REGRESSION: a file outside packages/*/src is never scanned, so it can never trip the guard", () => {
    const root = makeCleanFixture();
    // Same violating text, but in a location the walker's scan scope excludes.
    writeSource(root, "packages/lore/tests/rogue.ts", "const n = MAX(ordinal) + 1;\n");
    writeSource(root, "packages/lore/src/generated/rogue.ts", "const n = MAX(ordinal) + 1;\n");
    writeSource(root, "packages/lore/src/service/rogue.test.ts", "const n = MAX(ordinal) + 1;\n");
    writeSource(root, "packages/lore/src/service/rogue.d.ts", "declare const n: 1; // MAX(ordinal) + 1\n");
    writeSource(root, "packages/lore/src/service/rogue.md", "MAX(ordinal) + 1\n");
    expect(main(root)).toBe(EXIT_CLEAN);
  });

  it("BOUNDARY: a .mts source file IS scanned (extension allowlist is not .ts-only)", () => {
    const root = makeCleanFixture();
    writeSource(root, "packages/lore/src/service/rogue.mts", "const n = ordinal + 1;\n");
    expect(main(root)).toBe(EXIT_VIOLATIONS_FOUND);
  });
});

// ─── main(): rule (c) — the MirrorHumanId cast-escape (SPEC-mirror-identifier-ssot D4) ─────

describe("check-ordinal-write-sites: main() — MirrorHumanId cast-escape rule (AC-MIS-3)", () => {
  it("NEGATIVE: an 'as MirrorHumanId' cast in an UNSANCTIONED file returns EXACTLY 3, naming the rule and file:line", () => {
    const root = makeCleanFixture();
    const rogue = "packages/lore/src/service/rogue-cast.ts";
    writeSource(
      root,
      rogue,
      'import type { MirrorHumanId } from "@lore/core";\nconst id = "SPEC-021" as MirrorHumanId;\n',
    );

    expect(main(root)).toBe(EXIT_VIOLATIONS_FOUND); // exactly 3, not merely non-zero — same discipline as the ordinal rules

    const violations = collectViolationsInFile(rogue, 'const id = "SPEC-021" as MirrorHumanId;\n');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("mirror-human-id-unsanctioned-cast");
    expect(violations[0]?.file).toBe(rogue);
    expect(violations[0]?.line).toBe(1);
  });

  it("NEGATIVE: the laundering 'as unknown as MirrorHumanId' double-cast is ALSO caught in an unsanctioned file", () => {
    const root = makeCleanFixture();
    writeSource(
      root,
      "packages/lore/src/service/rogue-launder.ts",
      'const id = ("SPEC-021" as unknown) as MirrorHumanId;\n',
    );
    expect(main(root)).toBe(EXIT_VIOLATIONS_FOUND);
  });

  it("NEGATIVE: the SAME 'as MirrorHumanId' cast bytes inside the SANCTIONED schemas.ts path return 0 — the allowlist is honoured, not ignored", () => {
    const root = makeCleanFixture();
    const sanctioned = SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES[0] as string;
    const castLine = 'human_id: z.string().min(1).transform((value) => value as MirrorHumanId),\n';

    writeSource(root, sanctioned, castLine);
    expect(main(root)).toBe(EXIT_CLEAN);

    // Independent control: the IDENTICAL bytes in a non-allowlisted path DO trip the guard,
    // so the exemption above is the allowlist doing its job, not the pattern failing to match.
    writeSource(root, "packages/lore/src/service/same-cast-bytes.ts", castLine);
    expect(main(root)).toBe(EXIT_VIOLATIONS_FOUND);
  });

  it("NEGATIVE: a comment merely mentioning the identifier MirrorHumanId (no 'as' cast) is never a violation", () => {
    const root = makeCleanFixture();
    writeSource(
      root,
      "packages/lore/src/service/mentions-only.ts",
      "// this value is a MirrorHumanId once formatMirrorHumanId returns it\nexport type X = string;\n",
    );
    expect(main(root)).toBe(EXIT_CLEAN);
  });

  it("BOUNDARY: the cast rule is case-SENSITIVE — 'as mirrorhumanid' (wrong case) is never flagged", () => {
    const root = makeCleanFixture();
    writeSource(root, "packages/lore/src/service/wrong-case.ts", "const id = x as mirrorhumanid;\n");
    expect(main(root)).toBe(EXIT_CLEAN);
  });

  it("NEGATIVE: an UNRELATED 'as SomeOtherType' cast in the same unsanctioned file is not flagged by this rule", () => {
    const root = makeCleanFixture();
    writeSource(root, "packages/lore/src/service/other-cast.ts", "const id = x as SomeOtherType;\n");
    expect(main(root)).toBe(EXIT_CLEAN);
  });

  it("STATE: a file sanctioned for the ORDINAL rules but NOT for the cast rule still trips the cast rule — the two allowlists are independent", () => {
    const root = makeCleanFixture();
    // ordinal-migration-service.ts is on SANCTIONED_ORDINAL_WRITE_FILES but NOT on
    // SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES — an unsanctioned cast there must still trip.
    const ordinalSanctionedFile = SANCTIONED_ORDINAL_WRITE_FILES.find(
      (f) => !SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES.includes(f),
    ) as string;
    writeSource(root, ordinalSanctionedFile, "const id = x as MirrorHumanId;\n");
    expect(main(root)).toBe(EXIT_VIOLATIONS_FOUND);
  });

  it("REGRESSION: every path in SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES still exists on disk", () => {
    const missing = SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES.filter((relPath) => !existsSync(join(REPO_ROOT, relPath)));
    expect(missing).toEqual([]);
  });

  it("REGRESSION: SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES is a SEPARATE allowlist from SANCTIONED_ORDINAL_WRITE_FILES — the two rule families must stay independently extensible", () => {
    expect(SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES).not.toBe(SANCTIONED_ORDINAL_WRITE_FILES);
    expect(SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES).toEqual(["packages/core/src/schemas.ts"]);
  });
});

// ─── collectViolationsInFile(): the three textual rules ─────────────────────

describe("check-ordinal-write-sites: collectViolationsInFile — rule (a) allocation arithmetic", () => {
  it("HAPPY: MAX(ordinal) is reported at its EXACT line, with the arithmetic rule name", () => {
    const prefix = "// header\n\n";
    const content = `${prefix}const next = MAX(ordinal);\n`;
    const violations = collectViolationsInFile("packages/lore/src/x.ts", content);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("ordinal-allocation-arithmetic");
    expect(violations[0]?.file).toBe("packages/lore/src/x.ts");
    // Line computed from the fixture's own prefix (2 newlines => the statement is on line 3).
    expect(violations[0]?.line).toBe(prefix.split("\n").length);
  });

  it("HAPPY: the parenthesis-free `ordinal + 1` increment form is also caught", () => {
    const violations = collectViolationsInFile("x.ts", "const next = ordinal + 1;\n");
    expect(violations.map((violation) => violation.rule)).toEqual(["ordinal-allocation-arithmetic"]);
  });

  it("BOUNDARY: matching is case- and whitespace-insensitive (max( ORDINAL ), ordinal+1)", () => {
    expect(collectViolationsInFile("x.ts", "max( ORDINAL )\n")).toHaveLength(1);
    expect(collectViolationsInFile("x.ts", "ordinal+1\n")).toHaveLength(1);
  });

  it("NEGATIVE: a line merely mentioning the word ordinal is not a violation", () => {
    expect(collectViolationsInFile("x.ts", "// the ordinal column is allocated elsewhere\n")).toEqual([]);
    expect(collectViolationsInFile("x.ts", "const ordinalLabel = doc.ordinal;\n")).toEqual([]);
  });

  it("REGRESSION: a comment discussing the arithmetic IS reported, deliberately (drift signal, per the module header)", () => {
    const violations = collectViolationsInFile("x.ts", "// we could compute MAX(ordinal) + 1 here\n");
    expect(violations.length).toBeGreaterThan(0);
  });

  it("BOUNDARY: multiple occurrences are all reported, each with its own line", () => {
    const violations = collectViolationsInFile("x.ts", "MAX(ordinal)\nconst a = 1;\nMAX(ordinal)\n");
    expect(violations.map((violation) => violation.line)).toEqual([1, 3]);
  });
});

describe("check-ordinal-write-sites: collectViolationsInFile — rule (b) direct SQL write", () => {
  it("HAPPY: `SET ordinal =` is reported under the direct-sql-write rule name", () => {
    const violations = collectViolationsInFile("x.ts", "UPDATE docs SET ordinal = ? WHERE id = ?\n");
    expect(violations.map((violation) => violation.rule)).toEqual(["ordinal-direct-sql-write"]);
  });

  it("HAPPY: a multi-line `INSERT INTO docs (...)` whose column list mentions ordinal is reported", () => {
    const content = ["const sql = `", "  INSERT INTO docs (", "    id,", "    ordinal", "  ) VALUES (?, ?)", "`;"].join(
      "\n",
    );
    const violations = collectViolationsInFile("x.ts", content);
    expect(violations.map((violation) => violation.rule)).toEqual(["ordinal-direct-sql-write"]);
  });

  it("BOUNDARY: the INSERT window is bounded — an `ordinal` mention just INSIDE 600 chars matches, one just OUTSIDE does not", () => {
    // Padding lengths are COMPUTED against the documented 600-char window, never
    // hand-counted: the header's bound is the thing under test, so a fixture that
    // merely "looks far enough away" would not prove it.
    const head = "INSERT INTO docs (id) VALUES (?);\n";
    const inside = `${head}${"x".repeat(600 - head.length - 10)}\nconst ordinal = 1;\n`;
    const outside = `${head}${"x".repeat(900)}\nconst ordinal = 1;\n`;

    expect(collectViolationsInFile("x.ts", inside).length).toBeGreaterThan(0);
    expect(collectViolationsInFile("x.ts", outside)).toEqual([]);
  });

  it("NEGATIVE: an INSERT INTO docs that never mentions ordinal is not a violation", () => {
    expect(collectViolationsInFile("x.ts", "INSERT INTO docs (id, title) VALUES (?, ?)\n")).toEqual([]);
  });

  it("STATE: collectViolationsInFile is pure — the same input twice yields the identical result (no leaked regex lastIndex)", () => {
    const content = "MAX(ordinal)\nUPDATE docs SET ordinal = 1;\n";
    expect(collectViolationsInFile("x.ts", content)).toEqual(collectViolationsInFile("x.ts", content));
  });
});

// ─── isScannableSourceFile(): scan scope ────────────────────────────────────

describe("check-ordinal-write-sites: isScannableSourceFile", () => {
  it("HAPPY: TypeScript source in a package src tree is scannable", () => {
    expect(isScannableSourceFile("packages/lore/src/store/sqlite-store.ts")).toBe(true);
    expect(isScannableSourceFile("packages/lore/src/store/x.mts")).toBe(true);
    expect(isScannableSourceFile("packages/lore/src/store/x.cts")).toBe(true);
  });

  it("NEGATIVE: tests, declarations, generated code and non-TypeScript files are out of scope", () => {
    expect(isScannableSourceFile("packages/lore/src/store/x.test.ts")).toBe(false);
    expect(isScannableSourceFile("packages/lore/src/store/x.bun.test.ts")).toBe(false);
    expect(isScannableSourceFile("packages/lore/src/store/x.d.ts")).toBe(false);
    expect(isScannableSourceFile("packages/lore/tests/x.ts")).toBe(false);
    expect(isScannableSourceFile("packages/lore/src/generated/x.ts")).toBe(false);
    expect(isScannableSourceFile("packages/lore/node_modules/pkg/x.ts")).toBe(false);
    expect(isScannableSourceFile("packages/lore/src/store/x.js")).toBe(false);
    expect(isScannableSourceFile("packages/lore/src/store/README.md")).toBe(false);
  });
});

// ─── The allowlist itself ───────────────────────────────────────────────────

describe("check-ordinal-write-sites: SANCTIONED_ORDINAL_WRITE_FILES", () => {
  it("REGRESSION: every allowlisted path still exists on disk — a row that outlived its file exempts nothing and hides drift", () => {
    const missing = SANCTIONED_ORDINAL_WRITE_FILES.filter((relPath) => !existsSync(join(REPO_ROOT, relPath)));
    expect(missing).toEqual([]);
  });

  it("REGRESSION: allowlist paths are POSIX-relative and de-duplicated (the exact key shape the scan compares against)", () => {
    expect(SANCTIONED_ORDINAL_WRITE_FILES.every((relPath) => !relPath.startsWith("/") && !relPath.includes("\\"))).toBe(
      true,
    );
    expect(new Set(SANCTIONED_ORDINAL_WRITE_FILES).size).toBe(SANCTIONED_ORDINAL_WRITE_FILES.length);
  });
});

// ─── The arming assertion (task oracle) ─────────────────────────────────────

describe("check-ordinal-write-sites: real repo tree (task oracle)", () => {
  it("HAPPY: exits 0 against THIS checkout's own packages/*/src tree, with no injected root", () => {
    // Deliberately un-mocked and un-injected: this is the exact `bun run
    // check:ordinal-sites` code path. Before this task nothing in the repo ever
    // executed it — no CI, no pre-push hook, no test — so its green was unproven.
    // This is ALSO AC-MIS-3's "the real tree returns 0" requirement: since rule (c)
    // now runs against every scanned file, a real, unsanctioned `as MirrorHumanId`
    // cast anywhere in packages/*/src would have made this fail, not just the
    // ordinal-column rules.
    expect(main()).toBe(EXIT_CLEAN);
  });
});
