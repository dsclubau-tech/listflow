"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import PageRefreshButton from "@/components/PageRefreshButton";

interface SidebarProps {
  userName: string;
  userEmail: string;
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({
  userName,
  userEmail,
  collapsed = false,
  onToggle,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const links = [
    {
      href: "/action-center",
      label: "Action Center",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 6.75h11.25M9 12h11.25M9 17.25h11.25M3.75 6.75h.008v.008H3.75V6.75Zm0 5.25h.008v.008H3.75V12Zm0 5.25h.008v.008H3.75v-.008Z"
          />
        </svg>
      ),
    },
    {
      href: "/products",
      label: "Products",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M20.25 7.5 12 3 3.75 7.5m16.5 0V16.5L12 21m8.25-13.5L12 12m0 9V12m0 0L3.75 7.5"
          />
        </svg>
      ),
    },
    {
      href: "/ebay-research",
      label: "eBay Research",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm2.25-9.75h-4.5m4.5 3h-4.5"
          />
        </svg>
      ),
    },
    {
      href: "/drafts",
      label: "Drafts",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7.5 18.75A4.5 4.5 0 1 1 8.96 9.99a5.25 5.25 0 0 1 10.29 1.26A3.75 3.75 0 1 1 18 18.75H7.5Zm4.5-6v4.5m0 0 2.25-2.25M12 17.25l-2.25-2.25"
          />
        </svg>
      ),
    },
    {
      href: "/ebay-import",
      label: "eBay Import",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 3v12m0 0 4-4m-4 4-4-4m-3 8h14"
          />
        </svg>
      ),
    },
    {
      href: "/history",
      label: "Upload History",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      href: "/settings",
      label: "Settings",
      icon: (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
  ];

  const userInitial = (userName || userEmail || "U").charAt(0).toUpperCase();

  return (
    <aside
      className={`fixed inset-y-0 left-0 bg-gray-900 flex flex-col z-30 transition-all duration-300 ease-in-out ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-gray-800 h-16">
        {!collapsed ? (
          <div>
            <h1 className="text-xl font-bold text-white leading-none">ListFlow</h1>
            <p className="text-xs text-gray-400 mt-1">eBay listing tool</p>
          </div>
        ) : (
          <div className="mx-auto font-bold text-white text-lg tracking-wider">
            LF
          </div>
        )}

        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors ${
              collapsed ? "mx-auto" : ""
            }`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {collapsed ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 5l7 7-7 7M5 5l7 7-7 7"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                />
              )}
            </svg>
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-2 py-4 space-y-1.5 overflow-y-auto">
        {links.map((link) => {
          const isActive =
            pathname === link.href || pathname.startsWith(`${link.href}/`);

          return (
            <Link
              key={link.href}
              href={link.href}
              prefetch
              onFocus={() => router.prefetch(link.href)}
              onMouseEnter={() => router.prefetch(link.href)}
              title={collapsed ? link.label : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-0" : ""
              } ${
                isActive
                  ? "bg-orange-600 text-white"
                  : "text-gray-300 hover:text-white hover:bg-gray-800"
              }`}
            >
              {link.icon}
              {!collapsed && <span>{link.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User Section */}
      <div className="p-3 border-t border-gray-800">
        {!collapsed ? (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{userName}</p>
                <p className="truncate text-xs text-gray-400">{userEmail}</p>
              </div>
              <PageRefreshButton />
            </div>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="mt-3 flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              <span>Sign out</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div
              title={`${userName} (${userEmail})`}
              className="w-8 h-8 rounded-full bg-orange-600 text-white font-bold text-xs flex items-center justify-center"
            >
              {userInitial}
            </div>
            <PageRefreshButton />
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              title="Sign out"
              className="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
