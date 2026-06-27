/**
 * DocDetail — full document view with metadata table, markdown body, and navigation footer.
 * Purpose: renders the complete doc view for the /docs/$id route.
 * Public surface: DocDetail, DocDetailProps
 * Invariants: read-only. All write paths (edit, approve, etc.) are out of scope for SPEC-015.
 * Side-effect class: pure
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { DocWithNavigation } from "@/lib/api";

export interface DocDetailProps {
  /** Document with navigation context from the API. */
  docWithNav: DocWithNavigation;
  /** Called when the user clicks on a sibling/related doc ID. */
  onNavigate?: (idOrSlug: string) => void;
}

/**
 * Full document detail view. Renders markdown content and navigation sidebar context.
 *
 * @example
 * <DocDetail docWithNav={data} onNavigate={(id) => navigate({ to: '/docs/$id', params: { id } })} />
 */
export function DocDetail({ docWithNav, onNavigate }: DocDetailProps): React.ReactElement {
  const { doc, navigation } = docWithNav;

  return (
    <article className="max-w-4xl mx-auto space-y-6">
      <header>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="secondary">{doc.type}</Badge>
          <Badge variant="outline">{doc.status}</Badge>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{doc.title}</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono">{doc.slug}</p>
      </header>

      <Separator />

      <section aria-label="Document metadata">
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium w-32">ID</TableCell>
              <TableCell className="font-mono text-xs">{doc.id}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Created</TableCell>
              <TableCell>{new Date(doc.created_at).toLocaleDateString()}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Updated</TableCell>
              <TableCell>{new Date(doc.updated_at).toLocaleDateString()}</TableCell>
            </TableRow>
            {doc.created_by !== null && (
              <TableRow>
                <TableCell className="font-medium">Author</TableCell>
                <TableCell>{doc.created_by}</TableCell>
              </TableRow>
            )}
            {doc.tags !== undefined && doc.tags.length > 0 && (
              <TableRow>
                <TableCell className="font-medium">Tags</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {doc.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <Separator />

      <section aria-label="Document content" className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
      </section>

      {(navigation.parent !== null || navigation.siblings.length > 0 || navigation.children.length > 0) && (
        <>
          <Separator />
          <footer aria-label="Document navigation" className="space-y-3">
            {navigation.parent !== null && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Parent</p>
                <button
                  className="text-sm text-primary hover:underline"
                  onClick={() => onNavigate?.(navigation.parent!.id)}
                  type="button"
                >
                  {navigation.parent.title}
                </button>
              </div>
            )}
            {navigation.children.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Children</p>
                <div className="flex flex-wrap gap-2">
                  {navigation.children.map((child) => (
                    <button
                      key={child.id}
                      className="text-sm text-primary hover:underline"
                      onClick={() => onNavigate?.(child.id)}
                      type="button"
                    >
                      {child.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </footer>
        </>
      )}
    </article>
  );
}
