"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { AIWidget } from "@/components/layout/ai-widget";

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Sidebar role="admin" />
      <main className="ml-[250px] transition-all duration-200">
        {children}
      </main>
      <AIWidget />
    </div>
  );
}
