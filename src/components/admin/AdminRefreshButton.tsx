"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function AdminRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return <button
    type="button"
    disabled={pending}
    onClick={() => startTransition(() => router.refresh())}
    className="seal-button seal-button--lit px-4 py-2 text-sm"
  >
    {pending ? "刷新中…" : "刷新当前视图"}
  </button>;
}
