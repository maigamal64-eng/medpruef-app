'use client';
import { useEffect, useState } from 'react';
import Script from 'next/script';
import { TG_CHECKOUT_OPENLINK_BUILD } from '@/lib/checkout-context';
import { isTelegramWebAppMarked, markTelegramWebApp } from '@/lib/checkout-context-client';
export default function TelegramSdkLoader() {
  const [needed, setNeeded] = useState(false);
  useEffect(() => {
    const miniApp = /tgWebAppData=/.test(window.location.hash);
    // a-tg-checkout-context: remember the Mini App for this tab (the hash is gone after the first navigation).
    if (miniApp) markTelegramWebApp();
    // With the openLink hand-off on, a marked tab keeps the SDK on later pages (the purchase page needs openLink).
    setNeeded(miniApp || /Telegram/i.test(navigator.userAgent) || (TG_CHECKOUT_OPENLINK_BUILD && isTelegramWebAppMarked()));
  }, []);
  return needed ? <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onLoad={() => window.dispatchEvent(new Event('medpruef:telegram-ready'))} /> : null;
}
