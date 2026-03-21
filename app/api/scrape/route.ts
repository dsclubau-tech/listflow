import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { scrapeAmazonProduct } from "@/lib/amazon-scraper";

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url } = body;

  if (!url || typeof url !== "string" || url.trim() === "") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  if (!url.startsWith("https://www.amazon.com.au")) {
    return NextResponse.json(
      { error: "Only Amazon AU URLs are supported" },
      { status: 400 }
    );
  }

  try {
    const product = await scrapeAmazonProduct(url);
    return NextResponse.json(product);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Scraping failed unexpectedly";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
