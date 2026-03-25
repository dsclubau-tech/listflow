"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentType, CSSProperties } from "react";
import "react-quill-new/dist/quill.snow.css";
import { quillFormats } from "@/lib/quill-config";

const COLOR_OPTIONS = [
  "",
  "#000000",
  "#e60000",
  "#ff9900",
  "#ffff00",
  "#008a00",
  "#0066cc",
  "#9933ff",
  "#ffffff",
  "#facccc",
  "#ffebcc",
  "#ffffcc",
  "#cce8cc",
  "#cce0f5",
  "#ebd6ff",
  "#bbbbbb",
  "#f06666",
  "#ffc266",
  "#ffff66",
  "#66b966",
  "#66a3e0",
  "#c285ff",
  "#888888",
  "#a10000",
  "#b26b00",
  "#b2b200",
  "#006100",
  "#0047b2",
  "#6b24b2",
  "#444444",
  "#5c0000",
  "#663d00",
  "#666600",
  "#003700",
  "#002966",
  "#3d1466",
];

type ReactQuillComponent = ComponentType<Record<string, unknown>>;

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
}

let quillConfigured = false;

type QuillRegistrar = {
  import: (path: string) => unknown;
  register: (...args: unknown[]) => void;
};

type BlotBaseCtor = new (...args: never[]) => Record<string, unknown>;

function registerCustomFormats(Quill: QuillRegistrar) {
  if (quillConfigured) return;

  const BlockEmbed = Quill.import("blots/block/embed") as BlotBaseCtor;

  class DividerBlot extends BlockEmbed {
    static blotName = "divider";
    static tagName = "HR";
  }

  Quill.register(DividerBlot, true);
  quillConfigured = true;
}

