/**
 * Module: done-contract-migrate-input — parses the decision flags of `lore migrate done-contract`.
 *
 * Purpose: `--kind <slug>=<kind>`, `--red-waiver <slug>=<reason>` and `--tip <slug>=<commit>` are each repeatable; every
 *   one is `<slug>=<value>` split at the FIRST `=` (a reason may itself hold `=`, spaces, digits or `--`).
 * Public surface: {@link parseDoneContractDecisions}.
 * Invariants: pure; a malformed flag is returned as a usage message (the command exits 2), never repaired or dropped.
 * Side-effect class: pure.
 */

import { isTaskKind, TASK_KIND_LIST_TEXT, type TaskKind } from "@lore/core";
import type { MigrationDecisions } from "../../service/done-contract-migration-service.js";

function valuesOf(raw: unknown): string[] {
  if (raw === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((value) => String(value));
}

function split(flag: string, entry: string): { slug: string; value: string } | string {
  const at = entry.indexOf("=");
  if (at <= 0) return `--${flag} takes <slug>=<value>, got ${JSON.stringify(entry)}`;
  return { slug: entry.slice(0, at), value: entry.slice(at + 1) };
}

/**
 * @param kind - the raw `--kind` values
 * @param redWaiver - the raw `--red-waiver` values
 * @param tip - the raw `--tip` values
 * @returns the decisions, or a usage message
 * @example
 * parseDoneContractDecisions("t=check", undefined, undefined) // => { kinds: Map { "t" => "check" }, ... }
 */
export function parseDoneContractDecisions(kind: unknown, redWaiver: unknown, tip: unknown): MigrationDecisions | string {
  const kinds = new Map<string, TaskKind>();
  const redWaivers = new Map<string, string>();
  const tips = new Map<string, string>();
  for (const entry of valuesOf(kind)) {
    const parts = split("kind", entry);
    if (typeof parts === "string") return parts;
    if (!isTaskKind(parts.value)) return `--kind ${parts.slug}=${JSON.stringify(parts.value)}: the kind must be one of ${TASK_KIND_LIST_TEXT}`;
    kinds.set(parts.slug, parts.value);
  }
  for (const entry of valuesOf(redWaiver)) {
    const parts = split("red-waiver", entry);
    if (typeof parts === "string") return parts;
    if (parts.value.trim() === "") return `--red-waiver ${parts.slug}= needs a non-blank reason`;
    redWaivers.set(parts.slug, parts.value);
  }
  for (const entry of valuesOf(tip)) {
    const parts = split("tip", entry);
    if (typeof parts === "string") return parts;
    tips.set(parts.slug, parts.value);
  }
  return { kinds, redWaivers, tips };
}
