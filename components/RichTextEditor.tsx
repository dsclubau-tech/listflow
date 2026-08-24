"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  ComponentType,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import "react-quill-new/dist/quill.snow.css";
import { quillFormats } from "@/lib/quill-config";

const COLOR_OPTIONS = [
  "",
  "#000000",
  "#e60000",
  "#ff9900",
  "#ffff00",
  "#008a00",
  "#2196F3",
  "#9933ff",
  "#ffffff",
  "#facccc",
  "#ffebcc",
  "#ffffcc",
  "#cce8cc",
  "#E3F2FD",
  "#ebd6ff",
  "#bbbbbb",
  "#f06666",
  "#ffc266",
  "#ffff66",
  "#66b966",
  "#64B5F6",
  "#c285ff",
  "#888888",
  "#a10000",
  "#b26b00",
  "#b2b200",
  "#006100",
  "#0D47A1",
  "#6b24b2",
  "#444444",
  "#5c0000",
  "#663d00",
  "#666600",
  "#003700",
  "#082F6C",
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
type PickerKey = "font" | "size" | "color";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  selectableImages?: boolean;
  stickyToolbar?: boolean;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  toolbarVariant?: ToolbarVariant;
}

interface FixedToolbarLayout {
  height: number;
  left: number;
  top: number;
  width: number;
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

interface EditableImageData {
  src: string;
  alt: string;
  width: string;
  height: string;
  align: "" | "center" | "right" | "justify";
}

interface ImageContextMenuState {
  clientX: number;
  clientY: number;
}

interface ImagePropertiesState extends EditableImageData {
  imageIndex: number;
}

interface PointerImageDragState {
  image: HTMLImageElement;
  startX: number;
  startY: number;
  moved: boolean;
  targetBlock: HTMLElement | null;
}

type QuillRegistrar = {
  find?: (node: Node) => unknown;
  import: (path: string) => unknown;
  register: (...args: unknown[]) => void;
};

interface QuillBlotLike {
  domNode?: Node;
  length?: () => number;
}

let quillConfigured = false;
let quillRuntime: QuillRegistrar | null = null;

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
  quillRuntime = Quill;
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

function cleanImageOnlyLists(html: string) {
  if (typeof document === "undefined" || !html) {
    return html;
  }

  const template = document.createElement("template");
  template.innerHTML = html;

  template.content.querySelectorAll("ol, ul").forEach((list) => {
    const children = Array.from(list.children);
    const items = children.filter((child): child is HTMLLIElement => child.tagName === "LI");

    if (
      items.length === 0 ||
      items.length !== children.length ||
      !items.every((item) => Boolean(item.querySelector("img")) && !(item.textContent || "").trim())
    ) {
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      item.querySelectorAll(".ql-ui").forEach((marker) => marker.remove());
      Array.from(item.childNodes).forEach((node) => {
        if (node instanceof HTMLBRElement) {
          return;
        }
        fragment.appendChild(node);
      });
    });
    list.replaceWith(fragment);
  });

  return template.innerHTML;
}

