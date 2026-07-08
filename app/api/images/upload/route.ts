import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession, getInternalUserId } from "@/lib/store-session";
import { NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);

function sanitizeFileName(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return sanitized || "product-image.jpg";
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "type" in value &&
    "size" in value
  );
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid image upload." }, { status: 400 });
  }

  const file = formData.get("image");
  if (!isUploadedFile(file)) {
    return NextResponse.json({ error: "Choose an image file first." }, { status: 400 });
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Only JPG, PNG, and GIF images can be uploaded." },
      { status: 400 }
    );
  }

  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Image must be smaller than 12 MB." },
      { status: 400 }
    );
  }

  const data = Buffer.from(await file.arrayBuffer());
  const userId = await getInternalUserId();
  const image = await prisma.uploadedImage.create({
    data: {
      storeId: storeSession.storeId,
      createdById: userId,
      fileName: sanitizeFileName(file.name),
      contentType: file.type,
      byteLength: data.byteLength,
      data,
    },
    select: {
      id: true,
    },
  });

  return NextResponse.json({
    url: new URL(`/api/images/${image.id}`, request.url).toString(),
  });
}