function parsePositiveInt(raw: string | null): number | null {
  if (raw == null) return null;

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    window.alert("Enter a whole number between 1 and 10.");
    return null;
  }

  return value;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = "18rem",
  className = "",
}: RichTextEditorProps) {
  const toolbarId = `rich-text-toolbar-${useId().replace(/:/g, "")}`;
  const editorRef = useRef<{
    getEditor: () => {
      focus: () => void;
      getLength: () => number;
      getModule: (name: string) => {
        insertTable?: (rows: number, columns: number) => void;
        undo?: () => void;
        redo?: () => void;
      } | null;
      getSelection: (focus?: boolean) => { index: number; length: number } | null;
      deleteText: (index: number, length: number, source?: string) => void;
      format: (name: string, value: unknown, source?: string) => void;
      insertEmbed: (index: number, type: string, value: unknown, source?: string) => void;
      insertText: (index: number, text: string, source?: string) => void;
      setSelection: (index: number, length?: number, source?: string) => void;
    };
  } | null>(null);
  const [EditorComponent, setEditorComponent] = useState<ReactQuillComponent | null>(null);
  const [isSourceMode, setIsSourceMode] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void import("react-quill-new").then((mod) => {
      registerCustomFormats(mod.Quill);
      if (!cancelled) {
        setEditorComponent(() => mod.default as ReactQuillComponent);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const modules = useMemo(
    () => ({
      toolbar: {
        container: `#${toolbarId}`,
      },
      history: {
        delay: 400,
        maxStack: 100,
        userOnly: true,
      },
    }),
    [toolbarId],
  );
  const quillToolbarDisabled = isSourceMode || !EditorComponent;

  const getEditor = useCallback(() => editorRef.current?.getEditor() ?? null, []);

  const withEditorSelection = useCallback(
    (callback: (editor: NonNullable<ReturnType<typeof getEditor>>, index: number, length: number) => void) => {
      const editor = getEditor();
      if (!editor) return;

      editor.focus();
      const range = editor.getSelection(true) ?? { index: editor.getLength(), length: 0 };
      callback(editor, range.index, range.length);
    },
    [getEditor],
  );

  const insertTextAtCursor = useCallback(
    (text: string) => {
      if (!text) return;

      withEditorSelection((editor, index, length) => {
        if (length > 0) {
          editor.deleteText(index, length, "user");
        }
        editor.insertText(index, text, "user");
        editor.setSelection(index + text.length, 0, "silent");
      });
    },
    [withEditorSelection],
  );

  const handleUnlink = useCallback(() => {
    withEditorSelection((editor, index, length) => {
      if (length > 0) {
        editor.format("link", false, "user");
        return;
      }

      editor.format("link", false, "user");
      editor.setSelection(index, 0, "silent");
    });
  }, [withEditorSelection]);

  const handleInsertTable = useCallback(() => {
    const rows = parsePositiveInt(window.prompt("Number of rows", "2"));
    if (rows == null) return;

    const columns = parsePositiveInt(window.prompt("Number of columns", "2"));
    if (columns == null) return;

    const editor = getEditor();
    const table = editor?.getModule("table");
    table?.insertTable?.(rows, columns);
    editor?.focus();
  }, [getEditor]);

  const handleInsertDivider = useCallback(() => {
    withEditorSelection((editor, index, length) => {
      const insertIndex = index + length;
      editor.insertText(insertIndex, "\n", "user");
      editor.insertEmbed(insertIndex + 1, "divider", true, "user");
      editor.insertText(insertIndex + 2, "\n", "user");
      editor.setSelection(insertIndex + 3, 0, "silent");
    });
  }, [withEditorSelection]);

  const handleInsertEmoji = useCallback(() => {
    const text = window.prompt("Enter an emoji or special character", "🙂");
    if (!text) return;
    insertTextAtCursor(text);
  }, [insertTextAtCursor]);

  const handleInsertSymbol = useCallback(() => {
    const text = window.prompt("Enter a symbol", "Ω");
    if (!text) return;
    insertTextAtCursor(text);
  }, [insertTextAtCursor]);

  const handleUndo = useCallback(() => {
    const editor = getEditor();
    editor?.getModule("history")?.undo?.();
    editor?.focus();
  }, [getEditor]);

  const handleRedo = useCallback(() => {
    const editor = getEditor();
    editor?.getModule("history")?.redo?.();
    editor?.focus();
  }, [getEditor]);

  const rootStyle = {
    "--listflow-quill-min-height": minHeight,
  } as CSSProperties;

  return (
    <div className={`listflow-rich-text ${className}`.trim()} style={rootStyle}>
      <div id={toolbarId} className="listflow-quill-toolbar" role="toolbar" aria-label="Rich text editor toolbar">
        <span className="ql-formats">
          <button type="button" className="ql-bold" aria-label="Bold" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-italic" aria-label="Italic" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-underline" aria-label="Underline" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-strike" aria-label="Strikethrough" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-script" value="sub" aria-label="Subscript" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-script" value="super" aria-label="Superscript" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-clean" aria-label="Clear formatting" disabled={quillToolbarDisabled} />
        </span>

        <span className="ql-formats">
          <button type="button" className="ql-list" value="ordered" aria-label="Ordered list" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-list" value="bullet" aria-label="Bullet list" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-blockquote" aria-label="Blockquote" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-align" value="" aria-label="Align left" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-align" value="center" aria-label="Align center" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-align" value="right" aria-label="Align right" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-align" value="justify" aria-label="Justify" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-indent" value="-1" aria-label="Decrease indent" disabled={quillToolbarDisabled} />
          <button type="button" className="ql-indent" value="+1" aria-label="Increase indent" disabled={quillToolbarDisabled} />
        </span>

        <span className="ql-formats">
          <button type="button" className="ql-link" aria-label="Insert link" disabled={quillToolbarDisabled} />
          <button
            type="button"
            className="listflow-quill-action"
            onClick={handleUnlink}
            disabled={quillToolbarDisabled}
          >
            Unlink
          </button>
          <button type="button" className="ql-image" aria-label="Insert image" disabled={quillToolbarDisabled} />
          <button
            type="button"
            className="listflow-quill-action"
            onClick={handleInsertTable}
            disabled={quillToolbarDisabled}
          >
            Table
          </button>
          <button
            type="button"
            className="listflow-quill-action"
            onClick={handleInsertDivider}
            disabled={quillToolbarDisabled}
          >
            HR
          </button>
          <button
            type="button"
            className="listflow-quill-action"
            onClick={handleInsertEmoji}
            disabled={quillToolbarDisabled}
          >
            Emoji
          </button>
          <button
            type="button"
            className="listflow-quill-action"
            onClick={handleInsertSymbol}
            disabled={quillToolbarDisabled}
          >
            Ω
          </button>
        </span>

        <span className="ql-formats">
          <select className="ql-font" defaultValue="" aria-label="Font family" disabled={quillToolbarDisabled}>
            <option value="" />
            <option value="serif" />
            <option value="monospace" />
          </select>
          <select className="ql-size" defaultValue="" aria-label="Font size" disabled={quillToolbarDisabled}>
            <option value="small" />
            <option value="" />
            <option value="large" />
            <option value="huge" />
          </select>
          <select className="ql-color" defaultValue="" aria-label="Text color" disabled={quillToolbarDisabled}>
            {COLOR_OPTIONS.map((color) => (
              <option key={`color-${color || "default"}`} value={color} />
            ))}
          </select>
          <select className="ql-background" defaultValue="" aria-label="Highlight color" disabled={quillToolbarDisabled}>
            {COLOR_OPTIONS.map((color) => (
              <option key={`background-${color || "default"}`} value={color} />
            ))}
          </select>
        </span>

        <span className="ql-formats">
          <button
            type="button"
            className="listflow-quill-action"
            data-active={isSourceMode}
            onClick={() => setIsSourceMode((current) => !current)}
            disabled={!EditorComponent}
          >
            Source
          </button>
          <button
            type="button"
            className="listflow-quill-action"
            onClick={handleUndo}
            disabled={quillToolbarDisabled}
          >
            Undo
          </button>
          <button
            type="button"
            className="listflow-quill-action"
            onClick={handleRedo}
            disabled={quillToolbarDisabled}
          >
            Redo
          </button>
        </span>
      </div>

      {!EditorComponent ? (
        <div className="listflow-quill-loading border border-gray-300 border-t-0 rounded-b-md px-4 py-3 text-sm text-gray-500 bg-white">
          Loading editor…
        </div>
      ) : (
        <>
          <EditorComponent
            ref={editorRef}
            theme="snow"
            value={value}
            onChange={onChange}
            modules={modules}
            formats={quillFormats}
            placeholder={placeholder}
            className={isSourceMode ? "hidden" : "bg-white"}
          />
          {isSourceMode && (
            <textarea
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              className="listflow-quill-source"
              spellCheck={false}
            />
          )}
        </>
      )}
    </div>
  );
}
