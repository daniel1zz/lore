// @spawns packages/lore/src/index.ts
/**
 * @task task-test-runs-are-hermetic-the-inherited-session-lore-harness (resolves #503)
 *
 * A test run is hermetic about identity: the `LORE_HARNESS_RUN` an agent session exports to every Bash call (#418) is
 * removed before any test process starts, so a `lore` child spawned against a throwaway corpus is attributed to the
 * test's own run (the known-party rewrite, scripts/test-known-party-spawn.ts), never refused as an unknown run.
 *
 * Run it with the variable set to an unknown run:
 *   LORE_HARNESS_RUN=cc:unknown-session-503 bun run test:file packages/lore/tests/integration/test-env-hermetic-run.bun.test.ts
 *
 * #531 (regression of #503): the agent-harness MARKER env (`CLAUDECODE=1`, ...) is stripped at config load as well, so a
 * fixture that spawns `lore` without a test identity behaves inside an agent session exactly as it does in CI.
 *
 * Coverage: HAPPY (create exits 0), REGRESSION (the inherited run never reaches the child), STATE (the write is attributed
 * to the test's own run, not the inherited one), BOUNDARY (the test process itself sees no inherited run).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { HARNESS_ADAPTERS } from "@lore/core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureRequirementsDocSlug } from "../helpers/parented-create";
import { DEFAULT_TEST_RUN, HARNESS_RUN_ENV } from "../helpers/test-run-identity";

const INDEX_TS = new URL("../../src/index.ts", import.meta.url).pathname;
const TEST_TIMEOUT_MS = 30_000;
/** The unknown run this file is meant to be run with; it is registered in no corpus. */
const UNKNOWN_RUN = "cc:unknown-session-503";

function runLore(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  // No explicit env: the child inherits the process's startup environment, the case the hermetic fix must cover.
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], { cwd });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

describe("test env is hermetic about the harness run", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-hermetic-run-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("the test process does not see an inherited run", () => {
    expect(process.env[HARNESS_RUN_ENV]).not.toBe(UNKNOWN_RUN);
    expect(process.env[HARNESS_RUN_ENV] ?? "").toBe("");
  });

  it(
    "lore create against a throwaway corpus exits 0 and is attributed to the test's own run",
    () => {
      const init = runLore(["init"], dir);
      expect(init.exitCode, init.stderr + init.stdout).toBe(0);

      const created = runLore(["create", "knowledge", "--parent", ensureRequirementsDocSlug((a) => runLore(a, dir)), "--sub-type", "reference", "--title", "Hermetic run probe", "--content", "probe", "--json"], dir);
      expect(created.exitCode, created.stderr + created.stdout).toBe(0);
      expect(created.stderr + created.stdout).not.toContain(UNKNOWN_RUN);

      const ownRunWriter = `agent:session-${DEFAULT_TEST_RUN.replace(/^cc:/, "").slice(0, 8)}`;
      expect(created.stdout).toContain(ownRunWriter);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#531: with every agent-harness marker set, config load strips them and a spawning fixture without a test identity exits 0",
    () => {
      const root = new URL("../../../../", import.meta.url).pathname;
      const markerEnv: Record<string, string> = {};
      for (const adapter of Object.values(HARNESS_ADAPTERS)) markerEnv[adapter.marker.env] = adapter.marker.value;
      expect(Object.keys(markerEnv).length).toBeGreaterThan(0);

      // The fixture loads the shared vitest config (the strip point), then spawns lore with NO explicit env, the
      // way a test fixture without a test identity does; it reports the child's exit status as its own.
      const fixture = join(dir, "spawning-fixture.ts");
      writeFileSync(
        fixture,
        `import ${JSON.stringify(join(root, "vitest.shared.ts"))};
const lore = (args: string[]) => Bun.spawnSync(["bun", "run", ${JSON.stringify(INDEX_TS)}, ...args], { cwd: ${JSON.stringify(dir)} });
const init = lore(["init"]);
const proc = init.exitCode === 0 ? lore(["create", "prd", "--title", "Marker probe", "--content", "probe"]) : init;
process.stdout.write(proc.stdout.toString());
process.stderr.write(proc.stderr.toString());
process.stderr.write("MARKERS_SEEN=" + JSON.stringify(Object.keys(${JSON.stringify(markerEnv)}).filter((k) => process.env[k] !== undefined)) + "\\n");
process.exit(proc.exitCode ?? 1);
`,
      );
      const env: Record<string, string | undefined> = { ...process.env, ...markerEnv };
      delete env[HARNESS_RUN_ENV];
      delete env["LORE_TEST_THROWAWAY_HOME"];
      const proc = Bun.spawnSync(["bun", fixture], { cwd: root, env });
      const out = proc.stderr.toString() + proc.stdout.toString();
      expect(proc.exitCode, out).toBe(0);
      expect(out).toContain("MARKERS_SEEN=[]");
    },
    TEST_TIMEOUT_MS,
  );
});
