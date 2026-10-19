/**
 * The runner a hand-built test `App` names: verify runs in-loop over the stub's own `AuditService`, which is what the
 * composition chooses for an InMemory-style store (`buildAuditVerifyRunner`, kind `memory`). The anchor root has no
 * `.lore/audit-anchor.json`, so the anchor reads as absent. A stub whose `auditService` is a null-cast never has
 * verify called on it; the runner then simply holds that same null service.
 */

import type { AuditService } from "../../src/service/audit-service.js";
import { buildAuditVerifyRunner, type AuditVerifyRunner } from "../../src/service/audit-verify-runner.js";

const STUB_VERIFY_SINCE = "2000-01-01T00:00:00.000Z";

export function inLoopAuditVerifyRunner(auditService: AuditService): AuditVerifyRunner {
  return buildAuditVerifyRunner(
    { kind: "memory", auditService },
    { verifySince: STUB_VERIFY_SINCE, anchorRoot: "/nonexistent-lore-anchor-root" },
  );
}
