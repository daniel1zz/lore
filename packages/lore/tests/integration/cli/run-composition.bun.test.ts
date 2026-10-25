// @spawns packages/lore/src/index.ts
// @reads assets/context/agent-rules.md
// @reads assets/context/ask-then-execute.md
// @reads assets/context/evidence-attestation.md
/**
 * @spec_ref AC-RID-2
 *
 * RED (TDD role) for the run composition record — spec
 * spec-run-identity-slice-1-harness-attested-runs-attested D5 + BR-1028.
 * `lore run` does not exist yet, so every test fails on the missing command.
 *
 * The expected fragment set is NOT hard-coded: it is whatever
 * `lore fragments render --outlet hook:subagent-start --agent-type <t> --explain`
 * (an existing command) selects in the same sandbox, parsed from its stderr lines
 * `explain: <id> layer=<shipped|project|user> chars=<n>`. The expected sha256 is computed
 * HERE from the fragment file on disk (shipped: assets/context/<id>.md; project:
 * <corpus>/.lore/context/<id>.md), i.e. "sha256 of the fragment file's bytes".
 * The sandbox HOME/XDG are empty temp dirs so the user layer contributes nothing and the
 * selection is deterministic: shipped + the project fixtures written below.
 *
 * Registration flags are those pinned in run-register.bun.test.ts; stored composition is read
 * back via `lore run show <id> --json` (`data.composition = {schemaVersion:1, fragments:[{id,sha256}]}`,
 * `data.agentType`).
 *
 * Six dimensions: HAPPY (selection == composition, hashes of content, agent type stored),
 * BOUNDARY (a different agent type yields a different selection; hash is 64 lowercase hex),
 * STATE (editing one fragment changes only that hash for a NEW run; the OLD run keeps its
 * record), REGRESSION (re-registering after the edit does not rewrite the stored record).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const SHIPPED_DIR = join(REPO_ROOT, "assets", "context");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface Sandbox {
  root: string;
  corpus: string;
}

function runLore(sb: Sandbox, args: string[]): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd: sb.corpus,
    env: {
      ...process.env,
      HOME: join(sb.root, "home"),
      XDG_CONFIG_HOME: join(sb.root, "xdg"),
      EDITOR: "true",
      CLAUDECODE: "1",
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "lore-run-composition-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  const corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const sb = { root, corpus };
  const init = runLore(sb, ["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  return sb;
}

const projectCtxDir = (sb: Sandbox): string => join(sb.corpus, ".lore", "context");

function writeFragment(sb: Sandbox, id: string, inject: string[], body: string, agents?: string[]): void {
  mkdirSync(projectCtxDir(sb), { recursive: true });
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `inject: [${inject.join(", ")}]`,
    ...(agents === undefined ? [] : [`agents: [${agents.join(", ")}]`]),
    "---",
    "",
  ].join("\n");
  writeFileSync(join(projectCtxDir(sb), `${id}.md`), `${fm}${body}\n`, "utf8");
}

interface Selected {
  id: string;
  layer: string;
}

/** The ground-truth selection: what the existing `fragments render --explain` picks. */
function selection(sb: Sandbox, agentType: string): Selected[] {
  const r = runLore(sb, [
    "fragments", "render", "--outlet", "hook:subagent-start", "--agent-type", agentType, "--explain",
  ]);
  if (r.exitCode !== 0) throw new Error(`fragments render failed: ${r.stderr}`);
  const out: Selected[] = [];
  for (const line of r.stderr.split("\n")) {
    const m = /^explain: (\S+) layer=(\S+)/.exec(line);
    if (m) out.push({ id: m[1]!, layer: m[2]! });
  }
  return out;
}

function fileSha256(sb: Sandbox, s: Selected): string {
  const dir = s.layer === "shipped" ? SHIPPED_DIR : s.layer === "project" ? projectCtxDir(sb) : null;
  if (dir === null) throw new Error(`fixture error: unexpected layer ${s.layer} for ${s.id}`);
  return createHash("sha256").update(readFileSync(join(dir, `${s.id}.md`))).digest("hex");
}

interface RunRecord {
  id: string;
  agentType: string | null;
  composition: { schemaVersion: number; fragments: { id: string; sha256: string }[] };
}

function registerSub(sb: Sandbox, session: string, agentId: string, agentType: string): void {
  const r = runLore(sb, [
    "run", "register", "--harness", "claude-code", "--session", session,
    "--agent-id", agentId, "--agent-type", agentType,
  ]);
  expect({ code: r.exitCode, err: r.stderr }).toEqual({ code: 0, err: "" });
}

