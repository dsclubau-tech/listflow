export function buildTitleHtml(title: string): string {
  const clean = (title || "").trim();
  if (!clean) return "";
  return `<p><strong style="color: #e60000; font-size: 24px;">${clean}</strong></p>`;
}

export function hasTitleInDescription(description: string): boolean {
  if (!description) return false;
  const trimmed = description.trim();
  return (
    /^\s*<p[^>]*>\s*<strong[^>]*style="[^"]*color:\s*(?:#e60000|rgb\(230,\s*0,\s*0\))[^"]*"[^>]*>/i.test(trimmed) ||
    /^\s*<p[^>]*>\s*<span[^>]*style="[^"]*color:\s*(?:#e60000|rgb\(230,\s*0,\s*0\))[^"]*"[^>]*>\s*<strong/i.test(trimmed) ||
    /^\s*<p[^>]*>\s*<strong[^>]*>\s*<span[^>]*style="[^"]*color:\s*(?:#e60000|rgb\(230,\s*0,\s*0\))[^"]*"[^>]*>/i.test(trimmed)
  );
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

  const topTitleRegex = /^\s*<p[^>]*>(?:\s*<strong[^>]*style="[^"]*color:\s*(?:#e60000|rgb\(230,\s*0,\s*0\))[^"]*"[^>]*>|\s*<span[^>]*style="[^"]*color:\s*(?:#e60000|rgb\(230,\s*0,\s*0\))[^"]*"[^>]*>\s*<strong[^>]*>|\s*<strong[^>]*>\s*<span[^>]*style="[^"]*color:\s*(?:#e60000|rgb\(230,\s*0,\s*0\))[^"]*"[^>]*>)[\s\S]*?<\/p>\s*/i;

  if (topTitleRegex.test(cleanDesc)) {
    if (!cleanTitle) {
      return cleanDesc.replace(topTitleRegex, "").trim();
    }
    return cleanDesc.replace(topTitleRegex, buildTitleHtml(cleanTitle) + "\n");
  }

  return prependTitleToDescription(cleanTitle, cleanDesc);
}
