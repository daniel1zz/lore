/**
 * Test fixture: an OverrideDecisionPort that answers `auto` for every request, recording what was asked.
 *
 * Named for what it is: it stands in for "the class was loosened and the decision came back auto" so a UNIT test of a
 * service that is not about the autonomy gate can exercise its override path. It is a test double only; product code
 * never builds one, and a service with NO port refuses an override loudly (override-decision.ts requireOverrideAuto).
 * Tests whose subject IS the gate use the real port (tests/integration/autonomy-human-set.test.ts).
 */
import { ok } from "@lore/core";
import type { OverrideDecisionPort, OverrideRequest } from "../../src/service/override-decision.js";

export interface RecordingOverridePort extends OverrideDecisionPort {
  readonly asked: OverrideRequest[];
}

/** A port that grants every override and remembers the requests. */
export function alwaysAutoOverridePort(): RecordingOverridePort {
  const asked: OverrideRequest[] = [];
  return {
    asked,
    requireAuto: async (request) => {
      asked.push(request);
      return ok(undefined);
    },
  };
}
