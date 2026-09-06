import { redirect } from "next/navigation";
import SidebarLayout from "@/components/SidebarLayout";
import {
  getCurrentStoreSession,
  getUserStoresWithRanking,
} from "@/lib/store-session";
import { createClient } from "@/lib/supabase/server";
import { getOrRefreshEntitlement } from "@/lib/aa-entitlement";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 1. Check Supabase auth
  let aaUserId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) {
      aaUserId = user.id;
    }
  } catch {
    // Fall through to session check
  }

  // 2. If authenticated via AA Supabase, verify entitlement snapshot
  let overLimitWarning: string | null = null;

  if (aaUserId) {
    const entitlement = await getOrRefreshEntitlement(aaUserId);

    if (entitlement.status !== "ACTIVE" || entitlement.allowedStores <= 0) {
      redirect("/subscription-required");
    }

    const { stores, allowedStores } = await getUserStoresWithRanking(aaUserId);
    const overLimitStores = stores.filter((s) => !s.isEntitled);

    if (overLimitStores.length > 0) {
      overLimitWarning = `Subscription limit: ${allowedStores} of ${stores.length} stores active. Stores added after your limit are locked. Upgrade your plan to manage all stores.`;
    }
  }

  // 3. Resolve active store session
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    if (aaUserId) {
      redirect("/subscription-required");
    } else {
      redirect("/login");
    }
  }

  return (
    <SidebarLayout
      userName={storeSession.storeName}
      userEmail={storeSession.storeLoginId}
    >
      {overLimitWarning && (
        <div className="mx-4 mt-4 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2.5">
            <svg
              className="w-4 h-4 text-amber-400 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span>{overLimitWarning}</span>
          </div>
        </div>
      )}
      {children}
    </SidebarLayout>
  );
}
