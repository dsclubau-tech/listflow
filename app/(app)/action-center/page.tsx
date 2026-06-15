import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ActionCenterClient from "@/components/ActionCenterClient";
import { getActionCenterData } from "@/lib/action-center";

export default async function ActionCenterPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const data = await getActionCenterData(session.user.id);

  return (
    <div className="p-8">
      <ActionCenterClient data={data} />
    </div>
  );
}
