import { useState, useCallback } from "react";

interface ToastState {
  id: number;
  message: string;
  variant: "success" | "error";
  visible: boolean;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState>({
    id: 0,
    message: "",
    variant: "success",
    visible: false,
  });

  const showToast = useCallback(
    (message: string, variant: "success" | "error") => {
      setToast(previous => ({ id: previous.id + 1, message, variant, visible: true }));
    },
    []
  );

  const hideToast = useCallback(() => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  return { toast, showToast, hideToast };
}
