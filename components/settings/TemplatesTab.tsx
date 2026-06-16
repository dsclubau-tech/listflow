"use client";

import { useState, useEffect, useCallback } from "react";
import type { ClipboardEvent } from "react";
import RichTextEditor from "@/components/RichTextEditor";

interface DescriptionTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
}

interface Store {
  id: string;
  name: string;
}

interface PolicyEntry {
  profileId: string;
  profileName: string;
}

interface Policies {
  shipping: PolicyEntry[];
  returns: PolicyEntry[];
  payment: PolicyEntry[];
}

interface PolicyTemplate {
  id: string;
  name: string;
  storeId: string;
  shippingPolicyId: string | null;
  returnPolicyId: string | null;
  paymentPolicyId: string | null;
  store: Store;
}

const placeholderTokens = [
  "title",
  "description",
  "store_name",
  "main_image_with_tag",
  "main_image",
  "product_dimension",
  "item_specifics",
];

type ActiveSubTab = "description" | "policy";
type DescriptionModalMode = "edit" | "source" | "preview";

const escapedHtmlSourcePattern =
  /&lt;\/?(?:!doctype|html|head|body|meta|link|style|div|table|section|article|h[1-6]|p|span|font|ul|ol|li|img|a)\b/i;
const rawFullTemplatePattern =
  /<(?:!doctype|html|head|body|meta|link|style|div\s+(?:id|class)=["'][^"']*(?:wrapper|container|template)|table|section)\b/i;

function normalizePastedTemplateSource(content: string) {
  if (!escapedHtmlSourcePattern.test(content)) {
    return content;
  }

  if (typeof document === "undefined") {
    return content;
  }

  const container = document.createElement("div");
  container.innerHTML = content
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return (container.textContent || content).trim();
}

function isFullTemplateSource(content: string) {
  return rawFullTemplatePattern.test(normalizePastedTemplateSource(content));
}

function getFullTemplateSourceFromClipboard(event: ClipboardEvent) {
  const plainText = event.clipboardData.getData("text/plain");
  const htmlText = event.clipboardData.getData("text/html");
  const candidates = [plainText, htmlText].filter(Boolean);
  const match = candidates.find((candidate) => isFullTemplateSource(candidate));
  return match ? normalizePastedTemplateSource(match) : null;
}

function getPolicyLabel(policyId: string | null, options: PolicyEntry[] | undefined) {
  if (!policyId) {
    return "Not set";
  }

  const match = options?.find((entry) => entry.profileId === policyId);
  return match?.profileName ?? policyId;
}

export default function TemplatesTab() {
  const [activeSubTab, setActiveSubTab] = useState<ActiveSubTab>("description");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [descriptionTemplates, setDescriptionTemplates] = useState<DescriptionTemplate[]>([]);
  const [policyTemplates, setPolicyTemplates] = useState<PolicyTemplate[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [policyOptionsByStore, setPolicyOptionsByStore] = useState<Record<string, Policies>>({});
  const [loadingPolicyOptionsByStore, setLoadingPolicyOptionsByStore] = useState<Record<string, boolean>>({});

  const [descriptionModalOpen, setDescriptionModalOpen] = useState(false);
  const [editingDescriptionId, setEditingDescriptionId] = useState<string | null>(null);
  const [descriptionFormName, setDescriptionFormName] = useState("");
  const [descriptionFormContent, setDescriptionFormContent] = useState("");
  const [descriptionFormIsDefault, setDescriptionFormIsDefault] = useState(false);
  const [descriptionSaveError, setDescriptionSaveError] = useState<string | null>(null);
  const [descriptionEditorNotice, setDescriptionEditorNotice] = useState<string | null>(null);
  const [descriptionModalMode, setDescriptionModalMode] =
    useState<DescriptionModalMode>("edit");
  const [savingDescription, setSavingDescription] = useState(false);

  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [policyFormName, setPolicyFormName] = useState("");
  const [policyFormStoreId, setPolicyFormStoreId] = useState("");
  const [policyFormShippingPolicyId, setPolicyFormShippingPolicyId] = useState("");
  const [policyFormReturnPolicyId, setPolicyFormReturnPolicyId] = useState("");
  const [policyFormPaymentPolicyId, setPolicyFormPaymentPolicyId] = useState("");
  const [savingPolicy, setSavingPolicy] = useState(false);

  const fetchDescriptionTemplates = useCallback(async () => {
    const res = await fetch("/api/templates");
    if (!res.ok) {
      throw new Error("Failed to load description templates");
    }
    const data = (await res.json()) as DescriptionTemplate[];
    setDescriptionTemplates(data);
  }, []);

  const fetchPolicyTemplates = useCallback(async () => {
    const res = await fetch("/api/policy-templates");
    if (!res.ok) {
      throw new Error("Failed to load policy templates");
    }
    const data = (await res.json()) as PolicyTemplate[];
    setPolicyTemplates(data);
  }, []);

  const fetchStores = useCallback(async () => {
    const res = await fetch("/api/stores");
    if (!res.ok) {
      throw new Error("Failed to load stores");
    }
    const data = (await res.json()) as Store[];
    setStores(data);
  }, []);

  const ensurePoliciesForStore = useCallback(async (storeId: string) => {
    if (!storeId || policyOptionsByStore[storeId] || loadingPolicyOptionsByStore[storeId]) {
      return;
    }

    setLoadingPolicyOptionsByStore((current) => ({ ...current, [storeId]: true }));
    try {
      const res = await fetch(`/api/policies?store=${storeId}`);
      if (!res.ok) {
        throw new Error("Failed to load policies");
      }

      const data = (await res.json()) as Policies;
      setPolicyOptionsByStore((current) => ({
        ...current,
        [storeId]: data,
      }));
    } catch {
      // Keep the current UI responsive even if a store's policies fail to load.
    } finally {
      setLoadingPolicyOptionsByStore((current) => {
        const next = { ...current };
        delete next[storeId];
        return next;
      });
    }
  }, [loadingPolicyOptionsByStore, policyOptionsByStore]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const results = await Promise.allSettled([
          fetchDescriptionTemplates(),
          fetchPolicyTemplates(),
          fetchStores(),
        ]);

        const rejectedResult = results.find((result) => result.status === "rejected");
        if (rejectedResult?.status === "rejected") {
          setLoadError(
            rejectedResult.reason instanceof Error
              ? rejectedResult.reason.message
              : "Failed to load templates",
          );
        } else {
          setLoadError(null);
        }
      } finally {
        setLoading(false);
      }
    }

    void bootstrap();
  }, [fetchDescriptionTemplates, fetchPolicyTemplates, fetchStores]);

  useEffect(() => {
    const uniqueStoreIds = [...new Set(policyTemplates.map((template) => template.storeId))];
    uniqueStoreIds.forEach((storeId) => {
      void ensurePoliciesForStore(storeId);
    });
  }, [ensurePoliciesForStore, policyTemplates]);

  function openAddDescription() {
    setEditingDescriptionId(null);
    setDescriptionFormName("");
    setDescriptionFormContent("");
    setDescriptionFormIsDefault(false);
    setDescriptionSaveError(null);
    setDescriptionEditorNotice(null);
    setDescriptionModalMode("source");
    setDescriptionModalOpen(true);
  }

  function openEditDescription(template: DescriptionTemplate) {
    setEditingDescriptionId(template.id);
    setDescriptionFormName(template.name);
    setDescriptionFormContent(template.content);
    setDescriptionFormIsDefault(template.isDefault);
    setDescriptionSaveError(null);
    setDescriptionEditorNotice(null);
    setDescriptionModalMode("source");
    setDescriptionModalOpen(true);
  }

  function showDescriptionVisualEditor() {
    const normalizedContent = normalizePastedTemplateSource(descriptionFormContent);
    if (isFullTemplateSource(normalizedContent)) {
      if (normalizedContent !== descriptionFormContent) {
        setDescriptionFormContent(normalizedContent);
      }
      setDescriptionEditorNotice(
        "Full HTML templates are protected from the visual editor. Use Source to edit and Preview to inspect the rendered template.",
      );
      setDescriptionModalMode("source");
      return;
    }

    setDescriptionEditorNotice(null);
    setDescriptionModalMode("edit");
  }

  function showDescriptionPreview() {
    setDescriptionFormContent((current) => normalizePastedTemplateSource(current));
    setDescriptionEditorNotice(null);
    setDescriptionModalMode("preview");
  }

  function insertPlaceholder(token: string) {
    setDescriptionFormContent((current) => `${current}${current ? "\n" : ""}{{ ${token} }}`);
  }

  function handleDescriptionVisualPaste(event: ClipboardEvent<HTMLDivElement>) {
    const source = getFullTemplateSourceFromClipboard(event);
    if (!source) {
      return;
    }

    event.preventDefault();
    setDescriptionFormContent(source);
    setDescriptionEditorNotice(
      "Detected full HTML source and switched to Source mode so the template is not stripped.",
    );
    setDescriptionModalMode("source");
  }

  function openAddPolicy() {
    setEditingPolicyId(null);
    setPolicyFormName("");
    setPolicyFormStoreId("");
    setPolicyFormShippingPolicyId("");
    setPolicyFormReturnPolicyId("");
    setPolicyFormPaymentPolicyId("");
    setPolicyModalOpen(true);
  }

  function openEditPolicy(template: PolicyTemplate) {
    setEditingPolicyId(template.id);
    setPolicyFormName(template.name);
    setPolicyFormStoreId(template.storeId);
    setPolicyFormShippingPolicyId(template.shippingPolicyId ?? "");
    setPolicyFormReturnPolicyId(template.returnPolicyId ?? "");
    setPolicyFormPaymentPolicyId(template.paymentPolicyId ?? "");
    setPolicyModalOpen(true);
    void ensurePoliciesForStore(template.storeId);
  }

  async function handleSaveDescription() {
    if (!descriptionFormName.trim()) {
      return;
    }

    setSavingDescription(true);
    setDescriptionSaveError(null);
    try {
      const normalizedContent = normalizePastedTemplateSource(descriptionFormContent);
      if (normalizedContent !== descriptionFormContent) {
        setDescriptionFormContent(normalizedContent);
      }

      const res = editingDescriptionId
        ? await fetch(`/api/templates/${editingDescriptionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: descriptionFormName,
            content: normalizedContent,
            isDefault: descriptionFormIsDefault,
          }),
        })
        : await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: descriptionFormName,
            content: normalizedContent,
            isDefault: descriptionFormIsDefault,
          }),
        });

      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        setDescriptionSaveError(data?.error || "Failed to save template");
        return;
      }

      setDescriptionModalOpen(false);
      await fetchDescriptionTemplates();
    } catch {
      setDescriptionSaveError("Network error while saving template");
    } finally {
      setSavingDescription(false);
    }
  }

  async function handleDeleteDescription(id: string) {
    if (!window.confirm("Are you sure you want to delete this template?")) {
      return;
    }

    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      await fetchDescriptionTemplates();
      return;
    }

    const data = await res.json();
    alert(data.error || "Failed to delete template");
  }

  async function handleSavePolicy() {
    if (!policyFormName.trim() || !policyFormStoreId) {
      return;
    }

    setSavingPolicy(true);
    try {
      const payload = {
        name: policyFormName,
        storeId: policyFormStoreId,
        shippingPolicyId: policyFormShippingPolicyId || null,
        returnPolicyId: policyFormReturnPolicyId || null,
        paymentPolicyId: policyFormPaymentPolicyId || null,
      };

      const res = editingPolicyId
        ? await fetch(`/api/policy-templates/${editingPolicyId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/policy-templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to save policy template");
        return;
      }

      setPolicyModalOpen(false);
      await fetchPolicyTemplates();
    } finally {
      setSavingPolicy(false);
    }
  }

  async function handleDeletePolicy(id: string) {
    if (!window.confirm("Are you sure you want to delete this policy template?")) {
      return;
    }

    const res = await fetch(`/api/policy-templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      await fetchPolicyTemplates();
      return;
    }

    const data = await res.json();
    alert(data.error || "Failed to delete policy template");
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading templates...</p>;
  }

  const activePolicyOptions = policyFormStoreId ? policyOptionsByStore[policyFormStoreId] : undefined;
  const activePolicyOptionsLoading = Boolean(policyFormStoreId && loadingPolicyOptionsByStore[policyFormStoreId]);
  const descriptionPreviewContent = normalizePastedTemplateSource(descriptionFormContent);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setActiveSubTab("description")}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            activeSubTab === "description"
              ? "bg-orange-500 text-white"
              : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
          }`}
        >
          Description Templates
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("policy")}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            activeSubTab === "policy"
              ? "bg-orange-500 text-white"
              : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
          }`}
        >
          Policy Templates
        </button>
      </div>

      {loadError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {activeSubTab === "description" && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">{descriptionTemplates.length} template(s)</p>
            <button
              onClick={openAddDescription}
              className="rounded-md bg-orange-500 px-4 py-2 text-sm text-white transition-colors hover:bg-orange-600"
            >
              + Add blank template
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {descriptionTemplates.map((template) => (
              <div
                key={template.id}
                className="group relative overflow-hidden rounded-lg border border-gray-200 bg-white"
              >
                <div className="relative h-40 overflow-hidden bg-gray-50 p-2">
                  <iframe
                    title={`Template preview: ${template.name}`}
                    srcDoc={template.content || "<div></div>"}
                    sandbox=""
                    className="pointer-events-none origin-top-left bg-white"
                    style={{
                      transform: "scale(0.3)",
                      width: "333%",
                      height: "333%",
                      border: "0",
                    }}
                  />
                </div>

                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-colors group-hover:bg-black/20 group-hover:opacity-100">
                  <button
                    onClick={() => openEditDescription(template)}
                    className="rounded-full bg-white p-2 shadow transition-colors hover:bg-gray-100"
                    title="Edit"
                  >
                    <svg className="h-4 w-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => void handleDeleteDescription(template.id)}
                    className="rounded-full bg-white p-2 shadow transition-colors hover:bg-gray-100"
                    title="Delete"
                  >
                    <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>

                <div className="border-t border-gray-200 px-3 py-2">
                  <p className="truncate text-center text-sm font-medium">{template.name}</p>
                  {template.isDefault && (
                    <p className="mt-1 text-center">
                      <span className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                        Default
                      </span>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {activeSubTab === "policy" && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">{policyTemplates.length} policy template(s)</p>
            <button
              onClick={openAddPolicy}
              className="rounded-md bg-orange-500 px-4 py-2 text-sm text-white transition-colors hover:bg-orange-600"
            >
              + Add policy template
            </button>
          </div>

          <p className="mb-4 text-sm text-gray-500">
            Policy templates are selected on each product. The store on a template only determines which eBay business policies can be used inside that template.
          </p>

          <div className="space-y-3">
            {policyTemplates.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-500">
                No policy templates yet.
              </div>
            )}

            {policyTemplates.map((template) => {
              const storePolicies = policyOptionsByStore[template.storeId];

              return (
                <div
                  key={template.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">{template.name}</h3>
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                          {template.store.name}
                        </span>
                      </div>

                      <div className="grid gap-2 text-sm text-gray-600 md:grid-cols-3">
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Shipping</p>
                          <p className="mt-1 text-sm text-gray-700">
                            {getPolicyLabel(template.shippingPolicyId, storePolicies?.shipping)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Return</p>
                          <p className="mt-1 text-sm text-gray-700">
                            {getPolicyLabel(template.returnPolicyId, storePolicies?.returns)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Payment</p>
                          <p className="mt-1 text-sm text-gray-700">
                            {getPolicyLabel(template.paymentPolicyId, storePolicies?.payment)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditPolicy(template)}
                        className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDeletePolicy(template.id)}
                        className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {descriptionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="shrink-0 border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingDescriptionId ? "Edit Template" : "Add Template"}
              </h2>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Template Name</label>
                <input
                  type="text"
                  value={descriptionFormName}
                  onChange={(event) => setDescriptionFormName(event.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="e.g. RK Ecom, 30 Day Free Return"
                />
              </div>
              <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-gray-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="truncate font-medium text-gray-700">
                      {descriptionFormName || "Untitled template"}
                    </span>
                    <div className="flex overflow-hidden rounded-md border border-gray-200">
                      <button
                        type="button"
                        onClick={showDescriptionVisualEditor}
                        className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                          descriptionModalMode === "edit"
                            ? "bg-gray-900 text-white"
                            : "bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        Visual
                      </button>
                      <button
                        type="button"
                        onClick={() => setDescriptionModalMode("source")}
                        className={`border-l border-gray-200 px-2.5 py-1 text-xs font-semibold transition-colors ${
                          descriptionModalMode === "source"
                            ? "bg-gray-900 text-white"
                            : "bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        Source
                      </button>
                      <button
                        type="button"
                        onClick={showDescriptionPreview}
                        className={`border-l border-gray-200 px-2.5 py-1 text-xs font-semibold transition-colors ${
                          descriptionModalMode === "preview"
                            ? "bg-blue-600 text-white"
                            : "bg-white text-blue-600 hover:bg-blue-50"
                        }`}
                      >
                        Preview
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-y-1 text-xs text-gray-500">
                    <span className="mr-1">Insert:</span>
                    {placeholderTokens.map((token, index) => (
                      <span key={token} className="inline-flex items-center">
                        <button
                          type="button"
                          onClick={() => insertPlaceholder(token)}
                          className="text-[11px] font-medium text-gray-700 hover:text-orange-600"
                        >
                          {token}
                        </button>
                        {index < placeholderTokens.length - 1 ? (
                          <span className="pr-1 text-gray-400">, </span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="bg-white">
                  {descriptionModalMode === "edit" ? (
                    <div onPasteCapture={handleDescriptionVisualPaste}>
                      <RichTextEditor
                        value={descriptionFormContent}
                        onChange={setDescriptionFormContent}
                        minHeight="560px"
                        placeholder="Paste the full AutoDS HTML template here"
                        toolbarVariant="compact"
                      />
                    </div>
                  ) : descriptionModalMode === "source" ? (
                    <textarea
                      value={descriptionFormContent}
                      onChange={(event) => setDescriptionFormContent(event.target.value)}
                      spellCheck={false}
                      className="h-[560px] w-full resize-y border-0 bg-white px-4 py-3 font-mono text-xs leading-6 text-gray-900 outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Paste the full AutoDS HTML source here"
                    />
                  ) : (
                    <iframe
                      title={`${descriptionFormName || "Template"} preview`}
                      srcDoc={descriptionPreviewContent || "<div></div>"}
                      sandbox="allow-same-origin"
                      className="h-[560px] w-full border-0 bg-white"
                    />
                  )}
                </div>
              </div>
              {descriptionEditorNotice && (
                <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                  {descriptionEditorNotice}
                </div>
              )}
              <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={descriptionFormIsDefault}
                  onChange={(event) => setDescriptionFormIsDefault(event.target.checked)}
                  className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                />
                Set as default template
              </label>
              {descriptionSaveError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {descriptionSaveError}
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-gray-200 bg-white px-6 py-4">
              <div className="flex justify-end gap-3">
              <button
                onClick={() => setDescriptionModalOpen(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSaveDescription()}
                disabled={savingDescription || !descriptionFormName.trim()}
                className="rounded-md bg-orange-500 px-4 py-2 text-sm text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
              >
                {savingDescription ? "Saving..." : "Save"}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {policyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingPolicyId ? "Edit Policy Template" : "Add Policy Template"}
              </h2>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Template Name</label>
                <input
                  type="text"
                  value={policyFormName}
                  onChange={(event) => setPolicyFormName(event.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="e.g. RK Ecom Policy Template"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Store</label>
                <select
                  value={policyFormStoreId}
                  onChange={(event) => {
                    const nextStoreId = event.target.value;
                    setPolicyFormStoreId(nextStoreId);
                    setPolicyFormShippingPolicyId("");
                    setPolicyFormReturnPolicyId("");
                    setPolicyFormPaymentPolicyId("");
                    if (nextStoreId) {
                      void ensurePoliciesForStore(nextStoreId);
                    }
                  }}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Select a store</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Choose the store only to load that store&apos;s eBay business policy IDs. Products will still select templates individually.
                </p>
              </div>

              {policyFormStoreId ? (
                activePolicyOptionsLoading ? (
                  <p className="text-sm text-gray-500">Loading store policies...</p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Shipping Policy</label>
                      <select
                        value={policyFormShippingPolicyId}
                        onChange={(event) => setPolicyFormShippingPolicyId(event.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="">Select shipping policy</option>
                        {activePolicyOptions?.shipping.map((policy) => (
                          <option key={policy.profileId} value={policy.profileId}>
                            {policy.profileName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Return Policy</label>
                      <select
                        value={policyFormReturnPolicyId}
                        onChange={(event) => setPolicyFormReturnPolicyId(event.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="">Select return policy</option>
                        {activePolicyOptions?.returns.map((policy) => (
                          <option key={policy.profileId} value={policy.profileId}>
                            {policy.profileName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">Payment Policy</label>
                      <select
                        value={policyFormPaymentPolicyId}
                        onChange={(event) => setPolicyFormPaymentPolicyId(event.target.value)}
                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="">Select payment policy</option>
                        {activePolicyOptions?.payment.map((policy) => (
                          <option key={policy.profileId} value={policy.profileId}>
                            {policy.profileName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              ) : (
                <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  Select a store to load its shipping, return, and payment policies.
                </div>
              )}

            </div>

            <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
              <button
                onClick={() => setPolicyModalOpen(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSavePolicy()}
                disabled={savingPolicy || !policyFormName.trim() || !policyFormStoreId}
                className="rounded-md bg-orange-500 px-4 py-2 text-sm text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
              >
                {savingPolicy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
