import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { normalizeBuiltinDescriptionTemplate } from "@/lib/builtin-description-templates";
import { getTemplateProductTitle } from "@/lib/product-title";

interface ProductForTemplate {
  storeId: string;
  title: string;
  fullTitle?: string | null;
  description: string;
  images: string[];
  itemSpecifics: unknown;
  templateId: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PLACEHOLDER_SPACING = `(?:\\s|&nbsp;|&#160;|&#xA0;|${String.fromCharCode(160)})*`;

function replacePlaceholder(content: string, placeholder: string, replacement: string): string {
  const pattern = new RegExp(
    `\\{\\{${PLACEHOLDER_SPACING}${escapeRegExp(placeholder)}${PLACEHOLDER_SPACING}\\}\\}`,
    "g",
  );

  return content.replace(pattern, () => replacement);
}

/**
 * Resolves template placeholders with actual product data.
 * Falls back to the default template if no templateId on the product.
 * Returns the final description HTML.
 */
export async function resolveDescriptionTemplate(product: ProductForTemplate): Promise<string> {
  let template = null;

  if (product.templateId) {
    template = await prisma.descriptionTemplate.findUnique({
      where: { id: product.templateId },
    });

    if (template?.storeId !== product.storeId) {
      template = null;
    }
  }

  if (!template) {
    template = await prisma.descriptionTemplate.findFirst({
      where: { storeId: product.storeId, isDefault: true },
    });
  }

  if (!template) {
    logger.info("resolveTemplate", "No template found, using raw description");
    return product.description;
  }

  const normalizedTemplate = normalizeBuiltinDescriptionTemplate(template);

  logger.info("resolveTemplate", "Template found", {
    templateId: normalizedTemplate.id,
    templateName: normalizedTemplate.name,
    contentLength: normalizedTemplate.content.length,
  });

  const templateTitle = getTemplateProductTitle(product);
  const mainImage = product.images.length > 0
    ? `<img src="${escapeHtml(product.images[0])}" alt="${escapeHtml(templateTitle)}" style="max-width:100%;height:auto;" />`
    : "";
  const specs = product.itemSpecifics as Record<string, string> | null;
  const specificsHtml = specs
    ? Object.entries(specs)
        .filter(([key]) => !key.startsWith("_"))
        .map(([key, value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`)
        .join("\n")
    : "";

  // Preserve raw HTML exactly. Placeholder matching tolerates legacy Quill spacing entities.
  const content = normalizedTemplate.content;

  const resolved = replacePlaceholder(
    replacePlaceholder(
      replacePlaceholder(
        replacePlaceholder(content, "title", escapeHtml(templateTitle)),
        "main_image_with_tag",
        mainImage,
      ),
      "description",
      product.description,
    ),
    "item_specifics",
    specificsHtml,
  );

  const stillHasPlaceholders = /\{\{\s*\w+/.test(resolved);
  logger.info("resolveTemplate", "Template resolved", {
    stillHasPlaceholders,
    resolvedLength: resolved.length,
  });

  if (stillHasPlaceholders) {
    const remaining = resolved.match(/\{\{[^}]*\}\}/g);
    logger.info("resolveTemplate", "Unresolved placeholders remaining", {
      remaining: remaining?.slice(0, 5),
    });
  }

  return resolved;
}
