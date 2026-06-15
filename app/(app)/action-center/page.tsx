import { redirect } from "next/navigation";
import ActionCenterClient from "@/components/ActionCenterClient";
import { getActionCenterData } from "@/lib/action-center";
import { getCurrentStoreSession } from "@/lib/store-session";

export default async function ActionCenterPage() {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  const data = await getActionCenterData(storeSession.storeId);

  return (
    <div className="p-8">
      <ActionCenterClient data={data} />
    </div>
  );
}
