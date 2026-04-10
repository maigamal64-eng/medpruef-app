"use client";
import { useEffect } from "react";

const THEME_KEY = "medpruef_theme";

export type Theme = "light" | "dark";

/** Returns true if user has explicitly chosen a theme */
function hasStoredTheme(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(THEME_KEY) !== null;
}

/** Detect system preference */
function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(THEME_KEY) as Theme | null;
  if (stored) return stored;
  return getSystemTheme();
}

export function setStoredTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.setAttribute("data-theme", theme);
}

export function toggleTheme(): Theme {
  const current = getStoredTheme();
  const next: Theme = current === "dark" ? "light" : "dark";
  setStoredTheme(next);
  return next;
}

/**
 * Applies the stored theme on mount. Place this in the root layout.
 * If no stored preference, follows system theme and listens for changes.
 */
export default function ThemeProvider() {
  useEffect(() => {
    const theme = getStoredTheme();
    document.documentElement.setAttribute("data-theme", theme);

    // Listen for system theme changes when user hasn't set a preference
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      if (!hasStoredTheme()) {
        const systemTheme: Theme = e.matches ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", systemTheme);
      }
    };
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  return null;
}
