import { prisma } from "@/lib/prisma";

function removeKeyword(value: string, keyword: string): {
  cleaned: string;
  removed: boolean;
} {
  if (!value.includes(keyword)) {
    return { cleaned: value, removed: false };
  }

  return {
    cleaned: value.split(keyword).join(""),
    removed: true,
  };
}

function removeKeywordFromDescriptionHtml(description: string, keyword: string): {
  cleaned: string;
  removed: boolean;
} {
  if (!description.includes(keyword)) {
    return { cleaned: description, removed: false };
  }

  let removed = false;
  const cleaned = description
    .split(/(<[^>]+>)/g)
    .map((segment) => {
      if (segment.startsWith("<") && segment.endsWith(">")) {
        return segment;
      }

      const result = removeKeyword(segment, keyword);
      if (result.removed) {
        removed = true;
      }
      return result.cleaned;
    })
    .join("");

  return { cleaned, removed };
}

/**
 * Fetches all blacklisted keywords and removes them from the title and description.
 * Uses case-sensitive exact match as specified.
 * Returns the cleaned title, description, and a list of keywords that were actually removed.
 */
export async function applyKeywordFilter(
  title: string,
  description: string
): Promise<{ title: string; description: string; removedKeywords: string[] }> {
  const keywords = await prisma.keywordBlacklist.findMany();

  let cleanedTitle = title;
  let cleanedDescription = description;
  const removedKeywords: string[] = [];

  for (const entry of keywords) {
    let wasRemoved = false;

    if (entry.removeFromTitle) {
      const result = removeKeyword(cleanedTitle, entry.keyword);
      if (result.removed) {
        cleanedTitle = result.cleaned;
        wasRemoved = true;
      }
    }

    if (entry.removeFromDescription) {
      const result = removeKeywordFromDescriptionHtml(
        cleanedDescription,
        entry.keyword
      );
      if (result.removed) {
        cleanedDescription = result.cleaned;
        wasRemoved = true;
      }
    }

    if (wasRemoved) {
      removedKeywords.push(entry.keyword);
    }
  }

  // Clean up any double spaces left after removal
  cleanedTitle = cleanedTitle.replace(/\s{2,}/g, " ").trim();

  return { title: cleanedTitle, description: cleanedDescription, removedKeywords };
}
