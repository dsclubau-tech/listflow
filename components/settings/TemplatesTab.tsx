"use client";

import { useState, useEffect, useCallback } from "react";
import RichTextEditor from "@/components/RichTextEditor";

interface Template {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
}

export default function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      if (res.ok) setTemplates(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  function openAdd() {
    setEditingId(null);
    setFormName("");
    setFormContent("");
    setFormIsDefault(false);
    setModalOpen(true);
  }

  function openEdit(t: Template) {
    setEditingId(t.id);
    setFormName(t.name);
    setFormContent(t.content);
    setFormIsDefault(t.isDefault);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`/api/templates/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName, content: formContent, isDefault: formIsDefault }),
        });
      } else {
        await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName, content: formContent, isDefault: formIsDefault }),
        });
      }
      setModalOpen(false);
      await fetchTemplates();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Are you sure you want to delete this template?")) return;
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      await fetchTemplates();
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete template");
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading templates…</p>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{templates.length} template(s)</p>
        <button
          onClick={openAdd}
          className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-md transition-colors"
        >
          + Add blank template
        </button>
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {templates.map((t) => (
          <div
            key={t.id}
            className="group relative bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
          >
            {/* Miniature preview (sandboxed to prevent template CSS leaking into page UI) */}
            <div className="h-40 overflow-hidden relative bg-gray-50 p-2">
              <iframe
                title={`Template preview: ${t.name}`}
                srcDoc={t.content || "<div></div>"}
                sandbox=""
                className="origin-top-left pointer-events-none bg-white"
                style={{
                  transform: "scale(0.3)",
                  width: "333%",
                  height: "333%",
                  border: "0",
                }}
              />
            </div>

            {/* Overlay buttons */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              <button
                onClick={() => openEdit(t)}
                className="bg-white rounded-full p-2 shadow hover:bg-gray-100 transition-colors"
                title="Edit"
              >
                <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              <button
                onClick={() => handleDelete(t.id)}
                className="bg-white rounded-full p-2 shadow hover:bg-gray-100 transition-colors"
                title="Delete"
              >
                <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>

            {/* Name + badge */}
            <div className="px-3 py-2 border-t border-gray-200">
              <p className="text-sm font-medium text-center truncate">{t.name}</p>
              {t.isDefault && (
                <p className="text-center mt-1">
                  <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded">
                    Default
                  </span>
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? "Edit Template" : "Add Template"}
              </h2>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="e.g. RK Ecom, 30 Day Free Return"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
                <RichTextEditor value={formContent} onChange={setFormContent} minHeight="200px" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 mt-2">
                <input
                  type="checkbox"
                  checked={formIsDefault}
                  onChange={(e) => setFormIsDefault(e.target.checked)}
                  className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                />
                Set as default template
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formName.trim()}
                className="px-4 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
