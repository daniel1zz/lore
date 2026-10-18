/**
 * Helper for tests whose subject is NOT the autonomy gate but which exercise a self-grantable override
 * (`approve --override-*`, `done --override-attestation`, `ac exempt`, `verify --yes`).
 *
 * Those overrides are decided (AC-AU-7): with the seeded prior 0.5 they escalate. A test that needs the override to
 * APPLY gets the documented human path: a throwaway corpus whose override classes were loosened through a human-tty
 * governance-loosen decision (`lore autonomy set <class> --prior`, the pending decision answered by the real
 * `lore decide` flow with scripted human-channel ports). There is NO bypass flag or env var in product code.
 */
import { join } from "node:path";
import { lore, runDecide, type Corpus } from "./autonomy-calibration-helpers.js";

/** The self-grantable override classes whose seeded prior escalates (verify-new-command's prior is already 0.95). */
export const OVERRIDE_CLASSES_AT_LOW_PRIOR = ["override-judgment", "override-attestation", "ac-exempt"] as const;

/** A `Corpus` handle over an existing `lore init`-ed directory. */
export function corpusAt(dir: string): Corpus {
  return { dir, dbPath: join(dir, ".lore", "lore.db") };
}

/**
 * Raises `classes`' prior C to `prior` through the human path: set -> exit 4 + pending governance-loosen decision ->
 * human-tty accept (real `lore decide` flow, scripted ports) -> the same set again applies.
 *
 * @throws Error when any step does not behave as the human path documents (a fixture failure, not a product assertion)
 */
export async function loosenOverrideClasses(
  dir: string,
  classes: readonly string[] = OVERRIDE_CLASSES_AT_LOW_PRIOR,
  prior = 0.95,
): Promise<void> {
  const corpus = corpusAt(dir);
  for (const classId of classes) {
    const first = lore(corpus, ["autonomy", "set", classId, "--prior", String(prior)]);
    if (first.exitCode === 0) continue; // already at or above this prior (tightening / noop applies at once)
    const pendingId = Number(/Pending decision (\d+) created/.exec(first.stderr + first.stdout)?.[1]);
    if (first.exitCode !== 4 || !(pendingId > 0)) {
      throw new Error(`loosening ${classId} did not escalate to a pending decision: exit ${first.exitCode}\n${first.stdout}\n${first.stderr}`);
    }
    const accepted = await runDecide(corpus, pendingId, "accept");
    if (accepted.code !== 0) throw new Error(`human accept of decision ${pendingId} failed: ${accepted.code}\n${accepted.stderr}`);
    const applied = lore(corpus, ["autonomy", "set", classId, "--prior", String(prior)]);
    if (applied.exitCode !== 0) throw new Error(`re-running the loosening for ${classId} failed: ${applied.exitCode}\n${applied.stderr}`);
  }
}
