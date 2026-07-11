/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AsinLink from "@/components/AsinLink";
import type { Product, Store, User } from "@/app/generated/prisma/client";
import type { ScrapedProduct } from "@/components/AddProductModal";
import {
  addMissingItemSpecificRows,
  DRAFT_ITEM_SPECIFICS_TAB_INDEX,
  hasMissingItemSpecifics,
  mergeRequiredItemSpecifics,
  type DraftItemSpecificRow,
  type RequiredItemSpecific,
} from "@/components/draft-upload-response";
import ProductVariantsEditor from "@/components/ProductVariantsEditor";
import RichTextEditor from "@/components/RichTextEditor";
import { reportClientError } from "@/lib/client-logger";
import {
  DEFAULT_BRAND,
  inferBrandItemSpecific,
  inferSizeItemSpecific,
  inferTypeItemSpecific,
  parseMissingItemSpecificNames,
  sanitizeEbayItemSpecifics,
} from "@/lib/item-specifics";
import { isValidAsin, normalizeAsin } from "@/lib/price-check-eligibility";
import { resolveRequiredItemSpecifics } from "@/lib/required-specific-resolver";
import {
  getEbayCountryLabel,
  resolveEbayLocationMetadata,
} from "@/lib/ebay-location";
import {
  DEFAULT_AMAZON_PRICE_TRACKING_MODE,
  getAmazonPriceTrackingLabel,
  normalizeAmazonPriceTrackingMode,
  type AmazonPriceTrackingMode,
} from "@/lib/amazon-price-tracking";
import {
  dedupeProductImages,
  normalizeProductImageUrl,
} from "@/lib/product-images";
import { uploadProductImageFile } from "@/lib/client-product-image-upload";
import {
  applyTitleCase,
  normalizeFullProductTitle,
  toEbayListingTitle,
} from "@/lib/product-title";

// ----- Types -----

type ProductWithRelations = Product & { store: Store; createdBy: User };

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
  isDefault: boolean;
}

interface InlineEditFormProps {
  product: ProductWithRelations;
  onCollapse: () => void;
  onImported?: (productId: string) => void;
}

interface SaveMessage {
  text: string;
  title?: string;
  variant: "success" | "error";
}

function normalizeSpecificName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function getSpecificsObjectFromRows(
  rows: DraftItemSpecificRow[],
  brand: string
) {
  const specificsObj: Record<string, string> = {};

  for (const spec of rows) {
    if (spec.key.trim() && spec.value.trim()) {
      specificsObj[spec.key.trim()] = spec.value.trim();
    }
  }

  if (brand.trim()) {
    specificsObj.Brand = brand.trim();
  }

  return specificsObj;
}

function readSpecificValueFromRows(
  rows: DraftItemSpecificRow[],
  name: string,
  brand: string
) {
  const normalizedName = normalizeSpecificName(name);

  if (normalizedName === "brand" && brand.trim()) {
    return brand.trim();
  }

  const row = rows.find(
    (specific) => normalizeSpecificName(specific.key) === normalizedName
  );

  return row?.value.trim() || null;
}

function isPlaceholderBrand(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return (
    !normalized ||
    normalized === DEFAULT_BRAND.toLowerCase() ||
    normalized === "does not apply" ||
    normalized === "unknown" ||
    normalized === "n/a" ||
    normalized === "na"
  );
}

function upsertSpecificRow(
  rows: DraftItemSpecificRow[],
  name: string,
  value: string,
  options?: { replaceExisting?: boolean }
) {
  const normalizedName = normalizeSpecificName(name);
  let changed = false;
  const next = rows.map((specific) => {
    if (
      normalizeSpecificName(specific.key) !== normalizedName ||
      (specific.value.trim() && !options?.replaceExisting)
    ) {
      return specific;
    }

    if (specific.value === value) {
      return specific;
    }

    changed = true;
    return { ...specific, value };
  });

  if (!next.some((specific) => normalizeSpecificName(specific.key) === normalizedName)) {
    return [{ key: name, value }, ...next];
  }

  return changed ? next : rows;
}

function itemSpecificRowsEqual(
  left: DraftItemSpecificRow[],
  right: DraftItemSpecificRow[]
) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (row, index) =>
      row.key === right[index]?.key && row.value === right[index]?.value
  );
}

function prepareRequiredSpecificRows(input: {
  rows: DraftItemSpecificRow[];
  requiredItemSpecifics: RequiredItemSpecific[];
  brand: string;
  title: string;
  categoryName: string;
  description?: string;
}) {
  let rows = addMissingItemSpecificRows(
    input.rows,
    input.requiredItemSpecifics.map((specific) => specific.name)
  );

  const resolved = resolveRequiredItemSpecifics({
    title: input.title,
    categoryName: input.categoryName,
    description: input.description,
    brand: input.brand,
    itemSpecifics: getSpecificsObjectFromRows(rows, input.brand),
    requiredItemSpecifics: input.requiredItemSpecifics,
  });

  for (const decision of resolved.decisions) {
    if (decision.value) {
      rows = upsertSpecificRow(rows, decision.name, decision.value, {
        replaceExisting: decision.source !== "user",
      });
    }
  }

  const missingNames = input.requiredItemSpecifics
    .map((specific) => specific.name)
    .filter((name) => {
      const value = readSpecificValueFromRows(rows, name, input.brand);
      return !value || (normalizeSpecificName(name) === "brand" && isPlaceholderBrand(value));
    });

  return { rows, missingNames };
}

// ----- VERO keywords -----

const VERO_KEYWORDS = [
  "Tesla", "Apple", "Samsung", "Sony", "Nike", "Adidas", "Dyson",
  "Philips", "Bosch", "LG", "Panasonic", "Canon", "Nikon", "Nintendo",
  "Microsoft", "Google", "Amazon", "Bose", "Beats", "GoPro",
];

function findVeroMatch(title: string): string | null {
  const lower = title.toLowerCase();
  for (const word of VERO_KEYWORDS) {
    if (lower.includes(word.toLowerCase())) return word;
  }
  return null;
}

// ----- Store number helper -----

function storeNameToNumber(name: string): 1 | 2 | 3 {
  if (name === "Store 1") return 1;
  if (name === "Store 2") return 2;
  return 3;
}

function splitErrorMessage(message: string): string[] {
  const parts = message
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [message.trim()];
}

function buildRegrabAmazonUrl(asin: string) {
  return `https://www.amazon.com.au/dp/${asin.trim().toUpperCase()}`;
}

function normalizeScrapedTitle(data: ScrapedProduct) {
  const sourceTitle = normalizeFullProductTitle(data.fullTitle || data.title);
  if (!data.supplierDefaults?.capitalizeTitle) {
    return sourceTitle;
  }

  return applyTitleCase(sourceTitle);
}

function buildRegrabDraftUpdate(scraped: ScrapedProduct, fallbackAsin: string) {
  const fullTitle = normalizeScrapedTitle(scraped);
  const mergedSpecifics: Record<string, string> = {
    ...(scraped.supplierDefaults?.defaultItemSpecifics ?? {}),
    ...scraped.itemSpecifics,
  };
  const inferredBrand = inferBrandItemSpecific({
    itemSpecifics: mergedSpecifics,
    brand: scraped.brand,
  });
  if (inferredBrand) {
    mergedSpecifics.Brand = inferredBrand;
  }

  if (scraped.variantName?.trim() && !mergedSpecifics.Variant) {
    mergedSpecifics.Variant = scraped.variantName.trim();
  }

  if (!mergedSpecifics.Type) {
    const inferredType = inferTypeItemSpecific({
      title: fullTitle,
      categoryName: scraped.categoryName || scraped.category,
      itemSpecifics: mergedSpecifics,
    });
    if (inferredType) {
      mergedSpecifics.Type = inferredType;
    }
  }

  if (!mergedSpecifics.Size) {
    const inferredSize = inferSizeItemSpecific({
      title: fullTitle,
      categoryName: scraped.categoryName || scraped.category,
      itemSpecifics: mergedSpecifics,
    });
    if (inferredSize) {
      mergedSpecifics.Size = inferredSize;
    }
  }

  return {
    title: toEbayListingTitle(fullTitle),
    fullTitle,
    description: scraped.description,
    price: scraped.price,
    images: dedupeProductImages(scraped.images),
    asin: scraped.asin || fallbackAsin,
    brand: inferredBrand || scraped.brand,
    itemSpecifics: Object.entries(mergedSpecifics).map(([key, value]) => ({
      key,
      value: String(value),
    })),
    categoryId: scraped.categoryId,
    categoryName: scraped.categoryName || scraped.category,
    supplierDefaults: scraped.supplierDefaults,
    amazonPriceTrackingMode:
      scraped.amazonPriceTrackingMode ?? DEFAULT_AMAZON_PRICE_TRACKING_MODE,
  };
}

