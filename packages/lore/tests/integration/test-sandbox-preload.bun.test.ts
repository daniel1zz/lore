/**
 * AC-TG-2 (bun half): the runner is armed AND so are its children. Under bun a child spawned
 * WITHOUT an explicit `env` inherits the STARTUP environment, not runtime `process.env`
 * mutations, so the marker must come from `packages/lore/.env.test` (verified by
 * scripts/test-isolation-bun-preload.ts). Each spawn form below passes no `env` on purpose.
 * The last block pins the preload's consistency rule: a nested checkout inheriting the OUTER
 * repo is accepted (and the outer repo stays the protected one); a wrong-PWD start, a stray or
 * relative REPO, or a missing marker fails loud.
 */
import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = realpathSync(resolve(import.meta.dir, "../../../.."));
const PROBE = ["sh", "-c", 'printf "%s|%s" "$LORE_TEST_SANDBOX" "$LORE_TEST_SANDBOX_REPO"'] as const;

function expectArmed(out: string): void {
  const [marker, repo] = out.split("|");
  expect(marker).toBe("1");
  expect(realpathSync(repo!)).toBe(REPO);
}

test("AC-TG-2 bun runner process has the marker and this checkout recorded", () => {
  expect(process.env["LORE_TEST_SANDBOX"]).toBe("1");
  expect(realpathSync(process.env["LORE_TEST_SANDBOX_REPO"]!)).toBe(REPO);
});

test("AC-TG-2 child via node:child_process.spawnSync with NO explicit env sees the marker", () => {
  expectArmed(spawnSync(PROBE[0], PROBE.slice(1), { encoding: "utf8" }).stdout);
});

test("AC-TG-2 child via node:child_process.execFileSync with NO explicit env sees the marker", () => {
  expectArmed(execFileSync(PROBE[0], PROBE.slice(1), { encoding: "utf8" }));
});

test("AC-TG-2 child via Bun.spawnSync with NO explicit env sees the marker", () => {
  expectArmed(Bun.spawnSync([...PROBE]).stdout.toString());
});

// ─── preload consistency rule (nested checkouts, wrong PWD) ─────────────────

/** A minimal second lore checkout: preload + setup files, bunfig, .env.test and one inner test. */
function makeFixtureCheckout(): { root: string; lore: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-nested-")));
  const lore = join(root, "packages", "lore");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(lore, { recursive: true });
  for (const f of ["test-isolation-bun-preload.ts", "test-isolation-setup.ts"]) {
    copyFileSync(join(REPO, "scripts", f), join(root, "scripts", f));
  }
  copyFileSync(join(REPO, "packages", "lore", "bunfig.toml"), join(lore, "bunfig.toml"));
  copyFileSync(join(REPO, "packages", "lore", ".env.test"), join(lore, ".env.test"));
  writeFileSync(
    join(lore, "inner.bun.test.ts"),
    `import { expect, test } from "bun:test";
test("inner", () => {
  expect(process.env["LORE_TEST_SANDBOX"]).toBe("1");
  console.log("INNER_REPO=" + process.env["LORE_TEST_SANDBOX_REPO"]);
  const child = Bun.spawnSync(["sh", "-c", 'printf "%s" "$LORE_TEST_SANDBOX_REPO"']).stdout.toString();
  console.log("INNER_CHILD_REPO=" + child);
});
`,
  );
  return { root, lore };
}

function runInner(lore: string, env: Record<string, string>) {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "LORE_TEST_SANDBOX" && k !== "LORE_TEST_SANDBOX_REPO") base[k] = v;
  }
  const r = spawnSync("bun", ["test", "inner.bun.test.ts"], { cwd: lore, encoding: "utf8", env: { ...base, ...env } });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

test("AC-TG-2 nested checkout: an inherited OUTER repo is accepted and kept, in the runner and in its children", () => {
  const { root, lore } = makeFixtureCheckout();
  try {
    const r = runInner(lore, { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: REPO, PWD: lore });
    expect(r.status).toBe(0);
    expect(r.out).toContain(`INNER_REPO=${REPO}`);
    expect(r.out).toContain(`INNER_CHILD_REPO=${REPO}`);
    expect(r.out).not.toContain(`INNER_REPO=${root}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("AC-TG-2 wrong PWD (bun test started outside packages/lore) fails loud: REPO derived from PWD is not a lore checkout", () => {
  const { root, lore } = makeFixtureCheckout();
  try {
    const r = runInner(lore, { PWD: root });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not a lore checkout");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("AC-TG-2 an inherited REPO that is not a lore checkout, is relative, or paired with a missing marker fails loud", () => {
  const { root, lore } = makeFixtureCheckout();
  try {
    const stray = join(root, "stray");
    mkdirSync(stray);
    const notCheckout = runInner(lore, { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: stray });
    expect(notCheckout.status).not.toBe(0);
    expect(notCheckout.out).toContain("not a lore checkout");
    const relative = runInner(lore, { LORE_TEST_SANDBOX: "1", LORE_TEST_SANDBOX_REPO: "../.." });
    expect(relative.status).not.toBe(0);
    expect(relative.out).toContain("absolute path");
    const noMarker = runInner(lore, { LORE_TEST_SANDBOX: "0", LORE_TEST_SANDBOX_REPO: REPO });
    expect(noMarker.status).not.toBe(0);
    expect(noMarker.out).toContain("LORE_TEST_SANDBOX is");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);
