"use client";

import { createContext, useContext, useState, useEffect } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  /** Diseño nuevo (Augusto 30/10): lo prende él en Configuración y vale para todos (/api/diseno-nuevo).
   *  La compu recuerda el último valor para que no parpadee al abrir. */
  disenoNuevo: boolean;
  setDisenoNuevo: (v: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
  disenoNuevo: false,
  setDisenoNuevo: () => {},
});

const DISENO_NUEVO_KEY = "lazzari-diseno-nuevo";
const FUENTE_DISENO_NUEVO = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap";

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);
  const [disenoNuevo, setDisenoNuevo] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("lazzari-theme") as Theme | null;
    if (stored === "dark" || stored === "light") {
      setTheme(stored);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
    setDisenoNuevo(localStorage.getItem(DISENO_NUEVO_KEY) === "1");
    setMounted(true);
    // Sin sesión (login) da 401 y queda lo que recordaba la compu.
    fetch("/api/diseno-nuevo").then((r) => (r.ok ? r.json() : null))
      .then((d: { todos: boolean } | null) => { if (d) setDisenoNuevo(d.todos); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle("diseno-nuevo", disenoNuevo);
    localStorage.setItem(DISENO_NUEVO_KEY, disenoNuevo ? "1" : "0");
    // La letra del diseño nuevo se baja solo si está prendido.
    if (disenoNuevo && !document.getElementById("fuente-diseno-nuevo")) {
      const link = document.createElement("link");
      link.id = "fuente-diseno-nuevo";
      link.rel = "stylesheet";
      link.href = FUENTE_DISENO_NUEVO;
      document.head.appendChild(link);
    }
  }, [disenoNuevo, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("lazzari-theme", theme);
  }, [theme, mounted]);

  function toggleTheme() {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, disenoNuevo, setDisenoNuevo }}>
      {children}
    </ThemeContext.Provider>
  );
}
