/**
 * Test-run marker, per-worker verification (task-skill-implement-tg-4 / task-skill-implement-tg-23, AC-TG-2).
 *
 * Purpose: refuse to run ANY test unless `LORE_TEST_SANDBOX=1` is armed for this worker AND for
 * the children it spawns, so corpus resolution refuses this repository's own `.lore/lore.db`
 * without author discipline.
 * Public surface: none (import side effect). Registered in `vitest.config.ts` and
 * `vitest.node.config.ts` `setupFiles`. The arming itself happens at config load
 * (`armSandboxEnv`, scripts/test-isolation-env.ts) because under the Bun runtime a mutation made
 * here would not reach children; this file only MEASURES that it did (throws when it did not).
 * Side-effect class: spawns one probe process per test file; throws on violation.
 */
import { assertChildrenInheritSandbox } from "./test-isolation-env";

assertChildrenInheritSandbox();
