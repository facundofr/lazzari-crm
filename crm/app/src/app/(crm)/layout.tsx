"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { AIWidget } from "@/components/layout/ai-widget";
import { UserProvider, useUser } from "@/lib/auth-context";

function CRMContent({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useUser();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Sidebar />
      <main
        className="transition-all duration-200"
        style={{ marginLeft: sidebarCollapsed ? 68 : 250 }}
      >
        {children}
      </main>
      <AIWidget />
    </div>
  );
}

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
      <CRMContent>{children}</CRMContent>
    </UserProvider>
  );
}
