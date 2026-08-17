import "server-only";

import { prisma } from "@/lib/prisma";

export const MAX_FAVORITE_RESEARCH_QUERIES = 100;

export type FavoriteResearchQueryItem = {
  id: string;
  query: string;
  createdAt: string;
};

export function normalizeResearchQuery(rawQuery: string): string {
  return rawQuery.trim().replace(/\s+/g, " ");
}

export async function getFavoriteResearchQueries(
  storeId: string
): Promise<FavoriteResearchQueryItem[]> {
  if (!storeId) {
    return [];
  }

  const items = await prisma.favoriteResearchQuery.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: MAX_FAVORITE_RESEARCH_QUERIES,
    select: {
      id: true,
      query: true,
      createdAt: true,
    },
  });

  return items.map((item) => ({
    id: item.id,
    query: item.query,
    createdAt: item.createdAt.toISOString(),
  }));
}

export async function addFavoriteResearchQuery({
  userId,
  storeId,
  query,
}: {
  userId: string;
  storeId: string;
  query: string;
}): Promise<FavoriteResearchQueryItem> {
  const normalized = normalizeResearchQuery(query);

  if (!normalized) {
    throw new Error("Favorite query cannot be empty.");
  }

  if (normalized.length > 100) {
    throw new Error("Favorite query cannot exceed 100 characters.");
  }

  // Check store total favorites count to prevent unlimited growth
  const count = await prisma.favoriteResearchQuery.count({
    where: { storeId },
  });

  const existing = await prisma.favoriteResearchQuery.findUnique({
    where: {
      storeId_query: {
        storeId,
        query: normalized,
      },
    },
    select: {
      id: true,
      query: true,
      createdAt: true,
    },
  });

  if (existing) {
    return {
      id: existing.id,
      query: existing.query,
      createdAt: existing.createdAt.toISOString(),
    };
  }

  if (count >= MAX_FAVORITE_RESEARCH_QUERIES) {
    throw new Error(
      `You have reached the maximum limit of ${MAX_FAVORITE_RESEARCH_QUERIES} favorite searches.`
    );
  }

  const created = await prisma.favoriteResearchQuery.create({
    data: {
      userId,
      storeId,
      query: normalized,
    },
    select: {
      id: true,
      query: true,
      createdAt: true,
    },
  });

  return {
    id: created.id,
    query: created.query,
    createdAt: created.createdAt.toISOString(),
  };
}

export async function removeFavoriteResearchQuery({
  storeId,
  query,
}: {
  storeId: string;
  query: string;
}): Promise<boolean> {
  const normalized = normalizeResearchQuery(query);

  if (!normalized) {
    return false;
  }

  const result = await prisma.favoriteResearchQuery.deleteMany({
    where: {
      storeId,
      query: {
        equals: normalized,
        mode: "insensitive",
      },
    },
  });

  return result.count > 0;
}

export async function removeFavoriteResearchQueryById({
  storeId,
  id,
}: {
  storeId: string;
  id: string;
}): Promise<boolean> {
  if (!id) {
    return false;
  }

  const result = await prisma.favoriteResearchQuery.deleteMany({
    where: {
      id,
      storeId,
    },
  });

  return result.count > 0;
}
