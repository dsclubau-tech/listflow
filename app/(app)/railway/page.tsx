import { redirect } from "next/navigation";
import { getRenderCurrentStoreSession } from "@/lib/render-store-session";
import RailwayUsageClient from "@/components/RailwayUsageClient";

export const metadata = {
  title: "Railway Usage & Cost Monitor | ListFlow",
  description: "Monitor Railway resource consumption, per-service worker costs, and live process telemetry.",
};

export default async function RailwayPage() {
  const storeSession = await getRenderCurrentStoreSession();

  if (!storeSession) {
    return null;
  }

  return <RailwayUsageClient />;
}
