import type { Page } from "playwright-core";

export interface VariantSelectionHints {
  colour?: string | null;
  size?: string | null;
  style?: string | null;
  pattern?: string | null;
  variantTitle?: string | null;
}

export interface VariantSelectionResult {
  hasVariations: boolean;
  selected: boolean;
  matched: boolean;
  reason?: string;
  selectedDimensions?: string[];
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(key: string): string {
  return cleanText(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseJsonSpecifics(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Extract saved Colour, Size, Style, Pattern from a product and its primary variant.
 */
export function extractVariantSelectionHints(product: {
  itemSpecifics?: unknown;
  variants?: Array<{
    title?: string | null;
    variantTitle?: string | null;
    itemSpecifics?: unknown;
  }>;
}): VariantSelectionHints | null {
  const productSpecs = parseJsonSpecifics(product.itemSpecifics);
  const primaryVariant = product.variants?.[0];
  const variantSpecs = parseJsonSpecifics(primaryVariant?.itemSpecifics);

  // Combine specifics with variant-level overriding product-level
  const combined: Record<string, string> = {};

  for (const [k, v] of Object.entries(productSpecs)) {
    const textVal = cleanText(v);
    if (textVal) {
      combined[normalizeKey(k)] = textVal;
    }
  }

  for (const [k, v] of Object.entries(variantSpecs)) {
    const textVal = cleanText(v);
    if (textVal) {
      combined[normalizeKey(k)] = textVal;
    }
  }

  const colour =
    combined["colour"] ||
    combined["color"] ||
    combined["itemcolour"] ||
    combined["itemcolor"] ||
    combined["shade"] ||
    null;

  const size =
    combined["size"] ||
    combined["itemsize"] ||
    combined["capacity"] ||
    combined["sizevariation"] ||
    null;

  const style =
    combined["style"] ||
    combined["itemstyle"] ||
    combined["edition"] ||
    null;

  const pattern =
    combined["pattern"] ||
    combined["itempattern"] ||
    null;

  const variantTitle = (primaryVariant?.title || primaryVariant?.variantTitle)
    ? cleanText(primaryVariant.title || primaryVariant.variantTitle)
    : null;

  if (!colour && !size && !style && !pattern && !variantTitle) {
    return null;
  }

  return {
    colour,
    size,
    style,
    pattern,
    variantTitle,
  };
}

function normalizeMatchText(value: string): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Attempts to select exact variations on the Amazon product page using Playwright.
 * Safe order: Colour -> Size -> Style -> Pattern.
 * Never picks random variations.
 */
export async function attemptVariantSelection(
  page: Page,
  hints: VariantSelectionHints | null,
): Promise<VariantSelectionResult> {
  // Check if variation containers exist on the page
  const variationContainerCount = await page
    .locator(
      '#twister, #twisterContainer, div[id^="variation_"], #variation_color_name, #variation_size_name, #variation_style_name, #variation_pattern_name'
    )
    .count()
    .catch(() => 0);

  if (variationContainerCount === 0) {
    return {
      hasVariations: false,
      selected: false,
      matched: true,
    };
  }

  if (!hints || (!hints.colour && !hints.size && !hints.style && !hints.pattern)) {
    return {
      hasVariations: true,
      selected: false,
      matched: false,
      reason:
        "Amazon presents product variations, but no matching colour or size was saved on this listing.",
    };
  }

  const selectedDimensions: string[] = [];

  // 1. Colour selection
  if (hints.colour) {
    const colourResult = await selectDimension(page, {
      dimensionName: "Colour",
      containerSelectors: [
        "#variation_color_name",
        'div[id*="variation_color"]',
        'div[id*="variation_colour"]',
      ],
      targetValue: hints.colour,
    });

    if (!colourResult.matched) {
      return {
        hasVariations: true,
        selected: false,
        matched: false,
        reason: `Amazon presents colour variations, but could not select saved colour "${hints.colour}".`,
      };
    }
    if (colourResult.clicked) {
      selectedDimensions.push(`Colour: ${hints.colour}`);
      await waitForSelectionUpdate(page);
    }
  }

  // 2. Size selection
  if (hints.size) {
    const sizeResult = await selectDimension(page, {
      dimensionName: "Size",
      containerSelectors: [
        "#variation_size_name",
        'div[id*="variation_size"]',
        'div[id*="variation_dimension"]',
      ],
      dropdownSelectors: [
        "#native_dropdown_selected_size_name",
        '#variation_size_name select',
        'select[name="dropdown_selected_size_name"]',
      ],
      targetValue: hints.size,
    });

    if (!sizeResult.matched) {
      return {
        hasVariations: true,
        selected: false,
        matched: false,
        reason: `Amazon presents size variations, but could not select saved size "${hints.size}".`,
      };
    }
    if (sizeResult.clicked) {
      selectedDimensions.push(`Size: ${hints.size}`);
      await waitForSelectionUpdate(page);
    }
  }

  // 3. Style selection
  if (hints.style) {
    const styleResult = await selectDimension(page, {
      dimensionName: "Style",
      containerSelectors: [
        "#variation_style_name",
        'div[id*="variation_style"]',
      ],
      targetValue: hints.style,
    });

    if (!styleResult.matched) {
      return {
        hasVariations: true,
        selected: false,
        matched: false,
        reason: `Amazon presents style variations, but could not select saved style "${hints.style}".`,
      };
    }
    if (styleResult.clicked) {
      selectedDimensions.push(`Style: ${hints.style}`);
      await waitForSelectionUpdate(page);
    }
  }

  // 4. Pattern selection
  if (hints.pattern) {
    const patternResult = await selectDimension(page, {
      dimensionName: "Pattern",
      containerSelectors: [
        "#variation_pattern_name",
        'div[id*="variation_pattern"]',
      ],
      targetValue: hints.pattern,
    });

    if (!patternResult.matched) {
      return {
        hasVariations: true,
        selected: false,
        matched: false,
        reason: `Amazon presents pattern variations, but could not select saved pattern "${hints.pattern}".`,
      };
    }
    if (patternResult.clicked) {
      selectedDimensions.push(`Pattern: ${hints.pattern}`);
      await waitForSelectionUpdate(page);
    }
  }

  return {
    hasVariations: true,
    selected: selectedDimensions.length > 0,
    matched: true,
    selectedDimensions,
  };
}

async function selectDimension(
  page: Page,
  options: {
    dimensionName: string;
    containerSelectors: string[];
    dropdownSelectors?: string[];
    targetValue: string;
  },
): Promise<{ matched: boolean; clicked: boolean }> {
  const targetNorm = normalizeMatchText(options.targetValue);
  if (!targetNorm) {
    return { matched: true, clicked: false };
  }

  // Check if container exists
  let containerLocator = null;
  for (const selector of options.containerSelectors) {
    const loc = page.locator(selector).first();
    if (await loc.count().catch(() => 0) > 0) {
      containerLocator = loc;
      break;
    }
  }

  // Also check dropdowns if provided
  if (options.dropdownSelectors) {
    for (const selectSelector of options.dropdownSelectors) {
      const selectLoc = page.locator(selectSelector).first();
      if (await selectLoc.count().catch(() => 0) > 0) {
        const selectedText = await selectLoc
          .locator("option:checked")
          .textContent()
          .catch(() => "");
        if (selectedText && normalizeMatchText(selectedText).includes(targetNorm)) {
          return { matched: true, clicked: false };
        }

        // Find option matching target
        const optionValues = await selectLoc.evaluate((el: HTMLSelectElement, target: string) => {
          const options = Array.from(el.options);
          for (const opt of options) {
            const norm = opt.text.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (norm.includes(target) || target.includes(norm)) {
              return { value: opt.value, text: opt.text, index: opt.index };
            }
          }
          return null;
        }, targetNorm).catch(() => null);

        if (optionValues) {
          await selectLoc.selectOption({ index: optionValues.index }).catch(() => {});
          return { matched: true, clicked: true };
        }

        return { matched: false, clicked: false };
      }
    }
  }

  if (!containerLocator) {
    // Dimension container not present on page (e.g. this product has no colour variation container)
    return { matched: true, clicked: false };
  }

  // Check if currently selected text matches
  const currentSelection = await containerLocator
    .locator(".selection, .a-dropdown-prompt")
    .first()
    .textContent()
    .catch(() => "");

  if (currentSelection && normalizeMatchText(currentSelection).includes(targetNorm)) {
    return { matched: true, clicked: false };
  }

  // Evaluate and click matching swatch / button in container
  const clickResult = await page.evaluate(
    ({ containerSelectors, targetNorm }: { containerSelectors: string[]; targetNorm: string }) => {
      let container: Element | null = null;
      for (const sel of containerSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          container = el;
          break;
        }
      }
      if (!container) {
        return { found: false, clicked: false };
      }

      // Collect all candidate interactive elements
      const items = Array.from(
        container.querySelectorAll(
          "li, button, .a-button, img[alt], [data-defaultasin], [title]"
        )
      );

      let bestMatch: HTMLElement | null = null;

      for (const item of items) {
        const text = item.textContent?.trim() || "";
        const title = item.getAttribute("title") || "";
        const alt = item.getAttribute("alt") || item.querySelector("img")?.getAttribute("alt") || "";
        const ariaLabel = item.getAttribute("aria-label") || "";

        const combined = `${text} ${title} ${alt} ${ariaLabel}`.toLowerCase().replace(/[^a-z0-9]/g, "");

        if (combined.includes(targetNorm) || targetNorm.includes(combined)) {
          // Find the clickable button or element
          const clickable =
            (item.querySelector("button, input, a, img") as HTMLElement) ||
            (item as HTMLElement);
          bestMatch = clickable;
          break;
        }
      }

      if (bestMatch) {
        bestMatch.click();
        return { found: true, clicked: true };
      }

      return { found: false, clicked: false };
    },
    { containerSelectors: options.containerSelectors, targetNorm },
  ).catch(() => ({ found: false, clicked: false }));

  if (clickResult.clicked) {
    return { matched: true, clicked: true };
  }

  // If container had options but none matched, we couldn't match the required variation
  return { matched: false, clicked: false };
}

async function waitForSelectionUpdate(page: Page) {
  // Wait for network/DOM update after swatch selection
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
