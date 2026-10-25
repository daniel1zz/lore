/**
 * Tests for SPEC-080 G4 (gate-skip observability, AC-080-2) — the `LORE_GATE_BYPASS=1`
 * escape hatch now makes ONE best-effort attempt to write a `gate_skipped` audit entry
 * (mechanism `env_bypass`) before `commands/gate.ts` unconditionally exits 0.
 * `gate-bypass-audit.ts` holds the decision logic (`runGateEnvBypassAudit`) split out
 * for vitest testability — it imports only `@lore/core`/`@lore/core/node` +
 * `node:fs`/`node:path`, never `bun:sqlite` (mirrors `status-stamp-verdict.ts`'s split,
 * `adapters/cli/CLAUDE.md`). This suite exercises that decision logic via injected
 * fakes and `findLoreDbPathQuiet`'s real filesystem walk — no `bun:sqlite`, no store.
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref SPEC-080 §Scope, §Design Decisions D1/D3; AC-080-2
 */

import { liveInvocation, liveIo } from "../../live-invocation.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runGateEnvBypassAudit,
  findLoreDbPathQuiet,
  type GateBypassAuditDeps,
} from "../../../src/adapters/cli/gate-bypass-audit.js";
import type { RecordGateSkip } from "../../../src/service/gate-enforcer.js";
import { ok, err } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

/** Spies on `process.stderr.write` (swallowing real output), restored via `vi.restoreAllMocks()`. */
/** The audit names its actor from the Invocation it is handed (no process fallback), as the CLI delivers it. */
function auditInScope(checkpoint: Parameters<typeof runGateEnvBypassAudit>[0], deps: GateBypassAuditDeps): Promise<void> {
  return runGateEnvBypassAudit(checkpoint, liveInvocation(), deps);
}

function spyStderr() {
  return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

describe("runGateEnvBypassAudit (LORE_GATE_BYPASS=1 escape-hatch audit trace)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // HAPPY — a reachable corpus: exactly ONE gate_skipped/env_bypass entry, zero stderr.
  it("writes exactly ONE gate_skipped entry with mechanism env_bypass when the corpus is reachable", async () => {
    const stderrSpy = spyStderr();
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const deps: GateBypassAuditDeps = {
      openRecordGateSkip: vi.fn().mockResolvedValue(recordGateSkip),
    };

    await auditInScope("task-claim", deps);

    expect(recordGateSkip).toHaveBeenCalledTimes(1);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.action).toBe("gate_skipped");
    expect(entry.details).toMatchObject({ checkpoint: "task-claim", mechanism: "env_bypass" });
    expect(entry.session_id).toBe("gate-skip");
    expect(typeof entry.actor).toBe("string");
    expect(entry.actor.length).toBeGreaterThan(0);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  // HAPPY — no target id is ever threaded (the CLI bypass path never has a resolved
  // doc in hand at the point it fires — see buildGateSkipAuditEntry's no-target call).
  it("never includes doc_id/details.target (the bypass fires before any target resolves)", async () => {
    spyStderr();
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const deps: GateBypassAuditDeps = {
      openRecordGateSkip: vi.fn().mockResolvedValue(recordGateSkip),
    };

    await auditInScope("spec-create", deps);

    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.doc_id).toBeUndefined();
    expect("target" in (entry.details as object)).toBe(false);
  });

  // NEGATIVE / BOUNDARY — corpus unreachable (port resolves null): one stderr line,
  // shape "gate bypass NOT audited: <reason>", never throws.
  it("prints one 'gate bypass NOT audited: <reason>' line when the port resolves null", async () => {
    const stderrSpy = spyStderr();
    const deps: GateBypassAuditDeps = {
      openRecordGateSkip: vi.fn().mockResolvedValue(null),
    };

    await expect(auditInScope("plan-promote", deps)).resolves.toBeUndefined();

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = stderrSpy.mock.calls[0]![0] as string;
    expect(written).toContain("gate bypass NOT audited:");
    expect(written).toContain("corpus unreachable");
  });

  // ERROR — the port itself REJECTS (e.g. a corrupted lore.db threw during open):
  // degrades to the same one-line shape, never throws out of this function.
  it("prints the NOT-audited line when openRecordGateSkip rejects", async () => {
    const stderrSpy = spyStderr();
    const deps: GateBypassAuditDeps = {
      openRecordGateSkip: vi.fn().mockRejectedValue(new Error("db corrupted")),
    };

    await expect(auditInScope("phase-claim", deps)).resolves.toBeUndefined();

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = stderrSpy.mock.calls[0]![0] as string;
    expect(written).toContain("gate bypass NOT audited:");
    expect(written).toContain("db corrupted");
  });

  // ERROR — the resolved RecordGateSkip function itself REJECTS: same degrade shape.
  it("prints the NOT-audited line when the resolved recordGateSkip rejects", async () => {
    const stderrSpy = spyStderr();
    const recordGateSkip = vi.fn<RecordGateSkip>().mockRejectedValue(new Error("write failed"));
    const deps: GateBypassAuditDeps = {
      openRecordGateSkip: vi.fn().mockResolvedValue(recordGateSkip),
    };

    await auditInScope("spec-promote", deps);

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0]![0] as string).toContain("write failed");
  });

  // ERROR — the resolved RecordGateSkip function resolves Result.err: same shape,
  // reason drawn from the LoreError.
  it("prints the NOT-audited line when the resolved recordGateSkip resolves Result.err", async () => {
    const stderrSpy = spyStderr();
    const failure: LoreError = { code: "STORE_ERROR", message: "disk full" };
    const recordGateSkip = vi
      .fn<RecordGateSkip>()
      .mockResolvedValue(err(failure) as Result<void, LoreError>);
    const deps: GateBypassAuditDeps = {
      openRecordGateSkip: vi.fn().mockResolvedValue(recordGateSkip),
    };

    await auditInScope("task-claim", deps);

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0]![0] as string).toContain("disk full");
  });

  // STATE — every one of the five checkpoints threads its own name into the entry
  // (no hardcoded checkpoint literal leaking through).
  it.each(["spec-create", "spec-promote", "plan-promote", "task-claim", "phase-claim"] as const)(
    "threads checkpoint %s into details.checkpoint",
    async (checkpoint) => {
      spyStderr();
      const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
      const deps: GateBypassAuditDeps = {
        openRecordGateSkip: vi.fn().mockResolvedValue(recordGateSkip),
      };

      await auditInScope(checkpoint, deps);

      expect(recordGateSkip.mock.calls[0]![0].details).toMatchObject({ checkpoint });
    },
  );
});

