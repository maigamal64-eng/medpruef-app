'use client';
import { useEffect, useState } from 'react';
import Script from 'next/script';
export default function TelegramSdkLoader() {
  const [needed, setNeeded] = useState(false);
  useEffect(() => { setNeeded(/tgWebAppData=/.test(window.location.hash) || /Telegram/i.test(navigator.userAgent)); }, []);
  return needed ? <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onLoad={() => window.dispatchEvent(new Event('medpruef:telegram-ready'))} /> : null;
}
