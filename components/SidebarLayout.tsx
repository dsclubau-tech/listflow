"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";

interface SidebarLayoutProps {
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}

const STORAGE_KEY = "listflow_sidebar_collapsed";

export default function SidebarLayout({
  userName,
  userEmail,
  children,
}: SidebarLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        setCollapsed(saved === "true");
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const handleToggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  };

  return (
    <div className="flex min-h-screen bg-tertiary">
      <Sidebar
        userName={userName}
        userEmail={userEmail}
        collapsed={isMounted ? collapsed : false}
        onToggle={handleToggle}
      />
      <main
        className={`flex-1 transition-all duration-300 ease-in-out ${
          isMounted && collapsed ? "ml-16" : "ml-64"
        } overflow-auto bg-tertiary`}
      >
        {children}
      </main>
    </div>
  );
}
