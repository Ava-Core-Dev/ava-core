"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Legacy /goals/:id → /goals/view?id=… for static Pages hosting. */
export default function LegacyGoalRedirect() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || "");
  useEffect(() => {
    if (id) router.replace(`/goals/view?id=${encodeURIComponent(id)}`);
  }, [id, router]);
  return <p>Opening goal…</p>;
}
