import { redirect } from "next/navigation";
import { getRenderCurrentStoreSession } from "@/lib/render-store-session";

export default async function RailwayPage() {
  const storeSession = await getRenderCurrentStoreSession();

  if (!storeSession) {
    return null;
  }

  redirect("/products");
}
