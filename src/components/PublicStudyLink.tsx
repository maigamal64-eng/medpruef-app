"use client";

import { useEffect, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { getSessionToken, getStoredSession } from '@/lib/auth';
import { authDestination, buildAuthHref, persistAuthEntry, publicStudyEntry } from '@/lib/auth-entry';
import { authFetch } from '@/lib/authFetch';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: string };
let availability: { until: number; request: Promise<boolean> } | undefined;
function trialAvailable(): Promise<boolean> {
  if (!availability || availability.until < Date.now()) availability = {
    until: Date.now() + 30_000,
    request: authFetch('/api/trial/status', { timeoutMs: 8_000, skipAuthRedirect: true })
      .then(async response => response.ok && (await response.json()).enabled === true).catch(() => false),
  };
  return availability.request;
}

/** True once the card trial is confirmed available (same cached check the trial links use). */
export function useTrialAvailable(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    void trialAvailable().then(value => { if (active) setEnabled(value); });
    return () => { active = false; };
  }, []);
  return enabled;
}

/** Marketing entry keeps the bank and intent in the URL, including in empty-storage webviews. */
export default function PublicStudyLink({ href, onClick, ...props }: Props) {
  const entry = publicStudyEntry(href);
  const [signedIn, setSignedIn] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    const user = getStoredSession()?.user;
    setSignedIn(!!user && !user.id.startsWith('guest_') && !!getSessionToken());
    if (entry.intent === 'trial') void trialAvailable().then(value => { if (active) setEnabled(value); });
    return () => { active = false; };
  }, [entry.intent]);
  if (entry.intent === 'trial' && !enabled) return null;
  return <Link {...props} href={signedIn ? authDestination(entry) : buildAuthHref(entry)} onClick={event => {
    onClick?.(event);
    if (!event.defaultPrevented) persistAuthEntry(entry);
  }} />;
}
