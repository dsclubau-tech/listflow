import type { ExistingProductConflict } from "@/types/product-duplicate";

export type AmazonImportProgress = {
  stage: string;
  progress: number;
  workerName: string | null;
};

type AmazonImportJob<T> = AmazonImportProgress & {
  id: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  result: T | null;
  errorMessage: string | null;
  errorCode: string | null;
  errorStatus: number | null;
};

type AmazonImportResponse<T> = {
  job?: AmazonImportJob<T>;
  error?: string;
  code?: string;
  existing?: ExistingProductConflict;
};

export class AmazonImportRequestError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly existing?: ExistingProductConflict;

  constructor(
    message: string,
    options: {
      code?: string;
      status?: number;
      existing?: ExistingProductConflict;
    } = {},
  ) {
    super(message);
    this.name = "AmazonImportRequestError";
    this.code = options.code;
    this.status = options.status;
    this.existing = options.existing;
  }
}

function getFallbackError(response: Response, bodyText: string) {
  const trimmed = bodyText.trim();
  if (response.status === 504 || response.status === 408) {
    return "Amazon is taking too long to respond. No draft was created.";
  }
  if (response.status >= 500) {
    return "The Amazon import worker is unavailable. Please try again shortly.";
  }
  return trimmed ? trimmed.slice(0, 240) : "Amazon import failed.";
}

async function readResponse<T>(response: Response) {
  const bodyText = await response.text();
  if (!bodyText.trim()) return {} as AmazonImportResponse<T>;

  try {
    return JSON.parse(bodyText) as AmazonImportResponse<T>;
  } catch {
    return { error: getFallbackError(response, bodyText) };
  }
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function throwResponseError<T>(
  response: Response,
  data: AmazonImportResponse<T>,
): never {
  throw new AmazonImportRequestError(
    data.error || getFallbackError(response, ""),
    {
      code: data.code,
      status: response.status,
      existing: data.existing,
    },
  );
}

export async function runQueuedAmazonImport<T>(
  body: Record<string, unknown>,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: AmazonImportProgress) => void;
    timeoutMs?: number;
  } = {},
) {
  const response = await fetch("/api/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const queued = await readResponse<T>(response);
  if (!response.ok || !queued.job) {
    throwResponseError(response, queued);
  }

  const jobId = queued.job.id;
  const deadline = Date.now() + (options.timeoutMs ?? 150_000);
  let lastStage = "";
  let lastProgress = -1;

  while (Date.now() < deadline) {
    const pollResponse = await fetch(
      `/api/scrape?jobId=${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        cache: "no-store",
        signal: options.signal,
      },
    );
    const data = await readResponse<T>(pollResponse);
    if (!pollResponse.ok || !data.job) {
      throwResponseError(pollResponse, data);
    }

    const job = data.job;
    if (job.stage !== lastStage || job.progress !== lastProgress) {
      lastStage = job.stage;
      lastProgress = job.progress;
      options.onProgress?.({
        stage: job.stage,
        progress: job.progress,
        workerName: job.workerName,
      });
    }

    if (job.status === "COMPLETED") {
      if (!job.result) {
        throw new AmazonImportRequestError(
          "Amazon import completed without product data.",
          { code: "AMAZON_IMPORT_RESULT_MISSING", status: 422 },
        );
      }
      return job.result;
    }

    if (job.status === "FAILED") {
      throw new AmazonImportRequestError(
        job.errorMessage || "Amazon import failed.",
        {
          code: job.errorCode ?? undefined,
          status: job.errorStatus ?? 422,
        },
      );
    }

    await wait(800, options.signal);
  }

  throw new AmazonImportRequestError(
    "Amazon is taking too long to respond. The worker may still be finishing the import.",
    { code: "AMAZON_IMPORT_TIMEOUT", status: 408 },
  );
}

export function getAmazonImportStageMessage(stage: string) {
  switch (stage) {
    case "QUEUED":
      return "Waiting for the store worker.";
    case "SCRAPE_STARTED":
      return "Reading the selected Amazon product.";
    case "PAGE_FETCH":
    case "HTML_PARSE":
      return "Reading Amazon product details.";
    case "POSTCODE_SET":
      return "Checking the configured delivery location.";
    case "PRICE_EXTRACT":
      return "Reading the selected variant Buy Box price.";
    case "RETRYING_ON_UNIFIED_WORKER":
      return "Retrying with the unified worker.";
    case "RECOVERED_AFTER_WORKER_TIMEOUT":
      return "Resuming after a worker restart.";
    case "CATEGORY_SUGGEST":
      return "Finding the best eBay category.";
    case "DRAFT_READY":
      return "Preparing the imported draft.";
    default:
      return "Importing the Amazon product.";
  }
}
