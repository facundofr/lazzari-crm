"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { Role } from "@/lib/types";

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: Role;
  avatar_url: string | null;
  active: boolean;
}

interface UserContextValue {
  profile: Profile | null;
  role: Role;
  loading: boolean;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (v: boolean) => void;
}

const UserContext = createContext<UserContextValue>({
  profile: null,
  role: "viewer",
  loading: true,
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  mobileSidebarOpen: false,
  setMobileSidebarOpen: () => {},
});

export function useUser() {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const fetchProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, avatar_url, active")
        .eq("id", user.id)
        .single();

      if (data) {
        setProfile(data as Profile);
      } else {
        // Fallback: create a minimal profile from auth user
        setProfile({
          id: user.id,
          full_name: user.email?.split("@")[0] ?? null,
          email: user.email ?? null,
          role: "viewer",
          avatar_url: null,
          active: true,
        });
      }
    } catch {
      // Keep profile null on error
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const role = profile?.role ?? "viewer";

  return (
    <UserContext.Provider value={{ profile, role, loading, sidebarCollapsed, setSidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen }}>
      {children}
    </UserContext.Provider>
  );
}
