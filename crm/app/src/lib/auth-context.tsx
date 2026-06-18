"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { Role, Sociedad } from "@/lib/types";

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
  // Multi-sociedad
  sociedades: Sociedad[];
  sociedadActiva: Sociedad | null;
  setSociedadActiva: (s: Sociedad) => void;
}

const UserContext = createContext<UserContextValue>({
  profile: null,
  role: "viewer",
  loading: true,
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  mobileSidebarOpen: false,
  setMobileSidebarOpen: () => {},
  sociedades: [],
  sociedadActiva: null,
  setSociedadActiva: () => {},
});

export function useUser() {
  return useContext(UserContext);
}

const SOCIEDAD_STORAGE_KEY = "lazzari_sociedad_activa";

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sociedades, setSociedades] = useState<Sociedad[]>([]);
  const [sociedadActiva, setSociedadActivaState] = useState<Sociedad | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const setSociedadActiva = useCallback((s: Sociedad) => {
    setSociedadActivaState(s);
    try {
      localStorage.setItem(SOCIEDAD_STORAGE_KEY, s.id);
    } catch {}
  }, []);

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

  const fetchSociedades = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("sociedades")
        .select("id, nombre, cuit, razon_social, condicion_iva, color_primario, activo")
        .eq("activo", true)
        .order("nombre");

      if (!error && data && data.length > 0) {
        const mapped: Sociedad[] = data.map((s: Record<string, unknown>) => ({
          id: s.id as string,
          nombre: s.nombre as string,
          cuit: s.cuit as string,
          razonSocial: s.razon_social as string,
          condicionIva: s.condicion_iva as string,
          colorPrimario: (s.color_primario as string) || "#FF4500",
          activo: s.activo as boolean,
        }));
        setSociedades(mapped);

        // Restore from localStorage or default to first
        let savedId: string | null = null;
        try {
          savedId = localStorage.getItem(SOCIEDAD_STORAGE_KEY);
        } catch {}
        const saved = savedId ? mapped.find((s) => s.id === savedId) : null;
        setSociedadActivaState(saved || mapped[0]);
      }
    } catch {
      // Will work without sociedades
    }
  }, [supabase]);

  useEffect(() => {
    fetchProfile();
    fetchSociedades();
  }, [fetchProfile, fetchSociedades]);

  const role = profile?.role ?? "viewer";

  return (
    <UserContext.Provider
      value={{
        profile,
        role,
        loading,
        sidebarCollapsed,
        setSidebarCollapsed,
        mobileSidebarOpen,
        setMobileSidebarOpen,
        sociedades,
        sociedadActiva,
        setSociedadActiva,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}
