const TITLE_COLOR = "#0D47A1";
const TITLE_COLOR_PATTERN = String.raw`(?:#(?:0d47a1|e60000)|rgb\((?:13,\s*71,\s*161|230,\s*0,\s*0)\))`;

const titleDescriptionPatterns = [
  new RegExp(
    String.raw`^\s*<p[^>]*>\s*<strong[^>]*style="[^"]*color:\s*${TITLE_COLOR_PATTERN}[^"]*"[^>]*>`,
    "i",
  ),
  new RegExp(
    String.raw`^\s*<p[^>]*>\s*<span[^>]*style="[^"]*color:\s*${TITLE_COLOR_PATTERN}[^"]*"[^>]*>\s*<strong`,
    "i",
  ),
  new RegExp(
    String.raw`^\s*<p[^>]*>\s*<strong[^>]*>\s*<span[^>]*style="[^"]*color:\s*${TITLE_COLOR_PATTERN}[^"]*"[^>]*>`,
    "i",
  ),
];

const topTitleRegex = new RegExp(
  String.raw`^\s*<p[^>]*>(?:\s*<strong[^>]*style="[^"]*color:\s*${TITLE_COLOR_PATTERN}[^"]*"[^>]*>|\s*<span[^>]*style="[^"]*color:\s*${TITLE_COLOR_PATTERN}[^"]*"[^>]*>\s*<strong[^>]*>|\s*<strong[^>]*>\s*<span[^>]*style="[^"]*color:\s*${TITLE_COLOR_PATTERN}[^"]*"[^>]*>)[\s\S]*?<\/p>\s*`,
  "i",
);

export function buildTitleHtml(title: string): string {
  const clean = (title || "").trim();
  if (!clean) return "";
  return `<p><strong style="color: ${TITLE_COLOR}; font-size: 24px;">${clean}</strong></p>`;
}

export function hasTitleInDescription(description: string): boolean {
  if (!description) return false;
  const trimmed = description.trim();
  return titleDescriptionPatterns.some((pattern) => pattern.test(trimmed));
}

export function prependTitleToDescription(title: string, description: string): string {
  const cleanTitle = (title || "").trim();
  const cleanDesc = (description || "").trim();

  if (!cleanTitle) return cleanDesc;
  if (!cleanDesc) return buildTitleHtml(cleanTitle);

  if (hasTitleInDescription(cleanDesc)) {
    return cleanDesc;
  }

  return `${buildTitleHtml(cleanTitle)}\n${cleanDesc}`;
}

export function updateDescriptionTitle(newTitle: string, description: string): string {
  const cleanTitle = (newTitle || "").trim();
  const cleanDesc = (description || "").trim();

  if (!cleanDesc) {
    return buildTitleHtml(cleanTitle);
  }

  if (topTitleRegex.test(cleanDesc)) {
    if (!cleanTitle) {
      return cleanDesc.replace(topTitleRegex, "").trim();
    }
    return cleanDesc.replace(topTitleRegex, buildTitleHtml(cleanTitle) + "\n");
  }

  return prependTitleToDescription(cleanTitle, cleanDesc);
}
