"use client";

import { useEffect } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { AIWidget } from "@/components/layout/ai-widget";
import { UserProvider, useUser } from "@/lib/auth-context";
import { ToastProvider } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function CRMContent({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useUser();

  // Auto-select number inputs on focus so the "0" can be overwritten immediately
  useEffect(() => {
    const handler = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.type === "number") {
        el.select();
      }
    };
    document.addEventListener("focusin", handler);
    return () => document.removeEventListener("focusin", handler);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden animate-fade-in"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <Sidebar />
      <main
        data-collapsed={sidebarCollapsed}
        className={cn(
          "dn-main transition-all duration-200",
          sidebarCollapsed ? "lg:ml-[68px]" : "lg:ml-[250px]"
        )}
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
      <ToastProvider>
        <CRMContent>{children}</CRMContent>
      </ToastProvider>
    </UserProvider>
  );
}
