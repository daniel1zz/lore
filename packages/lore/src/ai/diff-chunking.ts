/**
 * Splits a plan's unified diff into file chunks that each fit one judge call (BR-1499, no silent truncation).
 *
 * Purpose: packs whole files, in diff order, into chunks of at most `budget` characters; a file that alone exceeds the
 *   budget is never cut, it is returned in `unseen` so the review can list it and refuse to pass a gate over it.
 * Public surface: chunkDiffByFile, DiffChunk, DiffChunking.
 * Invariants:
 *   - Every file of the diff is in exactly one chunk or in `unseen`; none is dropped or cut mid-body.
 *   - A chunk's `text` is its files joined with "\n" and is at most `budget` characters.
 *   - A diff within the budget is one chunk holding the diff byte-identically.
 *   - No IO, no clock: pure function of its inputs.
 * Side-effect class: pure.
 *
 * Reference: first-fit sequential bin packing (order-preserving, so a chunk reads like a contiguous slice of the diff).
 */

import { splitDiffByFile } from "./diff-truncation.js";

/** One chunk: the files it holds, its text and the changed-line counts per file. */
export interface DiffChunk {
  readonly files: readonly { readonly path: string; readonly added: number; readonly removed: number }[];
  readonly text: string;
}

/** The result of chunking: chunks within the budget, every file of the diff, and the files no chunk can hold. */
export interface DiffChunking {
  readonly chunks: readonly DiffChunk[];
  readonly allFiles: readonly string[];
  readonly unseen: readonly string[];
}

function countChangedLines(text: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

/**
 * Chunks a diff by file within a per-call character budget.
 *
 * @param diffText - the plan's unified diff
 * @param budget - the per-call character budget for diff text (positive)
 * @returns the chunks, all file paths and the files that alone exceed the budget
 * @example
 * chunkDiffByFile(diff, 80000).unseen // [] when every file fits a call
 */
export function chunkDiffByFile(diffText: string, budget: number): DiffChunking {
  const files = splitDiffByFile(diffText);
  const allFiles = files.map((f) => f.filePath);
  if (diffText.length <= budget) {
    return {
      chunks: [{ files: files.map((f) => ({ path: f.filePath, ...countChangedLines(f.text) })), text: diffText }],
      allFiles,
      unseen: [],
    };
  }
  const chunks: { files: DiffChunk["files"][number][]; texts: string[]; length: number }[] = [];
  const unseen: string[] = [];
  for (const file of files) {
    if (file.text.length > budget) {
      unseen.push(file.filePath);
      continue;
    }
    const current = chunks[chunks.length - 1];
    // reason: one "\n" separator joins two files of a chunk, so it counts against the budget
    const added = current === undefined ? file.text.length : file.text.length + 1;
    if (current !== undefined && current.length + added <= budget) {
      current.files.push({ path: file.filePath, ...countChangedLines(file.text) });
      current.texts.push(file.text);
      current.length += added;
    } else {
      chunks.push({ files: [{ path: file.filePath, ...countChangedLines(file.text) }], texts: [file.text], length: file.text.length });
    }
  }
  return { chunks: chunks.map((c) => ({ files: c.files, text: c.texts.join("\n") })), allFiles, unseen };
}
