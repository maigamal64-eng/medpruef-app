'use client';
import { useSyncExternalStore } from 'react';
let active = false;
const listeners = new Set<() => void>();
export function setFocusMode(value: boolean) { active = value; listeners.forEach(listener => listener()); }
export function useFocusMode() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => active, () => false); }
