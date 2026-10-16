/**
 * Unit suite for `scripts/check-prose-pins.ts`
 * (`spec-test-governance-guards-that-refuse-bad-tests-declared` AC-TG-4).
 *
 * Pure `scanFile`/`checkLedger`/`parseLedgerFile` cases run against injected
 * text; the `main()` cases run a real scan over a throwaway mkdtemp tree and
 * over this checkout (exit 0 on the real tree); the hook cases pin the
 * pre-push wiring.
 *
 * Coverage: HAPPY (pin found with file:line; clean fixture exits 0; ledger
 * covers a pin), NEGATIVE (`.not.` and imported constants not flagged; ledger
 * row with empty consumer/reason rejected), BOUNDARY (4 words vs 5 words;
 * heading literal), ERROR (stale ledger row fails; bad JSON throws), STATE
 * (scan idempotent), REGRESSION (regex literal, wrapped prose, mirror docs not
 * governing).
 *
 * @spec_ref spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-4
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ProsePinLedgerError,
  checkLedger,
  main,
  normalizeText,
  parseLedgerFile,
  scanFile,
} from "../check-prose-pins";

const PROSE = normalizeText("Never resume from a handoff pointer.\nThe stub IS an index entry, always.");
const READER = `import { readFileSync } from "node:fs";\nconst c = readFileSync("assets/x.md", "utf8");\n`;

describe("scanFile", () => {
  it("HAPPY: flags a positive toContain of 5+ prose words with its line", () => {
    const src = `${READER}expect(c).toContain("The stub IS an index entry");\n`;
    const pins = scanFile("t.test.ts", src, PROSE);
    expect(pins).toEqual([{ path: "t.test.ts", line: 3, literal: "The stub IS an index entry" }]);
  });

  it("HAPPY: flags a toMatch regex literal and an includes() call", () => {
    const src = `${READER}expect(c).toMatch(/Never resume from a handoff pointer/);\nc.includes('The stub IS an index entry');\n`;
    expect(scanFile("t.test.ts", src, PROSE).map((p) => p.line)).toEqual([3, 4]);
  });

  it("NEGATIVE: a .not. assertion is not a pin", () => {
    const src = `${READER}expect(c).not.toContain("The stub IS an index entry");\n`;
    expect(scanFile("t.test.ts", src, PROSE)).toEqual([]);
  });

  it("NEGATIVE: an imported constant argument is not a pin", () => {
    const src = `${READER}expect(c).toContain(STUB_TEXT);\n`;
    expect(scanFile("t.test.ts", src, PROSE)).toEqual([]);
  });

  it("NEGATIVE: a file that never names a prose location is out of scope", () => {
    const src = `expect(c).toContain("The stub IS an index entry");\n`;
    expect(scanFile("t.test.ts", src, PROSE)).toEqual([]);
  });

  it("NEGATIVE: a long literal absent from the prose corpus is not a pin", () => {
    const src = `${READER}expect(c).toContain("some entirely unrelated runtime sentence here");\n`;
    expect(scanFile("t.test.ts", src, PROSE)).toEqual([]);
  });

  it("BOUNDARY: 4 words pass, 5 words fail", () => {
    expect(scanFile("t.test.ts", `${READER}expect(c).toContain("stub IS an index");\n`, PROSE)).toEqual([]);
    expect(scanFile("t.test.ts", `${READER}expect(c).toContain("The stub IS an index");\n`, PROSE)).toHaveLength(1);
  });

  it("BOUNDARY: a heading literal locates a section and is not a pin", () => {
    const prose = normalizeText("## Target vs Ceiling — read this first");
    const src = `${READER}expect(c).toContain("## Target vs Ceiling — read this first");\n`;
    expect(scanFile("t.test.ts", src, prose)).toEqual([]);
  });

  it("REGRESSION: a literal that wraps across lines in the prose still matches", () => {
    const src = `${READER}expect(c).toContain("Never resume from a handoff pointer");\n`;
    expect(scanFile("t.test.ts", src, normalizeText("Never resume from a\n  handoff pointer"))).toHaveLength(1);
  });

  it("STATE: scanning twice gives the same answer", () => {
    const src = `${READER}expect(c).toContain("The stub IS an index entry");\n`;
    expect(scanFile("t.test.ts", src, PROSE)).toEqual(scanFile("t.test.ts", src, PROSE));
  });
});

describe("checkLedger / parseLedgerFile", () => {
  const pin = { path: "a.test.ts", line: 3, literal: "five words are in here" };
  const row = { file: "a.test.ts", literal_fingerprint: "five words are in here", consumer: "agents", reason: "contract" };

  it("HAPPY: a ledger row naming file and literal covers the pin", () => {
    expect(checkLedger([pin], [row])).toEqual({ unledgered: [], stale: [] });
  });

  it("NEGATIVE: a pin without a row is unledgered", () => {
    expect(checkLedger([pin], []).unledgered).toEqual([pin]);
  });

  it("ERROR: a row whose pin is gone is stale", () => {
    expect(checkLedger([], [row]).stale).toEqual([row]);
  });

  it("NEGATIVE: a row for another file does not cover the pin", () => {
    const check = checkLedger([pin], [{ ...row, file: "b.test.ts" }]);
    expect(check.unledgered).toHaveLength(1);
    expect(check.stale).toHaveLength(1);
  });

  it("NEGATIVE: empty consumer or empty reason is rejected", () => {
    for (const bad of [{ ...row, consumer: "" }, { ...row, reason: "" }]) {
      expect(() => parseLedgerFile(JSON.stringify({ entries: [bad] }))).toThrow(ProsePinLedgerError);
    }
  });

  it("ERROR: invalid JSON throws a typed error", () => {
    expect(() => parseLedgerFile("{nope")).toThrow(ProsePinLedgerError);
  });

  it("HAPPY: a valid ledger parses", () => {
    expect(parseLedgerFile(JSON.stringify({ entries: [row] }))).toEqual([row]);
  });
});

describe("main over a fixture tree", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "prose-pins-"));
    dirs.push(root);
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    return root;
  }

  const testSrc = (lit: string) =>
    `import { readFileSync } from "node:fs";\nreadFileSync("assets/p.md");\nexpect(c).toContain("${lit}");\n`;

  it("HAPPY: exits 1 and prints file:line for a pin, exits 0 on a clean fixture", () => {
    const pinned = fixture({
      "assets/p.md": "The stub IS an index entry.\n",
      "scripts/prose-pin-ledger.json": '{"entries":[]}',
      "scripts/tests/a.test.ts": testSrc("The stub IS an index entry"),
    });
    const lines: string[] = [];
    const orig = console.error;
    console.error = (m: string) => void lines.push(m);
    try {
      expect(main(pinned)).toBe(1);
    } finally {
      console.error = orig;
    }
    expect(lines[0]).toContain("scripts/tests/a.test.ts:3");

    const clean = fixture({
      "assets/p.md": "The stub IS an index entry.\n",
      "scripts/prose-pin-ledger.json": '{"entries":[]}',
      "scripts/tests/a.test.ts": testSrc("stub IS"),
    });
    expect(main(clean)).toBe(0);
  });

  it("HAPPY: a ledgered pin exits 0, and its row going stale exits 1", () => {
    const row = {
      file: "scripts/tests/a.test.ts",
      literal_fingerprint: "The stub IS an index entry",
      consumer: "agents",
      reason: "contract",
    };
    const root = fixture({
      "assets/p.md": "The stub IS an index entry.\n",
      "scripts/prose-pin-ledger.json": JSON.stringify({ entries: [row] }),
      "scripts/tests/a.test.ts": testSrc("The stub IS an index entry"),
    });
    expect(main(root)).toBe(0);
    writeFileSync(join(root, "scripts/tests/a.test.ts"), testSrc("stub IS"));
    expect(main(root)).toBe(1);
  });

  it("REGRESSION: docs/requirements (the corpus mirror) is not governing prose", () => {
    const root = fixture({
      "docs/requirements/m.md": "The stub IS an index entry.\n",
      "scripts/prose-pin-ledger.json": '{"entries":[]}',
      "scripts/tests/a.test.ts": testSrc("The stub IS an index entry"),
    });
    expect(main(root)).toBe(0);
  });

  it("ERROR: a missing ledger file exits 2, not 0", () => {
    const root = fixture({ "scripts/tests/a.test.ts": testSrc("stub IS") });
    const orig = console.error;
    console.error = () => undefined;
    try {
      expect(main(root)).toBe(2);
    } finally {
      console.error = orig;
    }
  });
});

describe("real tree and wiring", () => {
  const repo = join(__dirname, "..", "..");

  it("HAPPY: exits 0 on this checkout with the checked-in ledger", () => {
    expect(main(repo)).toBe(0);
  });

  it("HAPPY: package.json test chain runs it next to check:ac-state-renderers", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["check:prose-pins"]).toBe("bun scripts/check-prose-pins.ts");
    expect(pkg.scripts.test).toContain("check:ac-state-renderers && bun run check:prose-pins");
  });

  it("HAPPY: hooks/pre-push and assets/project/pre-push both run it, byte-identical", () => {
    const hook = readFileSync(join(repo, "hooks/pre-push"), "utf8");
    expect(hook).toContain("check-prose-pins.ts");
    expect(readFileSync(join(repo, "assets/project/pre-push"), "utf8")).toBe(hook);
  });
});
