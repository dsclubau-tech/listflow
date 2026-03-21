import { useState, useCallback } from "react";

interface ToastState {
  message: string;
  variant: "success" | "error";
  visible: boolean;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState>({
    message: "",
    variant: "success",
    visible: false,
  });

  const showToast = useCallback(
    (message: string, variant: "success" | "error") => {
      setToast({ message, variant, visible: true });
    },
    []
  );

  const hideToast = useCallback(() => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  return { toast, showToast, hideToast };
}
