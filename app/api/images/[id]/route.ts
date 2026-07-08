import { prisma } from "@/lib/prisma";

function isSafeImageId(value: string) {
  return /^[a-z0-9]+$/i.test(value);
}

function contentDispositionFileName(value: string) {
  return value.replace(/["\\\r\n]/g, "_");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isSafeImageId(id)) {
    return new Response("Not found", { status: 404 });
  }

  const image = await prisma.uploadedImage.findUnique({
    where: { id },
    select: {
      data: true,
      contentType: true,
      byteLength: true,
      fileName: true,
    },
  });

  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(image.data, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${contentDispositionFileName(
        image.fileName
      )}"`,
      "Content-Length": String(image.byteLength),
      "Content-Type": image.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
