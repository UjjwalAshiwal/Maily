"use client";

import { useEffect, useState } from "react";

// Tiny event-based toasts, no dependency.
export const toast = (message: string) =>
  window.dispatchEvent(new CustomEvent("maily-toast", { detail: message }));

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; message: string }[]>([]);
  useEffect(() => {
    let next = 1;
    const onToast = (e: Event) => {
      const message = (e as CustomEvent<string>).detail;
      const id = next++;
      setItems((prev) => [...prev, { id, message }]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
    };
    window.addEventListener("maily-toast", onToast);
    return () => window.removeEventListener("maily-toast", onToast);
  }, []);
  if (items.length === 0) return null;
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <p key={t.id} role="status" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          {t.message}
        </p>
      ))}
    </div>
  );
}
