/**
 * @spec_ref TECH-01KV4W88GZF74B98BHCBBV9GHD §4.2
 *
 * Pure graph traversal utilities — zero external dependencies.
 */

/**
 * Walks the ancestor chain from `startId` using `getParent`, detecting cycles.
 *
 * Returns `{ hasCycle: true, path }` immediately upon revisiting a node (handles
 * self-loops and arbitrary cycles). Returns `{ hasCycle: false, path }` when the
 * chain terminates naturally (`getParent` returns `null`).
 *
 * @param startId - The node ID to begin the walk from.
 * @param getParent - Pure function returning the parent ID or null for roots.
 * @returns `{ hasCycle, path }` where `path` is the sequence of nodes visited.
 */
export function ancestorChainWalk(
  startId: string,
  getParent: (id: string) => string | null,
): { hasCycle: boolean; path: string[] } {
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = startId;
  while (cur !== null) {
    if (seen.has(cur)) return { hasCycle: true, path };
    seen.add(cur);
    path.push(cur);
    cur = getParent(cur);
  }
  return { hasCycle: false, path };
}
