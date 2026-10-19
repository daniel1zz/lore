/**
 * The runner a hand-built test `App` names: verify runs in-loop over the stub's own `AuditService`, which is what the
 * composition chooses for an InMemory-style store (`buildAuditVerifyRunner`, kind `memory`). The anchor root has no
 * `.lore/audit-anchor.json`, so the anchor reads as absent.
 */

import type { AuditService } from "../../src/service/audit-service.js";
import { buildAuditVerifyRunner, type AuditVerifyRunner } from "../../src/service/audit-verify-runner.js";

export function inLoopAuditVerifyRunner(auditService: AuditService, verifySince: string = auditService.verifySince): AuditVerifyRunner {
  return buildAuditVerifyRunner({ kind: "memory", auditService }, { verifySince, anchorRoot: "/nonexistent-lore-anchor-root" });
}