function showRun(sb: Sandbox, id: string): RunRecord {
  const r = runLore(sb, ["run", "show", id, "--json"]);
  if (r.exitCode !== 0) throw new Error(`lore run show ${id} exited ${r.exitCode}: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { ok: boolean; data: RunRecord }).data;
}

const byId = (r: RunRecord): Record<string, string> =>
  Object.fromEntries(r.composition.fragments.map((f) => [f.id, f.sha256]));

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
  writeFragment(sb, "rid2-shared", ["subagent-start"], "Shared fixture body v1", ["lore-implementer", "lore-reviewer"]);
  writeFragment(sb, "rid2-impl-only", ["subagent-start"], "Implementer-only fixture body v1", ["lore-implementer"]);
  writeFragment(sb, "rid2-reviewer-only", ["subagent-start"], "Reviewer-only fixture body v1", ["lore-reviewer"]);
});
afterEach(() => {
  try {
    rmSync(sb.root, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-RID-2: the composition record equals the fragment selection, with content hashes", () => {
  it("HAPPY: fragment ids equal the ids `fragments render --explain` selects for the agent type", () => {
    const expected = selection(sb, "lore-implementer").map((s) => s.id).sort();
    // vacuous-pass guards: the selection includes the project fixtures and the shipped layer
    expect(expected).toContain("rid2-impl-only");
    expect(expected).toContain("rid2-shared");
    expect(expected).not.toContain("rid2-reviewer-only");
    expect(expected).toContain("agent-rules");

    registerSub(sb, "sess-comp-1", "agent-I1", "lore-implementer");
    const run = showRun(sb, "cc:sess-comp-1:agent-I1");
    expect(run.composition.schemaVersion).toBe(1);
    expect(run.composition.fragments.map((f) => f.id).sort()).toEqual(expected);
  }, 120_000);

  it("HAPPY: each fragment's sha256 is the SHA-256 of that fragment file's content, and the agent type is stored", () => {
    const sel = selection(sb, "lore-implementer");
    registerSub(sb, "sess-comp-2", "agent-I1", "lore-implementer");
    const run = showRun(sb, "cc:sess-comp-2:agent-I1");

    expect(run.agentType).toBe("lore-implementer");
    const stored = byId(run);
    for (const s of sel) {
      expect(stored[s.id]).toMatch(/^[0-9a-f]{64}$/);
      expect(stored[s.id]).toBe(fileSha256(sb, s));
    }
  }, 120_000);

  it("BOUNDARY: a different agent type gets its own selection, not the implementer's", () => {
    const reviewerExpected = selection(sb, "lore-reviewer").map((s) => s.id).sort();
    const implExpected = selection(sb, "lore-implementer").map((s) => s.id).sort();
    expect(reviewerExpected).not.toEqual(implExpected); // fixture control

    registerSub(sb, "sess-comp-3", "agent-R1", "lore-reviewer");
    registerSub(sb, "sess-comp-3", "agent-I1", "lore-implementer");
    const reviewer = showRun(sb, "cc:sess-comp-3:agent-R1");
    const impl = showRun(sb, "cc:sess-comp-3:agent-I1");

    expect(reviewer.agentType).toBe("lore-reviewer");
    expect(reviewer.composition.fragments.map((f) => f.id).sort()).toEqual(reviewerExpected);
    expect(impl.composition.fragments.map((f) => f.id).sort()).toEqual(implExpected);
    expect(Object.keys(byId(reviewer))).toContain("rid2-reviewer-only");
    expect(Object.keys(byId(impl))).not.toContain("rid2-reviewer-only");
  }, 120_000);

  it("STATE: after editing one fragment, a NEW run differs from the old one in that fragment's hash only", () => {
    registerSub(sb, "sess-comp-4", "agent-OLD", "lore-implementer");
    const before = showRun(sb, "cc:sess-comp-4:agent-OLD");

    writeFragment(sb, "rid2-impl-only", ["subagent-start"], "Implementer-only fixture body v2 EDITED", ["lore-implementer"]);
    registerSub(sb, "sess-comp-4", "agent-NEW", "lore-implementer");
    const after = showRun(sb, "cc:sess-comp-4:agent-NEW");

    const a = byId(before);
    const b = byId(after);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    const changed = Object.keys(a).filter((id) => a[id] !== b[id]);
    expect(changed).toEqual(["rid2-impl-only"]);
    expect(b["rid2-impl-only"]).toBe(
      createHash("sha256").update(readFileSync(join(projectCtxDir(sb), "rid2-impl-only.md"))).digest("hex"),
    );
  }, 120_000);

  it("REGRESSION: the OLD run keeps its original record after the fragment is edited and it is re-registered", () => {
    registerSub(sb, "sess-comp-5", "agent-OLD", "lore-implementer");
    const before = showRun(sb, "cc:sess-comp-5:agent-OLD");

    writeFragment(sb, "rid2-impl-only", ["subagent-start"], "Implementer-only fixture body v3 EDITED", ["lore-implementer"]);
    registerSub(sb, "sess-comp-5", "agent-OLD", "lore-implementer"); // idempotent: first wins
    expect(showRun(sb, "cc:sess-comp-5:agent-OLD").composition).toEqual(before.composition);
  }, 120_000);
});

describe("AC-IT-11: run composition per run kind", () => {
  it("AC-IT-11 a main run records rules:user, rules:project and hook:user-prompt selections; a subagent run only hook:subagent-start", () => {
    writeFragment(sb, "it11-launch", ["launch"], "Launch fixture body");
    writeFragment(sb, "it11-per-turn", ["user-prompt"], "Per-turn fixture body");

    const main = runLore(sb, ["run", "register", "--harness", "claude-code", "--session", "sess-it11-main", "--harness-pid", String(process.pid)]);
    expect({ code: main.exitCode, err: main.stderr }).toEqual({ code: 0, err: "" });
    const mainIds = Object.keys(byId(showRun(sb, "cc:sess-it11-main")));
    expect(mainIds).toContain("it11-launch");
    expect(mainIds).toContain("it11-per-turn");
    expect(mainIds).not.toContain("rid2-impl-only"); // helper-only fragments never reach the main session

    registerSub(sb, "sess-it11-sub", "agent-it11", "lore-implementer");
    const subIds = Object.keys(byId(showRun(sb, "cc:sess-it11-sub:agent-it11")));
    expect(subIds).toContain("rid2-impl-only");
    expect(subIds).not.toContain("it11-launch");
    expect(subIds).not.toContain("it11-per-turn");
  }, 120_000);
});
