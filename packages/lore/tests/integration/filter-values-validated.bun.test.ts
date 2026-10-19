// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/adapters/cli/commands/*.ts
/** @spec_ref AC-DCL-2 */
/**
 * AC-DCL-2: filter values are validated by ONE shared validator
 * (`src/adapters/cli/filter-values.ts`), so an unknown value never silently
 * yields an empty result.
 *
 * Drives the REAL CLI from source (`bun run src/index.ts`) against a throwaway
 * corpus (`mkdtemp` + `lore init`; HOME and cwd both inside it). Never touches
 * the repo's own `.lore/`.
 *
 * Dimensions:
 *   NEGATIVE:   unknown enum value -> exit 4 naming the accepted values; unreadable
 *               date -> exit 4 naming the accepted format; `status --fix` alone and
 *               `review <doc> --pending` -> exit 4 naming the flags
 *   HAPPY:      a valid value still lists the matching doc (exit 0)
 *   BOUNDARY:   date-only and full date-time forms are both accepted
 *   REGRESSION: the exact `--since yesterday` / unknown `--type` inputs from the bound reports
 *   STATE:      a scan shows no command parses these options itself
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const COMMANDS_DIR = join(PACKAGE_ROOT, "src", "adapters", "cli", "commands");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let corpusDir: string;

function runLore(args: string[]): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: corpusDir,
    env: { ...process.env, HOME: corpusDir, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

const DOC_TITLE = "Filter Values Probe Doc";

beforeAll(() => {
  corpusDir = mkdtempSync(join(tmpdir(), "lore-filter-values-"));
  const init = runLore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  const created = runLore(["create", "prd", "--title", DOC_TITLE, "--no-ai", "--content", "body"]);
  if (created.exitCode !== 0) throw new Error(`create prd failed: ${created.stderr}`);
}, 120_000);

afterAll(() => {
  rmSync(corpusDir, { recursive: true, force: true });
});

interface RefusalCase {
  readonly name: string;
  readonly args: string[];
  /** Substrings the stderr must carry. */
  readonly names: string[];
}

const ACCEPTED_TYPES = "prd";
const DATE_FORMAT = "ISO 8601";

const REFUSALS: RefusalCase[] = [
  { name: "pending --type", args: ["pending", "--type", "bogus"], names: ["--type", "bogus", ACCEPTED_TYPES, "spec"] },
  { name: "pending --since", args: ["pending", "--since", "yesterday"], names: ["--since", "yesterday", DATE_FORMAT] },
  { name: "list --type", args: ["list", "--type", "bogus"], names: ["--type", "bogus", ACCEPTED_TYPES, "spec"] },
  { name: "list --status", args: ["list", "--status", "bogus"], names: ["--status", "bogus", "draft", "archived"] },
  { name: "list --since", args: ["list", "--since", "last week"], names: ["--since", DATE_FORMAT] },
  { name: "calibration --doc-type", args: ["calibration", "--stats", "--doc-type", "bogus"], names: ["--doc-type", "bogus", ACCEPTED_TYPES, "spec"] },
  { name: "audit --since", args: ["audit", "--since", "yesterday"], names: ["--since", DATE_FORMAT] },
  { name: "audit --verify --since", args: ["audit", "--verify", "--since", "yesterday"], names: ["--since", DATE_FORMAT] },
  { name: "trace stats --since", args: ["trace", "stats", "--since", "yesterday"], names: ["--since", DATE_FORMAT] },
  { name: "status --fix without --check-tree", args: ["status", "--fix"], names: ["--check-tree"] },
  { name: "review <doc> --pending", args: ["review", "some-doc", "--pending"], names: ["--pending", "<doc>"] },
];

describe("AC-DCL-2 refusals", () => {
  it.each(REFUSALS)("AC-DCL-2 refuses $name with exit 4 naming the accepted input", ({ args, names }) => {
    const r = runLore(args);
    expect(r.exitCode, r.stderr).toBe(4);
    for (const needle of names) expect(r.stderr).toContain(needle);
  }, 90_000);
});

describe("AC-DCL-2 valid values behave as before", () => {
  it("AC-DCL-2 pending --type prd --since <date> lists the matching draft", () => {
    const r = runLore(["pending", "--type", "prd", "--since", "2000-01-01"]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain(DOC_TITLE);
  }, 90_000);

  it("AC-DCL-2 list --type prd --status draft --since <date-time> lists the matching doc", () => {
    const r = runLore(["list", "--type", "prd", "--status", "draft", "--since", "2000-01-01T00:00:00.000Z"]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain(DOC_TITLE);
  }, 90_000);

  it("AC-DCL-2 a valid but non-matching type still lists nothing with exit 0", () => {
    const r = runLore(["list", "--type", "adr"]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).not.toContain(DOC_TITLE);
  }, 90_000);

  it("AC-DCL-2 calibration --stats --doc-type prd exits 0", () => {
    const r = runLore(["calibration", "--stats", "--doc-type", "prd"]);
    expect(r.exitCode, r.stderr).toBe(0);
  }, 90_000);

  it("AC-DCL-2 audit --since <date> returns the create entry", () => {
    const r = runLore(["audit", "--since", "2000-01-01"]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("create");
  }, 90_000);

  it("AC-DCL-2 trace stats --since <date> exits 0", () => {
    const r = runLore(["trace", "stats", "--since", "2000-01-01"]);
    expect(r.exitCode, r.stderr).toBe(0);
  }, 90_000);

  it("AC-DCL-2 status --fix --check-tree is not refused by the flag rule", () => {
    const r = runLore(["status", "--check-tree", "--fix"]);
    expect(r.stderr).not.toContain("--fix requires --check-tree");
  }, 90_000);
});

describe("AC-DCL-2 scan: one shared validator", () => {
  const EXPECTED: Record<string, string[]> = {
    "pending.ts": ["parseDocTypeFilter", "parseSinceFilter"],
    "list.ts": ["parseDocTypeFilter", "parseDocStatusFilter", "parseSinceFilter"],
    "calibration.ts": ["parseDocTypeFilter"],
    "audit.ts": ["parseSinceFilter"],
    "trace.ts": ["parseSinceFilter"],
    "status.ts": ["requireCheckTreeForFix"],
    "review.ts": ["refuseDocWithPending"],
  };
  // Patterns that mean a command parses/casts these values itself.
  const OWN_PARSING: RegExp[] = [
    /args\.type as /,
    /args\.status as /,
    /args\["doc-type"\] as /,
    /docTypeSchema/,
    /docStatusSchema/,
    /Date\.parse\(/,
    /new Date\(args/,
  ];

  for (const [file, validators] of Object.entries(EXPECTED)) {
    it(`AC-DCL-2 ${file} calls ${validators.join(", ")} from filter-values and parses nothing itself`, () => {
      const source = readFileSync(join(COMMANDS_DIR, file), "utf8");
      expect(source).toContain('from "../filter-values.js"');
      for (const validator of validators) expect(source).toMatch(new RegExp(`${validator}\\(`));
      for (const pattern of OWN_PARSING) expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
    });
  }
});
