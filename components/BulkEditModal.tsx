"use client";
import { inventoryJobCounts } from "@/lib/ebay-inventory-job-results";

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import ActionProgressBar from "@/components/ActionProgressBar";
import { PostcodeAutocomplete } from "@/components/PostcodeAutocomplete";
import { getSuburbsForAuPostcode, getZipcodeLocationText } from "@/lib/ebay-location";
import {
  type BulkEditJobController,
  isActiveBulkEditJob as isActiveJob,
  isTerminalBulkEditJob as isTerminalJob,
  type BulkEditJob,
  type BulkEditSkipped,
} from "@/hooks/useBulkEditJob";

type ToastVariant = "success" | "error";

type BulkEditField =
  | "feesPercent"
  | "feesFixed"
  | "profitFixed"
  | "profitPercent"
  | "roundCents"
  | "quantity"
  | "title"
  | "brand"
  | "location"
  | "shippingPolicyId"
  | "returnPolicyId"
  | "paymentPolicyId"
  | "policyTemplateId"
  | "templateId"
  | "dispatchTimeMax"
  | "globalShipping"
  | "shippingMethod"
  | "shippingPrice";

type TitleMode = "set" | "prefix" | "suffix" | "findReplace";

type BulkEditItem = {
  id: string;
  field: BulkEditField;
  value: string;
  replaceValue: string;
  boolValue: boolean;
  titleMode: TitleMode;
  location: string;
  postalCode: string;
  locationText?: string;
};

type PolicyEntry = {
  profileId: string;
  profileName: string;
};

type Policies = {
  shipping: PolicyEntry[];
  returns: PolicyEntry[];
  payment: PolicyEntry[];
};

type PolicyTemplate = {
  id: string;
  name: string;
  storeId: string;
};

type DescriptionTemplate = {
  id: string;
  name: string;
  storeId: string;
};

type SupportDataLoaded = {
  storeId: string | null;
  policies: boolean;
  policyTemplates: boolean;
  descriptionTemplates: boolean;
};

interface BulkEditModalProps {
  open: boolean;
  view: "editor" | "job";
  tracking: BulkEditJobController;
  returnFocusRef?: RefObject<HTMLElement | null>;
  storeId: string | null;
  selectedProductIds: string[];
  onClose: () => void;
  onToast: (message: string, variant: ToastVariant) => void;
}

const FIELD_DEFINITIONS: Array<{
  field: BulkEditField;
  label: string;
  tag?: string;
  disabled?: boolean;
}> = [
  { field: "feesPercent", label: "Fees %" },
  { field: "feesFixed", label: "Fees $" },
  { field: "profitFixed", label: "Additional profit $" },
  { field: "profitPercent", label: "Additional profit %" },
  { field: "quantity", label: "Quantity" },
  { field: "roundCents", label: "Round cents" },
  { field: "templateId", label: "Template" },
  { field: "brand", label: "Brand" },
  { field: "title", label: "Title" },
  { field: "location", label: "Location", tag: "eBay" },
  { field: "returnPolicyId", label: "Return Policy", tag: "eBay" },
  { field: "shippingPolicyId", label: "Shipping Policy", tag: "eBay" },
  { field: "paymentPolicyId", label: "Payment Policy", tag: "eBay" },
  { field: "policyTemplateId", label: "Use Dynamic Policies", tag: "eBay" },
  { field: "dispatchTimeMax", label: "Additional handling days", tag: "eBay" },
  {
    field: "shippingMethod",
    label: "Shipping method",
    tag: "eBay",
    disabled: true,
  },
  {
    field: "shippingPrice",
    label: "Shipping price",
    tag: "eBay",
    disabled: true,
  },
  {
    field: "globalShipping",
    label: "Allow Global Shipping Program",
    tag: "eBay",
    disabled: true,
  },
];

const TITLE_MODE_OPTIONS: Array<{ value: TitleMode; label: string }> = [
  { value: "prefix", label: "Add prefix" },
  { value: "suffix", label: "Add suffix" },
  { value: "findReplace", label: "Find and replace" },
  { value: "set", label: "Set exact title" },
];

