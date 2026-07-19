import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
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
    <div className="flex min-h-screen">
      <Sidebar
        userName={storeSession.storeName}
        userEmail={storeSession.storeLoginId}
      />
      <main className="flex-1 ml-64 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  );
}
