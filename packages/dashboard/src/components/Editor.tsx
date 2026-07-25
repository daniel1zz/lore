/**
 * Editor — CodeMirror 6 markdown editor with optional live preview panel.
 * Purpose: in-place markdown editing for dashboard write mode (SPEC-022 Q1).
 * Public surface: Editor, EditorProps
 * Invariants:
 *   - Editor mounts into a ref; unmounts cleanly via EditorView.destroy().
 *   - onChange is debounced ONLY for draft cache — explicit "Save" triggers save.
 *   - No auto-save on keystroke (risk mitigation per §6).
 *   - Split-view shows raw markdown on left, react-markdown preview on right.
 *   - Content changes fire onChange with the current text value.
 * Side-effect class: IO (DOM via CodeMirror)
 * Source: SPEC-022 §9.2, Q1
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EditorProps {
  /** Initial markdown content. Re-initialises the editor when changed. */
  initialValue: string;
  /** Callback fired on every content change with the current text. */
  onChange?: (value: string) => void;
  /** When true, show a side-by-side preview panel. Default: true. */
  splitView?: boolean;
  /** Additional CSS class for the editor container. */
  className?: string;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

// reason: CodeMirror injects its own styles; we need to ensure the host element
// fills the available height so the editor doesn't collapse to zero. These
// styles are applied inline to avoid Tailwind purging the dynamic class names.
const HOST_STYLE: React.CSSProperties = {
  height: "100%",
  minHeight: "300px",
  border: "1px solid hsl(var(--border))",
  borderRadius: "0.375rem",
  overflow: "hidden",
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Markdown editor using CodeMirror 6 with optional split-view preview.
 *
 * @example
 * <Editor
 *   initialValue={doc.content}
 *   onChange={(text) => setDraft(text)}
 *   splitView={true}
 * />
 */
export function Editor({
  initialValue,
  onChange,
  splitView = true,
  className,
}: EditorProps): React.ReactElement {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [previewContent, setPreviewContent] = useState(initialValue);

  const handleChange = useCallback(
    (value: string) => {
      setPreviewContent(value);
      onChange?.(value);
    },
    [onChange],
  );

  useEffect(() => {
    const host = editorHostRef.current;
    if (host === null) return;

    // Tear down any existing view before re-creating (e.g. initialValue changed).
    viewRef.current?.destroy();

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        handleChange(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        markdown(),
        updateListener,
        // reason: Use a light theme matching shadcn design tokens.
        // EditorView.theme patches the default dark CM theme to inherit background.
        EditorView.theme({
          "&": { backgroundColor: "transparent", height: "100%" },
          ".cm-scroller": { fontFamily: "ui-monospace, monospace", fontSize: "0.875rem" },
          ".cm-editor": { height: "100%" },
          ".cm-focused": { outline: "none" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  // reason: Re-initialise only when initialValue changes (not on every render).
  // onChange is captured in handleChange which is stable via useCallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: re-initialising CodeMirror on handleChange identity churn destroys+recreates the view per keystroke, dropping/scrambling rapidly typed input (observed regression, see reason above)
  }, [initialValue]);

  if (!splitView) {
    return (
      <div
        ref={editorHostRef}
        style={HOST_STYLE}
        className={className}
        aria-label="Markdown editor"
      />
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-2 ${className ?? ""}`} style={{ minHeight: "300px" }}>
      <div ref={editorHostRef} style={HOST_STYLE} aria-label="Markdown editor" />
      <div
        className="prose prose-sm max-w-none dark:prose-invert overflow-auto p-3 border rounded-md"
        style={{ minHeight: "300px" }}
        aria-label="Preview"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewContent}</ReactMarkdown>
      </div>
    </div>
  );
}
