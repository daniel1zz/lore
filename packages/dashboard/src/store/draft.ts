/**
 * Draft cache — persist in-progress edits to localStorage.
 * Purpose: recover unsaved content if the user closes/refreshes the page mid-edit.
 * Public surface: saveDraft, loadDraft, clearDraft, DraftEntry
 * Invariants:
 *   - Draft is keyed by doc_id — one draft per document.
 *   - Draft is opportunistic UX — never authoritative (server wins on conflict).
 *   - All functions swallow storage errors (privacy mode, quota exceeded, etc.).
 *   - Draft is stale when the stored version differs from the current server version.
 * Side-effect class: IO (localStorage)
 * Source: SPEC-022 §6 (Risk: "User edits then refreshes losing draft")
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single draft entry keyed by doc_id. */
export interface DraftEntry {
  /** Document ULID. */
  doc_id: string;
  /** Server version the draft was based on (used to detect stale draft). */
  version: number;
  /** Draft content. */
  content: string;
  /** ISO 8601 timestamp of last edit. */
  last_edited_at: string;
}

// ─── Storage key ─────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "lore_draft_";

function storageKey(docId: string): string {
  return `${STORAGE_PREFIX}${docId}`;
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Persist a draft for a specific document.
 * Overwrites any existing draft for the same doc_id.
 * Swallows storage errors (quota exceeded, privacy mode).
 *
 * @param entry - Draft data to persist.
 */
export function saveDraft(entry: DraftEntry): void {
  try {
    localStorage.setItem(storageKey(entry.doc_id), JSON.stringify(entry));
  } catch {
    // reason: localStorage may be unavailable in private browsing or when quota exceeded.
    // Draft is an opportunistic feature — failure is silent per invariant.
  }
}

/**
 * Load a draft for a specific document.
 * Returns null if no draft exists or the stored value is corrupt.
 *
 * @param docId - Document ULID.
 * @returns DraftEntry or null.
 */
export function loadDraft(docId: string): DraftEntry | null {
  try {
    const raw = localStorage.getItem(storageKey(docId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as DraftEntry).doc_id !== "string" ||
      typeof (parsed as DraftEntry).version !== "number" ||
      typeof (parsed as DraftEntry).content !== "string"
    ) {
      return null;
    }
    return parsed as DraftEntry;
  } catch {
    return null;
  }
}

/**
 * Remove the draft for a specific document.
 * Called after a successful save or when the user discards changes.
 *
 * @param docId - Document ULID.
 */
export function clearDraft(docId: string): void {
  try {
    localStorage.removeItem(storageKey(docId));
  } catch {
    // reason: silent failure — same invariant as saveDraft
  }
}

/**
 * Check whether a draft is stale relative to the server version.
 * A draft is stale when the doc was updated after the draft was created.
 *
 * @param draft - Loaded draft entry.
 * @param serverVersion - Current server version of the document.
 * @returns true when the draft should be discarded.
 */
export function isDraftStale(draft: DraftEntry, serverVersion: number): boolean {
  return draft.version < serverVersion;
}
