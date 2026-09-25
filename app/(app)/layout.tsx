import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SidebarLayout from "@/components/SidebarLayout";
import {
  type StoreOption,
} from "@/lib/store-session";
import {
  getRenderCurrentStoreSession,
  getRenderEntitlement,
  getRenderLegacySession,
  getRenderStores,
  getRenderSupabaseUserId,
} from "@/lib/render-store-session";
import { prisma } from "@/lib/prisma";
import {
  verifyStoreUnlockToken,
  PROFILE_UNLOCK_COOKIE_NAME,
} from "@/lib/profile-lock";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 1. Check Supabase auth
  let aaUserId: string | null = null;
  try {
    aaUserId = await getRenderSupabaseUserId();
  } catch {
    // Fall through to session check
  }

  // 2. If authenticated via AA Supabase, verify entitlement snapshot
  let overLimitWarning: string | null = null;
  let userStores: StoreOption[] = [];

  if (aaUserId) {
    const entitlement = await getRenderEntitlement(aaUserId);

    if (entitlement.status !== "ACTIVE" || entitlement.allowedStores <= 0) {
      redirect("/subscription-required");
    }

    const { stores, allowedStores } = await getRenderStores(aaUserId);
    userStores = stores
      .filter((s) => s.isEntitled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        loginId: s.loginId,
        rank: s.rank,
        hasPassword: s.hasPassword,
        profileLockEnabled: s.profileLockEnabled,
      }));

    const overLimitStores = stores.filter((s) => !s.isEntitled);

    if (overLimitStores.length > 0) {
      overLimitWarning = `Subscription limit: ${allowedStores} of ${stores.length} stores active. Stores added after your limit are locked. Upgrade your plan to manage all stores.`;
    }
  }

  // 3. Resolve active store session
  const storeSession = await getRenderCurrentStoreSession();

  if (!storeSession) {
    const legacySession = await getRenderLegacySession();
    const legacyStoreId = legacySession?.user?.storeId;
    if (legacyStoreId) {
      const store = await prisma.store.findUnique({
        where: { id: legacyStoreId },
        select: { ownerUserId: true },
      });
      if (store?.ownerUserId) {
        redirect("/subscription-required");
      }
    }

    if (aaUserId) {
      redirect("/subscription-required");
    } else {
      redirect("/login");
    }
  }

  // If userStores not populated yet (e.g. legacy session), resolve via ownerUserId
  if (userStores.length === 0 && storeSession.ownerUserId) {
    const { stores } = await getRenderStores(storeSession.ownerUserId);
    userStores = stores
      .filter((s) => s.isEntitled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        loginId: s.loginId,
        rank: s.rank,
        hasPassword: s.hasPassword,
        profileLockEnabled: s.profileLockEnabled,
      }));
  }

  const selectedStore = userStores.find((store) => store.id === storeSession.storeId);
  const currentStore = selectedStore
    ? null
    : await prisma.store.findUnique({
        where: { id: storeSession.storeId },
        select: { password: true, profileLockEnabled: true },
      });
  const currentStoreHasPassword = selectedStore?.hasPassword ?? Boolean(currentStore?.password);
  const currentStoreProfileLockEnabled =
    selectedStore?.profileLockEnabled ?? currentStore?.profileLockEnabled ?? true;

  if (userStores.length === 0) {
    userStores = [
      {
        id: storeSession.storeId,
        name: storeSession.storeName,
        loginId: storeSession.storeLoginId,
        rank: 1,
        hasPassword: currentStoreHasPassword,
        profileLockEnabled: currentStoreProfileLockEnabled,
      },
    ];
  }

  // Check if profile lock is active for the current store
  const cookieStore = await cookies();
  const unlockToken = cookieStore.get(PROFILE_UNLOCK_COOKIE_NAME)?.value;
  const isProfileLocked = Boolean(
    currentStoreHasPassword &&
    currentStoreProfileLockEnabled !== false &&
      !verifyStoreUnlockToken(storeSession.storeId, unlockToken)
  );

  return (
    <SidebarLayout
      userName={storeSession.storeName}
      userEmail={storeSession.storeLoginId}
      currentStoreId={storeSession.storeId}
      stores={userStores}
      initialLocked={isProfileLocked}
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
