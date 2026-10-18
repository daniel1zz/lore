// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/adapters/cli/live-server-registry.ts
// @reads packages/lore/src/adapters/cli/decide-flow.ts
// @reads packages/lore/src/service/human-channel.ts
// @reads packages/lore/src/adapters/cli/pending-decisions-render.ts
/**
 * AC-HR-5 (spec-human-review-surface-decisions-audit-items-and-pending D4): a running
 * `lore dashboard` records its live base URL for the corpus it serves; the reader returns
 * it, the record is gone after a SIGTERM stop (BR-869), a record naming a dead pid is
 * reported absent with that pid, and no link-building module hardcodes a port.
 *
 * Isolation: throwaway corpus (mkdtemp + `lore init`), HOME / LORE_STATE_HOME /
 * LORE_CONFIG_HOME redirected into throwaway dirs so the user's real registry is never
 * written; the port is a free OS-assigned one, never 8787.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLiveServerUrl, registerLiveServer } from "../../src/adapters/cli/live-server-registry.js";

const PKG_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PKG_ROOT, "src/index.ts");

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface Fixture {
  corpusDir: string;
  stateDir: string;
  registryDir: string;
  env: Record<string, string>;
}

function makeFixture(): Fixture {
  const corpusDir = realpathSync(mkdtempSync(join(tmpdir(), "lore-live-reg-corpus-")));
  const stateDir = mkdtempSync(join(tmpdir(), "lore-live-reg-state-"));
  const configDir = mkdtempSync(join(tmpdir(), "lore-live-reg-config-"));
  cleanups.push(() => {
    for (const dir of [corpusDir, stateDir, configDir]) rmSync(dir, { recursive: true, force: true });
  });
  const env = {
    ...(process.env as Record<string, string>),
    HOME: corpusDir,
    LORE_STATE_HOME: stateDir,
    LORE_CONFIG_HOME: configDir,
    CLAUDECODE: "1",
    LORE_DASHBOARD_ASSETS_FIXTURE: "1",
  };
  const init = Bun.spawnSync(["bun", INDEX_TS, "init"], { cwd: corpusDir, env });
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr.toString()}`);
  return { corpusDir, stateDir, registryDir: join(stateDir, "live-servers"), env };
}

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  return port;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function startDashboard(fx: Fixture, port: number) {
  const child = Bun.spawn(["bun", INDEX_TS, "dashboard", "--no-open", "--api-port", String(port)], {
    cwd: fx.corpusDir,
    env: fx.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  cleanups.push(() => child.kill("SIGKILL"));
  let out = "";
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) out += decoder.decode(chunk);
  })();
  return { child, stdout: () => out };
}

describe("AC-HR-5 live server registry", () => {
  it("AC-HR-5 HAPPY+STATE: dashboard registers its base URL, SIGTERM removes the record", async () => {
    const fx = makeFixture();
    const port = freePort();
    const { child, stdout } = startDashboard(fx, port);
    await waitFor(() => stdout().includes("LORE_DASHBOARD_URL="), "dashboard handshake");

    const lookup = readLiveServerUrl(fx.registryDir, fx.corpusDir);
    expect(lookup.live).toBe(true);
    if (!lookup.live) return;
    expect(lookup.url).toBe(`http://localhost:${port}`);
    expect(lookup.url).not.toContain("nonce");
    expect(lookup.pid).toBe(child.pid);

    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);

    const after = readLiveServerUrl(fx.registryDir, fx.corpusDir);
    expect(after.live).toBe(false);
    expect(existsSync(fx.registryDir) ? readdirSync(fx.registryDir) : []).toEqual([]);
  }, 60_000);

  it("AC-HR-5 NEGATIVE: a record whose pid is not alive is absent and names the dead pid", () => {
    const fx = makeFixture();
    const deadPid = Bun.spawnSync(["true"]).pid;
    registerLiveServer({ registryDir: fx.registryDir, corpusRoot: fx.corpusDir, baseUrl: "http://localhost:9", pid: deadPid });
    const lookup = readLiveServerUrl(fx.registryDir, fx.corpusDir);
    expect(lookup.live).toBe(false);
    if (lookup.live) return;
    expect(lookup.reason).toContain(`pid ${deadPid}`);
    expect(lookup.reason).toContain("not alive");
  });

  it("AC-HR-5 BOUNDARY: no record means absent with a reason; another corpus is not confused", () => {
    const fx = makeFixture();
    const other = makeFixture();
    const none = readLiveServerUrl(fx.registryDir, fx.corpusDir);
    expect(none.live).toBe(false);
    registerLiveServer({ registryDir: fx.registryDir, corpusRoot: fx.corpusDir, baseUrl: "http://localhost:1234" });
    expect(readLiveServerUrl(fx.registryDir, fx.corpusDir).live).toBe(true);
    expect(readLiveServerUrl(fx.registryDir, other.corpusDir).live).toBe(false);
  });

  it("AC-HR-5 ERROR: a malformed record is absent, not a crash", () => {
    const fx = makeFixture();
    mkdirSync(fx.registryDir, { recursive: true });
    const key = createHash("sha256").update(fx.corpusDir).digest("hex").slice(0, 32);
    writeFileSync(join(fx.registryDir, `${key}.json`), "{not json");
    const lookup = readLiveServerUrl(fx.registryDir, fx.corpusDir);
    expect(lookup.live).toBe(false);
    if (lookup.live) return;
    expect(lookup.reason).toContain("malformed");
  });

  it("AC-HR-5 REGRESSION: a stale remover never deletes a successor's record", () => {
    const fx = makeFixture();
    const removeFirst = registerLiveServer({ registryDir: fx.registryDir, corpusRoot: fx.corpusDir, baseUrl: "http://localhost:1", pid: process.pid + 1_000_000 });
    registerLiveServer({ registryDir: fx.registryDir, corpusRoot: fx.corpusDir, baseUrl: "http://localhost:2" });
    removeFirst();
    const lookup = readLiveServerUrl(fx.registryDir, fx.corpusDir);
    expect(lookup.live).toBe(true);
  });

  it("AC-HR-5 REGRESSION: link-building modules never hardcode a port", () => {
    const files = [
      "src/adapters/cli/live-server-registry.ts",
      "src/adapters/cli/decide-flow.ts",
      "src/service/human-channel.ts",
      "src/adapters/cli/pending-decisions-render.ts",
    ];
    const pattern = /:(8787|3456|5173)\b|localhost:\d/;
    for (const rel of files) {
      const path = join(PKG_ROOT, rel);
      // reason: decide-flow / human-channel / pending-decisions-render are owned by later tasks (T7);
      // a not-yet-existing file has no hardcoded port to find.
      if (!existsSync(path)) continue;
      expect({ file: rel, hit: pattern.test(readFileSync(path, "utf8")) }).toEqual({ file: rel, hit: false });
    }
  });
});
