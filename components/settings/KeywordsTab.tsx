"use client";

import { useState, useEffect, useCallback } from "react";

interface Keyword {
  id: string;
  keyword: string;
  removeFromTitle: boolean;
  removeFromDescription: boolean;
}

export default function KeywordsTab() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formKeyword, setFormKeyword] = useState("");
  const [formRemoveTitle, setFormRemoveTitle] = useState(false);
  const [formRemoveDesc, setFormRemoveDesc] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchKeywords = useCallback(async () => {
    try {
      const res = await fetch("/api/keywords");
      if (res.ok) setKeywords(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeywords();
  }, [fetchKeywords]);

  function openAdd() {
    setEditingId(null);
    setFormKeyword("");
    setFormRemoveTitle(false);
    setFormRemoveDesc(true);
    setModalOpen(true);
  }

  function openEdit(k: Keyword) {
    setEditingId(k.id);
    setFormKeyword(k.keyword);
    setFormRemoveTitle(k.removeFromTitle);
    setFormRemoveDesc(k.removeFromDescription);
    setModalOpen(true);
  }

  async function handleSave() {
    if (!formKeyword.trim()) return;
    if (!formRemoveTitle && !formRemoveDesc) {
      alert("At least one action must be selected.");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await fetch(`/api/keywords/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keyword: formKeyword,
            removeFromTitle: formRemoveTitle,
            removeFromDescription: formRemoveDesc,
          }),
        });
      } else {
        await fetch("/api/keywords", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keyword: formKeyword,
            removeFromTitle: formRemoveTitle,
            removeFromDescription: formRemoveDesc,
          }),
        });
      }
      setModalOpen(false);
      await fetchKeywords();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Are you sure you want to delete this keyword?")) return;
    const res = await fetch(`/api/keywords/${id}`, { method: "DELETE" });
    if (res.ok) {
      await fetchKeywords();
    }
  }

  function getActionText(k: Keyword) {
    if (k.removeFromTitle && k.removeFromDescription) return "Remove from title, Remove from description";
    if (k.removeFromTitle) return "Remove from title";
    return "Remove from description";
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading keywords…</p>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{keywords.length} keyword(s)</p>
        <button
          onClick={openAdd}
          className="bg-orange-500 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded-md transition-colors"
        >
          + Add Keywords
        </button>
      </div>

      {/* Keywords table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b text-xs font-medium text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-3 text-left">Keyword</th>
              <th className="px-4 py-3 text-left">Action</th>
              <th className="px-4 py-3 text-right w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((k) => (
              <tr key={k.id} className="border-b hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  <code className="bg-gray-100 px-2 py-0.5 rounded text-sm">{k.keyword}</code>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{getActionText(k)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => openEdit(k)}
                      className="text-gray-400 hover:text-orange-500 transition-colors p-1"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(k.id)}
                      className="p-1 text-gray-400 transition-colors hover:text-quaternary"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {keywords.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                  No keywords yet. Click &ldquo;+ Add Keywords&rdquo; to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? "Edit Keyword" : "Add Keyword"}
              </h2>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Keyword</label>
                <input
                  type="text"
                  value={formKeyword}
                  onChange={(e) => setFormKeyword(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="e.g. Amazon"
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formRemoveTitle}
                    onChange={(e) => setFormRemoveTitle(e.target.checked)}
                    className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                  Remove from title
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formRemoveDesc}
                    onChange={(e) => setFormRemoveDesc(e.target.checked)}
                    className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                  />
                  Remove from description
                </label>
              </div>
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
                disabled={saving || !formKeyword.trim()}
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
