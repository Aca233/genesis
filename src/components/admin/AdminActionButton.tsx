"use client";

import { AdminActionPanel, type AdminActionPanelProps } from "./AdminActionPanel";

export function AdminActionButton(props: AdminActionPanelProps) {
  return <AdminActionPanel {...props} />;
}
