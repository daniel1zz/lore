/**
 * Where `AuditService.verify` runs for the two long-lived servers (HTTP, MCP), and the one place that decides it.
 *
 * Why a runner exists: the full-chain verdict is O(rows) by design (SPEC-079 — the chain over the WHOLE trail),
 * and besides its reads it is CPU work in JS (the completeness join, one sha256 per audit row). On a long-lived
 * server's event loop that stalls every other request for the whole run, whatever the store's I/O model, so for
 * every persistent store the verdict is computed in a Bun Worker that opens its own connection to the same
 * corpus (`audit-verify-worker.ts`) and runs the unchanged `AuditService.verify`. The one-shot CLI does not use a
 * runner: it calls the service directly.
 *
 * Public surface: {@link buildAuditVerifyRunner}, {@link spawnAuditVerifyWorker} (the default worker port),
 * {@link readAuditAnchorFile}, and the types {@link AuditVerifyRunner}, {@link AuditVerifyStoreSpec},
 * {@link AuditVerifyJob}, {@link AuditVerifyWorkerPort}.
 *
 * Invariants:
 *   - The runner is chosen by STORE KIND, at composition, by name: `sqlite` -> worker, `turso` -> worker,
 *     `memory` -> in-loop. The InMemory store exists only in tests and its data lives in one thread (a worker
 *     cannot open it), so that is the sole in-loop server composition. A worker that fails to start or errors
 *     makes the request fail with that error — there is NO fallback to running the verify on the loop.
 *   - The verdict is unchanged: the worker runs `AuditService.verify` itself over the whole chain. No timeout,
 *     no cached result, no "since the last anchor" shortcut.
 *   - Anchor parity (D3): the runner reads `<anchorRoot>/.lore/audit-anchor.json` the way `lore audit --verify`
 *     does and passes it to verify, so every surface reports the same verdict for the same corpus. A present but
 *     malformed file is a refusal (VALIDATION_ERROR), never read as "absent".
 *   - The worker opens its store without writing: SQLite read-only (no migration, no journal change); Turso with
 *     the local replica path only — no remote URL, so it never syncs (an embedded replica syncing from two
 *     threads can conflict). The serving thread has already migrated the file before any verify runs.
 *
 * Side-effect class: IO (reads the anchor file; spawns a Worker).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { AuditAnchorRef, AuditService, AuditVerifyResult } from "./audit-service.js";

/** The store the verdict is computed over: persistent kinds name where the worker opens it; memory names the service. */
export type AuditVerifyStoreSpec =
  | { readonly kind: "sqlite"; readonly dbPath: string }
  | { readonly kind: "turso"; readonly localPath: string }
  | { readonly kind: "memory"; readonly auditService: AuditService };

/** What the worker receives: a persistent store location plus the verify inputs. Plain data (structured-cloneable). */
export interface AuditVerifyJob {
  readonly store: Exclude<AuditVerifyStoreSpec, { readonly kind: "memory" }>;
  /** The configured `audit.verify_since` watermark — the worker builds its own `AuditService` with it. */
  readonly verifySince: string;
  readonly since?: string;
  readonly anchor?: AuditAnchorRef;
}

/** Runs one verify job somewhere other than the calling thread. Injected in tests; {@link spawnAuditVerifyWorker} in production. */
export type AuditVerifyWorkerPort = (job: AuditVerifyJob) => Promise<Result<AuditVerifyResult, LoreError>>;

export interface AuditVerifyRunner {
  /** Which runner the composition chose — `worker` for every persistent store, `in-loop` for InMemory only. */
  readonly mode: "worker" | "in-loop";
  /** `since` overrides the configured watermark for this call only (as `lore audit --verify --since`). */
  verify(opts?: { readonly since?: string }): Promise<Result<AuditVerifyResult, LoreError>>;
}

// ─── .lore/audit-anchor.json ────────────────────────────────────────────────

export const auditAnchorFileSchema = z.object({
  head_id: z.number(),
  head_hash: z.string(),
  entry_count: z.number(),
  anchored_at: z.string(),
});

/** Shape of `.lore/audit-anchor.json`, written by `lore audit anchor` and read by every verify surface. */
export type AuditAnchorFile = z.infer<typeof auditAnchorFileSchema>;

const ANCHOR_FILE_LABEL = ".lore/audit-anchor.json";

/** `<corpusRoot>/.lore/audit-anchor.json` — the one place the file's location is spelled. */
export function auditAnchorFilePath(corpusRoot: string): string {
  return join(corpusRoot, ".lore", "audit-anchor.json");
}

/**
 * Reads and validates `<corpusRoot>/.lore/audit-anchor.json`. A missing file is `ok(undefined)` (verify reports the
 * anchor as `absent`); a present but unreadable/malformed file is a VALIDATION_ERROR naming the file, so a corrupted
 * trust root is never silently treated as absent. Same contract as `lore audit --verify`.
 */
