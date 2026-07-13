"use client";

import { useRouter } from "next/navigation";

type PageLoadErrorStateProps = {
  title: string;
  message: string;
};

export default function PageLoadErrorState({
  title,
  message,
}: PageLoadErrorStateProps) {
  const router = useRouter();

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      <p className="mt-2 text-sm text-red-800">{message}</p>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
      >
        Retry
      </button>
    </section>
  );
}
