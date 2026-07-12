"use client";

import { useEffect, useMemo, useState } from "react";
import ActionProgressBar from "@/components/ActionProgressBar";
import { normalizePromotedAdRate } from "@/lib/promoted-listings";

export type PromotedListingsJob = {
  id: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ productId: string; title: string; error: string }>;
  errorMessage: string | null;
  metadata?: Record<string, unknown>;
};

type Campaign = {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  marketplaceId: string;
  startDate: string | null;
  endDate: string | null;
  rateStrategy: "FIXED" | "DYNAMIC" | "UNKNOWN";
  bidPercentage: number | null;
  supported: boolean;
};

type Props = {
  open: boolean;
  selectedProductIds: string[];
  job: PromotedListingsJob | null;
  onClose: () => void;
  onJobStarted: (job: PromotedListingsJob) => void;
  onToast: (message: string, variant: "success" | "error") => void;
};

function getJobPercent(job: PromotedListingsJob) {
  return job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;
}

function isActiveJob(job: PromotedListingsJob | null) {
  return job?.status === "QUEUED" || job?.status === "RUNNING";
}

export default function PromotedListingsModal({
  open,
  selectedProductIds,
  job,
  onClose,
  onJobStarted,
  onToast,
}: Props) {
  const [operation, setOperation] = useState<"APPLY" | "REMOVE">("APPLY");
  const [campaignMode, setCampaignMode] = useState<"EXISTING" | "CREATE">(
    "EXISTING",
  );
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [bidPercentage, setBidPercentage] = useState("3.0");
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const supportedCampaigns = useMemo(
    () => campaigns.filter((campaign) => campaign.supported),
    [campaigns],
  );
  const unsupportedCampaigns = campaigns.filter((campaign) => !campaign.supported);
  const active = isActiveJob(job);

  useEffect(() => {
    if (!open || active) return;

    const controller = new AbortController();
    setIsLoadingCampaigns(true);
    setEligibilityError(null);

    void fetch("/api/ebay/promoted-listings/campaigns", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          campaigns?: Campaign[];
          eligibility?: { eligible?: boolean; reason?: string | null };
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "Failed to load campaigns.");

        const nextCampaigns = data.campaigns ?? [];
        setCampaigns(nextCampaigns);
        const supported = nextCampaigns.filter((campaign) => campaign.supported);
        setCampaignId((current) =>
          supported.some((campaign) => campaign.campaignId === current)
            ? current
            : supported[0]?.campaignId ?? "",
        );
        if (supported.length === 0) setCampaignMode("CREATE");
        if (data.eligibility?.eligible === false) {
          setEligibilityError(
            data.eligibility.reason
              ? `This eBay account is not eligible: ${data.eligibility.reason}.`
              : "This eBay account is not eligible for General Promoted Listings.",
          );
        }
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setEligibilityError(
          error instanceof Error ? error.message : "Failed to load campaigns.",
        );
      })
      .finally(() => setIsLoadingCampaigns(false));

    return () => controller.abort();
  }, [active, open]);

  if (!open) return null;

  const rate = normalizePromotedAdRate(bidPercentage);
  const validRate = rate !== null;
  const validCampaign =
    operation === "REMOVE" ||
    (campaignMode === "EXISTING" ? Boolean(campaignId) : campaignName.trim().length > 0);
  const canSubmit =
    !active &&
    !isSubmitting &&
    selectedProductIds.length > 0 &&
    !eligibilityError &&
    validCampaign &&
    (operation === "REMOVE" || (validRate && confirmed));

  const submit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/ebay/promoted-listings/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: selectedProductIds,
          operation,
          bidPercentage: operation === "APPLY" ? rate : undefined,
          campaign:
            operation === "APPLY"
              ? campaignMode === "EXISTING"
                ? { mode: "EXISTING", campaignId }
                : { mode: "CREATE", campaignName: campaignName.trim() }
              : undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        job?: PromotedListingsJob;
        message?: string;
        error?: string;
      };
      if (!response.ok || !data.job) {
        throw new Error(data.error || "Failed to queue promotion changes.");
      }

      onJobStarted(data.job);
      onToast(data.message || "Promotion changes queued.", "success");
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Failed to queue promotion changes.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Manage eBay Promotions</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {selectedProductIds.length} selected listing
              {selectedProductIds.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close promotion modal"
            className="flex h-9 w-9 items-center justify-center rounded text-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            X
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {job && (
            <div className="space-y-3">
              <ActionProgressBar
                label={
                  job.status === "QUEUED"
                    ? "Queued - waiting for the store worker"
                    : job.status === "RUNNING"
                      ? "Updating eBay promoted listings"
                      : job.status === "COMPLETED"
                        ? "Promotion job complete"
                        : "Promotion job failed"
                }
                percent={getJobPercent(job)}
                tone={job.failed > 0 || job.status === "FAILED" ? "red" : job.status === "COMPLETED" ? "green" : "blue"}
                detail={`${job.processed}/${job.total} processed, ${job.succeeded} succeeded, ${job.failed} failed`}
              />
              {job.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {job.errors.map((error, index) => (
                    <p key={`${error.productId}-${index}`} className="mb-1 last:mb-0">
                      <strong>{error.title || error.productId}:</strong> {error.error}
                    </p>
                  ))}
                </div>
              )}
              {active && (
                <p className="text-xs text-gray-500">
                  You can close this window or leave Products. The worker will continue this job.
                </p>
              )}
            </div>
          )}

          {!active && (
            <>
              <div className="inline-flex overflow-hidden rounded border border-gray-300">
                <button
                  type="button"
                  onClick={() => setOperation("APPLY")}
                  className={`px-4 py-2 text-sm font-medium ${operation === "APPLY" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                >
                  Promote / change rate
                </button>
                <button
                  type="button"
                  onClick={() => setOperation("REMOVE")}
                  className={`border-l border-gray-300 px-4 py-2 text-sm font-medium ${operation === "REMOVE" ? "bg-red-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                >
                  Remove promotion
                </button>
              </div>

              {eligibilityError && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {eligibilityError}
                </div>
              )}

              {operation === "APPLY" ? (
                <div className="space-y-4">
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-semibold text-gray-800">Campaign</legend>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="campaign-mode"
                        checked={campaignMode === "EXISTING"}
                        onChange={() => setCampaignMode("EXISTING")}
                        disabled={supportedCampaigns.length === 0}
                      />
                      Use an existing fixed-rate campaign
                    </label>
                    {campaignMode === "EXISTING" && (
                      <select
                        value={campaignId}
                        onChange={(event) => setCampaignId(event.target.value)}
                        disabled={isLoadingCampaigns}
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      >
                        {supportedCampaigns.map((campaign) => (
                          <option key={campaign.campaignId} value={campaign.campaignId}>
                            {campaign.campaignName} - {campaign.campaignStatus}
                            {campaign.bidPercentage !== null ? ` - ${campaign.bidPercentage}%` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="campaign-mode"
                        checked={campaignMode === "CREATE"}
                        onChange={() => setCampaignMode("CREATE")}
                      />
                      Create a new ListFlow campaign
                    </label>
                    {campaignMode === "CREATE" && (
                      <input
                        type="text"
                        value={campaignName}
                        onChange={(event) => setCampaignName(event.target.value)}
                        maxLength={80}
                        placeholder="Campaign name"
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      />
                    )}
                  </fieldset>

                  <label className="block text-sm font-semibold text-gray-800">
                    Fixed ad rate
                    <div className="relative mt-1">
                      <input
                        type="number"
                        value={bidPercentage}
                        onChange={(event) => setBidPercentage(event.target.value)}
                        min="2"
                        max="100"
                        step="0.1"
                        className="w-full rounded border border-gray-300 px-3 py-2 pr-9 text-sm"
                      />
                      <span className="absolute right-3 top-2 text-sm text-gray-500">%</span>
                    </div>
                    {!validRate && (
                      <span className="mt-1 block text-xs font-normal text-red-600">
                        Enter 2.0% to 100.0% using one decimal place.
                      </span>
                    )}
                  </label>

                  {unsupportedCampaigns.length > 0 && (
                    <p className="text-xs text-gray-500">
                      {unsupportedCampaigns.length} dynamic, ended, or unsupported campaign
                      {unsupportedCampaigns.length === 1 ? " is" : "s are"} hidden from selection.
                    </p>
                  )}

                  <label className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      I understand eBay may charge this ad rate when a sale is attributed to a promoted listing.
                    </span>
                  </label>
                </div>
              ) : (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  Selected listings will be removed from their current General Promoted Listings campaigns. Their eBay listings will remain active.
                </div>
              )}
            </>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-gray-200 bg-white px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {active || job?.status === "COMPLETED" || job?.status === "FAILED" ? "Close" : "Cancel"}
          </button>
          {!active && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className={`rounded px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${operation === "REMOVE" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}
            >
              {isSubmitting
                ? "Queuing..."
                : operation === "REMOVE"
                  ? "Remove Promotion"
                  : "Apply Promotion"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
