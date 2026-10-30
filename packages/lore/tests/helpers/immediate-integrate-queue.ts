/**
 * A merge-queue port for tests that drive `IntegrateService` alone, with no other landing in flight: every turn is the head at once.
 * The queue itself (tickets, order, dead holders, timeout) is tested through the compiled binary in
 * `tests/e2e/done-contract-queue-compiled.bun.test.ts`.
 */
import type { IntegrateQueuePort, QueueTicket } from "../../src/service/integrate-queue";

export function immediateIntegrateQueue(): IntegrateQueuePort {
  let seq = 0;
  return {
    async take(taker): Promise<QueueTicket> {
      seq += 1;
      return { pid: process.pid, start_time: "test", session: taker.session, branch: taker.branch, since: "1970-01-01T00:00:00.000Z", seq, file: `/nonexistent/${seq}.ticket` };
    },
    async waitForTurn(): Promise<void> {},
    release(): void {},
  };
}
