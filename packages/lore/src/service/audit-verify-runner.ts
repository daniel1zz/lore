import type { AuditService, AuditVerifyResult, AuditAnchorRef } from "./audit-service.js";
import type { LoreError, Result } from "@lore/core";

export type AuditVerifyStoreSpec =
  | { kind: "sqlite"; dbPath: string }
  | { kind: "turso"; localPath: string }
  | { kind: "memory"; auditService: AuditService };

export interface AuditVerifyJob {
  store: Exclude<AuditVerifyStoreSpec, { kind: "memory" }>;
  verifySince: string;
  since?: string;
  anchor?: AuditAnchorRef;
}

export type AuditVerifyWorkerPort = (job: AuditVerifyJob) => Promise<Result<AuditVerifyResult, LoreError>>;

export interface AuditVerifyRunner {
  readonly mode: "worker" | "in-loop";
  verify(opts?: { since?: string }): Promise<Result<AuditVerifyResult, LoreError>>;
}

export function buildAuditVerifyRunner(
  _spec: AuditVerifyStoreSpec,
  _deps: { verifySince: string; anchorRoot: string; workerPort?: AuditVerifyWorkerPort },
): AuditVerifyRunner {
  throw new Error("not implemented");
}