// ----- Tabs -----

const tabs = ["Product", "Description", "Variants", "Images", "Item Specifications"];

// ===== Component =====

export default function InlineEditForm({ product, onImported }: InlineEditFormProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);

  // Policies
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [policiesLoading, setPoliciesLoading] = useState(false);

  // Product tab fields
  const [title, setTitle] = useState(product.title);
  const [fullTitle, setFullTitle] = useState(
    normalizeFullProductTitle(
      (product as { fullTitle?: string | null }).fullTitle || product.title
    )
  );
  const [category, setCategory] = useState(product.category);
  const [categoryName, setCategoryName] = useState((product as Record<string, unknown>).categoryName as string || "");
  const [asin, setAsin] = useState(product.asin ?? "");
  const [tags, setTags] = useState("");
  const [shippingMethods, setShippingMethods] = useState("Cheapest with tracking");

  // Category suggestions
  const [catSuggestions, setCatSuggestions] = useState<Array<{ categoryId: string; categoryName: string }>>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [showCatDropdown, setShowCatDropdown] = useState(false);
  const [paymentPolicyId, setPaymentPolicyId] = useState(product.paymentPolicyId || "");
  const [shippingPolicyId, setShippingPolicyId] = useState(product.shippingPolicyId || "");
  const [returnPolicyId, setReturnPolicyId] = useState(product.returnPolicyId || "");
  const [policyTemplates, setPolicyTemplates] = useState<PolicyTemplate[]>([]);
  const [selectedPolicyTemplateId, setSelectedPolicyTemplateId] = useState(product.policyTemplateId || "");
  const hasInferredPolicyTemplateRef = useRef(Boolean(product.policyTemplateId));
  const hasAppliedDefaultPolicyTemplateRef = useRef(false);
  const [countryLocation, setCountryLocation] = useState("Australia");
  const [defaultZipcode, setDefaultZipcode] = useState("3170");
  const [brand, setBrand] = useState("");
  const [condition, setCondition] = useState(product.condition);
  const [price, setPrice] = useState(product.price.toString());
  const [quantity, setQuantity] = useState(product.quantity.toString());
  const [promotedAdPercent, setPromotedAdPercent] = useState(
    String(product.promotedAdPercent ?? 0)
  );
  const [amazonPriceTrackingMode, setAmazonPriceTrackingMode] =
    useState<AmazonPriceTrackingMode>(
      normalizeAmazonPriceTrackingMode(
        (product as { amazonPriceTrackingMode?: unknown })
          .amazonPriceTrackingMode
      )
    );
  const [amazonPriceUpdatePending, setAmazonPriceUpdatePending] = useState(false);

  // Description
  const [description, setDescription] = useState(product.description);
  const [templates, setTemplates] = useState<{ id: string; name: string; content: string; isDefault: boolean }[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(product.templateId || "");
  const [isLoadingEbayDescription, setIsLoadingEbayDescription] = useState(false);
  const requestedEbayDescriptionRef = useRef(false);

  // Images
  const [images, setImages] = useState<string[]>(() =>
    dedupeProductImages(product.images)
  );
  const [hoveredImage, setHoveredImage] = useState<number | null>(null);
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [imageMessage, setImageMessage] = useState<SaveMessage | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const manualImageFileInputRef = useRef<HTMLInputElement | null>(null);

  // Item Specifics
  const [itemSpecifics, setItemSpecifics] = useState<{ key: string; value: string }[]>([]);
  const [requiredItemSpecifics, setRequiredItemSpecifics] = useState<RequiredItemSpecific[]>([]);

  // Fetch templates on mount
  useEffect(() => {
    fetch("/api/templates")
      .then((res) => res.json())
      .then((data) => {
        setTemplates(data);
        // If product has no templateId, select the default template
        if (!selectedTemplateId) {
          const defaultTemplate = data.find((t: { isDefault: boolean }) => t.isDefault);
          if (defaultTemplate) setSelectedTemplateId(defaultTemplate.id);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save state
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isRegrabbing, setIsRegrabbing] = useState(false);
  const [saveMessage, setSaveMessage] = useState<SaveMessage | null>(null);

  useEffect(() => {
    setAsin(product.asin ?? "");
  }, [product.asin]);

  useEffect(() => {
    setImages(dedupeProductImages(product.images));
    setManualImageUrl("");
    setImageMessage(null);
    setIsUploadingImage(false);
    setHoveredImage(null);
    if (manualImageFileInputRef.current) {
      manualImageFileInputRef.current.value = "";
    }
  }, [product.id, product.images]);

  useEffect(() => {
    setFullTitle(
      normalizeFullProductTitle(
        (product as { fullTitle?: string | null }).fullTitle || product.title
      )
    );
  }, [product]);

  useEffect(() => {
    if (!amazonPriceUpdatePending) {
      setPrice(product.price.toString());
    }
  }, [amazonPriceUpdatePending, product.price]);

  useEffect(() => {
    setPromotedAdPercent(String(product.promotedAdPercent ?? 0));
  }, [product.promotedAdPercent]);

  useEffect(() => {
    setAmazonPriceTrackingMode(
      normalizeAmazonPriceTrackingMode(
        (product as { amazonPriceTrackingMode?: unknown })
          .amazonPriceTrackingMode
      )
    );
  }, [product]);

  // Parse brand / location from itemSpecifics on load
  useEffect(() => {
    const specs = product.itemSpecifics as Record<string, string> | null;
    if (specs && typeof specs === "object") {
      // Restore visible specs (exclude internal _-prefixed metadata)
      setItemSpecifics(
        Object.entries(specs)
          .filter(([key]) => !key.startsWith("_"))
          .map(([key, value]) => ({ key, value }))
      );
      const inferredBrand = inferBrandItemSpecific({
        itemSpecifics: specs,
        brand: specs.Brand,
      });
      if (inferredBrand) {
        setBrand(inferredBrand);
      } else if (specs["Brand"]) {
        setBrand(specs["Brand"]);
      }
      // Restore country code/label separately from item location.
      if (specs["_Country"]) {
        setCountryLocation(getEbayCountryLabel(specs["_Country"]));
      } else if (
        ["Australia", "United States", "United Kingdom", "Canada"].includes(
          specs["_Location"],
        )
      ) {
        setCountryLocation(getEbayCountryLabel(specs["_Location"]));
      }
      // Restore zipcode
      if (specs["_PostalCode"]) setDefaultZipcode(specs["_PostalCode"]);
    }
  }, [product.itemSpecifics]);

  const resolvedItemLocation = useMemo(
    () =>
      resolveEbayLocationMetadata({
        country: countryLocation,
        postalCode: defaultZipcode,
      }).location,
    [countryLocation, defaultZipcode],
  );

  const missingSpecificsFromError = useMemo(
    () => parseMissingItemSpecificNames(product.errorMessage),
    [product.errorMessage]
  );

  const fetchRequiredSpecificsForCategory = useCallback(async () => {
    if (!/^\d+$/.test(category.trim())) {
      return [];
    }

    const response = await fetch(
      `/api/ebay/category-aspects?categoryId=${encodeURIComponent(category.trim())}`,
      { cache: "no-store" }
    );
    const data = (await response.json().catch(() => ({}))) as {
      requiredItemSpecifics?: RequiredItemSpecific[];
    };

    if (!response.ok) {
      return [];
    }

    return data.requiredItemSpecifics ?? [];
  }, [category]);

  useEffect(() => {
    if (!/^\d+$/.test(category.trim())) {
      setRequiredItemSpecifics([]);
      return;
    }

    let cancelled = false;

    async function loadRequiredSpecifics() {
      try {
        const requiredSpecifics = await fetchRequiredSpecificsForCategory();

        if (!cancelled) {
          setRequiredItemSpecifics(requiredSpecifics);
        }
      } catch {
        if (!cancelled) {
          setRequiredItemSpecifics([]);
        }
      }
    }

    void loadRequiredSpecifics();

    return () => {
      cancelled = true;
    };
  }, [category, fetchRequiredSpecificsForCategory]);

  useEffect(() => {
    const names = Array.from(
      new Set([
        ...missingSpecificsFromError,
        ...requiredItemSpecifics.map((specific) => specific.name),
      ])
    ).filter(Boolean);

    if (names.length === 0) {
      return;
    }

    setItemSpecifics((current) => addMissingItemSpecificRows(current, names));

    if (missingSpecificsFromError.length > 0) {
      setActiveTab(DRAFT_ITEM_SPECIFICS_TAB_INDEX);
    }
  }, [missingSpecificsFromError, requiredItemSpecifics]);

  useEffect(() => {
    if (requiredItemSpecifics.length === 0) {
      return;
    }

    const preparedSpecifics = prepareRequiredSpecificRows({
      rows: itemSpecifics,
      requiredItemSpecifics,
      brand,
      title,
      categoryName,
      description,
    });

    if (!itemSpecificRowsEqual(itemSpecifics, preparedSpecifics.rows)) {
      setItemSpecifics(preparedSpecifics.rows);
    }

    const preparedBrand = inferBrandItemSpecific({
      itemSpecifics: getSpecificsObjectFromRows(preparedSpecifics.rows, brand),
      brand,
    });
    if (preparedBrand && isPlaceholderBrand(brand)) {
      setBrand(preparedBrand);
    }
  }, [brand, categoryName, description, itemSpecifics, requiredItemSpecifics, title]);

  // Fetch policies
  const fetchPolicies = useCallback(async () => {
    setPoliciesLoading(true);
    try {
      const storeNum = storeNameToNumber(product.store.name);
      const res = await fetch(`/api/policies?store=${storeNum}`);
      if (res.ok) {
        const data = await res.json();
        setPolicies(data);
      } else {
        void reportClientError(
          "inline-edit/policies",
          "Failed to fetch policies",
          undefined,
          { status: res.status, productId: product.id, storeNum },
          {
            requestId: res.headers.get("x-request-id") ?? undefined,
            tags: ["policies"],
          },
        );
      }
    } catch (error) {
      void reportClientError(
        "inline-edit/policies",
        "Failed to fetch policies",
        error,
        { productId: product.id },
        { tags: ["policies"] },
      );
    } finally {
      setPoliciesLoading(false);
    }
  }, [product.id, product.store.name]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  useEffect(() => {
    async function fetchPolicyTemplates() {
      try {
        const res = await fetch("/api/policy-templates");
        if (res.ok) {
          const data = await res.json();
          setPolicyTemplates(data);
        } else {
          void reportClientError(
            "inline-edit/policy-templates",
            "Failed to fetch policy templates",
            undefined,
            { status: res.status, productId: product.id },
            {
              requestId: res.headers.get("x-request-id") ?? undefined,
              tags: ["policy-templates"],
            },
          );
          setPolicyTemplates([]);
        }
      } catch (error) {
        void reportClientError(
          "inline-edit/policy-templates",
          "Failed to fetch policy templates",
          error,
          { productId: product.id },
          { tags: ["policy-templates"] },
        );
        setPolicyTemplates([]);
      }
    }

    void fetchPolicyTemplates();
  }, [product.id]);

  useEffect(() => {
    if (!selectedPolicyTemplateId || policyTemplates.length === 0) {
      return;
    }

    const selectedTemplate = policyTemplates.find(
      (template) => template.id === selectedPolicyTemplateId,
    );

    if (!selectedTemplate) {
      setSelectedPolicyTemplateId("");
      return;
    }

    const stillMatches =
      (selectedTemplate.shippingPolicyId ?? "") === shippingPolicyId &&
      (selectedTemplate.returnPolicyId ?? "") === returnPolicyId &&
      (selectedTemplate.paymentPolicyId ?? "") === paymentPolicyId;

    if (!stillMatches && !shippingPolicyId && !returnPolicyId && !paymentPolicyId) {
      setShippingPolicyId(selectedTemplate.shippingPolicyId ?? "");
      setReturnPolicyId(selectedTemplate.returnPolicyId ?? "");
      setPaymentPolicyId(selectedTemplate.paymentPolicyId ?? "");
      return;
    }

    if (!stillMatches) {
      setSelectedPolicyTemplateId("");
    }
  }, [
    paymentPolicyId,
    policyTemplates,
    returnPolicyId,
    selectedPolicyTemplateId,
    shippingPolicyId,
  ]);

  useEffect(() => {
    if (
      hasAppliedDefaultPolicyTemplateRef.current ||
      product.paymentPolicyId ||
      product.shippingPolicyId ||
      product.returnPolicyId ||
      selectedPolicyTemplateId ||
      shippingPolicyId ||
      returnPolicyId ||
      paymentPolicyId ||
      policyTemplates.length === 0
    ) {
      return;
    }

    const defaultTemplate = policyTemplates.find((template) => template.isDefault);
    if (!defaultTemplate) {
      return;
    }

    hasAppliedDefaultPolicyTemplateRef.current = true;
    setSelectedPolicyTemplateId(defaultTemplate.id);
    setShippingPolicyId(defaultTemplate.shippingPolicyId ?? "");
    setReturnPolicyId(defaultTemplate.returnPolicyId ?? "");
    setPaymentPolicyId(defaultTemplate.paymentPolicyId ?? "");
  }, [
    paymentPolicyId,
    policyTemplates,
    product.paymentPolicyId,
    product.returnPolicyId,
    product.shippingPolicyId,
    returnPolicyId,
    selectedPolicyTemplateId,
    shippingPolicyId,
  ]);

  useEffect(() => {
    if (
      hasInferredPolicyTemplateRef.current ||
      selectedPolicyTemplateId ||
      policyTemplates.length === 0
    ) {
      return;
    }

    const matchingTemplate = policyTemplates.find((template) =>
      (template.shippingPolicyId ?? "") === shippingPolicyId &&
      (template.returnPolicyId ?? "") === returnPolicyId &&
      (template.paymentPolicyId ?? "") === paymentPolicyId,
    );

    hasInferredPolicyTemplateRef.current = true;

    if (matchingTemplate) {
      setSelectedPolicyTemplateId(matchingTemplate.id);
    }
  }, [
    paymentPolicyId,
    policyTemplates,
    returnPolicyId,
    selectedPolicyTemplateId,
    shippingPolicyId,
  ]);

  // Auto-clear save message
  useEffect(() => {
    if (saveMessage?.variant === "success" && !saveMessage.title) {
      const timer = setTimeout(() => setSaveMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveMessage]);

  const isImported = product.status === "IMPORTED" && Boolean(product.ebayItemId);
  const isOnHold = product.status === "ON_HOLD" && Boolean(product.ebayItemId);
  const isListed = isImported || isOnHold;
  const inlineSuccessMessage =
    saveMessage?.variant === "success" && !saveMessage.title ? saveMessage : null;
  const bannerMessage =
    saveMessage && (saveMessage.variant === "error" || Boolean(saveMessage.title))
      ? saveMessage
      : null;
  const bannerItems = useMemo(
    () =>
      bannerMessage
        ? bannerMessage.variant === "error"
          ? splitErrorMessage(bannerMessage.text)
          : [bannerMessage.text]
        : [],
    [bannerMessage]
  );
  const requiredSpecificByName = useMemo(() => {
    const map = new Map<string, RequiredItemSpecific>();
    for (const specific of requiredItemSpecifics) {
      map.set(specific.name.trim().toLowerCase(), specific);
    }
    for (const name of missingSpecificsFromError) {
      const key = name.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, { name });
      }
    }
    return map;
  }, [missingSpecificsFromError, requiredItemSpecifics]);
  const visibleItemSpecifics = useMemo(
    () =>
      itemSpecifics
        .map((specific, index) => ({
          specific,
          index,
          required: requiredSpecificByName.has(specific.key.trim().toLowerCase()),
        }))
        .sort((left, right) => {
          if (left.required !== right.required) {
            return left.required ? -1 : 1;
          }
          return left.index - right.index;
        }),
    [itemSpecifics, requiredSpecificByName]
  );

  useEffect(() => {
    const requiredType = requiredSpecificByName.get("type");
    const hasTypeRow = itemSpecifics.some(
      (specific) => specific.key.trim().toLowerCase() === "type"
    );
    const hasBlankTypeRow = itemSpecifics.some(
      (specific) =>
        specific.key.trim().toLowerCase() === "type" && !specific.value.trim()
    );

    if (!hasBlankTypeRow && (!requiredType || hasTypeRow)) {
      return;
    }

    const specificsObj = Object.fromEntries(
      itemSpecifics
        .filter((specific) => specific.key.trim() && specific.value.trim())
        .map((specific) => [specific.key.trim(), specific.value.trim()])
    );
    const inferredType = inferTypeItemSpecific({
      title,
      categoryName,
      itemSpecifics: specificsObj,
      allowedValues: requiredType?.values,
    });

    if (!inferredType) {
      return;
    }

    setItemSpecifics((current) => {
      let changed = false;
      const next = current.map((specific) => {
        if (
          specific.key.trim().toLowerCase() !== "type" ||
          specific.value.trim()
        ) {
          return specific;
        }

        changed = true;
        return { ...specific, value: inferredType };
      });

      if (!hasTypeRow && requiredType) {
        changed = true;
        return [{ key: requiredType.name, value: inferredType }, ...next];
      }

      return changed ? next : current;
    });
  }, [categoryName, itemSpecifics, requiredSpecificByName, title]);

  useEffect(() => {
    const requiredSize =
      requiredSpecificByName.get("size") ?? requiredSpecificByName.get("item size");
    const requiredSizeName = requiredSize?.name ?? "Size";
    const normalizedRequiredSizeName = normalizeSpecificName(requiredSizeName);
    const hasSizeRow = itemSpecifics.some(
      (specific) => normalizeSpecificName(specific.key) === normalizedRequiredSizeName
    );
    const hasBlankSizeRow = itemSpecifics.some(
      (specific) =>
        normalizeSpecificName(specific.key) === normalizedRequiredSizeName &&
        !specific.value.trim()
    );

    if (!hasBlankSizeRow && (!requiredSize || hasSizeRow)) {
      return;
    }

    const specificsObj = getSpecificsObjectFromRows(itemSpecifics, brand);
    const inferredSize = inferSizeItemSpecific({
      title,
      categoryName,
      itemSpecifics: specificsObj,
      allowedValues: requiredSize?.values,
    });

    if (!inferredSize) {
      return;
    }

    setItemSpecifics((current) => {
      const next = upsertSpecificRow(current, requiredSizeName, inferredSize);
      return next === current ? current : next;
    });
  }, [brand, categoryName, itemSpecifics, requiredSpecificByName, title]);

  useEffect(() => {
    if (
      requestedEbayDescriptionRef.current ||
      description.trim() ||
      !isListed ||
      !product.ebayItemId
    ) {
      return;
    }

    requestedEbayDescriptionRef.current = true;
    setIsLoadingEbayDescription(true);

    async function refreshDescription() {
      try {
        const response = await fetch(
          `/api/products/${product.id}/refresh-ebay-description`,
          {
            method: "POST",
            cache: "no-store",
          },
        );
        const data = (await response.json().catch(() => ({}))) as {
          description?: string;
          error?: string;
        };

        if (!response.ok || !data.description) {
          throw new Error(data.error || "Failed to refresh eBay description.");
        }

        setDescription(data.description);
        router.refresh();
      } catch (error) {
        setSaveMessage({
          title: "Description refresh failed",
          text:
            error instanceof Error
              ? error.message
              : "Failed to refresh eBay description.",
          variant: "error",
        });
      } finally {
        setIsLoadingEbayDescription(false);
      }
    }

    void refreshDescription();
  }, [description, isListed, product.ebayItemId, product.id, router]);

  // ----- Save -----

  async function handleSave(options?: {
    showSuccessMessage?: boolean;
    itemSpecificRowsOverride?: DraftItemSpecificRow[];
  }): Promise<boolean> {
    const { showSuccessMessage = true, itemSpecificRowsOverride } = options ?? {};

    setIsSaving(true);
    setSaveMessage(null);

    // Validate category is numeric before saving
    if (!category.trim() || !/^\d+$/.test(category.trim())) {
      setSaveMessage({
        variant: "error",
        title: "Save failed",
        text: "eBay requires a numeric Category ID (e.g. 171114). Please update the Category ID field.",
      });
      setIsSaving(false);
      return false;
    }

    const normalizedAsin = normalizeAsin(asin);

    if (normalizedAsin && !isValidAsin(normalizedAsin)) {
      setSaveMessage({
        variant: "error",
        title: "Save failed",
        text: "Amazon ASIN must be 10 letters or numbers.",
      });
      setIsSaving(false);
      return false;
    }

    // Build visible itemSpecifics from the table rows
    const specificsObj: Record<string, string> = {};
    const rowsForSpecifics = itemSpecificRowsOverride ?? itemSpecifics;
    rowsForSpecifics.forEach((spec) => {
      if (spec.key.trim() && spec.value.trim()) {
        specificsObj[spec.key.trim()] = spec.value.trim();
      }
    });

    // Add Brand into specifics without letting a placeholder overwrite an inferred value.
    if (brand.trim() && (!specificsObj.Brand || !isPlaceholderBrand(brand))) {
      specificsObj.Brand = brand.trim();
    }

    // Embed internal location metadata with _ prefix so the XML builder can use it.
    const locationMetadata = resolveEbayLocationMetadata({
      country: countryLocation,
      postalCode: defaultZipcode,
    });
    specificsObj["_Country"] = locationMetadata.country;
    specificsObj["_Currency"] = locationMetadata.currency;
    specificsObj["_Site"] = locationMetadata.site;
    specificsObj["_Location"] = locationMetadata.location;
    specificsObj["_PostalCode"] = locationMetadata.postalCode;

    const parsedQuantity = Number.parseInt(quantity, 10);
    const normalizedQuantity = Number.isFinite(parsedQuantity)
      ? Math.max(0, parsedQuantity)
      : 1;

    const body: Record<string, unknown> = {
      title: toEbayListingTitle(title),
      fullTitle,
      description,
      quantity: normalizedQuantity,
      condition,
      category: category.trim(),
      categoryName: categoryName.trim() || null,
      asin: normalizedAsin,
      images: dedupeProductImages(images),
      itemSpecifics: sanitizeEbayItemSpecifics(specificsObj),
      shippingPolicyId: shippingPolicyId || null,
      returnPolicyId: returnPolicyId || null,
      paymentPolicyId: paymentPolicyId || null,
      policyTemplateId: selectedPolicyTemplateId || null,
      templateId: selectedTemplateId || null,
      promotedAdPercent: Math.min(100, Math.max(0, Number(promotedAdPercent) || 0)),
    };

    if (amazonPriceUpdatePending) {
      body.price = parseFloat(price) || 0;
      body.amazonPriceUpdateSource = "regrab";
      body.amazonPriceTrackingMode = amazonPriceTrackingMode;
    }

    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        // Show keyword removal toast if applicable
        if (data.removedKeywords && data.removedKeywords.length > 0) {
          setSaveMessage({
            title: "Review required",
            text: `The following keywords were automatically removed: ${data.removedKeywords.join(", ")}. Check your title and description.`,
            variant: "error",
          });
        } else if (showSuccessMessage) {
          setSaveMessage({
            text: isOnHold
              ? "Saved locally. Resume this listing before syncing updates to eBay."
              : isImported
                ? "Saved locally. Update eBay to sync the live listing."
                : "Saved",
            variant: "success",
          });
        }
        setAmazonPriceUpdatePending(false);
        router.refresh();
        return true;
      } else {
        const data = await res.json();
        void reportClientError(
          "inline-edit/save",
          "Product save failed",
          undefined,
          {
            productId: product.id,
            status: res.status,
            error: data.error,
          },
          {
            requestId: res.headers.get("x-request-id") ?? undefined,
            tags: ["save"],
          },
        );
        setSaveMessage({
          title: "Save failed",
          text: data.error || "Save failed",
          variant: "error",
        });
        return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      void reportClientError(
        "inline-edit/save",
        "Product save request failed",
        err,
        { productId: product.id },
        { tags: ["save"] },
      );
      setSaveMessage({ title: "Save failed", text: msg, variant: "error" });
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  // Amazon keyword detection
  const descriptionContainsAmazon = useMemo(() => {
    const plainText = description.replace(/<[^>]*>/g, "");
    return /amazon/i.test(plainText);
  }, [description]);

  // ----- Save & Import -----

  async function handleSaveAndImport() {
    if (isListed) {
      setSaveMessage({
        variant: "error",
        title: "Import failed",
        text: isOnHold
          ? "This product is on hold. Resume it before updating the live eBay listing."
          : "This product is already imported. Use Save & Update eBay instead.",
      });
      return;
    }

    // Block import if Amazon keyword is in description
    if (descriptionContainsAmazon) {
      setSaveMessage({
        variant: "error",
        title: "Import blocked",
        text: "Import blocked - description contains the word 'Amazon'. Edit your description and remove all mentions before importing.",
      });
      return;
    }

    setSaveMessage(null);

    let latestRequiredItemSpecifics = requiredItemSpecifics;
    try {
      const fetchedRequiredItemSpecifics = await fetchRequiredSpecificsForCategory();
      latestRequiredItemSpecifics = mergeRequiredItemSpecifics(
        requiredItemSpecifics,
        fetchedRequiredItemSpecifics
      );
      setRequiredItemSpecifics(latestRequiredItemSpecifics);
    } catch {
      latestRequiredItemSpecifics = requiredItemSpecifics;
    }

    const preparedSpecifics = prepareRequiredSpecificRows({
      rows: itemSpecifics,
      requiredItemSpecifics: latestRequiredItemSpecifics,
      brand,
      title,
      categoryName,
      description,
    });
    setItemSpecifics(preparedSpecifics.rows);
    const preparedBrand = inferBrandItemSpecific({
      itemSpecifics: getSpecificsObjectFromRows(preparedSpecifics.rows, brand),
      brand,
    });
    if (preparedBrand && isPlaceholderBrand(brand)) {
      setBrand(preparedBrand);
    }

    if (preparedSpecifics.missingNames.length > 0) {
      setActiveTab(DRAFT_ITEM_SPECIFICS_TAB_INDEX);
      setSaveMessage({
        title: "Import failed",
        text: `Add ${preparedSpecifics.missingNames.join(", ")} before importing.`,
        variant: "error",
      });
      return;
    }

    setIsImporting(true);

    const saved = await handleSave({
      showSuccessMessage: false,
      itemSpecificRowsOverride: preparedSpecifics.rows,
    });
    if (!saved) {
      setIsImporting(false);
      return;
    }

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });

      if (res.ok) {
        setSaveMessage({ text: "Imported", variant: "success" });
        onImported?.(product.id);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          missingItemSpecifics?: string[];
          requiredItemSpecifics?: RequiredItemSpecific[];
        };
        const missingNames = data.missingItemSpecifics ?? [];

        if (data.requiredItemSpecifics && data.requiredItemSpecifics.length > 0) {
          setRequiredItemSpecifics((current) =>
            mergeRequiredItemSpecifics(current, data.requiredItemSpecifics)
          );
        }

        if (hasMissingItemSpecifics(data)) {
          setItemSpecifics((current) =>
            addMissingItemSpecificRows(current, missingNames)
          );
          setActiveTab(DRAFT_ITEM_SPECIFICS_TAB_INDEX);
        }

        void reportClientError(
          "inline-edit/import",
          "Product import failed",
          undefined,
          {
            productId: product.id,
            status: res.status,
            error: data.error,
          },
          {
            requestId: res.headers.get("x-request-id") ?? undefined,
            tags: ["import"],
          },
        );
        setSaveMessage({
          title: "Import failed",
          text: data.error || "Import failed",
          variant: "error",
        });
      }
    } catch (err) {
      void reportClientError(
        "inline-edit/import",
        "Product import request failed",
        err,
        { productId: product.id },
        { tags: ["import"] },
      );
      setSaveMessage({
        title: "Import failed",
        text: "Network error during import",
        variant: "error",
      });
    } finally {
      setIsImporting(false);
    }
  }

  // ----- Save & Update eBay -----
  const [isRevising, setIsRevising] = useState(false);

  async function handleSaveAndUpdateEbay() {
    if (!isImported) {
      setSaveMessage({
        variant: "error",
        title: "Update failed",
        text: "This product must be imported before it can be updated on eBay.",
      });
      return;
    }

    if (descriptionContainsAmazon) {
      setSaveMessage({
        variant: "error",
        title: "Update blocked",
        text: "Update blocked - description contains the word 'Amazon'. Edit your description and remove all mentions before updating eBay.",
      });
      return;
    }

    setIsRevising(true);
    setSaveMessage(null);

    const saved = await handleSave({ showSuccessMessage: false });
    if (!saved) {
      setIsRevising(false);
      return;
    }

    try {
      const res = await fetch("/api/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });

      if (res.ok) {
        setSaveMessage({ text: "eBay listing updated", variant: "success" });
        router.refresh();
      } else {
        const data = await res.json();
        void reportClientError(
          "inline-edit/revise",
          "Product revise failed",
          undefined,
          {
            productId: product.id,
            status: res.status,
            error: data.error,
          },
          {
            requestId: res.headers.get("x-request-id") ?? undefined,
            tags: ["revise"],
          },
        );
        setSaveMessage({
          title: "Update failed",
          text: data.error || "Update failed",
          variant: "error",
        });
      }
    } catch (err) {
      void reportClientError(
        "inline-edit/revise",
        "Product revise request failed",
        err,
        { productId: product.id },
        { tags: ["revise"] },
      );
      setSaveMessage({
        title: "Update failed",
        text: "Network error during update",
        variant: "error",
      });
    } finally {
      setIsRevising(false);
    }
  }

  async function handleRegrab() {
    const currentAsin = normalizeAsin(asin);

    if (!currentAsin || !isValidAsin(currentAsin)) {
      setSaveMessage({
        title: "Regrab blocked",
        text: "Add a valid 10-character Amazon ASIN first.",
        variant: "error",
      });
      return;
    }

    setIsRegrabbing(true);
    setSaveMessage(null);

    try {
      const url = buildRegrabAmazonUrl(currentAsin);
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          mode: "regrab",
          amazonPriceTrackingMode,
        }),
        signal: AbortSignal.timeout(90000),
      });

      const data = (await res.json()) as ScrapedProduct | { error?: string };

      if (!res.ok) {
        void reportClientError(
          "inline-edit/regrab",
          "Regrab failed",
          undefined,
          {
            productId: product.id,
            asin: currentAsin,
            status: res.status,
            error: "error" in data ? data.error : undefined,
          },
          {
            requestId: res.headers.get("x-request-id") ?? undefined,
            tags: ["regrab"],
          },
        );
        setSaveMessage({
          title: "Regrab failed",
          text: ("error" in data && data.error) || "Failed to fetch product details",
          variant: "error",
        });
        return;
      }

      const scraped = data as ScrapedProduct;
      const update = buildRegrabDraftUpdate(scraped, currentAsin);

      setTitle(update.title);
      setFullTitle(update.fullTitle);
      setDescription(update.description);
      setImages(update.images);
      setAsin(update.asin);
      const regrabPrice =
        typeof update.price === "number" && update.price > 0
          ? update.price
          : null;
      const regrabPriceUpdated = regrabPrice !== null;
      if (regrabPriceUpdated) {
        setPrice(regrabPrice.toFixed(2));
        setAmazonPriceTrackingMode(update.amazonPriceTrackingMode);
        setAmazonPriceUpdatePending(true);
      } else {
        setSaveMessage({
          title: "Regrab updated product details",
          text: `${getAmazonPriceTrackingLabel(
            amazonPriceTrackingMode
          )} was not available, so the Amazon buy price was not changed.`,
          variant: "success",
        });
      }
      setHoveredImage(null);
      setBrand(update.brand);
      setItemSpecifics(update.itemSpecifics);

      if (update.categoryId) {
        setCategory(update.categoryId);
      }

      if (update.categoryName) {
        setCategoryName(update.categoryName);
      }

      if (update.supplierDefaults) {
        setShippingPolicyId((current) => current || update.supplierDefaults?.shippingPolicyId || "");
        setReturnPolicyId((current) => current || update.supplierDefaults?.returnPolicyId || "");
        setPaymentPolicyId((current) => current || update.supplierDefaults?.paymentPolicyId || "");
        setSelectedPolicyTemplateId(
          (current) => current || update.supplierDefaults?.policyTemplateId || "",
        );
      }

      if (regrabPriceUpdated) {
        setSaveMessage({
          title: "Regrab complete",
          text: "Product details refreshed from Amazon. Review and Save when you're ready.",
          variant: "success",
        });
      }
    } catch (err) {
      void reportClientError(
        "inline-edit/regrab",
        "Regrab request failed",
        err,
        { productId: product.id, asin: currentAsin },
        { tags: ["regrab"] },
      );
      setSaveMessage({
        title: "Regrab failed",
        text: "Network error. Please try again.",
        variant: "error",
      });
    } finally {
      setIsRegrabbing(false);
    }
  }

  // ----- Images -----

  function addImageUrlToList(url: string, successText = "Image added") {
    const normalized = normalizeProductImageUrl(url);
    if (!normalized) {
      setImageMessage({
        title: "Image not added",
        text: "Enter a valid direct image URL.",
        variant: "error",
      });
      return false;
    }

    const nextImages = dedupeProductImages([...images, normalized]);
    if (nextImages.length === images.length) {
      setImageMessage({
        title: "Image already exists",
        text: "That image is already in this listing.",
        variant: "error",
      });
      return false;
    }

    setImages(nextImages);
    setImageMessage({
      text: successText,
      variant: "success",
    });
    return true;
  }

  function addManualImage() {
    if (addImageUrlToList(manualImageUrl)) {
      setManualImageUrl("");
    }
  }

  async function uploadManualImage(file: File | null | undefined) {
    if (!file) {
      return;
    }

    setIsUploadingImage(true);
    setImageMessage(null);

    try {
      const uploadedUrl = await uploadProductImageFile(file);
      addImageUrlToList(uploadedUrl, "Image uploaded");
    } catch (error) {
      setImageMessage({
        title: "Upload failed",
        text: error instanceof Error ? error.message : "Image upload failed.",
        variant: "error",
      });
    } finally {
      setIsUploadingImage(false);
      if (manualImageFileInputRef.current) {
        manualImageFileInputRef.current.value = "";
      }
    }
  }

  function setMainImage(url: string) {
    const normalized = normalizeProductImageUrl(url);
    if (!normalized) {
      return;
    }

    setImages((current) =>
      dedupeProductImages([
        normalized,
        ...current.filter(
          (candidate) =>
            normalizeProductImageUrl(candidate)?.toLowerCase() !==
            normalized.toLowerCase()
        ),
      ])
    );
    setHoveredImage(0);
  }

  function removeImage(url: string) {
    const normalized = normalizeProductImageUrl(url);
    setImages((current) =>
      current.filter((candidate) => {
        if (!normalized) {
          return candidate !== url;
        }

        return (
          normalizeProductImageUrl(candidate)?.toLowerCase() !==
          normalized.toLowerCase()
        );
      })
    );
    setHoveredImage(null);
    setImageMessage(null);
  }

  // ----- Item specifics -----

  function addSpecific() {
    setItemSpecifics([...itemSpecifics, { key: "", value: "" }]);
  }

  function removeSpecific(index: number) {
    setItemSpecifics(itemSpecifics.filter((_, i) => i !== index));
  }

  function updateSpecific(index: number, field: "key" | "value", val: string) {
    const updated = [...itemSpecifics];
    updated[index][field] = val;
    setItemSpecifics(updated);
  }

  // ----- VERO -----

  const veroMatch = findVeroMatch(title);

  // ----- Derived -----

  const storeBadge = product.store.name;
  const thumbnail = images[0] || "";
  const currentAsin = normalizeAsin(asin);

  return (
    <div className="bg-gray-50 border-t border-gray-200">
      {/* ===== Header bar ===== */}
      <div className="flex flex-col gap-3 px-6 py-3 bg-white border-b border-gray-200 lg:flex-row lg:items-center lg:justify-between">
        {/* Left side */}
        <div className="flex items-center gap-3 min-w-0">
          {thumbnail && (
            <img
              src={thumbnail}
              alt={title}
              className="w-10 h-10 rounded object-cover flex-shrink-0"
            />
          )}
          <span className="text-sm font-medium text-gray-900 truncate max-w-xs" title={title}>
            {title}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 flex-shrink-0">
            {storeBadge}
          </span>
          {currentAsin && (
            <span className="text-xs text-gray-400 flex-shrink-0">
              Supplier: Amazon AU
            </span>
          )}
        </div>

        {/* Right side — buttons */}
        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
          {currentAsin && (
            <button
              type="button"
              onClick={handleRegrab}
              disabled={isRegrabbing || isSaving || isImporting || isRevising}
              className="px-3 py-1.5 border border-blue-300 text-blue-700 text-sm font-medium rounded-md hover:bg-blue-50 disabled:opacity-40 transition-colors"
              title="Re-fetch product details from Amazon. This can take 10-30 seconds."
            >
              {isRegrabbing ? "Regrabbing..." : "Regrab"}
            </button>
          )}
          {inlineSuccessMessage && (
            <span className="text-sm font-medium text-green-600">
              {inlineSuccessMessage.text}
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || isImporting || isRevising || isRegrabbing}
            className="px-4 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {isSaving ? "Saving..." : isListed ? "Save Locally" : "Save"}
          </button>
          {!isListed && (
            <button
              type="button"
              onClick={handleSaveAndImport}
              disabled={isSaving || isImporting || isRevising || isRegrabbing}
              className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-md disabled:opacity-40 transition-colors"
            >
              {isImporting ? "Importing..." : "Save & Import"}
            </button>
          )}
          {isImported && (
            <button
              type="button"
              onClick={handleSaveAndUpdateEbay}
              disabled={isSaving || isImporting || isRevising || isRegrabbing}
              className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-md disabled:opacity-40 transition-colors"
            >
              {isRevising ? "Updating..." : "Save & Update eBay"}
            </button>
          )}
        </div>
      </div>

      {bannerMessage && (
        <div
          className={`border-b px-6 py-3 ${
            bannerMessage.variant === "error"
              ? "border-red-200 bg-red-50"
              : "border-green-200 bg-green-50"
          }`}
        >
          <div className="flex items-start gap-3">
            <svg
              className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
                bannerMessage.variant === "error" ? "text-red-500" : "text-green-500"
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {bannerMessage.variant === "error" ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              )}
            </svg>
            <div className="min-w-0">
              <p
                className={`text-sm font-semibold ${
                  bannerMessage.variant === "error" ? "text-red-800" : "text-green-800"
                }`}
              >
                {bannerMessage.title || "Action required"}
              </p>
              {bannerItems.length > 1 ? (
                <ul
                  className={`mt-2 list-disc space-y-1 pl-5 text-sm ${
                    bannerMessage.variant === "error" ? "text-red-700" : "text-green-700"
                  }`}
                >
                  {bannerItems.map((item, index) => (
                    <li key={`${index}-${item}`} className="break-words">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p
                  className={`mt-1 break-words text-sm ${
                    bannerMessage.variant === "error" ? "text-red-700" : "text-green-700"
                  }`}
                >
                  {bannerItems[0]}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== VERO Warning ===== */}
      {veroMatch && (
        <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          Product title contains a VERO word, keyword ({veroMatch}).{" "}
          <a
            href="https://www.ebay.com.au/help/policies/listing-policies/vero-program"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium hover:text-red-900"
          >
            Read More
          </a>
        </div>
      )}

      {/* ===== Tabs ===== */}
      <div className="border-b border-gray-200 px-6">
        <nav className="flex gap-6">
          {tabs.map((tab, i) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(i)}
              className={`py-3 text-sm transition-colors ${
                activeTab === i
                  ? "border-b-2 border-orange-500 text-orange-600 font-medium"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* ===== Tab Content ===== */}
      <div className="p-6 pb-10">
        {/* ===== Tab 1 — Product ===== */}
        {activeTab === 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Title — full width */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <p className={`mt-1 text-xs ${title.length > 80 ? "text-red-600 font-medium" : "text-gray-400"}`}>
                {title.length}/80
              </p>
            </div>

            {/* Category — split into Name + ID */}
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category Name</label>
                <input
                  type="text"
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="e.g. Charging Equipment"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">eBay Category ID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="e.g. 171114"
                  />
                  <button
                    type="button"
                    disabled={catLoading || !title.trim()}
                    onClick={async () => {
                      setCatLoading(true);
                      setShowCatDropdown(false);
                      try {
                        const storeNum = storeNameToNumber(product.store.name);
                        const res = await fetch("/api/suggest-category", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ title: title.trim(), storeNumber: storeNum }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          setCatSuggestions(data);
                          setShowCatDropdown(true);
                        }
                      } catch { /* silent */ }
                      finally { setCatLoading(false); }
                    }}
                    className="px-3 py-2 border border-orange-500 text-orange-600 text-sm font-medium rounded-md hover:bg-orange-50 disabled:opacity-40 transition-colors whitespace-nowrap"
                  >
                    {catLoading ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    ) : "Re-suggest"}
                  </button>
                </div>
              </div>
            </div>
            {/* Suggestion Dropdown */}
            {showCatDropdown && (
              <div className="col-span-2 bg-white border border-gray-200 rounded-md shadow-sm divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {catSuggestions.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-gray-500">No suggestions found — please enter the ID manually</p>
                ) : (
                  catSuggestions.map((s) => (
                    <button
                      key={s.categoryId}
                      type="button"
                      onClick={() => {
                        setCategory(s.categoryId);
                        setCategoryName(s.categoryName);
                        setShowCatDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700 transition-colors"
                    >
                      {s.categoryName} <span className="text-gray-400">({s.categoryId})</span>
                    </button>
                  ))
                )}
              </div>
            )}
            <p className="col-span-2 text-xs text-gray-400">
              Not sure of the ID? Use the Re-suggest button or find it at{" "}
              <a href="https://www.ebay.com.au/sch/categories" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">ebay.com.au/sch/categories</a>
            </p>

            {/* Amazon ASIN */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Amazon ASIN</label>
              <input
                type="text"
                value={asin}
                onChange={(e) => setAsin(e.target.value)}
                onBlur={() => setAsin(normalizeAsin(asin) ?? "")}
                maxLength={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="B0XXXXXXXX"
              />
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>Required for Amazon price tracking.</span>
                {currentAsin && isValidAsin(currentAsin) && (
                  <AsinLink
                    asin={currentAsin}
                    className="font-mono text-orange-600 hover:text-orange-800 hover:underline"
                  />
                )}
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Enter Tag"
              />
            </div>

            {/* Shipping Methods */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Methods</label>
              <input
                type="text"
                value={shippingMethods}
                onChange={(e) => setShippingMethods(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Brand */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Policy Template</label>
              <select
                value={selectedPolicyTemplateId}
                onChange={(e) => {
                  const nextTemplateId = e.target.value;
                  setSelectedPolicyTemplateId(nextTemplateId);

                  if (!nextTemplateId) {
                    return;
                  }

                  const selectedPolicyTemplate = policyTemplates.find((template) => template.id === nextTemplateId);
                  if (!selectedPolicyTemplate) {
                    return;
                  }

                  setShippingPolicyId(selectedPolicyTemplate.shippingPolicyId ?? "");
                  setReturnPolicyId(selectedPolicyTemplate.returnPolicyId ?? "");
                  setPaymentPolicyId(selectedPolicyTemplate.paymentPolicyId ?? "");
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="">Select policy template</option>
                {policyTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Payment Policy */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Policy</label>
              {policiesLoading ? (
                <p className="text-sm text-gray-500 animate-pulse py-2">Loading policies…</p>
              ) : (
                <select
                  value={paymentPolicyId}
                  onChange={(e) => setPaymentPolicyId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Select payment policy</option>
                  {policies?.payment.map((p) => (
                    <option key={p.profileId} value={p.profileId}>
                      {p.profileName}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Shipping Policy */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shipping Policy</label>
              {policiesLoading ? (
                <p className="text-sm text-gray-500 animate-pulse py-2">Loading policies…</p>
              ) : (
                <select
                  value={shippingPolicyId}
                  onChange={(e) => setShippingPolicyId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Select shipping policy</option>
                  {policies?.shipping.map((p) => (
                    <option key={p.profileId} value={p.profileId}>
                      {p.profileName}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Return Policy */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Return Policy</label>
              {policiesLoading ? (
                <p className="text-sm text-gray-500 animate-pulse py-2">Loading policies…</p>
              ) : (
                <select
                  value={returnPolicyId}
                  onChange={(e) => setReturnPolicyId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Select return policy</option>
                  {policies?.returns.map((p) => (
                    <option key={p.profileId} value={p.profileId}>
                      {p.profileName}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Default Item Country */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Item Country</label>
              <select
                value={countryLocation}
                onChange={(e) => setCountryLocation(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="Australia">Australia</option>
                <option value="United States">United States</option>
                <option value="United Kingdom">United Kingdom</option>
              </select>
            </div>

            {/* Default Zipcode */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Zipcode</label>
              <input
                type="text"
                value={defaultZipcode}
                onChange={(e) => setDefaultZipcode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                eBay item location: {resolvedItemLocation}
              </p>
            </div>

            {/* Condition */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Condition</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="New">New</option>
                <option value="Used">Used</option>
              </select>
            </div>

            {/* Amazon Buy Price */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amazon Buy Price (AUD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="text"
                  value={price}
                  readOnly
                  className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm text-gray-700 focus:outline-none"
                  placeholder="0.00"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Updated by Add Product, Regrab, or price check. Tracking:{" "}
                {getAmazonPriceTrackingLabel(amazonPriceTrackingMode)}.
              </p>
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>

            {/* Local promoted ad reference */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Local Promoted Ad Reference %</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={promotedAdPercent}
                onChange={(e) => setPromotedAdPercent(e.target.value)}
                disabled={isListed}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-50 disabled:text-gray-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                {isListed
                  ? "Live eBay ad rates are updated with Sync eBay Ads on Products."
                  : "Reference only. Products filters use Sync eBay Ads for live campaign rates."}
              </p>
            </div>
            </div>
        )}

        {/* ===== Tab 2 — Description ===== */}
        {activeTab === 1 && (
          <div>
            {descriptionContainsAmazon && (
              <div className="mb-3 flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-md">
                <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-red-700">
                  <strong>Warning:</strong> Your description contains the word &ldquo;Amazon&rdquo;. eBay may remove your listing for referencing a competitor. Remove all mentions of Amazon before importing.
                </p>
              </div>
            )}
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            {isLoadingEbayDescription && (
              <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                Loading description from eBay...
              </div>
            )}
            <div className="flex items-center gap-3 text-sm text-gray-600 mb-3">
                <span className="text-sm text-gray-500">Selected Template:</span>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">— None —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.isDefault ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
                <span className="text-gray-300">|</span>
                <Link href="/settings" className="text-orange-500 hover:text-orange-600 text-sm hover:underline">
                  Edit Templates
                </Link>
              </div>
            <div className="min-h-[300px]">
              <RichTextEditor value={description} onChange={setDescription} minHeight="300px" toolbarVariant="compact" />
            </div>
          </div>
        )}

        {/* ===== Tab 3 — Variants ===== */}
        {activeTab === 2 && (
          <>
            <ProductVariantsEditor
              product={{
                id: product.id,
                title: product.title,
                price,
                quantity: product.quantity,
                status: product.status,
                images: product.images,
                asin: currentAsin,
              }}
            />
            <div className="hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <th className="px-3 py-2 text-left w-14">Image</th>
                  <th className="px-3 py-2 text-left">Variant</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Buy ID</th>
                  <th className="px-3 py-2 text-left w-32">Price</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="px-3 py-2">
                    {thumbnail ? (
                      <img src={thumbnail} alt="variant" className="w-10 h-10 rounded object-cover" />
                    ) : (
                      <div className="w-10 h-10 bg-gray-200 rounded" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {product.condition || "Default"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      IN STOCK
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 font-mono text-xs">
                    <AsinLink
                      asin={currentAsin}
                      fallback="—"
                      className="font-mono text-xs text-orange-600 hover:text-orange-800 hover:underline"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full pl-5 pr-2 py-1 border border-gray-300 rounded text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <button
              type="button"
              className="mt-3 text-sm text-green-600 hover:text-green-800 font-medium transition-colors"
            >
              + Add Variant
            </button>
            </div>
          </>
        )}

        {/* ===== Tab 4 — Images ===== */}
        {activeTab === 3 && (
          <div>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="flex-1">
                <label className="sr-only" htmlFor={`manual-image-${product.id}`}>
                  Add image URL
                </label>
                <input
                  id={`manual-image-${product.id}`}
                  type="url"
                  value={manualImageUrl}
                  onChange={(event) => {
                    setManualImageUrl(event.target.value);
                    setImageMessage(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addManualImage();
                    }
                  }}
                  placeholder="Paste image URL"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <button
                type="button"
                onClick={addManualImage}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
              >
                Add Image
              </button>
              <input
                ref={manualImageFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif"
                className="hidden"
                onChange={(event) => {
                  void uploadManualImage(event.target.files?.[0] ?? null);
                }}
              />
              <button
                type="button"
                onClick={() => manualImageFileInputRef.current?.click()}
                disabled={isUploadingImage}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploadingImage ? "Uploading..." : "Upload Image"}
              </button>
            </div>
            {imageMessage && (
              <div
                className={`mb-4 rounded-md border px-3 py-2 text-sm ${
                  imageMessage.variant === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-green-200 bg-green-50 text-green-700"
                }`}
              >
                {imageMessage.title ? `${imageMessage.title}: ` : ""}
                {imageMessage.text}
              </div>
            )}
            <div className="grid grid-cols-7 gap-2">
              {images.map((url, i) => {
                const isMain = i === 0;
                const isHovered = hoveredImage === i;

                return (
                  <div
                    key={i}
                    className="relative"
                    onMouseEnter={() => setHoveredImage(i)}
                    onMouseLeave={() => setHoveredImage(null)}
                  >
                    <img
                      src={url}
                      alt={`Product image ${i + 1}`}
                      className="w-full aspect-square object-cover rounded border border-gray-200"
                    />

                    {isHovered && (
                      <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 z-20 rounded">
                        {!isMain && (
                          <button
                            type="button"
                            onClick={() => setMainImage(url)}
                            className="border border-white text-white text-xs px-2 py-1 rounded hover:bg-white hover:text-black transition-colors text-center"
                          >
                            Set as Main
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeImage(url)}
                          className="border border-white text-white text-xs px-2 py-1 rounded hover:bg-white hover:text-black transition-colors text-center"
                        >
                          Remove
                        </button>
                      </div>
                    )}

                    {isMain && (
                      <div className="absolute bottom-0 left-0 right-0 bg-orange-500 text-white text-xs text-center py-0.5 rounded-b">
                        Main image
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-gray-500">
              {images.length} images
            </p>
          </div>
        )}

        {/* ===== Tab 5 — Item Specifications ===== */}
        {activeTab === 4 && (
          <div>
            <div className="flex items-center gap-3 px-3 py-2 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <span className="flex-1">Name</span>
              <span className="flex-1">Value</span>
              <span className="w-10" />
            </div>

            <div className="divide-y divide-gray-100">
              {visibleItemSpecifics.map(({ specific: spec, index, required }, visibleIndex) => {
                const requiredSpecific = requiredSpecificByName.get(
                  spec.key.trim().toLowerCase()
                );
                const allowedValues = requiredSpecific?.values ?? [];
                const hasCustomValue =
                  spec.value.trim() &&
                  allowedValues.length > 0 &&
                  !allowedValues.some(
                    (value) => value.toLowerCase() === spec.value.trim().toLowerCase()
                  );

                return (
                  <div
                    key={`${index}-${spec.key}`}
                    className={`flex items-center gap-3 px-3 py-2 ${
                      visibleIndex % 2 === 0 ? "bg-white" : "bg-gray-50"
                    } ${required && !spec.value.trim() ? "border-l-2 border-l-red-400" : ""}`}
                  >
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        type="text"
                        value={spec.key}
                        onChange={(e) => updateSpecific(index, "key", e.target.value)}
                        className="min-w-0 flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        placeholder="Name"
                      />
                      {required && (
                        <span className="whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                          Required
                        </span>
                      )}
                    </div>
                    {allowedValues.length > 0 ? (
                      <select
                        value={spec.value}
                        onChange={(e) => updateSpecific(index, "value", e.target.value)}
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="">Select {requiredSpecific?.name ?? "value"}</option>
                        {hasCustomValue && <option value={spec.value}>{spec.value}</option>}
                        {allowedValues.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={spec.value}
                        onChange={(e) => updateSpecific(index, "value", e.target.value)}
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        placeholder="Value"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeSpecific(index)}
                      className="w-10 flex items-center justify-center text-red-400 hover:text-red-600 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={addSpecific}
              className="mt-3 text-sm text-green-600 hover:text-green-800 font-medium transition-colors"
            >
              + Add Item Specification
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
