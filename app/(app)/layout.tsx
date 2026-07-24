import { redirect } from "next/navigation";
import SidebarLayout from "@/components/SidebarLayout";
import { getCurrentStoreSession } from "@/lib/store-session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    redirect("/login");
  }

  return (
    <SidebarLayout
      userName={storeSession.storeName}
      userEmail={storeSession.storeLoginId}
    >
      {children}
    </SidebarLayout>
  );
}
