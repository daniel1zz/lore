/**
 * DocTree — recursive collapsible tree of documents.
 * Purpose: renders the corpus tree structure with expand/collapse per node.
 * Public surface: DocTree, DocTreeProps
 * Invariants: read-only. No mutations. Collapse state is local to component.
 * Side-effect class: stateful (collapse state per node)
 */

import { useState } from "react";
import { ChevronRight, ChevronDown, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/lib/api";

export interface DocTreeProps {
  /** Top-level nodes to render. */
  nodes: TreeNode[];
  /** Called when a node is clicked. */
  onSelect?: (node: TreeNode) => void;
  /** Visual depth level (used for indentation). */
  depth?: number;
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
        <span className="flex-1 truncate">{node.title}</span>
        <Badge variant="outline" className="text-xs shrink-0">
          {node.type}
        </Badge>
      </div>

      {hasChildren && isExpanded && (
        <ul>
          {node.children.map((child) => (
            // reason: exactOptionalPropertyTypes forbids passing `undefined` for optional props;
            // conditional spread omits the prop entirely when onSelect is not provided.
            <DocTreeNode key={child.id} node={child} {...(onSelect ? { onSelect } : {})} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Collapsible document tree. Nodes at depth < 2 start expanded.
 *
 * @example
 * <DocTree nodes={treeData} onSelect={(node) => navigate({ to: '/docs/$id', params: { id: node.id } })} />
 */
export function DocTree({ nodes, onSelect, depth = 0 }: DocTreeProps): React.ReactElement {
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No documents in tree.</p>;
  }

  return (
    <ul className="space-y-0.5" role="tree">
      {nodes.map((node) => (
        <DocTreeNode key={node.id} node={node} {...(onSelect ? { onSelect } : {})} depth={depth} />
      ))}
    </ul>
  );
}
