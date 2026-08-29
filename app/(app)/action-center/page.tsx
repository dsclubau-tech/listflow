import { redirect } from "next/navigation";
import ActionCenterClient from "@/components/ActionCenterClient";
import PageLoadErrorState from "@/components/PageLoadErrorState";
import { getActionCenterData } from "@/lib/action-center";
import { logger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";

export default async function ActionCenterPage() {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  let data: Awaited<ReturnType<typeof getActionCenterData>> | null = null;

  try {
    data = await getActionCenterData(storeSession.storeId);
  } catch (error) {
    logger.error(
      "action-center/page",
      "Failed to load Action Center data",
      error,
      { storeId: storeSession.storeId },
    );

  }

  if (!data) {
    return (
      <div className="w-full">
        <PageLoadErrorState
          title="Action Center"
          message="Action Center is temporarily unavailable. Refresh and try again."
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      <ActionCenterClient data={data} />
    </div>
  );
}