export default function RichTextEditor({
  value,
  onChange,
  selectableImages = false,
  stickyToolbar = false,
  placeholder,
  minHeight = "18rem",
  className = "",
  toolbarVariant = "grouped",
}: RichTextEditorProps) {
  const toolbarId = `rich-text-toolbar-${useId().replace(/:/g, "")}`;
  const editorRef = useRef<{
    getEditor: () => {
      root: HTMLDivElement;
      focus: () => void;
      getIndex: (blot: unknown) => number;
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
      formatLine: (
        index: number,
        length: number,
        name: string,
        value: unknown,
        source?: string,
      ) => void;
      formatText: (
        index: number,
        length: number,
        formats: Record<string, unknown>,
        source?: string,
      ) => void;
      insertEmbed: (index: number, type: string, value: unknown, source?: string) => void;
      insertText: (index: number, text: string, source?: string) => void;
      getLeaf: (index: number) => [QuillBlotLike | null, number];
      getLine: (index: number) => [QuillBlotLike | null, number];
      setSelection: (index: number, length?: number, source?: string) => void;
    };
  } | null>(null);
  const [EditorComponent, setEditorComponent] = useState<ReactQuillComponent | null>(null);
  const [isSourceMode, setIsSourceMode] = useState(false);
  const [openPicker, setOpenPicker] = useState<PickerKey | null>(null);
  const [imageContextMenu, setImageContextMenu] =
    useState<ImageContextMenuState | null>(null);
  const [imageClipboard, setImageClipboard] =
    useState<EditableImageData | null>(null);
  const [imageProperties, setImageProperties] =
    useState<ImagePropertiesState | null>(null);
  const pickerRef = useRef<HTMLSpanElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarFrameRef = useRef<number | null>(null);
  const selectedImageRef = useRef<HTMLImageElement | null>(null);
  const imageMenuRef = useRef<HTMLDivElement | null>(null);
  const pointerImageDragRef = useRef<PointerImageDragState | null>(null);
  const [fixedToolbarLayout, setFixedToolbarLayout] =
    useState<FixedToolbarLayout | null>(null);

  useEffect(() => {
    if (!stickyToolbar) return;

    const updateToolbarLayout = () => {
      const root = rootRef.current;
      const toolbar = toolbarRef.current;
      if (!root || !toolbar) return;

      const rootRect = root.getBoundingClientRect();
      const height = toolbar.offsetHeight;
      const top = window.matchMedia("(min-width: 768px)").matches ? 0 : 64;
      const shouldFix =
        rootRect.top < top && rootRect.bottom > top + height;

      const nextLayout = shouldFix
        ? {
            height,
            left: Math.max(0, rootRect.left),
            top,
            width: Math.max(
              0,
              Math.min(window.innerWidth, rootRect.right) -
                Math.max(0, rootRect.left),
            ),
          }
        : null;

      setFixedToolbarLayout((current) => {
        if (
          current?.height === nextLayout?.height &&
          current?.left === nextLayout?.left &&
          current?.top === nextLayout?.top &&
          current?.width === nextLayout?.width
        ) {
          return current;
        }
        return nextLayout;
      });
    };

    const scheduleToolbarUpdate = () => {
      if (toolbarFrameRef.current !== null) return;
      toolbarFrameRef.current = window.requestAnimationFrame(() => {
        toolbarFrameRef.current = null;
        updateToolbarLayout();
      });
    };

    scheduleToolbarUpdate();
    window.addEventListener("scroll", scheduleToolbarUpdate, true);
    window.addEventListener("resize", scheduleToolbarUpdate);

    const resizeObserver = new ResizeObserver(scheduleToolbarUpdate);
    if (rootRef.current) resizeObserver.observe(rootRef.current);
    if (toolbarRef.current) resizeObserver.observe(toolbarRef.current);

    return () => {
      window.removeEventListener("scroll", scheduleToolbarUpdate, true);
      window.removeEventListener("resize", scheduleToolbarUpdate);
      resizeObserver.disconnect();
      if (toolbarFrameRef.current !== null) {
        window.cancelAnimationFrame(toolbarFrameRef.current);
        toolbarFrameRef.current = null;
      }
    };
  }, [stickyToolbar]);

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
    if (!imageContextMenu) return;

    function closeImageMenu(event: PointerEvent) {
      if (
        imageMenuRef.current &&
        !imageMenuRef.current.contains(event.target as Node)
      ) {
        setImageContextMenu(null);
      }
    }

    function closeImageMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setImageContextMenu(null);
      }
    }

    function closeImageMenuOnScroll() {
      setImageContextMenu(null);
    }

    document.addEventListener("pointerdown", closeImageMenu);
    document.addEventListener("keydown", closeImageMenuOnEscape);
    window.addEventListener("scroll", closeImageMenuOnScroll, true);

    return () => {
      document.removeEventListener("pointerdown", closeImageMenu);
      document.removeEventListener("keydown", closeImageMenuOnEscape);
      window.removeEventListener("scroll", closeImageMenuOnScroll, true);
    };
  }, [imageContextMenu]);

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

      const cleaned = cleanImageOnlyLists(value.replace(emptyTableRegex, ""));
      if (cleaned !== value) {
        onChange(cleaned);
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

  useEffect(() => {
    if (!selectableImages || !EditorComponent) return;

    const editor = getEditor();
    editor?.root.querySelectorAll("img").forEach((image) => {
      image.draggable = false;
    });
  }, [EditorComponent, getEditor, selectableImages, value]);

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

  const handleFormatColor = useCallback(
    (colorValue: string) => {
      const editor = getEditor();
      if (!editor) return;

      editor.focus();
      editor.format("color", colorValue || false, "user");
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

  const getImageData = useCallback((image: HTMLImageElement): EditableImageData => {
    const alignmentRoot = image.closest(
      ".ql-align-center, .ql-align-right, .ql-align-justify",
    );
    const align = alignmentRoot?.classList.contains("ql-align-center")
      ? "center"
      : alignmentRoot?.classList.contains("ql-align-right")
        ? "right"
        : alignmentRoot?.classList.contains("ql-align-justify")
          ? "justify"
          : "";

    return {
      src: image.currentSrc || image.src,
      alt: image.getAttribute("alt") || "",
      width: image.getAttribute("width") || "",
      height: image.getAttribute("height") || "",
      align,
    };
  }, []);

  const selectEditorImage = useCallback(
    (image: HTMLImageElement) => {
      const editor = getEditor();
      const imageBlot = quillRuntime?.find?.(image);
      if (!editor || !imageBlot) return null;

      const imageIndex = editor.getIndex(imageBlot);
      selectedImageRef.current = image;
      editor.setSelection(imageIndex, 1, "user");
      return { editor, imageIndex };
    },
    [getEditor],
  );

  const getSelectedImage = useCallback(() => {
    const image = selectedImageRef.current;
    if (!image?.isConnected) return null;

    const selected = selectEditorImage(image);
    if (!selected) return null;

    return {
      ...selected,
      image,
      data: getImageData(image),
    };
  }, [getImageData, selectEditorImage]);

  const formatImage = useCallback(
    (
      editor: NonNullable<ReturnType<typeof getEditor>>,
      imageIndex: number,
      image: EditableImageData,
    ) => {
      editor.formatText(
        imageIndex,
        1,
        {
          alt: image.alt || false,
          width: image.width || false,
          height: image.height || false,
        },
        "user",
      );
      editor.formatLine(imageIndex, 1, "align", image.align || false, "user");
    },
    [],
  );

  const focusInsertedImage = useCallback(
    (
      editor: NonNullable<ReturnType<typeof getEditor>>,
      imageIndex: number,
    ) => {
      const [insertedBlot] = editor.getLeaf(imageIndex);
      if (insertedBlot?.domNode instanceof HTMLImageElement) {
        selectedImageRef.current = insertedBlot.domNode;
      }
      editor.setSelection(imageIndex, 1, "user");
    },
    [],
  );

  const insertImageLine = useCallback(
    (
      editor: NonNullable<ReturnType<typeof getEditor>>,
      imageIndex: number,
      image: EditableImageData,
    ) => {
      editor.insertEmbed(imageIndex, "image", image.src, "user");
      editor.insertText(imageIndex + 1, "\n", "user");
      formatImage(editor, imageIndex, image);
      focusInsertedImage(editor, imageIndex);
    },
    [focusInsertedImage, formatImage],
  );

  const moveSelectedImageTo = useCallback(
    (targetIndex: number) => {
      const selected = getSelectedImage();
      if (!selected) return;

      const { editor, image, imageIndex, data } = selected;
      const sourceBlock = image.closest(".ql-editor > *");
      const sourceBlockBlot = sourceBlock
        ? (quillRuntime?.find?.(sourceBlock) as QuillBlotLike | undefined)
        : undefined;
      const sourceStart = sourceBlockBlot
        ? editor.getIndex(sourceBlockBlot)
        : imageIndex;
      const sourceLength = sourceBlockBlot?.length?.() ?? 1;
      const isStandaloneImage =
        sourceBlock instanceof HTMLElement &&
        sourceBlock.querySelectorAll("img").length === 1 &&
        !(sourceBlock.textContent || "").trim();

      if (
        targetIndex >= sourceStart &&
        targetIndex <= sourceStart + sourceLength
      ) {
        setImageContextMenu(null);
        return;
      }

      if (isStandaloneImage) {
        editor.deleteText(sourceStart, sourceLength, "user");
        const adjustedTarget =
          targetIndex > sourceStart ? targetIndex - sourceLength : targetIndex;
        insertImageLine(editor, adjustedTarget, data);
      } else {
        editor.deleteText(imageIndex, 1, "user");
        const adjustedTarget =
          targetIndex > imageIndex ? targetIndex - 1 : targetIndex;
        insertImageLine(editor, adjustedTarget, data);
      }

      setImageContextMenu(null);
    },
    [getSelectedImage, insertImageLine],
  );

  const moveSelectedImage = useCallback(
    (direction: "up" | "down") => {
      const selected = getSelectedImage();
      if (!selected) return;

      const sourceBlock = selected.image.closest(".ql-editor > *");
      if (!(sourceBlock instanceof HTMLElement)) return;

      const targetBlock =
        direction === "up"
          ? sourceBlock.previousElementSibling
          : sourceBlock.nextElementSibling;
      if (!(targetBlock instanceof HTMLElement)) return;

      const targetBlot = quillRuntime?.find?.(targetBlock) as
        | QuillBlotLike
        | undefined;
      if (!targetBlot) return;

      const targetStart = selected.editor.getIndex(targetBlot);
      const targetIndex =
        direction === "up"
          ? targetStart
          : targetStart + (targetBlot.length?.() ?? 1);
      moveSelectedImageTo(targetIndex);
    },
    [getSelectedImage, moveSelectedImageTo],
  );

  const handleSelectableImageClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!selectableImages || isSourceMode) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const clickedImage = target.closest(".ql-editor img");
      if (!(clickedImage instanceof HTMLImageElement)) return;

      event.preventDefault();
      event.stopPropagation();
      setImageContextMenu(null);
      selectEditorImage(clickedImage);
    },
    [isSourceMode, selectableImages, selectEditorImage],
  );

  const handleImageContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!selectableImages || isSourceMode) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const clickedImage = target.closest(".ql-editor img");
      if (!(clickedImage instanceof HTMLImageElement)) return;

      event.preventDefault();
      event.stopPropagation();
      selectEditorImage(clickedImage);
      setImageContextMenu({
        clientX: Math.min(event.clientX, window.innerWidth - 210),
        clientY: Math.min(event.clientY, window.innerHeight - 280),
      });
    },
    [isSourceMode, selectableImages, selectEditorImage],
  );

  const copySelectedImage = useCallback(
    (cut: boolean) => {
      const selected = getSelectedImage();
      if (!selected) return;

      setImageClipboard(selected.data);
      void navigator.clipboard?.writeText(selected.data.src).catch(() => undefined);

      if (cut) {
        selected.editor.deleteText(selected.imageIndex, 1, "user");
        selectedImageRef.current = null;
      }

      setImageContextMenu(null);
    },
    [getSelectedImage],
  );

  const pasteImageAfterSelection = useCallback(() => {
    if (!imageClipboard) return;

    const selected = getSelectedImage();
    const editor = selected?.editor ?? getEditor();
    if (!editor) return;

    const referenceIndex =
      selected?.imageIndex ?? editor.getSelection(true)?.index ?? editor.getLength() - 1;
    const [referenceLine] = editor.getLine(referenceIndex);
    const insertIndex = referenceLine
      ? editor.getIndex(referenceLine) + (referenceLine.length?.() ?? 1)
      : referenceIndex + 1;

    insertImageLine(editor, insertIndex, imageClipboard);
    setImageContextMenu(null);
  }, [getEditor, getSelectedImage, imageClipboard, insertImageLine]);

  const openImageProperties = useCallback(() => {
    const selected = getSelectedImage();
    if (!selected) return;

    setImageProperties({
      imageIndex: selected.imageIndex,
      ...selected.data,
    });
    setImageContextMenu(null);
  }, [getSelectedImage]);

  const saveImageProperties = useCallback(() => {
    if (!imageProperties) return;

    const editor = getEditor();
    if (!editor) return;

    formatImage(editor, imageProperties.imageIndex, imageProperties);
    focusInsertedImage(editor, imageProperties.imageIndex);
    setImageProperties(null);
  }, [focusInsertedImage, formatImage, getEditor, imageProperties]);

  const clearPointerImageDrag = useCallback(() => {
    const drag = pointerImageDragRef.current;
    drag?.image.classList.remove("listflow-image-dragging");
    drag?.targetBlock?.classList.remove("listflow-image-drop-target");
    pointerImageDragRef.current = null;
  }, []);

  const handleImagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        !selectableImages ||
        isSourceMode ||
        event.button !== 0 ||
        !event.isPrimary
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const image = target.closest(".ql-editor img");
      if (!(image instanceof HTMLImageElement)) return;

      event.preventDefault();
      selectEditorImage(image);
      setImageContextMenu(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerImageDragRef.current = {
        image,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        targetBlock: null,
      };
    },
    [isSourceMode, selectableImages, selectEditorImage],
  );

  const handleImagePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = pointerImageDragRef.current;
      if (!drag) return;

      const distance = Math.hypot(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
      );
      if (!drag.moved && distance < 6) return;

      event.preventDefault();
      drag.moved = true;
      drag.image.classList.add("listflow-image-dragging");

      const hitTarget = document.elementFromPoint(event.clientX, event.clientY);
      const targetBlock = hitTarget?.closest(".ql-editor > *");
      const sourceBlock = drag.image.closest(".ql-editor > *");
      const nextTarget =
        targetBlock instanceof HTMLElement && targetBlock !== sourceBlock
          ? targetBlock
          : null;

      if (drag.targetBlock !== nextTarget) {
        drag.targetBlock?.classList.remove("listflow-image-drop-target");
        nextTarget?.classList.add("listflow-image-drop-target");
        drag.targetBlock = nextTarget;
      }
    },
    [],
  );

  const handleImagePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = pointerImageDragRef.current;
      if (!drag) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (drag.moved && drag.targetBlock) {
        const editor = getEditor();
        const targetBlot = quillRuntime?.find?.(drag.targetBlock) as
          | QuillBlotLike
          | undefined;

        if (editor && targetBlot) {
          const targetStart = editor.getIndex(targetBlot);
          const targetBounds = drag.targetBlock.getBoundingClientRect();
          const insertAfter =
            event.clientY >= targetBounds.top + targetBounds.height / 2;
          const targetIndex =
            targetStart + (insertAfter ? targetBlot.length?.() ?? 1 : 0);

          event.preventDefault();
          event.stopPropagation();
          moveSelectedImageTo(targetIndex);
        }
      }

      clearPointerImageDrag();
    },
    [clearPointerImageDrag, getEditor, moveSelectedImageTo],
  );

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

          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              type="button"
              className="listflow-quill-action listflow-quill-action-compact listflow-quill-action-compact-label"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setOpenPicker(openPicker === "color" ? null : "color")}
              disabled={quillToolbarDisabled}
              aria-label="Text color"
              aria-expanded={openPicker === "color"}
              aria-haspopup="menu"
            >
              A ▾
            </button>
            {openPicker === "color" && (
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
                  padding: 6,
                  width: 152,
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
                  {COLOR_OPTIONS.map((color) => (
                    <button
                      key={`pick-${color || "auto"}`}
                      type="button"
                      title={color || "Automatic"}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleFormatColor(color)}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 3,
                        border: color ? "1px solid #d1d5db" : "1px dashed #9ca3af",
                        background: color || "#fff",
                        cursor: "pointer",
                        padding: 0,
                        position: "relative",
                      }}
                      onMouseEnter={(event) => {
                        (event.target as HTMLElement).style.outline = "2px solid #2196F3";
                        (event.target as HTMLElement).style.outlineOffset = "1px";
                      }}
                      onMouseLeave={(event) => {
                        (event.target as HTMLElement).style.outline = "none";
                      }}
                    >
                      {!color && <span style={{ fontSize: 10, color: "#6b7280" }}>✕</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
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
      ref={rootRef}
      className={`listflow-rich-text ${className}`.trim()}
      style={rootStyle}
      data-toolbar-variant={toolbarVariant}
      data-toolbar-sticky={stickyToolbar ? "true" : undefined}
      data-images-selectable={selectableImages ? "true" : undefined}
      onClickCapture={handleSelectableImageClick}
      onContextMenuCapture={handleImageContextMenu}
      onPointerDownCapture={handleImagePointerDown}
      onPointerMoveCapture={handleImagePointerMove}
      onPointerUpCapture={handleImagePointerUp}
      onPointerCancelCapture={clearPointerImageDrag}
    >
      <div
        ref={toolbarRef}
        id={toolbarId}
        className="listflow-quill-toolbar"
        role="toolbar"
        aria-label="Rich text editor toolbar"
        style={
          fixedToolbarLayout
            ? {
                left: fixedToolbarLayout.left,
                position: "fixed",
                top: fixedToolbarLayout.top,
                width: fixedToolbarLayout.width,
                zIndex: 70,
              }
            : undefined
        }
      >
        {toolbarVariant === "compact" ? renderCompactToolbar() : renderGroupedToolbar()}
      </div>
      {fixedToolbarLayout && (
        <div aria-hidden="true" style={{ height: fixedToolbarLayout.height }} />
      )}

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

      {imageContextMenu && (
        <div
          ref={imageMenuRef}
          role="menu"
          aria-label="Image actions"
          className="fixed z-[90] w-48 overflow-hidden rounded-md border border-gray-300 bg-white py-1 text-sm shadow-xl"
          style={{
            left: imageContextMenu.clientX,
            top: imageContextMenu.clientY,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => copySelectedImage(true)}
            className="flex w-full items-center px-3 py-2 text-left text-gray-700 hover:bg-gray-100"
          >
            Cut
            <span className="ml-auto text-xs text-gray-400">Ctrl+X</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => copySelectedImage(false)}
            className="flex w-full items-center px-3 py-2 text-left text-gray-700 hover:bg-gray-100"
          >
            Copy
            <span className="ml-auto text-xs text-gray-400">Ctrl+C</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={pasteImageAfterSelection}
            disabled={!imageClipboard}
            className="flex w-full items-center px-3 py-2 text-left text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
          >
            Paste
            <span className="ml-auto text-xs text-gray-400">Ctrl+V</span>
          </button>
          <div className="my-1 border-t border-gray-200" />
          <button
            type="button"
            role="menuitem"
            onClick={() => moveSelectedImage("up")}
            className="w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-100"
          >
            Move Up
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => moveSelectedImage("down")}
            className="w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-100"
          >
            Move Down
          </button>
          <div className="my-1 border-t border-gray-200" />
          <button
            type="button"
            role="menuitem"
            onClick={openImageProperties}
            className="w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-100"
          >
            Image Properties
          </button>
        </div>
      )}

      {imageProperties && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setImageProperties(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${toolbarId}-image-properties-title`}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
          >
            <h2
              id={`${toolbarId}-image-properties-title`}
              className="text-lg font-semibold text-gray-900"
            >
              Image Properties
            </h2>

            <div className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                Alternative text
                <input
                  type="text"
                  value={imageProperties.alt}
                  onChange={(event) =>
                    setImageProperties((current) =>
                      current ? { ...current, alt: event.target.value } : current
                    )
                  }
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-gray-700">
                  Width
                  <input
                    type="number"
                    min="1"
                    placeholder="Auto"
                    value={imageProperties.width}
                    onChange={(event) =>
                      setImageProperties((current) =>
                        current
                          ? { ...current, width: event.target.value }
                          : current
                      )
                    }
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Height
                  <input
                    type="number"
                    min="1"
                    placeholder="Auto"
                    value={imageProperties.height}
                    onChange={(event) =>
                      setImageProperties((current) =>
                        current
                          ? { ...current, height: event.target.value }
                          : current
                      )
                    }
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                  />
                </label>
              </div>

              <label className="block text-sm font-medium text-gray-700">
                Alignment
                <select
                  value={imageProperties.align}
                  onChange={(event) =>
                    setImageProperties((current) =>
                      current
                        ? {
                            ...current,
                            align: event.target.value as EditableImageData["align"],
                          }
                        : current
                    )
                  }
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
                >
                  <option value="">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                  <option value="justify">Justify</option>
                </select>
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImageProperties(null)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveImageProperties}
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
