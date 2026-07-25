/**
 * Last-viewed project — localStorage-only client state (SPEC-078 D5).
 * Purpose: remember which registry project the user last switched to, so the
 *   multi-mode `/` redirect (`use-project-redirect.ts`) and the `ProjectSwitcher`
 *   dropdown can restore it across page loads without any server-side session
 *   concept — the spec's own D5 decision text pins this as "localStorage only".
 * Public surface: getLastViewedProject, setLastViewedProject
 * Invariants:
 *   - Opportunistic UX only, never authoritative — a missing/corrupt/quota-full
 *     localStorage value degrades to `null` (caller falls through to the next
 *     priority: first registry entry), mirroring `store/draft.ts`'s
 *     "swallow storage errors" convention for this exact same reason (private
 *     browsing, quota exceeded).
 *   - Stores the raw project NAME as a bare string (not JSON-wrapped) — there
 *     is no metadata to carry, unlike `DraftEntry`'s richer shape.
 * Side-effect class: IO (localStorage)
 * Source: SPEC-078 D5 ("Last-viewed project: localStorage only")
 */

const STORAGE_KEY = "lore_last_viewed_project";

/**
 * Read the last-viewed project name.
 *
 * @returns The stored project name, or `null` when absent or localStorage is
 *   unavailable (private browsing, quota exceeded — swallowed silently, same
 *   as `store/draft.ts::loadDraft`).
 */
export function getLastViewedProject(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // reason: localStorage may be unavailable in private browsing or when quota
    // exceeded — this is opportunistic UX, never authoritative. Silent per invariant.
    return null;
  }
}

/**
 * Persist the last-viewed project name. Called on every switcher selection
 * (SPEC-078 T10 deliverable 4).
 *
 * @param project - The project name just switched to.
 */
export function setLastViewedProject(project: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, project);
  } catch {
    // reason: silent failure — same invariant as store/draft.ts::saveDraft.
  }
}
