/**
 * Utility helpers for the dashboard.
 * Purpose: cn() className merger — single utility used across all UI components.
 * Public surface: cn
 * Invariants: pure, no side effects.
 * Side-effect class: pure
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names with Tailwind conflict resolution.
 * Combines clsx (conditional classes) with tailwind-merge (Tailwind deduplication).
 *
 * @example
 * cn("px-4 py-2", isPrimary && "bg-primary", "text-sm")
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
