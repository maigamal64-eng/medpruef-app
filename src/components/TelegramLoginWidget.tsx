"use client";
import { useEffect, useRef } from "react";

export interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface Props {
  /** Bot username without the leading @ (e.g. "MedPruefBot"). Must match the bot whose domain has been set via BotFather /setdomain. */
  botName: string;
  onAuth: (user: TelegramWidgetUser) => void;
  buttonSize?: "large" | "medium" | "small";
  cornerRadius?: number;
  requestAccess?: boolean;
  /** Extra classes for the container div (not the iframe itself). */
  className?: string;
}

/**
 * Wraps the official Telegram Login Widget (https://core.telegram.org/widgets/login).
 *
 * IMPORTANT: The widget iframe will ONLY render on the domain configured via
 * @BotFather /setdomain. It will silently fail on Vercel preview URLs and on
 * bare localhost — use a tunnel or test in production.
 */
export default function TelegramLoginWidget({
  botName,
  onAuth,
  buttonSize = "large",
  cornerRadius = 8,
  requestAccess = false,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep latest onAuth reachable from a stable global function so the widget
  // never captures a stale closure.
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Generate a unique callback name so multiple widgets can coexist.
    const cbName = `onTelegramAuth_${botName}_${Math.random().toString(36).slice(2, 8)}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)[cbName] = (user: TelegramWidgetUser) => {
      try { onAuthRef.current(user); } catch (e) { console.error("TelegramLoginWidget onAuth failed", e); }
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", buttonSize);
    script.setAttribute("data-radius", String(cornerRadius));
    script.setAttribute("data-onauth", `${cbName}(user)`);
    if (requestAccess) script.setAttribute("data-request-access", "write");
    container.appendChild(script);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any)[cbName];
      // Remove the script and any rendered iframe
      while (container.firstChild) container.removeChild(container.firstChild);
    };
  }, [botName, buttonSize, cornerRadius, requestAccess]);

  return <div ref={containerRef} className={className} />;
}
