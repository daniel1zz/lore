// @spawns packages/lore/src/index.ts
/**
 * AC-CRIT-6 — `lore list` reports how many invalidated docs the
 * default validity filter hid (`omitted_invalid`), instead of hiding them silently.
 *
 * CLI runs in SOURCE mode against a THROWAWAY corpus (`mkdtemp` + `lore init`) — never
 * the repo's own `.lore/`.
 *
 *   HAPPY:      default list -> total 1, omitted_invalid 1, text footer "1 invalidated hidden"
 *   BOUNDARY:   --include-invalid -> total 2, omitted_invalid 0, no footer note
 *   NEGATIVE:   a type with nothing invalidated -> omitted_invalid 0, no footer note
 *   REGRESSION: BR-745 — the invalidated doc stays excluded from the default rows
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

function runLore(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function runOrThrow(args: string[], dir: string, label: string): string {
  const r = runLore(args, dir);
  if (r.exitCode !== 0) throw new Error(`${label} failed (exit ${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

const slugOf = (stdout: string): string => (JSON.parse(stdout) as { data: { slug: string } }).data.slug;

const tmpDir = mkdtempSync(join(tmpdir(), "lore-list-omitted-invalid-"));
runOrThrow(["init"], tmpDir, "lore init");
patchLoreConfig(
  tmpDir,
  ["workflow:", "  gates:", "    spec-create:", "      enabled: false", ""].join("\n"),
);
const prd = slugOf(
  runOrThrow(
    ["create", "prd", "--title", "Omitted Root", "--no-ai", "--content", "## Overview\n\nBody.", "--json"],
    tmpDir,
    "prd",
  ),
);
function createKnowledge(title: string): string {
  return slugOf(
    runOrThrow(
      [
        "create", "knowledge", "--title", title, "--sub-type", "reference", "--parent", prd,
        "--no-ai", "--content", "## Fact\n\nBody.", "--json",
      ],
      tmpDir,
      `create ${title}`,
    ),
  );
}
const liveSlug = createKnowledge("Live Fact Alpha");
const deadSlug = createKnowledge("Dead Fact Beta");
runOrThrow(["invalidate", deadSlug, "--reason", "retracted for test", "--json"], tmpDir, "invalidate");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

interface ListJson {
  ok: boolean;
  data: { docs: Array<{ slug: string }>; total: number; omitted_invalid: number };
}
const listJson = (extra: string[]): ListJson =>
  JSON.parse(runOrThrow(["list", "--type", "knowledge", "--json", ...extra], tmpDir, "list")) as ListJson;

describe("AC-CRIT-6: lore list reports omitted_invalid (CLI)", () => {
  it("AC-CRIT-6 default JSON: total=1, omitted_invalid=1, invalidated doc excluded (BR-745)", () => {
    const out = listJson([]);
    expect(out.data.total).toBe(1);
    expect(out.data.omitted_invalid).toBe(1);
    const slugs = out.data.docs.map((d) => d.slug);
    expect(slugs).toContain(liveSlug);
    expect(slugs).not.toContain(deadSlug);
  });

  it("AC-CRIT-6 default text footer says '1 invalidated hidden'", () => {
    const r = runLore(["list", "--type", "knowledge"], tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("1 invalidated hidden");
    expect(r.stdout).toContain("--include-invalid");
  });

  it("AC-CRIT-6 --include-invalid: total=2, omitted_invalid=0, no hidden note", () => {
    const out = listJson(["--include-invalid"]);
    expect(out.data.total).toBe(2);
    expect(out.data.omitted_invalid).toBe(0);
    const r = runLore(["list", "--type", "knowledge", "--include-invalid"], tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("invalidated hidden");
  });

  it("AC-CRIT-6 nothing invalidated: omitted_invalid=0 and no footer note", () => {
    const out = JSON.parse(runOrThrow(["list", "--type", "prd", "--json"], tmpDir, "list prd")) as ListJson;
    expect(out.data.omitted_invalid).toBe(0);
    const r = runLore(["list", "--type", "prd"], tmpDir);
    expect(r.stdout).not.toContain("invalidated hidden");
  });
});