export function readAuditAnchorFile(corpusRoot: string): Result<AuditAnchorRef | undefined, LoreError> {
  const path = auditAnchorFilePath(corpusRoot);
  if (!existsSync(path)) return ok(undefined);
  try {
    const parsed = auditAnchorFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    return ok({ head_id: parsed.head_id, head_hash: parsed.head_hash });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return err({ code: "VALIDATION_ERROR", field: ANCHOR_FILE_LABEL, message: `Malformed ${ANCHOR_FILE_LABEL}: ${detail}` });
  }
}

// ─── Worker port ────────────────────────────────────────────────────────────

function workerFailure(message: string): Result<never, LoreError> {
  return err({ code: "STORE_ERROR", message });
}

/**
 * Where the worker's entry file is. From source (`bun run src/index.ts`, tests) it is the sibling file by URL. In the
 * `bun build --compile` binary every module is bundled into one entry (`file:///$bunfs/root/index.js`), so a URL
 * relative to this module is wrong; the worker is a second compile entrypoint (scripts/build.ts) embedded at its path
 * under the entrypoints' common root, `packages/lore/src` — i.e. `service/audit-verify-worker.js`. This is a choice
 * by how the code was built, not a fallback: a missing embedded file still fails the verify with its error.
 */
function auditVerifyWorkerEntry(moduleUrl: string): string {
  return moduleUrl.startsWith("file:///$bunfs/")
    ? "/$bunfs/root/service/audit-verify-worker.js"
    : new URL("./audit-verify-worker.ts", moduleUrl).href;
}

/**
 * The production {@link AuditVerifyWorkerPort}: one Bun Worker per call, running `audit-verify-worker.ts`. The
 * worker's own verdict (including an error result) is returned as-is; a worker that cannot start, throws, or exits
 * without answering is reported as a STORE_ERROR carrying the worker's message verbatim.
 */
export const spawnAuditVerifyWorker: AuditVerifyWorkerPort = (job) =>
  new Promise((resolve) => {
    let settled = false;
    let worker: Worker;
    const settle = (outcome: Result<AuditVerifyResult, LoreError>): void => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      resolve(outcome);
    };
    try {
      worker = new Worker(auditVerifyWorkerEntry(import.meta.url));
    } catch (e) {
      resolve(workerFailure(`audit verify worker could not start: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    worker.addEventListener("message", (event: MessageEvent<Result<AuditVerifyResult, LoreError>>) => settle(event.data));
    worker.addEventListener("error", (event: ErrorEvent) => {
      event.preventDefault();
      settle(workerFailure(`audit verify worker failed: ${event.message}`));
    });
    worker.addEventListener("messagerror", () => settle(workerFailure("audit verify worker returned a result that could not be received")));
    worker.addEventListener("close", () => settle(workerFailure("audit verify worker exited without a result")));
    worker.postMessage(job);
  });

// ─── Composition ────────────────────────────────────────────────────────────

/**
 * Builds the runner for a store kind — the single decision point (see the module invariants).
 *
 * @param spec - the store kind and where the worker opens it (or, for `memory`, the in-thread service)
 * @param deps.verifySince - the configured `audit.verify_since` watermark
 * @param deps.anchorRoot - the project root whose `.lore/audit-anchor.json` is passed to verify
 * @param deps.workerPort - overrides the worker spawn (tests); defaults to {@link spawnAuditVerifyWorker}
 */
export function buildAuditVerifyRunner(
  spec: AuditVerifyStoreSpec,
  deps: { readonly verifySince: string; readonly anchorRoot: string; readonly workerPort?: AuditVerifyWorkerPort },
): AuditVerifyRunner {
  if (spec.kind === "memory") {
    const service = spec.auditService;
    return {
      mode: "in-loop",
      async verify(opts) {
        const anchor = readAuditAnchorFile(deps.anchorRoot);
        if (!anchor.ok) return anchor;
        return service.verify({
          ...(opts?.since !== undefined ? { since: opts.since } : {}),
          ...(anchor.value !== undefined ? { anchor: anchor.value } : {}),
        });
      },
    };
  }

  const store = spec;
  const port = deps.workerPort ?? spawnAuditVerifyWorker;
  return {
    mode: "worker",
    async verify(opts) {
      const anchor = readAuditAnchorFile(deps.anchorRoot);
      if (!anchor.ok) return anchor;
      const job: AuditVerifyJob = {
        store,
        verifySince: deps.verifySince,
        ...(opts?.since !== undefined ? { since: opts.since } : {}),
        ...(anchor.value !== undefined ? { anchor: anchor.value } : {}),
      };
      try {
        return await port(job);
      } catch (e) {
        return workerFailure(`audit verify worker failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
