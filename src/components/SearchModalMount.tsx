"use client";

/**
 * SearchModalMount — single global mount-point for the Cmd+K /
 * Ctrl+K command palette.
 *
 * Mounted once from src/app/layout.tsx. Listens for the two global
 * shortcuts and reads lang + examSource + userId from localStorage
 * each time the palette opens so state stays in sync without
 * re-renders elsewhere in the tree.
 *
 * Shortcuts:
 *   - Cmd+K (macOS) / Ctrl+K (Win/Linux) — toggles the palette from anywhere
 *   - "/" — opens the palette when no input/textarea/select is focused
 *           (vim-style; ignored while typing in any field)
 *
 * Path skips:
 *   - /landing, /login, /admin, /privacy, /terms, /impressum — palette
 *     is irrelevant (marketing/legal/admin surfaces)
 *   - "/" (home page) — already mounts its own SearchBar + SearchModal
 *     with a local Cmd+K handler. Skipping here prevents double modals.
 */
import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import SearchModal from "@/components/SearchModal";
import { getLang } from "@/lib/i18n";
import { getStoredExamSource } from "@/lib/topics";
import { getStoredSession } from "@/lib/auth";

const HIDDEN_PATHS = [
  "/landing",
  "/login",
  "/admin",
  "/privacy",
  "/terms",
  "/impressum",
];

/**
 * Paths that already mount their own SearchModal + keybinding locally.
 * Skipping here avoids two modals opening on Cmd+K. Home (/) is the
 * only one today.
 */
const PATHS_WITH_LOCAL_PALETTE = ["/"];

function isTypingContext(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export default function SearchModalMount() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [lang, setLang] = useState<"de" | "en">("de");
  const [examSource, setExamSource] = useState<string>("kenntnispruefung");
  const [userId, setUserId] = useState<string | undefined>();
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
    setLang(getLang());
    setExamSource(getStoredExamSource());
    const session = getStoredSession();
    setUserId(session?.user?.id);
  }, []);

  const refresh = useCallback(() => {
    setLang(getLang());
    setExamSource(getStoredExamSource());
    const session = getStoredSession();
    setUserId(session?.user?.id);
  }, []);

  const onHidden = HIDDEN_PATHS.some((p) => pathname?.startsWith(p));
  const hasLocalPalette = PATHS_WITH_LOCAL_PALETTE.includes(pathname || "");

  useEffect(() => {
    if (!mounted) return;
    if (onHidden) return;
    if (hasLocalPalette) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K — global toggle
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        refresh();
        setOpen((o) => !o);
        return;
      }
      // "/" — vim-style; ignored while typing
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !open &&
        !isTypingContext(document.activeElement)
      ) {
        e.preventDefault();
        refresh();
        setOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mounted, onHidden, hasLocalPalette, open, refresh]);

  if (!mounted || onHidden || hasLocalPalette) return null;

  return (
    <SearchModal
      open={open}
      onClose={() => setOpen(false)}
      lang={lang}
      examSource={examSource}
      userId={userId}
    />
  );
}