describe("findLoreDbPathQuiet (safe .lore/lore.db discovery, never process.exit)", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // reason: on macOS, `os.tmpdir()` returns a path under a `/tmp` symlink whose
    // target is `/private/tmp`; `process.chdir()` + `process.cwd()` resolve through
    // the symlink, so an unresolved `tmpDir` string would never `===` what
    // `findLoreDbPathQuiet()` (built from `process.cwd()`) actually returns.
    // `realpathSync` normalizes once here so every assertion below compares
    // like-for-like resolved paths.
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "lore-gate-bypass-audit-test-")));
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  // NEGATIVE — no .lore anywhere up the tree: returns undefined, never process.exit.
  it("returns undefined (never exits) when no .lore/lore.db is discoverable", () => {
    process.chdir(tmpDir);
    expect(findLoreDbPathQuiet(liveIo(), { cwd: process.cwd(), env: process.env })).toBeUndefined();
  });

  // HAPPY — .lore/lore.db present in cwd.
  it("returns the discovered path when .lore/lore.db exists in cwd", () => {
    mkdirSync(join(tmpDir, ".lore"), { recursive: true });
    // reason: findLoreDbPathQuiet only checks existence via existsSync — an empty
    // file is sufficient, no real SQLite content needed for this pure-walk test.
    writeFileSync(join(tmpDir, ".lore", "lore.db"), "");
    process.chdir(tmpDir);

    expect(findLoreDbPathQuiet(liveIo(), { cwd: process.cwd(), env: process.env })).toBe(join(tmpDir, ".lore", "lore.db"));
  });

  // BOUNDARY — .lore/lore.db exists in an ANCESTOR directory, cwd is a nested subdir.
  it("walks upward past a nested cwd to find an ancestor .lore/lore.db", () => {
    mkdirSync(join(tmpDir, ".lore"), { recursive: true });
    writeFileSync(join(tmpDir, ".lore", "lore.db"), "");
    const nested = join(tmpDir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    process.chdir(nested);

    expect(findLoreDbPathQuiet(liveIo(), { cwd: process.cwd(), env: process.env })).toBe(join(tmpDir, ".lore", "lore.db"));
  });
});
