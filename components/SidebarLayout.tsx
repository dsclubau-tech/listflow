"use client";

import { useSyncExternalStore } from "react";
import Sidebar from "@/components/Sidebar";

interface SidebarLayoutProps {
  userName: string;
  userEmail: string;
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
  children,
}: SidebarLayoutProps) {
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

  return (
    <div className="flex min-h-screen bg-tertiary">
      <Sidebar
        userName={userName}
        userEmail={userEmail}
        collapsed={collapsed}
        onToggle={handleToggle}
      />
      <main
        className={`flex-1 transition-all duration-300 ease-in-out ${
          collapsed ? "ml-16" : "ml-64"
        } overflow-auto bg-tertiary`}
      >
        {children}
      </main>
    </div>
  );
}
