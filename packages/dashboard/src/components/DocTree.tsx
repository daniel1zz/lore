/**
 * DocTree — recursive collapsible tree of documents.
 * Purpose: renders the corpus tree structure with expand/collapse per node.
 * Public surface: DocTree, DocTreeProps
 * Invariants: read-only. No mutations. Collapse state is local to component.
 *   The corpus tree has exactly one root (`CorpusService.tree` returns a single
 *   recursive `TreeNode`, never a forest) — `root` is a singular prop, not an array.
 *   Doc fields (title/type/id/slug) live under `node.doc`, not flattened onto the node.
 * Side-effect class: stateful (collapse state per node)
 */

import { useState } from "react";
import { ChevronRight, ChevronDown, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/lib/api";

export interface DocTreeProps {
  /** Root node of the tree, or null/undefined when there is nothing to render. */
  root: TreeNode | null | undefined;
  /** Called when a node is clicked. */
  onSelect?: (node: TreeNode) => void;
}

interface DocTreeNodeProps {
  node: TreeNode;
  onSelect?: (node: TreeNode) => void;
  depth: number;
}

/**
 * Single expandable tree node with optional children.
 *
 * @invariant The chevron and the title are two independently interactive elements.
 *   The chevron button ONLY toggles expansion (stopPropagation, no `onSelect`); the
 *   title area ONLY navigates (`onSelect`, never toggles). Before SPEC-037 D4 a single
 *   click handler did both, so expanding a collapsed node always navigated away —
 *   depth>=2 subtrees were effectively unreachable in the tree view. `aria-expanded`
 *   lives on the chevron button (the element that actually owns expand/collapse state),
 *   not on the row (which no longer claims expandable semantics since it navigates).
 */
function DocTreeNode({ node, onSelect, depth }: DocTreeNodeProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  const toggleExpanded = (e: { stopPropagation: () => void }): void => {
    e.stopPropagation();
    setIsExpanded((prev) => !prev);
  };

  return (
    <li>
      <div
        className={cn("flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-accent", "text-sm transition-colors")}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 flex items-center justify-center h-3 w-3 cursor-pointer"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.doc.title}`}
            onClick={toggleExpanded}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleExpanded(e);
              }
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
          </button>
        ) : (
          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span
          className="flex-1 truncate cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => onSelect?.(node)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect?.(node);
            }
          }}
        >
          {node.doc.title}
        </span>
        <Badge variant="outline" className="text-xs shrink-0">
          {node.doc.type}
        </Badge>
      </div>

      {hasChildren && isExpanded && (
        <ul>
          {node.children.map((child) => (
            // reason: exactOptionalPropertyTypes forbids passing `undefined` for optional props;
            // conditional spread omits the prop entirely when onSelect is not provided.
            <DocTreeNode key={child.doc.id} node={child} {...(onSelect ? { onSelect } : {})} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Collapsible document tree rooted at a single node. Nodes at depth < 2 start expanded.
 *
 * @example
 * <DocTree root={treeRoot} onSelect={(node) => navigate({ to: '/docs/$id', params: { id: node.doc.id } })} />
 */
export function DocTree({ root, onSelect }: DocTreeProps): React.ReactElement {
  if (root == null) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No documents in tree.</p>;
  }

  return (
    <ul className="space-y-0.5" role="tree">
      <DocTreeNode node={root} {...(onSelect ? { onSelect } : {})} depth={0} />
    </ul>
  );
}
