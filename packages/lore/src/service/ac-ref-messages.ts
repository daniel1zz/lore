/**
 * Refusal clauses for an evidence `ac_ref` that names an AC id its governing spec does not declare.
 *
 * One definition shared by `TaskWorkflowService` and `PhaseWorkflowService` (which may not import
 * each other) and by the tests that assert the refusal. Pure constants; the rule itself is the
 * VALIDATION_ERROR on field `ac_ref`, and these clauses name which spec was consulted.
 */

/** Task evidence resolved its governing spec through the plan's `ac_scope` and the id is not on it. */
export const AC_REF_NOT_ON_RESOLVED_GOVERNING_SPEC = "not declared on the resolved governing spec";

/** Evidence resolved the id against the parent spec and it is not declared there. */
export const AC_REF_NOT_ON_PARENT_SPEC = "not declared on the parent spec";