const LOCATION_OPTIONS = ["Australia", "United States", "United Kingdom"] as const;
const EMPTY_SUPPORT_DATA_LOADED: SupportDataLoaded = {
  storeId: null,
  policies: false,
  policyTemplates: false,
  descriptionTemplates: false,
};

function makeItem(field: BulkEditField): BulkEditItem {
  const numericDefault =
    field === "quantity"
      ? "1"
      : field === "dispatchTimeMax"
        ? "3"
      : field === "feesPercent" ||
          field === "feesFixed" ||
          field === "profitFixed" ||
          field === "profitPercent"
        ? "0"
        : "";

  return {
    id: `${field}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    field,
    value: numericDefault,
    replaceValue: "",
    boolValue: true,
    titleMode: field === "title" ? "prefix" : "prefix",
    location: "Australia",
    postalCode: "3000",
    locationText: "Melbourne, VIC",
  };
}

function fieldLabel(field: BulkEditField) {
  return FIELD_DEFINITIONS.find((definition) => definition.field === field)?.label ?? field;
}

function getProgressPercent(job: BulkEditJob | null) {
  if (!job?.total) {
    return 0;
  }

  return Math.min(100, Math.round((job.processed / job.total) * 100));
}

function buildOperation(item: BulkEditItem) {
  if (
    item.field === "feesPercent" ||
    item.field === "feesFixed" ||
    item.field === "profitFixed" ||
    item.field === "profitPercent" ||
    item.field === "quantity" ||
    item.field === "dispatchTimeMax"
  ) {
    return { field: item.field, value: item.value };
  }

  if (item.field === "roundCents") {
    return { field: item.field, value: item.boolValue };
  }

  if (item.field === "title") {
    return {
      field: item.field,
      mode: item.titleMode,
      value: item.value,
      replaceValue: item.replaceValue,
    };
  }

  if (item.field === "location") {
    return {
      field: item.field,
      value: {
        location: item.location,
        postalCode: item.postalCode,
        locationText: item.locationText,
      },
    };
  }

  return {
    field: item.field,
    value: item.value || null,
  };
}

export default function BulkEditModal({
  open,
  view,
  tracking,
  returnFocusRef,
  storeId,
  selectedProductIds,
  onClose,
  onToast,
}: BulkEditModalProps) {
  const [items, setItems] = useState<BulkEditItem[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fieldSearch, setFieldSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [policyTemplates, setPolicyTemplates] = useState<PolicyTemplate[]>([]);
  const [descriptionTemplates, setDescriptionTemplates] = useState<DescriptionTemplate[]>([]);
  const [supportDataLoaded, setSupportDataLoaded] = useState<SupportDataLoaded>(
    EMPTY_SUPPORT_DATA_LOADED
  );
  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const requestInFlight = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousStore = useRef(storeId);
  const requestScope = useMemo(() => ({ storeId, cancelled: false }), [storeId]);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const { job, skipped, workerOnline, pollingInterrupted, restoring, trackJob, dismiss } = tracking;
  const detailsView = Boolean(job && (view === "job" || isActiveJob(job)));
  const selectedStoreId = storeId;
  const selectedCount = selectedProductIds.length;
  const selectedFields = useMemo(
    () => new Set(items.map((item) => item.field)),
    [items]
  );
  const needsEbayPolicies =
    selectedFields.has("shippingPolicyId") ||
    selectedFields.has("returnPolicyId") ||
    selectedFields.has("paymentPolicyId");
  const needsPolicyTemplates = selectedFields.has("policyTemplateId");
  const needsDescriptionTemplates = selectedFields.has("templateId");
  const filteredFields = useMemo(() => {
    const query = fieldSearch.trim().toLowerCase();

    return FIELD_DEFINITIONS.filter((definition) => {
      if (selectedFields.has(definition.field)) {
        return false;
      }

      if (!query) {
        return true;
      }

      return definition.label.toLowerCase().includes(query);
    });
  }, [fieldSearch, selectedFields]);
  const validationError = useMemo(() => {
    if (items.length === 0) {
      return "Add at least one item to edit.";
    }

    for (const item of items) {
      if (
        item.field === "feesPercent" ||
        item.field === "feesFixed" ||
        item.field === "profitFixed" ||
        item.field === "profitPercent"
      ) {
        const value = Number(item.value);
        if (!Number.isFinite(value) || value < 0) {
          return `${fieldLabel(item.field)} must be 0 or greater.`;
        }
      }

      if (item.field === "quantity") {
        const value = Number(item.value);
        if (!Number.isInteger(value) || value < 0) {
          return "Quantity must be a whole number of 0 or greater.";
        }
      }

      if (item.field === "dispatchTimeMax") {
        const value = Number(item.value);
        if (!Number.isInteger(value) || value < 0 || value > 30) {
          return "Additional handling days must be a whole number from 0 to 30.";
        }
      }

      if (item.field === "title") {
        if (!item.value.trim()) {
          return item.titleMode === "findReplace"
            ? "Find text is required."
            : "Title text is required.";
        }
      }

      if (item.field === "brand" && !item.value.trim()) {
        return "Brand is required.";
      }

      if (item.field === "location" && !item.postalCode.trim()) {
        return "Postcode is required.";
      }
    }

    return null;
  }, [items]);

  useEffect(() => {
    if (!open && !submitting) {
      requestIdRef.current = null;
      setItems([]);
      setMenuOpen(false);
      setFieldSearch("");
      setPolicies(null);
      setPolicyTemplates([]);
      setDescriptionTemplates([]);
      setSupportDataLoaded(EMPTY_SUPPORT_DATA_LOADED);
      setLoadingPolicies(false);
      setSubmissionError(null);
    }
  }, [open, submitting]);

  useEffect(() => {
    if (previousStore.current !== storeId) {
      previousStore.current = storeId;
      requestInFlight.current = false;
      requestIdRef.current = null;
      setSubmitting(false);
      setItems([]);
      setRetryError(null);
      setSubmissionError(null);
      onClose();
    }
  }, [storeId, onClose]);

  useEffect(() => {
    requestScope.cancelled = false;
    return () => { requestScope.cancelled = true; };
  }, [requestScope]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = returnFocusRef?.current ?? document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']") ?? []).filter(element => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
      else document.getElementById("bulk-edit-job-control")?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setPolicies(null);
    setPolicyTemplates([]);
    setDescriptionTemplates([]);
    setSupportDataLoaded({
      ...EMPTY_SUPPORT_DATA_LOADED,
      storeId: selectedStoreId,
    });
  }, [open, selectedStoreId]);

  useEffect(() => {
    if (!open || !selectedStoreId) {
      return;
    }
    const storeIdForRequest = selectedStoreId;

    const loadedForStore =
      supportDataLoaded.storeId === storeIdForRequest
        ? supportDataLoaded
        : EMPTY_SUPPORT_DATA_LOADED;
    const shouldLoadPolicies = needsEbayPolicies && !loadedForStore.policies;
    const shouldLoadPolicyTemplates =
      needsPolicyTemplates && !loadedForStore.policyTemplates;
    const shouldLoadDescriptionTemplates =
      needsDescriptionTemplates && !loadedForStore.descriptionTemplates;

    if (
      !shouldLoadPolicies &&
      !shouldLoadPolicyTemplates &&
      !shouldLoadDescriptionTemplates
    ) {
      return;
    }

    let cancelled = false;

    async function loadSupportData() {
      setLoadingPolicies(true);

      try {
        const [policyResponse, templateResponse, descriptionTemplateResponse] =
          await Promise.all([
            shouldLoadPolicies
              ? fetch(`/api/policies?store=${encodeURIComponent(storeIdForRequest)}`, {
                  cache: "no-store",
                })
              : Promise.resolve(null),
            shouldLoadPolicyTemplates
              ? fetch(`/api/policy-templates?storeId=${encodeURIComponent(storeIdForRequest)}`, {
                  cache: "no-store",
                })
              : Promise.resolve(null),
            shouldLoadDescriptionTemplates
              ? fetch("/api/templates", {
                  cache: "no-store",
                })
              : Promise.resolve(null),
          ]);

        if (cancelled) {
          return;
        }

        const loaded = {
          policies: false,
          policyTemplates: false,
          descriptionTemplates: false,
        };

        if (policyResponse?.ok) {
          setPolicies((await policyResponse.json()) as Policies);
          loaded.policies = true;
        }

        if (templateResponse?.ok) {
          setPolicyTemplates((await templateResponse.json()) as PolicyTemplate[]);
          loaded.policyTemplates = true;
        }

        if (descriptionTemplateResponse?.ok) {
          setDescriptionTemplates(
            (await descriptionTemplateResponse.json()) as DescriptionTemplate[]
          );
          loaded.descriptionTemplates = true;
        }

        if (
          loaded.policies ||
          loaded.policyTemplates ||
          loaded.descriptionTemplates
        ) {
          setSupportDataLoaded((current) => {
            const base =
              current.storeId === storeIdForRequest
                ? current
                : { ...EMPTY_SUPPORT_DATA_LOADED, storeId: storeIdForRequest };

            return {
              storeId: storeIdForRequest,
              policies: base.policies || loaded.policies,
              policyTemplates: base.policyTemplates || loaded.policyTemplates,
              descriptionTemplates:
                base.descriptionTemplates || loaded.descriptionTemplates,
            };
          });
        }
      } catch {
        if (!cancelled) {
          if (shouldLoadPolicies) setPolicies(null);
          if (shouldLoadPolicyTemplates) setPolicyTemplates([]);
          if (shouldLoadDescriptionTemplates) setDescriptionTemplates([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingPolicies(false);
        }
      }
    }

    void loadSupportData();

    return () => {
      cancelled = true;
    };
  }, [
    needsDescriptionTemplates,
    needsEbayPolicies,
    needsPolicyTemplates,
    open,
    selectedStoreId,
    supportDataLoaded,
  ]);

  if (!open) return null;

  function addField(field: BulkEditField) {
    if (requestInFlight.current) return;
    const definition = FIELD_DEFINITIONS.find((item) => item.field === field);
    if (!definition || definition.disabled || selectedFields.has(field)) {
      return;
    }

    requestIdRef.current = null;
    setSubmissionError(null);
    setItems((current) => [...current, makeItem(field)]);
    setMenuOpen(false);
    setFieldSearch("");
  }

  function updateItem(id: string, patch: Partial<BulkEditItem>) {
    if (requestInFlight.current) return;
    requestIdRef.current = null;
    setSubmissionError(null);
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function removeItem(id: string) {
    if (requestInFlight.current) return;
    requestIdRef.current = null;
    setSubmissionError(null);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function submitBulkEdit() {
    if (validationError || selectedCount === 0 || isActiveJob(job) || restoring || requestInFlight.current || detailsView) {
      return;
    }

    const exactTitleItem = items.find(
      (item) => item.field === "title" && item.titleMode === "set"
    );
    const confirmedExactTitle =
      !exactTitleItem ||
      selectedCount === 1 ||
      window.confirm(
        `Set the same exact title on ${selectedCount} products? This can make listings identical.`
      );

    if (!confirmedExactTitle) {
      return;
    }

    requestInFlight.current = true;
    setSubmissionError(null);
    setSubmitting(true);

    try {
      const operations = items.map((item) => {
        const operation = buildOperation(item);
        if (item.field === "title" && item.titleMode === "set") {
          return { ...operation, confirmed: true };
        }
        return operation;
      });
      const response = await fetch("/api/products/bulk-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: selectedProductIds,
          operations,
          reviseEbay: true,
          requestId: requestIdRef.current ?? (requestIdRef.current = crypto.randomUUID()),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        job?: BulkEditJob | null;
        skipped?: BulkEditSkipped[];
      };

      if (requestScope.cancelled) return;
      if (!response.ok || !data.job) {
        throw new Error(data.error || "Bulk edit failed.");
      }

      if (!trackJob(data.job, data.skipped ?? [])) throw new Error("Bulk edit returned a job for a different store.");
      setRetryError(null);
      requestIdRef.current = null;
      onClose();
    } catch (error) {
      if (!requestScope.cancelled) {
        const message = error instanceof Error ? error.message : "Bulk edit failed.";
        setSubmissionError(message);
        onToast(message, "error");
      }
    } finally {
      if (!requestScope.cancelled) { requestInFlight.current = false; setSubmitting(false); }
    }
  }

  async function retryFailedItems() {
    if (!job || job.failed === 0 || !isTerminalJob(job) || requestInFlight.current) return;
    requestInFlight.current = true;
    setRetryError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/products/bulk-edit/jobs/${job.id}/retry`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { job?: BulkEditJob; error?: string };
      if (requestScope.cancelled) return;
      if (!response.ok || !data.job) throw new Error(data.error || "Unable to retry failed items.");
      if (!trackJob(data.job)) throw new Error("Retry returned a job for a different store.");
      onClose();
    } catch (error) {
      if (!requestScope.cancelled) setRetryError(error instanceof Error ? error.message : "Unable to retry failed items.");
    } finally {
      if (!requestScope.cancelled) { requestInFlight.current = false; setSubmitting(false); }
    }
  }

  function renderValueControl(item: BulkEditItem) {
    if (item.field === "roundCents") {
      return (
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={item.boolValue}
            onChange={(event) => updateItem(item.id, { boolValue: event.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
          />
          Round to .99
        </label>
      );
    }

    if (item.field === "title") {
      return (
        <div className="grid gap-2 sm:grid-cols-[150px_1fr_1fr]">
          <select
            value={item.titleMode}
            onChange={(event) =>
              updateItem(item.id, { titleMode: event.target.value as TitleMode })
            }
            className="h-10 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
          >
            {TITLE_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={item.value}
            onChange={(event) => updateItem(item.id, { value: event.target.value })}
            placeholder={item.titleMode === "findReplace" ? "Find" : "Text"}
            className="h-10 rounded-md border border-gray-300 px-3 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
          />
          {item.titleMode === "findReplace" ? (
            <input
              type="text"
              value={item.replaceValue}
              onChange={(event) =>
                updateItem(item.id, { replaceValue: event.target.value })
              }
              placeholder="Replace"
              className="h-10 rounded-md border border-gray-300 px-3 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            />
          ) : (
            <div />
          )}
        </div>
      );
    }

    if (item.field === "location") {
      const isAu = item.location === "Australia";
      const auSuburbsData = isAu ? getSuburbsForAuPostcode(item.postalCode) : null;
      const displayLocation =
        item.locationText ||
        getZipcodeLocationText(item.postalCode, item.location);

      return (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
            <select
              value={item.location}
              onChange={(event) =>
                updateItem(item.id, {
                  location: event.target.value,
                  locationText: undefined,
                })
              }
              className="h-10 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            >
              {LOCATION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <PostcodeAutocomplete
              value={item.postalCode}
              selectedLocationText={item.locationText}
              onChange={(pc, locText) =>
                updateItem(item.id, {
                  postalCode: pc,
                  locationText: locText || undefined,
                })
              }
              country={item.location}
              placeholder="Postcode"
              className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 bg-white"
              showHint={false}
            />
          </div>

          {/* If there are multiple suburbs for this postcode, show explicit suburb selector */}
          {auSuburbsData && auSuburbsData.suburbs.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Suburb:</span>
              <select
                value={
                  auSuburbsData.suburbs.find((sub) =>
                    displayLocation.toLowerCase() === `${sub}, ${auSuburbsData.state}`.toLowerCase(),
                  ) || ""
                }
                onChange={(e) => {
                  const chosenSuburb = e.target.value;
                  const newLocText = `${chosenSuburb}, ${auSuburbsData.state}`;
                  updateItem(item.id, { locationText: newLocText });
                }}
                className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs font-medium text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              >
                <option value="">Select suburb</option>
                {auSuburbsData.suburbs.map((sub) => (
                  <option key={sub} value={sub}>
                    {sub} ({item.postalCode})
                  </option>
                ))}
              </select>
            </div>
          )}

          {displayLocation && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200 w-fit">
              <span>📍 Selected Location: <strong className="font-semibold">{displayLocation}</strong></span>
            </div>
          )}
        </div>
      );
    }

    if (
      item.field === "shippingPolicyId" ||
      item.field === "returnPolicyId" ||
      item.field === "paymentPolicyId" ||
      item.field === "policyTemplateId" ||
      item.field === "templateId"
    ) {
      const options =
        item.field === "shippingPolicyId"
          ? policies?.shipping ?? []
          : item.field === "returnPolicyId"
            ? policies?.returns ?? []
            : item.field === "paymentPolicyId"
              ? policies?.payment ?? []
              : item.field === "policyTemplateId"
                ? policyTemplates.map((template) => ({
                    profileId: template.id,
                    profileName: template.name,
                  }))
                : descriptionTemplates.map((template) => ({
                    profileId: template.id,
                    profileName: template.name,
                  }));

      return (
        <select
          value={item.value}
          onChange={(event) => updateItem(item.id, { value: event.target.value })}
          disabled={loadingPolicies}
          className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:cursor-wait disabled:bg-gray-50"
        >
          <option value="">{loadingPolicies ? "Loading..." : "Select"}</option>
          {options.map((option) => (
            <option key={option.profileId} value={option.profileId}>
              {option.profileName}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        type={
          item.field === "brand"
            ? "text"
            : "number"
        }
        value={item.value}
        min={0}
        step={item.field === "quantity" || item.field === "dispatchTimeMax" ? 1 : 0.01}
        onChange={(event) => updateItem(item.id, { value: event.target.value })}
        className="h-10 w-full rounded-md border border-gray-300 px-3 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
      />
    );
  }

  const progressPercent = getProgressPercent(job);
  const terminalJob = isTerminalJob(job);

  function closeModal() {
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-2 sm:p-4"
      onClick={closeModal}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-edit-heading"
        className="max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-5 flex-shrink-0">
          <div>
            <h2 id="bulk-edit-heading" className="text-lg sm:text-xl font-semibold text-gray-900">
              {detailsView ? terminalJob ? "Bulk Edit Results" : "Bulk Edit Progress" : "Bulk Edit"}{" "}
              <span className="text-xs sm:text-sm font-medium text-gray-500">
                ({detailsView ? job?.total : selectedCount} products)
              </span>
            </h2>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="inline-flex h-8 w-8 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close bulk edit"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5">
          {!detailsView && <>
            <div className="relative inline-block">
              <button
                type="button"
                onClick={() => setMenuOpen((current) => !current)}
                disabled={submitting || restoring}
                className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
                Add item to edit
              </button>
              {menuOpen && (
                <div className="absolute left-0 top-full z-10 mt-2 w-72 sm:w-80 max-w-[calc(100vw-3rem)] overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                  <div className="border-b border-gray-100 p-2">
                    <input
                      type="search"
                      value={fieldSearch}
                      onChange={(event) => setFieldSearch(event.target.value)}
                      placeholder="Search"
                      className="h-9 w-full rounded-md border border-gray-200 px-3 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    />
                  </div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {filteredFields.map((definition) => (
                      <button
                        key={definition.field}
                        type="button"
                        onClick={() => addField(definition.field)}
                        disabled={definition.disabled}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
                      >
                        <span>{definition.label}</span>
                        <span className="flex items-center gap-1">
                          {definition.tag && (
                            <span className="rounded-full border border-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                              {definition.tag}
                            </span>
                          )}
                          {definition.disabled && (
                            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-400">
                              Coming soon
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                    {filteredFields.length === 0 && (
                      <div className="px-4 py-3 text-sm text-gray-500">
                        No matching fields
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">
                      {fieldLabel(item.field)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      disabled={submitting}
                      className="text-xs font-semibold text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                  <fieldset disabled={submitting}>{renderValueControl(item)}</fieldset>
                </div>
              ))}
              {items.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                  Choose fields above to start bulk editing.
                </div>
              )}
            </div>

            {items.length > 0 && validationError && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {validationError}
              </div>
            )}
            {submissionError && <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {submissionError}
            </div>}
            {restoring && <p className="mt-4 text-sm text-gray-500" role="status">Checking previous bulk edit…</p>}
          </>}

          {detailsView && job && (
            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
              <ActionProgressBar
                label={
                  job.status === "CANCELLED"
                    ? "Bulk edit cancelled"
                    : job.status === "CANCELLING"
                      ? "Cancelling - finishing current operation"
                    : job.status === "FAILED"
                      ? "Bulk edit failed"
                    : terminalJob
                    ? inventoryJobCounts(job).awaitingRestoration > 0
                      ? "Price updates awaiting restoration"
                    : job.failed > 0
                      ? "Bulk edit completed with errors"
                      : "Bulk edit complete"
                    : "Applying bulk edits"
                }
                percent={progressPercent}
                detail={`${job.processed}/${job.total} processed (${job.succeeded} succeeded, ${inventoryJobCounts(job).failed} failed${inventoryJobCounts(job).awaitingRestoration ? ", "+inventoryJobCounts(job).awaitingRestoration+" awaiting restoration" : ""}${inventoryJobCounts(job).verification ? ", "+inventoryJobCounts(job).verification+" need verification" : ""})` }
                tone={inventoryJobCounts(job).awaitingRestoration ? "amber" : "green"}
              />
              {!terminalJob && job.queuePosition && job.queuePosition > 1 && (
                <div className="mt-2 text-xs text-gray-600">Queue position {job.queuePosition}</div>
              )}
              {!terminalJob && workerOnline === false && (
                <div className="mt-2 text-xs font-medium text-amber-700">
                  No active worker. The job will resume when a worker reconnects.
                </div>
              )}
              {pollingInterrupted && (
                <div className="mt-2 text-xs font-medium text-red-600" role="alert">
                  Live progress is unavailable. The job may still be running; retrying status checks automatically.
                </div>
              )}
              {job.updatedAt && !terminalJob && (
                <div className="mt-1 text-xs text-gray-500">
                  Last progress {new Date(job.updatedAt).toLocaleTimeString()}
                </div>
              )}
              {job.errors.length > 0 && (
                <div className="mt-3 max-h-28 overflow-y-auto rounded border border-red-200 bg-white p-2">
                  {job.errors.map((error) => (
                    <div key={`${error.productId}-${error.error}`} className={(error.outcomeUncertain || error.variationResults?.some(t=>t.state==="DEFERRED")) ? "text-xs text-amber-800" : "text-xs text-red-700"}>
                      <span className="font-semibold">{error.title || error.productId}:</span>{" "}
                      <span>{error.outcomeUncertain ? "Update result needs verification." : error.error}</span>
                      {error.variationResults?.length ? <details className="my-1"><summary className="cursor-pointer">Variation details</summary>
                        <ul className="mt-1 space-y-1">{error.variationResults.map((result,index)=><li key={result.target.sku??index}>
                          {result.target.sku??"Listing"}: {result.state.toLowerCase()}{result.error ? " — "+result.error : ""}{result.errors?.map(e=><div key={e.code}>{e.code}: {e.shortMessage??e.message}{e.longMessage ? " — "+e.longMessage : ""}</div>)}
                        </li>)}</ul>
                      </details> : null}
                    </div>
                  ))}
                </div>
              )}
              {job.errorMessage && <p className="mt-2 text-sm text-red-700">{job.errorMessage}</p>}
              {retryError && <p className="mt-2 text-sm text-red-700" role="alert">{retryError}</p>}
              {terminalJob && job.status !== "CANCELLED" && inventoryJobCounts(job).retryable > 0 && (
                <button
                  type="button"
                  onClick={() => void retryFailedItems()}
                  disabled={submitting}
                  className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {submitting ? "Queuing retry..." : inventoryJobCounts(job).verification ? "Verify pending updates" : `Retry ${inventoryJobCounts(job).retryable} failed`}
                </button>
              )}
            </div>
          )}

          {detailsView && skipped.length > 0 && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="text-sm font-semibold text-amber-900">
                Skipped {skipped.length} product{skipped.length === 1 ? "" : "s"}
              </div>
              <div className="mt-2 max-h-24 overflow-y-auto space-y-1">
                {skipped.map((item) => (
                  <div key={`${item.productId}-${item.reason}`} className="text-xs text-amber-800">
                    <span className="font-semibold">{item.title || item.productId}:</span>{" "}
                    {item.reason}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-4 sm:px-6 py-3.5 sm:py-4 flex-shrink-0">
          {detailsView && terminalJob && <button type="button" onClick={() => { dismiss(); onClose(); }}
            className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Dismiss results</button>}
          <button
            type="button"
            onClick={closeModal}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            {detailsView ? "Close" : "Cancel"}
          </button>
          {!detailsView && <button
            type="button"
            onClick={() => void submitBulkEdit()}
            disabled={Boolean(validationError) || selectedCount === 0 || submitting || restoring}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Updating..." : "Update"}
          </button>}
        </div>
      </div>
    </div>
  );
}
