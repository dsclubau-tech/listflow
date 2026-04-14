"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
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

const CUSTOM_SIZES = [
  { label: "Default", value: "" },
  { label: "14", value: "14px" },
  { label: "16", value: "16px" },
  { label: "18", value: "18px" },
  { label: "20", value: "20px" },
  { label: "22", value: "22px" },
  { label: "24", value: "24px" },
  { label: "28", value: "28px" },
  { label: "32", value: "32px" },
];

type ReactQuillComponent = ComponentType<Record<string, unknown>>;
type ToolbarVariant = "grouped" | "compact";
type PickerKey = "font" | "size";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  toolbarVariant?: ToolbarVariant;
}

interface ToolbarSectionProps {
  label: string;
  children: ReactNode;
}

interface CompactToolbarButtonProps {
  ariaLabel: string;
  disabled: boolean;
  onClick: () => void;
  isActive?: boolean;
  className?: string;
  children: ReactNode;
}

let quillConfigured = false;

type QuillRegistrar = {
  import: (path: string) => unknown;
  register: (...args: unknown[]) => void;
};

type BlotBaseCtor = new (...args: never[]) => Record<string, unknown>;

function ToolbarSection({ label, children }: ToolbarSectionProps) {
  return (
    <div className="listflow-quill-section">
      <div className="listflow-quill-section-label">{label}</div>
      <span className="ql-formats listflow-quill-controls">{children}</span>
    </div>
  );
}

