import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  addFavoriteResearchQuery,
  getFavoriteResearchQueries,
  removeFavoriteResearchQuery,
  removeFavoriteResearchQueryById,
} from "@/lib/favorite-research-queries";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("ebay-research/favorites/GET", "Unauthorized favorites request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const favorites = await getFavoriteResearchQueries(storeSession.storeId);
    return NextResponse.json({ favorites });
  } catch (error) {
    log.error("ebay-research/favorites/GET", "Failed to load favorites", error);
    return NextResponse.json(
      { favorites: [], error: "Failed to load favorite searches." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("ebay-research/favorites/POST", "Unauthorized favorite attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    query?: unknown;
    action?: unknown;
  };

  try {
    body = (await request.json()) as {
      query?: unknown;
      action?: unknown;
    };
  } catch (error) {
    log.error("ebay-research/favorites/POST", "Invalid JSON body", error);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json(
      { error: "Query string is required." },
      { status: 400 }
    );
  }

  try {
    const userId = await getInternalUserId();

    if (body.action === "toggle") {
      // Check if it already exists to toggle off
      const removed = await removeFavoriteResearchQuery({
        storeId: storeSession.storeId,
        query,
      });

      if (removed) {
        log.info("ebay-research/favorites/POST", "Removed favorite via toggle", {
          query,
        });
        return NextResponse.json({ isFavorite: false, query });
      }

      // Otherwise add it
      const favorite = await addFavoriteResearchQuery({
        userId,
        storeId: storeSession.storeId,
        query,
      });

      log.info("ebay-research/favorites/POST", "Added favorite via toggle", {
        favoriteId: favorite.id,
        query,
      });
      return NextResponse.json({ isFavorite: true, favorite });
    }

    const favorite = await addFavoriteResearchQuery({
      userId,
      storeId: storeSession.storeId,
      query,
    });

    log.info("ebay-research/favorites/POST", "Added favorite", {
      favoriteId: favorite.id,
      query,
    });
    return NextResponse.json({ favorite, isFavorite: true }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save favorite";
    log.error("ebay-research/favorites/POST", "Failed to save favorite", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("ebay-research/favorites/DELETE", "Unauthorized delete favorite request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    query?: unknown;
    id?: unknown;
  } = {};

  try {
    body = (await request.json().catch(() => ({}))) as {
      query?: unknown;
      id?: unknown;
    };
  } catch {
    body = {};
  }

  const { searchParams } = new URL(request.url);
  const query =
    typeof body.query === "string"
      ? body.query
      : searchParams.get("query") ?? undefined;
  const id =
    typeof body.id === "string" ? body.id : searchParams.get("id") ?? undefined;

  if (!query && !id) {
    return NextResponse.json(
      { error: "Query or ID is required to remove a favorite." },
      { status: 400 }
    );
  }

  try {
    let removed = false;
    if (id) {
      removed = await removeFavoriteResearchQueryById({
        storeId: storeSession.storeId,
        id,
      });
    } else if (query) {
      removed = await removeFavoriteResearchQuery({
        storeId: storeSession.storeId,
        query,
      });
    }

    log.info("ebay-research/favorites/DELETE", "Removed favorite", { id, query, removed });
    return NextResponse.json({ success: true, removed });
  } catch (error) {
    log.error("ebay-research/favorites/DELETE", "Failed to delete favorite", error);
    return NextResponse.json(
      { error: "Failed to remove favorite search." },
      { status: 500 }
    );
  }
}
