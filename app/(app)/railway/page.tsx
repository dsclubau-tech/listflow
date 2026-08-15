import { fetchRailwayUsageReport } from "@/lib/railway-api";
import RailwayUsageClient from "@/components/RailwayUsageClient";

export const metadata = {
  title: "Railway Usage & Cost Monitor | ListFlow",
  description: "Monitor Railway resource consumption, per-service worker costs, and live process telemetry.",
};

export const dynamic = "force-dynamic";

export default async function RailwayPage() {
  const initialReport = await fetchRailwayUsageReport();

  return <RailwayUsageClient initialReport={initialReport} />;
}
