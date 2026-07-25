/**
 * Typed reader for the env vars `multi-project-global-setup.ts` publishes — the SAME
 * "globalSetup runs in Playwright's main process before workers fork, so `process.env`
 * writes are inherited" pattern `global-setup.ts` documents for `LORE_E2E_DB_PATH`.
 * Centralised here so all 3 `multi-project-*.spec.ts` files fail the SAME loud way on a
 * missing var instead of each re-deriving its own ad-hoc check.
 */

interface SeedProjectResult {
  prdId: string;
  prdTitle: string;
  markerTaskId: string;
  markerTaskTitle: string;
  markerContent: string;
}
interface SeedProjectAResult extends SeedProjectResult {
  draftSpecId: string;
  draftSpecTitle: string;
}
export interface MultiProjectFixture {
  runId: string;
  projectADbPath: string;
  projectBDbPath: string;
  projectABearerKey: string;
  projectBBearerKey: string;
  seed: { a: SeedProjectAResult; b: SeedProjectResult };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set — this spec file must run under multi-project-global-setup.ts ` +
        `(playwright.multi-project.config.ts), never the default config.`,
    );
  }
  return value;
}

export function loadMultiProjectFixture(): MultiProjectFixture {
  return {
    runId: requireEnv("LORE_E2E_MP_RUN_ID"),
    projectADbPath: requireEnv("LORE_E2E_MP_PROJECT_A_DB_PATH"),
    projectBDbPath: requireEnv("LORE_E2E_MP_PROJECT_B_DB_PATH"),
    projectABearerKey: requireEnv("LORE_E2E_MP_PROJECT_A_BEARER_KEY"),
    projectBBearerKey: requireEnv("LORE_E2E_MP_PROJECT_B_BEARER_KEY"),
    seed: JSON.parse(requireEnv("LORE_E2E_MP_SEED_JSON")) as MultiProjectFixture["seed"],
  };
}
