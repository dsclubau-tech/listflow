const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);

export async function uploadProductImageFile(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Only JPG, PNG, and GIF images can be uploaded.");
  }

  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image must be smaller than 12 MB.");
  }

  const formData = new FormData();
  formData.set("image", file);

  const response = await fetch("/api/images/upload", {
    method: "POST",
    body: formData,
  });
  const data = (await response.json().catch(() => null)) as {
    url?: unknown;
    error?: unknown;
  } | null;

  if (!response.ok || typeof data?.url !== "string") {
    throw new Error(
      typeof data?.error === "string" ? data.error : "Image upload failed."
    );
  }

  return data.url;
}
