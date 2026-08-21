import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import ClientErrorMonitor from "@/components/ClientErrorMonitor";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0d47a1",
};

export const metadata: Metadata = {
  title: "ListFlow — eBay Listing Tool",
  description: "Internal tool for managing and uploading products to eBay stores",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ClientErrorMonitor />
        <AppErrorBoundary>
          <Suspense fallback={null}>{children}</Suspense>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
