"use client";

import { useState, useSyncExternalStore } from "react";
import Sidebar from "@/components/Sidebar";
import StoreSwitcherModal from "@/components/StoreSwitcherModal";
import ProfileLockScreen from "@/components/ProfileLockScreen";
import type { StoreOption } from "@/lib/store-session";

interface SidebarLayoutProps {
  userName: string;
  userEmail: string;
  currentStoreId?: string;
  stores?: StoreOption[];
  initialLocked?: boolean;
  children: React.ReactNode;
}

const STORAGE_KEY = "listflow_sidebar_collapsed";
const STORAGE_EVENT = "listflow-sidebar-change";

function subscribeToSidebarPreference(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) callback();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(STORAGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(STORAGE_EVENT, callback);
  };
}

function getSidebarPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerSidebarPreference() {
  return false;
}

export default function SidebarLayout({
  userName,
  userEmail,
  currentStoreId,
  stores = [],
  initialLocked = false,
  children,
}: SidebarLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(initialLocked);

  const collapsed = useSyncExternalStore(
    subscribeToSidebarPreference,
    getSidebarPreference,
    getServerSidebarPreference
  );

  const handleToggle = () => {
    try {
      localStorage.setItem(STORAGE_KEY, String(!collapsed));
      window.dispatchEvent(new Event(STORAGE_EVENT));
    } catch {
      // Ignore localStorage errors
    }
  };

  const handleLockProfile = async () => {
    setIsLocked(true);
    try {
      await fetch("/api/stores/profile-lock/lock", { method: "POST" });
    } catch {
      // Ignore network errors on lock
    }
  };

  return (
    <div className="flex min-h-screen bg-tertiary">
      {/* ── Top Header on Mobile (< md) ── */}
      <header className="md:hidden fixed top-0 inset-x-0 h-16 bg-primary text-white flex items-center justify-between px-4 z-30 shadow-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-1.5 rounded-lg text-tertiary/90 hover:text-white hover:bg-white/10 transition-colors mobile-touch-target flex items-center justify-center"
            aria-label="Open navigation menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div>
            <span className="font-bold text-lg leading-tight tracking-tight block">ListFlow</span>
            <span className="text-[11px] text-tertiary/75 font-normal block truncate max-w-[160px] sm:max-w-xs">
              {userName || userEmail}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-tertiary text-primary font-bold text-xs flex items-center justify-center">
            {(userName || userEmail || "U").charAt(0).toUpperCase()}
          </div>
        </div>
      </header>

      {/* ── Sidebar (Desktop & Mobile Drawer) ── */}
      <Sidebar
        userName={userName}
        userEmail={userEmail}
        currentStoreId={currentStoreId}
        stores={stores}
        collapsed={collapsed}
        onToggle={handleToggle}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        onLockProfile={handleLockProfile}
        onOpenSwitcher={() => setSwitcherOpen(true)}
      />

      {/* ── Main Content Area ── */}
      <main
        className={`flex-1 min-w-0 transition-all duration-300 ease-in-out ${
          collapsed ? "md:ml-16" : "md:ml-64"
        } ml-0 min-h-screen overflow-x-clip bg-tertiary pt-16 md:pt-0`}
      >
        <div className="w-full max-w-full min-w-0 px-3 py-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>

      {/* ── Store Switcher Modal ── */}
      <StoreSwitcherModal
        isOpen={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        stores={stores}
        currentStoreId={currentStoreId}
      />

      {/* ── Workspace Profile Lock Screen Overlay ── */}
      {isLocked && currentStoreId && (
        <ProfileLockScreen
          storeId={currentStoreId}
          storeName={userName}
          storeLoginId={userEmail}
          onUnlock={() => setIsLocked(false)}
          onOpenSwitcher={() => setSwitcherOpen(true)}
        />
      )}
    </div>
  );
}
