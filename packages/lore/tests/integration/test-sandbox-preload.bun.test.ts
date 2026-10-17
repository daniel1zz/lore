/**
 * AC-TG-2 (one-runner half, task-skill-implement-tg-23): the runner is armed AND so are its
 * children. Under the Bun runtime (`bunx --bun vitest`) a child spawned WITHOUT an explicit `env`
 * inherits the STARTUP environment, not runtime `process.env` mutations, so the marker is armed
 * at vitest CONFIG load (scripts/test-isolation-env.ts, forked workers start with it) and
 * scripts/test-isolation-setup.ts measures that a no-env child sees it. Each spawn form below
 * passes no `env` on purpose. The second half pins the consistency rule with a fixture checkout
 * run through the same runner: a nested checkout inheriting the OUTER repo keeps it protected; a
 * stray or relative REPO fails loud; a config that does not arm at load fails loud at setup.
 *
 * File name keeps the historical `.bun.test.ts` suffix (TG-23 filename policy: names are not
 * renamed; the suffix no longer selects a runner).
 */
import { expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = realpathSync(resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../.."));
const PROBE = ["sh", "-c", 'printf "%s|%s" "$LORE_TEST_SANDBOX" "$LORE_TEST_SANDBOX_REPO"'] as const;

function expectArmed(out: string): void {
  const [marker, repo] = out.split("|");
  expect(marker).toBe("1");
  expect(realpathSync(repo!)).toBe(REPO);
}

test("AC-TG-2 vitest worker has the marker and this checkout recorded", () => {
  expect(process.env["LORE_TEST_SANDBOX"]).toBe("1");
  expect(realpathSync(process.env["LORE_TEST_SANDBOX_REPO"]!)).toBe(REPO);
});

test("AC-TG-2 child via node:child_process.spawnSync with NO explicit env sees the marker", () => {
  expectArmed(spawnSync(PROBE[0], PROBE.slice(1), { encoding: "utf8" }).stdout);
});

test("AC-TG-2 child via node:child_process.execFileSync with NO explicit env sees the marker", () => {
  expectArmed(execFileSync(PROBE[0], PROBE.slice(1), { encoding: "utf8" }));
});

test("AC-TG-2 child via Bun.spawnSync with NO explicit env sees the marker (under the Bun runtime)", () => {
  // reason: Bun.spawnSync exists only under the Bun runtime; the file is listed nowhere as Node-only,
  // so a Node run of it would be a defect and must fail loud rather than skip.
  expect(typeof (globalThis as { Bun?: unknown }).Bun).toBe("object");
  const Bun = (globalThis as unknown as { Bun: { spawnSync(cmd: string[]): { stdout: { toString(): string } } } }).Bun;
  expectArmed(Bun.spawnSync([...PROBE]).stdout.toString());
});

// ─── consistency rule (nested checkouts, unarmed config) ────────────────────

const VITEST_ENTRY = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");

const ARMED_CONFIG = `import { fileURLToPath } from "node:url";
import { armSandboxEnv } from "./scripts/test-isolation-env";
armSandboxEnv(fileURLToPath(new URL(".", import.meta.url)));
export default { test: { globals: true, include: ["inner.test.ts"], setupFiles: ["./scripts/test-isolation-setup.ts"] } };
`;
const UNARMED_CONFIG = `export default { test: { globals: true, include: ["inner.test.ts"], setupFiles: ["./scripts/test-isolation-setup.ts"] } };
`;

/** A minimal second lore checkout: the env + setup files, a config and one inner test. */
function makeFixtureCheckout(config: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-nested-")));
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const f of ["test-isolation-env.ts", "test-isolation-setup.ts"]) {
    copyFileSync(join(REPO, "scripts", f), join(root, "scripts", f));
  }
  writeFileSync(join(root, "vitest.config.ts"), config);
  writeFileSync(
    join(root, "inner.test.ts"),
    `import { spawnSync } from "node:child_process";
test("inner", () => {
  expect(process.env["LORE_TEST_SANDBOX"]).toBe("1");
  console.log("INNER_REPO=" + process.env["LORE_TEST_SANDBOX_REPO"]);
  const child = spawnSync("sh", ["-c", 'printf "%s" "$LORE_TEST_SANDBOX_REPO"'], { encoding: "utf8" }).stdout;
  console.log("INNER_CHILD_REPO=" + child);
});
`,
  );
  return root;
}

function runInner(root: string, env: Record<string, string>) {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "LORE_TEST_SANDBOX" && k !== "LORE_TEST_SANDBOX_REPO") base[k] = v;
  }
  const r = spawnSync(process.execPath, ["--bun", VITEST_ENTRY, "run"], { cwd: root, encoding: "utf8", env: { ...base, ...env } });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

test("AC-TG-2 nested checkout: an inherited OUTER repo is accepted and kept, in the runner and in its children", () => {
  const root = makeFixtureCheckout(ARMED_CONFIG);
  try {
    const r = runInner(root, { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: REPO });
    expect(r.out).toContain(`INNER_REPO=${REPO}`);
    expect(r.out).toContain(`INNER_CHILD_REPO=${REPO}`);
    expect(r.out).not.toContain(`INNER_REPO=${root}`);
    expect(r.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("AC-TG-2 an un-nested run protects its own checkout, in the runner and in its children", () => {
  const root = makeFixtureCheckout(ARMED_CONFIG);
  try {
    const r = runInner(root, {});
    expect(r.out).toContain(`INNER_REPO=${root}`);
    expect(r.out).toContain(`INNER_CHILD_REPO=${root}`);
    expect(r.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("AC-TG-2 an inherited marker that is not \"1\" is overwritten (the marker is always armed)", () => {
  const root = makeFixtureCheckout(ARMED_CONFIG);
  try {
    const r = runInner(root, { LORE_TEST_SANDBOX: "0" });
    expect(r.out).toContain(`INNER_CHILD_REPO=${root}`);
    expect(r.status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("AC-TG-2 an inherited REPO that is not a lore checkout or is relative fails loud", () => {
  const root = makeFixtureCheckout(ARMED_CONFIG);
  try {
    const stray = join(root, "stray");
    mkdirSync(stray);
    const notCheckout = runInner(root, { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: stray });
    expect(notCheckout.status).not.toBe(0);
    expect(notCheckout.out).toContain("not a lore checkout");
    const relative = runInner(root, { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: "../.." });
    expect(relative.status).not.toBe(0);
    expect(relative.out).toContain("absolute path");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);

test("AC-TG-2 a config that does not arm at load fails loud at setup: a no-env child would run unguarded", () => {
  const root = makeFixtureCheckout(UNARMED_CONFIG);
  try {
    const r = runInner(root, {});
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("a child spawned with no explicit env saw");
    expect(r.out).not.toContain("INNER_REPO=");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
