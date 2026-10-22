"use client";

/**
 * a-v2-copy-surfaces-1021: hands the server's half_year readiness to client
 * pages (FAQ, terms) whose layout is a server component. halfYearReady()
 * reads server-only env, so a browser bundle would always see false. The
 * layout reads it at render (pages are built at deploy, so a flag flip ships
 * with the redeploy) and wraps its children; outside a provider the value is
 * false, the safe side (never name a plan checkout cannot sell).
 */
import { createContext, useContext, type ReactNode } from "react";

const HalfYearReadyContext = createContext(false);

export function HalfYearReadyProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <HalfYearReadyContext.Provider value={value}>{children}</HalfYearReadyContext.Provider>;
}

export function useHalfYearReady(): boolean {
  return useContext(HalfYearReadyContext);
}
