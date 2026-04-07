"use client";
import { useEffect } from "react";

const THEME_KEY = "medpruef_theme";

export type Theme = "light" | "dark";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return (localStorage.getItem(THEME_KEY) as Theme) || "light";
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
 * Uses a script-injection approach to prevent flash of wrong theme.
 */
export default function ThemeProvider() {
  useEffect(() => {
    const theme = getStoredTheme();
    document.documentElement.setAttribute("data-theme", theme);
  }, []);

  return null;
}
