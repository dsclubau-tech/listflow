import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

interface ProductForTemplate {
  title: string;
  description: string;
  images: string[];
  itemSpecifics: unknown;
  templateId: string | null;
}

/**
 * Resolves template placeholders with actual product data.
 * Falls back to the default template if no templateId on the product.
 * Returns the final description HTML.
 */
export async function resolveDescriptionTemplate(product: ProductForTemplate): Promise<string> {
  let template = null;

  // Try product-specific template
  if (product.templateId) {
    template = await prisma.descriptionTemplate.findUnique({
      where: { id: product.templateId },
    });
  }

  // Fallback to default template
  if (!template) {
    template = await prisma.descriptionTemplate.findFirst({
      where: { isDefault: true },
    });
  }

  if (!template) {
    logger.info("resolveTemplate", "No template found, using raw description");
    return product.description;
  }

  logger.info("resolveTemplate", "Template found", {
    templateId: template.id,
    templateName: template.name,
    contentLength: template.content.length,
  });

  // Build replacement values
  const mainImage = product.images.length > 0
    ? `<img src="${product.images[0]}" alt="${product.title}" style="max-width:100%;height:auto;" />`
    : '';
  const specs = product.itemSpecifics as Record<string, string> | null;
  const specificsHtml = specs
    ? Object.entries(specs)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`)
        .join('\n')
    : '';

  // Decode common HTML entities in template content that editors may produce
  // CRITICAL: Quill editor converts spaces to &nbsp; — must decode BEFORE regex matching
  const content = template.content
    .replace(/&nbsp;/g, ' ')
    .replace(/&lbrace;/g, '{')
    .replace(/&rbrace;/g, '}')
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&#x7b;/gi, '{')
    .replace(/&#x7d;/gi, '}');

  // Replace placeholders
  const resolved = content
    .replace(/\{\{\s*title\s*\}\}/g, product.title)
    .replace(/\{\{\s*main_image_with_tag\s*\}\}/g, mainImage)
    .replace(/\{\{\s*description\s*\}\}/g, product.description)
    .replace(/\{\{\s*item_specifics\s*\}\}/g, specificsHtml);

  const stillHasPlaceholders = /\{\{\s*\w+/.test(resolved);
  logger.info("resolveTemplate", "Template resolved", {
    stillHasPlaceholders,
    resolvedLength: resolved.length,
  });

  if (stillHasPlaceholders) {
    // Log what's left unresolved for debugging
    const remaining = resolved.match(/\{\{[^}]*\}\}/g);
    logger.info("resolveTemplate", "Unresolved placeholders remaining", {
      remaining: remaining?.slice(0, 5),
    });
  }

  return resolved;
}
