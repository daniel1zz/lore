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
 */
function DocTreeNode({ node, onSelect, depth }: DocTreeNodeProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-accent cursor-pointer",
          "text-sm transition-colors",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        role="button"
        tabIndex={0}
        aria-expanded={hasChildren ? isExpanded : undefined}
        onClick={() => {
          if (hasChildren) setIsExpanded((prev) => !prev);
          onSelect?.(node);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (hasChildren) setIsExpanded((prev) => !prev);
            onSelect?.(node);
          }
        }}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 truncate">{node.doc.title}</span>
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
