import { prisma } from "@/lib/prisma";

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

    if (entry.removeFromTitle && cleanedTitle.includes(entry.keyword)) {
      cleanedTitle = cleanedTitle.split(entry.keyword).join("");
      wasRemoved = true;
    }

    if (entry.removeFromDescription && cleanedDescription.includes(entry.keyword)) {
      cleanedDescription = cleanedDescription.split(entry.keyword).join("");
      wasRemoved = true;
    }

    if (wasRemoved) {
      removedKeywords.push(entry.keyword);
    }
  }

  // Clean up any double spaces left after removal
  cleanedTitle = cleanedTitle.replace(/\s{2,}/g, " ").trim();

  return { title: cleanedTitle, description: cleanedDescription, removedKeywords };
}
