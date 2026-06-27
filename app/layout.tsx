import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Suspense } from "react";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import ClientErrorMonitor from "@/components/ClientErrorMonitor";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

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
      <body className={`${geistSans.variable} antialiased`}>
        <ClientErrorMonitor />
        <AppErrorBoundary>
          <Suspense fallback={null}>{children}</Suspense>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
