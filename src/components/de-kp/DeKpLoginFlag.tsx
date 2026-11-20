"use client";
/**
 * The Germany flag as the sign-in page sees it (a-dekp-walkfix2-1120). The server layout of /login
 * reads DE_KP_ENABLED and hands it down; the page shows the Germany sign-in line only while it is on,
 * so with the flag off a crafted next link shows the Austrian lines exactly as before.
 */
import { createContext, useContext, type ReactNode } from "react";

const Flag = createContext(false);

export function DeKpLoginFlag({ on, children }: { on: boolean; children: ReactNode }) {
  return <Flag.Provider value={on}>{children}</Flag.Provider>;
}

export function useDeKpLoginOn(): boolean { return useContext(Flag); }
