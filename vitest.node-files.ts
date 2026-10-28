/**
 * The test files that run under NODE instead of the Bun runtime (TG-23, adr-tg-1 option (b)).
 *
 * One runner is vitest; every file runs under `bunx --bun vitest run` (vitest.config.ts) EXCEPT
 * the files named here, which `bunx vitest run -c vitest.node.config.ts` runs under Node. The
 * list is by FILE, never a glob, and each entry carries the measured reason it cannot run under
 * the Bun runtime yet. Each entry passes under Node and fails under Bun on this tree
 * (measured 2026-10-17, vitest 3.2.6, bun 1.3.10). Remove an entry when its file is fixed or
 * removed; adding one needs a reason a reviewer can reproduce. scripts/check-test-file-census.ts
 * fails loud when a listed file no longer exists or when a file on disk runs in neither config.
 */

const VI_MOCK =
  "vi.mock of a module does not intercept under the Bun runtime: the mocked export is missing (`mockReset`/`mockClear`/`mockResolvedValue` is not a function) so the file fails before asserting";
const VI_MOCK_REAL_CALL =
  "vi.mock of a relative module is not applied under the Bun runtime, so the real implementation runs (a real `loadLoreApp` exits 4 / a real `gh` is invoked) and the assertions see it";
const BUN_PROCESS_SEMANTICS =
  "Bun differs from Node on the process API this test pins: `process.exitCode = undefined` does not clear the code (stays 2), and spawn ignores a PATH changed at runtime (a child still finds binaries the test removed from PATH)";
const UNDIAGNOSED =
  "behaves differently under the Bun runtime (adr-tg-1 category 'behave differently'); passes under Node; root cause not yet diagnosed";

export const NODE_PROJECT_FILES: Readonly<Record<string, string>> = {
  // dashboard component tests (jsdom) whose vi.mock does not take effect under Bun
  "packages/dashboard/tests/component/DocDetail.write.test.tsx": VI_MOCK,
  "packages/dashboard/tests/component/DocDetail.project-write.test.tsx": VI_MOCK,
  "packages/dashboard/tests/component/DocDetail.delete.test.tsx": VI_MOCK,
  "packages/dashboard/tests/component/HistoryTab.test.tsx": VI_MOCK,
  "packages/dashboard/tests/component/TriageQueue.test.tsx": VI_MOCK,
  "packages/dashboard/tests/component/AdjudicationBar.test.tsx": VI_MOCK,
  "packages/dashboard/tests/unit/lib/use-route-telemetry.test.ts":
    "a vi.mock'd/spied telemetry call is never observed under the Bun runtime ('spy' called 0 times, expected 1)",
  // lore: vi.mock interop
  "packages/lore/tests/unit/adapters/foreign-corpus-write-adapters.test.ts": VI_MOCK,
  "packages/lore/tests/unit/service/resolution-projector.test.ts": VI_MOCK_REAL_CALL,
  "packages/lore/tests/unit/service/github-filing-split-write.test.ts": VI_MOCK_REAL_CALL,
  // lore: Bun process-API semantics
  "packages/lore/tests/unit/hooks/session-bootstrap-injection.test.ts": BUN_PROCESS_SEMANTICS,
  "packages/lore/tests/unit/service/attestation-head-sha.test.ts": BUN_PROCESS_SEMANTICS,
  // lore: other measured differences
  "packages/lore/tests/unit/adapters/real-process-scan-port.test.ts":
    "the /proc fallback and the no-lsof PATH case give different answers under Bun (the PATH half is the same runtime-PATH-mutation difference as above)",
  "packages/lore/tests/unit/service/attested-red.test.ts": UNDIAGNOSED,
  "packages/lore/tests/unit/service/setup-service.test.ts": UNDIAGNOSED,
};
