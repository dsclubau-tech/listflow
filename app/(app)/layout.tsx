import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.storeId) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        userName={session.user.storeName || session.user.name || "Store"}
        userEmail={session.user.storeLoginId || session.user.email || ""}
      />
      <main className="flex-1 ml-64 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  );
}
