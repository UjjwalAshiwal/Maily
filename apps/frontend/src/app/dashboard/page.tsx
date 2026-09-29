"use client";

import { redirect } from "next/navigation";

// The Figma mail-client layout opens on the Scheduled list; sender and
// integration management live under /dashboard/settings.
export default function DashboardPage() {
  redirect("/dashboard/scheduled");
}
