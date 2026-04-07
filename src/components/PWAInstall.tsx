"use client";
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Registers the service worker on mount and shows an "Install App" banner
 * when the browser supports PWA installation.
 */
export default function PWAInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // Capture the install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      // Don't show if user previously dismissed
      if (!localStorage.getItem("medpruef_pwa_dismissed")) {
        setShowBanner(true);
      }
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") {
      setShowBanner(false);
    }
    setInstallPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setDismissed(true);
    localStorage.setItem("medpruef_pwa_dismissed", "1");
  };

  if (!showBanner || dismissed) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:w-80 z-40 animate-slide-up">
      <div className="card rounded-2xl p-4 shadow-[var(--shadow-elevated)] border border-[#007B5F]/20 bg-white">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#007B5F]/10 flex items-center justify-center flex-shrink-0">
            <Download className="w-5 h-5 text-[#007B5F]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1A2B3C] mb-0.5">Install MedPrüf</p>
            <p className="text-xs text-[#A0AEC0] mb-3">Study offline — on the bus, metro, anywhere.</p>
            <div className="flex gap-2">
              <button onClick={handleInstall} className="btn-primary text-xs px-3 py-1.5">
                Install
              </button>
              <button onClick={handleDismiss} className="text-xs text-[#A0AEC0] hover:text-[#4A5568]">
                Not now
              </button>
            </div>
          </div>
          <button onClick={handleDismiss} className="text-[#A0AEC0] hover:text-[#4A5568]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
