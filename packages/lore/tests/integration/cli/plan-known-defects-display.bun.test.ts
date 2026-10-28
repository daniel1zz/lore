// @reads assets/project/lore-config-template.yaml
// @spawns packages/lore/src/index.ts
// @reads packages
/**
 * @spec_ref spec-a-plan-s-known-defects-are-its-own-record-of-github-issues (AC-KD-5, BR-1421)
 *
 * `lore get <plan>` prints a Known defects section (issue, dimension, live state read by number), and archiving the
 * plan closes none of those issues: they are not `extra.issues`.
 *
 * Oracle: the real command tree (`runLoreInProcess`) over a throwaway corpus (`mkdtemp` + `lore init`, clean git tree)
 * and a STUB `gh` first on PATH serving one fake repository; every argv is logged; anything unrecognised exits 99.
 * The known-defect record is written into the throwaway db directly (no CLI verb writes it: filing does, through the
 * review batch, which needs a judge).
 *
 * Coverage dimensions:
 *   HAPPY       an open (#50/regression) and a closed (#51/security) entry are both listed with dimension and live state
 *   NEGATIVE    archiving the plan makes no close, comment or label write; --json carries the live state too
 *   ERROR       an issue the read cannot find prints `unknown (...)`, never `open`
 *   REGRESSION  the same issues carried as extra.issues ARE closed on archive (the falsifier)
 */
import { afterAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../../helpers/clean-tree-repo";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

import { ensureRequirementsDocSlugAsync } from "../../helpers/parented-create.js";
const FAKE_REPO = "acme/widget";
const REPO_ID = 4242;
const FP = "9".repeat(64);

interface Corpus {
  readonly dir: string;
  readonly stubDir: string;
}

const dirsToClean: string[] = [];
afterAll(() => {
  for (const dir of dirsToClean) rmSync(dir, { recursive: true, force: true });
});

/** The stub `gh`: per-issue state in `state-<n>`; an issue with no state file is a 404; PATCH closes. */
function writeStubGh(stubDir: string): void {
  const script = `#!/bin/sh
D="${stubDir}"
echo "$*" >> "$D/gh.log"
if [ "$1" != "api" ]; then echo "stub gh: unexpected call: $*" >&2; exit 99; fi
path="$2"
method=GET
prev=""
for a in "$@"; do
  if [ "$prev" = "-X" ]; then method="$a"; fi
  prev="$a"
done
if [ "$path" = "user" ]; then printf '%s\\n' '{"login":"stub-user"}'; exit 0; fi
if [ "$path" = "repos/${FAKE_REPO}" ]; then printf '%s\\n' '{"id":${REPO_ID},"name":"widget"}'; exit 0; fi
case "$path" in
  "repos/${FAKE_REPO}/issues?"*) cat "$D/listing.json"; exit 0 ;;
esac
n=$(printf '%s' "$path" | sed -E 's#^repos/${FAKE_REPO}/issues/([0-9]+).*#\\1#')
case "$path" in
  "repos/${FAKE_REPO}/issues/$n")
    if [ ! -f "$D/state-$n" ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
    if [ "$method" = "PATCH" ]; then printf 'closed' > "$D/state-$n"; printf '%s\\n' '{}'; exit 0; fi
    printf '{"number":%s,"state":"%s","state_reason":null,"labels":[]}\\n' "$n" "$(cat "$D/state-$n")"
    exit 0 ;;
  "repos/${FAKE_REPO}/issues/$n/comments") printf '%s\\n' '{}'; exit 0 ;;
  "repos/${FAKE_REPO}/issues/$n/labels") printf '%s\\n' '[]'; exit 0 ;;
esac
echo "stub gh: unrecognised api path: $path" >&2
exit 99
`;
  const ghPath = join(stubDir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
}

function seedStub(stubDir: string, states: Record<number, "open" | "closed">): void {
  writeFileSync(
    join(stubDir, "listing.json"),
    JSON.stringify(Object.entries(states).filter(([, s]) => s === "open").map(([n]) => ({ number: Number(n), title: `Issue ${n}`, state: "open", body: "", labels: [], state_reason: null }))),
  );
  for (const [n, state] of Object.entries(states)) writeFileSync(join(stubDir, `state-${n}`), state);
}

async function runLore(corpus: Corpus, args: string[]) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(CLAUDE|LORE|ANTHROPIC)/.test(key)) continue;
    env[key] = value;
  }
  const proc = await runLoreInProcess(args, {
    cwd: corpus.dir,
    home: FIXTURE_HOME_OUTSIDE_REPO,
    env: { ...env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDE_CODE_SESSION_ID: "kd5", EDITOR: "true", PATH: `${corpus.stubDir}:${process.env["PATH"] ?? ""}` },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

async function mustRun(corpus: Corpus, args: string[]) {
  const result = await runLore(corpus, args);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}${result.stdout}`);
  return result;
}

function ghLog(corpus: Corpus): string[] {
  const path = join(corpus.stubDir, "gh.log");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line !== "") : [];
}

/** The gh calls that write (PATCH, POST, DELETE), oldest first. */
function writes(corpus: Corpus): string[] {
  return ghLog(corpus).filter((line) => /-X (PATCH|POST|DELETE)/.test(line));
}

/** A corpus with a plan whose record names `entries`; `asCarrier` writes them as `extra.issues` instead (the falsifier). */
async function makeCorpus(states: Record<number, "open" | "closed">, asCarrier = false): Promise<Corpus & { plan: string }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-kd5-corpus-")));
  const stubDir = mkdtempSync(join(tmpdir(), "lore-kd5-stub-"));
  dirsToClean.push(dir, stubDir);
  writeStubGh(stubDir);
  seedStub(stubDir, states);
  const corpus: Corpus = { dir, stubDir };
  makeCleanTreeRepo(dir);
  await mustRun(corpus, ["init"]);
  patchLoreConfig(
    dir,
    ["workflow:", "  gates:", "    plan-promote:", "      enabled: false", "    plan-close:", "      enabled: false", "  review:", "    judgment_required_types: []", "feedback:", "  upstream:", `    repo: ${FAKE_REPO}`, ""].join("\n"),
  );
  await mustRun(corpus, ["create", "prd", "--title", "Kd5 PRD", "--no-ai", "--content", "## Overview\n\nBody.", "--json"]);
  const created = JSON.parse((await mustRun(corpus, ["create", "plan", "--parent", await ensureRequirementsDocSlugAsync((a) => mustRun(corpus, a)), "--title", "Kd5 plan", "--no-ai", "--content", "Plan body.", "--json"])).stdout) as { data: { slug: string; id: string } };
  const db = new Database(join(dir, ".lore", "lore.db"));
  try {
    const row = db.query("SELECT extra FROM docs WHERE id = ?").get(created.data.id) as { extra: string };
    const extra = JSON.parse(row.extra) as Record<string, unknown>;
    const entries = [
      { repo_id: REPO_ID, number: 50, dimension: "regression", fingerprint: FP },
      { repo_id: REPO_ID, number: 51, dimension: "security", fingerprint: FP },
    ];
    if (asCarrier) extra["issues"] = entries.map(({ repo_id, number }) => ({ repo_id, number }));
    else extra["known_defects"] = entries;
    db.prepare("UPDATE docs SET extra = ? WHERE id = ?").run(JSON.stringify(extra), created.data.id);
  } finally {
    db.close();
  }
  return { ...corpus, plan: created.data.slug };
}

async function archive(corpus: Corpus, plan: string): Promise<void> {
  await mustRun(corpus, ["set", plan, "--status", "approved"]);
  await mustRun(corpus, ["set", plan, "--status", "active"]);
  await mustRun(corpus, ["set", plan, "--status", "archived"]);
}

describe("AC-KD-5 known defects shown on the plan and never closed by its archive", () => {
  it("lore get <plan> lists both entries with their dimension and live state", async () => {
    const corpus = await makeCorpus({ 50: "open", 51: "closed" });
    const shown = await mustRun(corpus, ["get", corpus.plan]);
    expect(shown.stdout).toContain("Known defects:");
    expect(shown.stdout).toMatch(/#50\s+regression\s+open/);
    expect(shown.stdout).toMatch(/#51\s+security\s+closed/);
    // the structured-extra loss notice does not claim the record was withheld
    expect(shown.stdout).not.toMatch(/known_defects\s+array/);
    const json = JSON.parse((await mustRun(corpus, ["get", corpus.plan, "--json"])).stdout) as { data: { known_defects_live: { number: number; dimension: string; state: string }[] } };
    expect(json.data.known_defects_live).toEqual([
      { number: 50, dimension: "regression", state: "open" },
      { number: 51, dimension: "security", state: "closed" },
    ]);
    expect(writes(corpus)).toEqual([]);
  }, 180_000);

  it("archiving that plan closes neither issue: the stub log holds no close call", async () => {
    const corpus = await makeCorpus({ 50: "open", 51: "closed" });
    await archive(corpus, corpus.plan);
    const status = (JSON.parse((await mustRun(corpus, ["get", corpus.plan, "--json"])).stdout) as { data: { doc: { status: string } } }).data.doc.status;
    expect(status).toBe("archived");
    expect(writes(corpus)).toEqual([]);
    expect(ghLog(corpus).filter((line) => line.includes("state=closed"))).toEqual([]);
    expect(readFileSync(join(corpus.stubDir, "state-50"), "utf8")).toBe("open");
  }, 180_000);

  it("an issue whose read fails prints unknown with the reason, never open", async () => {
    const corpus = await makeCorpus({ 50: "open" }); // #51 has no state file: the stub answers 404
    const shown = await mustRun(corpus, ["get", corpus.plan]);
    expect(shown.stdout).toMatch(/#50\s+regression\s+open/);
    expect(shown.stdout).toMatch(/#51\s+security\s+unknown \(/);
  }, 180_000);

  it("falsifier: the same issues carried as extra.issues ARE closed by the archive", async () => {
    const corpus = await makeCorpus({ 50: "open", 51: "open" }, true);
    await archive(corpus, corpus.plan);
    expect(writes(corpus).some((line) => line.includes("issues/50 -X PATCH"))).toBe(true);
  }, 180_000);
});
