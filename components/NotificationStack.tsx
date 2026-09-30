import type { ReactNode, Ref } from "react";

export default function NotificationStack({ children, ref }: { children?: ReactNode; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3" aria-label="Notifications">
      {children}
    </div>
  );
}
