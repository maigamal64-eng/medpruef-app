"use client";
import { useEffect, useRef } from "react";
import LanguagePicker from "./LanguagePicker";
import { renderLang, useLang } from "@/lib/i18n";

/** Compatibility adapter: one native picker owns explicit preference writes. */
export default function LanguageToggle({ onChange }: { lang: "de" | "en"; onChange: (lang: "de" | "en") => void }) {
  const language = useLang();
  const callback = useRef(onChange);
  callback.current = onChange;
  useEffect(() => { callback.current(renderLang(language)); }, [language]);
  return <LanguagePicker onChange={onChange} />;
}