function CompactToolbarButton({
  ariaLabel,
  disabled,
  onClick,
  isActive = false,
  className = "",
  children,
}: CompactToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`listflow-quill-action listflow-quill-action-compact ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-active={isActive}
    >
      {children}
    </button>
  );
}

function registerCustomFormats(Quill: QuillRegistrar) {
  if (quillConfigured) return;

  const BlockEmbed = Quill.import("blots/block/embed") as BlotBaseCtor;

  class DividerBlot extends BlockEmbed {
    static blotName = "divider";
    static tagName = "HR";
  }

  Quill.register(DividerBlot, true);

  // Register custom pixel-based sizes with Quill
  const Size = Quill.import("attributors/style/size") as { whitelist: string[] };
  Size.whitelist = CUSTOM_SIZES.filter((s) => s.value).map((s) => s.value);
  Quill.register(Size, true);

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
  toolbarVariant = "grouped",
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
      getFormat: (index?: number, length?: number) => Record<string, unknown>;
      deleteText: (index: number, length: number, source?: string) => void;
      format: (name: string, value: unknown, source?: string) => void;
      insertEmbed: (index: number, type: string, value: unknown, source?: string) => void;
      insertText: (index: number, text: string, source?: string) => void;
      setSelection: (index: number, length?: number, source?: string) => void;
    };
  } | null>(null);
  const [EditorComponent, setEditorComponent] = useState<ReactQuillComponent | null>(null);
  const [isSourceMode, setIsSourceMode] = useState(false);
  const [openPicker, setOpenPicker] = useState<PickerKey | null>(null);
  const pickerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!openPicker) return;

    function handleClick(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setOpenPicker(null);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openPicker]);

  useEffect(() => {
    let cancelled = false;

    void import("react-quill-new").then((mod) => {
      registerCustomFormats(mod.Quill as unknown as QuillRegistrar);
      if (!cancelled) {
        setEditorComponent(() => mod.default as ReactQuillComponent);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup completely empty 1x1 tables (often left over from scrapers) on initial load.
  // We only run this once so users can still insert new empty tables intentionally.
  const hasCleanedUpRef = useRef(false);
  useEffect(() => {
    if (value && !hasCleanedUpRef.current) {
      hasCleanedUpRef.current = true;

      // Matches a 1x1 table at the very end of the content containing only a <br> or whitespace
      const emptyTableRegex = /<table[^>]*>\s*<tbody[^>]*>\s*<tr[^>]*>\s*<td[^>]*>(?:<br\s*\/?>|\s*)<\/td>\s*<\/tr>\s*<\/tbody>\s*<\/table>\s*$/i;

      if (emptyTableRegex.test(value)) {
        const cleaned = value.replace(emptyTableRegex, "");
        if (cleaned !== value) {
          onChange(cleaned);
        }
      }
    }
  }, [value, onChange]);

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

  useEffect(() => {
    if (quillToolbarDisabled) {
      setOpenPicker(null);
    }
  }, [quillToolbarDisabled]);

  const getEditor = useCallback(() => editorRef.current?.getEditor() ?? null, []);

  const withEditorSelection = useCallback(
    (
      callback: (
        editor: NonNullable<ReturnType<typeof getEditor>>,
        index: number,
        length: number,
      ) => void,
    ) => {
      const editor = getEditor();
      if (!editor) return;

      editor.focus();
      const range = editor.getSelection(true) ?? { index: editor.getLength(), length: 0 };
      callback(editor, range.index, range.length);
    },
    [getEditor],
  );

  const handleFormatFont = useCallback(
    (fontValue: string) => {
      const editor = getEditor();
      if (!editor) return;

      editor.focus();
      editor.format("font", fontValue || false, "user");
      setOpenPicker(null);
    },
    [getEditor],
  );

  const handleFormatSize = useCallback(
    (sizeValue: string) => {
      const editor = getEditor();
      if (!editor) return;

      editor.focus();
      editor.format("size", sizeValue || false, "user");
      setOpenPicker(null);
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
    withEditorSelection((editor) => {
      editor.format("link", false, "user");
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
    const text = window.prompt("Enter an emoji or special character", "\u{1F642}");
    if (!text) return;
    insertTextAtCursor(text);
  }, [insertTextAtCursor]);

  const handleInsertSymbol = useCallback(() => {
    const text = window.prompt("Enter a symbol", "\u03A9");
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

  const handleToggleList = useCallback(
    (listType: "ordered" | "bullet") => {
      withEditorSelection((editor, index, length) => {
        const currentList = editor.getFormat(index, length).list;
        editor.format("list", currentList === listType ? false : listType, "user");
      });
    },
    [withEditorSelection],
  );

  const rootStyle = {
    "--listflow-quill-min-height": minHeight,
  } as CSSProperties;

  function renderGroupedToolbar() {
    return (
      <>
        <ToolbarSection label="Text Formatting">
          <button type="button" className="ql-bold" aria-label="Bold" disabled={quillToolbarDisabled}>B</button>
          <button type="button" className="ql-italic" aria-label="Italic" disabled={quillToolbarDisabled}>I</button>
          <button type="button" className="ql-underline" aria-label="Underline" disabled={quillToolbarDisabled}>U</button>
          <button type="button" className="ql-strike" aria-label="Strikethrough" disabled={quillToolbarDisabled}>S</button>
          <button type="button" className="ql-script" value="sub" aria-label="Subscript" disabled={quillToolbarDisabled}>
            x<sub>2</sub>
          </button>
          <button type="button" className="ql-script" value="super" aria-label="Superscript" disabled={quillToolbarDisabled}>
            x<sup>2</sup>
          </button>
          <button type="button" className="ql-clean" aria-label="Clear formatting" disabled={quillToolbarDisabled}>Tx</button>
        </ToolbarSection>

        <ToolbarSection label="Lists & Indentation">
          <button
            type="button"
            className="listflow-quill-action"
            aria-label="Toggle numbered list"
            onClick={() => handleToggleList("ordered")}
            disabled={quillToolbarDisabled}
          >
            <span className="listflow-quill-list-glyph">1.</span>
          </button>
          <button
            type="button"
            className="listflow-quill-action"
            aria-label="Toggle bulleted list"
            onClick={() => handleToggleList("bullet")}
            disabled={quillToolbarDisabled}
          >
            <span className="listflow-quill-list-glyph">{"\u2022"}</span>
          </button>
          <button type="button" className="ql-blockquote" aria-label="Blockquote" disabled={quillToolbarDisabled}>&quot;</button>
          <button type="button" className="ql-align" value="" aria-label="Align left" disabled={quillToolbarDisabled}>Left</button>
          <button type="button" className="ql-align" value="center" aria-label="Align center" disabled={quillToolbarDisabled}>Center</button>
          <button type="button" className="ql-align" value="right" aria-label="Align right" disabled={quillToolbarDisabled}>Right</button>
          <button type="button" className="ql-align" value="justify" aria-label="Justify" disabled={quillToolbarDisabled}>Justify</button>
          <button type="button" className="ql-indent" value="-1" aria-label="Decrease indent" disabled={quillToolbarDisabled}>-</button>
          <button type="button" className="ql-indent" value="+1" aria-label="Increase indent" disabled={quillToolbarDisabled}>+</button>
        </ToolbarSection>

        <ToolbarSection label="Insert">
          <button type="button" className="ql-link" aria-label="Insert link" disabled={quillToolbarDisabled}>Link</button>
          <button type="button" className="listflow-quill-action" onClick={handleUnlink} disabled={quillToolbarDisabled}>Unlink</button>
          <button type="button" className="ql-image" aria-label="Insert image" disabled={quillToolbarDisabled}>Image</button>
          <button type="button" className="listflow-quill-action" onClick={handleInsertTable} disabled={quillToolbarDisabled}>Table</button>
          <button type="button" className="listflow-quill-action" onClick={handleInsertDivider} disabled={quillToolbarDisabled}>HR</button>
          <button type="button" className="listflow-quill-action" onClick={handleInsertEmoji} disabled={quillToolbarDisabled}>Emoji</button>
          <button type="button" className="listflow-quill-action" onClick={handleInsertSymbol} disabled={quillToolbarDisabled}>{"\u03A9"}</button>
        </ToolbarSection>

        <ToolbarSection label="Text Style">
          <select className="ql-font" defaultValue="" aria-label="Font family" disabled={quillToolbarDisabled}>
            <option value="">Font</option>
            <option value="serif">Serif</option>
            <option value="monospace">Monospace</option>
          </select>
          <select className="ql-size" defaultValue="" aria-label="Font size" disabled={quillToolbarDisabled}>
            {CUSTOM_SIZES.map((s) => (
              <option key={s.value || "default"} value={s.value}>
                {s.label}
              </option>
            ))}
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
        </ToolbarSection>

        <ToolbarSection label="View">
          <button type="button" className="listflow-quill-action" data-active={isSourceMode} onClick={() => setIsSourceMode((current) => !current)} disabled={!EditorComponent}>Source</button>
          <button type="button" className="listflow-quill-action" onClick={handleUndo} disabled={quillToolbarDisabled}>Undo</button>
          <button type="button" className="listflow-quill-action" onClick={handleRedo} disabled={quillToolbarDisabled}>Redo</button>
        </ToolbarSection>
      </>
    );
  }

  function renderCompactToolbar() {
    return (
      <>
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
          <CompactToolbarButton
            ariaLabel="Toggle numbered list"
            onClick={() => handleToggleList("ordered")}
            disabled={quillToolbarDisabled}
          >
            <span className="listflow-quill-list-glyph">1.</span>
          </CompactToolbarButton>
          <CompactToolbarButton
            ariaLabel="Toggle bulleted list"
            onClick={() => handleToggleList("bullet")}
            disabled={quillToolbarDisabled}
          >
            <span className="listflow-quill-list-glyph">{"\u2022"}</span>
          </CompactToolbarButton>
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
          <CompactToolbarButton ariaLabel="Remove link" onClick={handleUnlink} disabled={quillToolbarDisabled}>
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="M7 6.5H5.75a3.25 3.25 0 0 0 0 6.5H8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M11 11.5h1.25a3.25 3.25 0 1 0 0-6.5H10" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m6 12 6-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </CompactToolbarButton>
          <button type="button" className="ql-image" aria-label="Insert image" disabled={quillToolbarDisabled} />
          <CompactToolbarButton ariaLabel="Insert table" onClick={handleInsertTable} disabled={quillToolbarDisabled}>
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <rect x="3" y="4" width="12" height="10" rx="1" fill="none" stroke="currentColor" />
              <path d="M7 4v10M11 4v10M3 7.5h12M3 10.5h12" fill="none" stroke="currentColor" />
            </svg>
          </CompactToolbarButton>
          <CompactToolbarButton ariaLabel="Insert horizontal line" onClick={handleInsertDivider} disabled={quillToolbarDisabled}>
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="M4 9h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
            </svg>
          </CompactToolbarButton>
          <CompactToolbarButton ariaLabel="Insert special character" onClick={handleInsertEmoji} disabled={quillToolbarDisabled}>
            <span className="listflow-quill-compact-glyph">@</span>
          </CompactToolbarButton>
          <CompactToolbarButton ariaLabel="Insert special symbol" onClick={handleInsertSymbol} disabled={quillToolbarDisabled}>
            <span className="listflow-quill-compact-glyph">O</span>
          </CompactToolbarButton>
        </span>

        <span className="ql-formats" ref={pickerRef}>
          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              type="button"
              className="listflow-quill-action listflow-quill-action-compact listflow-quill-action-compact-label"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setOpenPicker(openPicker === "font" ? null : "font")}
              disabled={quillToolbarDisabled}
              aria-label="Font family"
              aria-expanded={openPicker === "font"}
              aria-haspopup="menu"
            >
              Font ▾
            </button>
            {openPicker === "font" && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  zIndex: 1000,
                  background: "#fff",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  padding: 4,
                  minWidth: 100,
                }}
              >
                {[
                  { label: "Default", value: "" },
                  { label: "Serif", value: "serif" },
                  { label: "Monospace", value: "monospace" },
                ].map((option) => (
                  <button
                    key={option.value || "default"}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleFormatFont(option.value)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "4px 8px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: 12,
                      borderRadius: 3,
                      fontFamily: option.value || "inherit",
                    }}
                    onMouseEnter={(event) => {
                      (event.target as HTMLElement).style.background = "#f3f4f6";
                    }}
                    onMouseLeave={(event) => {
                      (event.target as HTMLElement).style.background = "transparent";
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              type="button"
              className="listflow-quill-action listflow-quill-action-compact listflow-quill-action-compact-label"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setOpenPicker(openPicker === "size" ? null : "size")}
              disabled={quillToolbarDisabled}
              aria-label="Font size"
              aria-expanded={openPicker === "size"}
              aria-haspopup="menu"
            >
              Size ▾
            </button>
            {openPicker === "size" && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  zIndex: 1000,
                  background: "#fff",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  padding: 4,
                  minWidth: 80,
                }}
              >
                {CUSTOM_SIZES.map((option) => (
                  <button
                    key={option.value || "default"}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleFormatSize(option.value)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "4px 8px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: option.value ? parseInt(option.value, 10) : 14,
                      borderRadius: 3,
                    }}
                    onMouseEnter={(event) => {
                      (event.target as HTMLElement).style.background = "#f3f4f6";
                    }}
                    onMouseLeave={(event) => {
                      (event.target as HTMLElement).style.background = "transparent";
                    }}
                  >
                    {option.label}{option.value ? "px" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>

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
          <CompactToolbarButton
            ariaLabel="Toggle source mode"
            onClick={() => setIsSourceMode((current) => !current)}
            disabled={!EditorComponent}
            isActive={isSourceMode}
            className="listflow-quill-action-compact-label"
          >
            Source
          </CompactToolbarButton>
          <CompactToolbarButton ariaLabel="Undo" onClick={handleUndo} disabled={quillToolbarDisabled}>
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="M7 5 3.5 8.5 7 12" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 8.5h6a4 4 0 1 1 0 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </CompactToolbarButton>
          <CompactToolbarButton ariaLabel="Redo" onClick={handleRedo} disabled={quillToolbarDisabled}>
            <svg viewBox="0 0 18 18" aria-hidden="true">
              <path d="m11 5 3.5 3.5L11 12" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 8.5H8a4 4 0 1 0 0 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </CompactToolbarButton>
        </span>
      </>
    );
  }

  return (
    <div
      className={`listflow-rich-text ${className}`.trim()}
      style={rootStyle}
      data-toolbar-variant={toolbarVariant}
    >
      <div id={toolbarId} className="listflow-quill-toolbar" role="toolbar" aria-label="Rich text editor toolbar">
        {toolbarVariant === "compact" ? renderCompactToolbar() : renderGroupedToolbar()}
      </div>

      {!EditorComponent ? (
        <div className="listflow-quill-loading border border-gray-300 border-t-0 rounded-b-md px-4 py-3 text-sm text-gray-500 bg-white">
          Loading editor...
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
