"use client";

/**
 * سياق الواجهة (§٤.٥): اللغة والمظهر والمستخدم والفرع وإعدادات واجهة قليلة — Context لا Redux.
 * المسودات والمعلّق والإسقاطات في التخزين المحلي (@sting/platform + @sting/sync-core) لا هنا.
 */
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export interface AppSession {
  readonly userId: string | null;
  readonly tenantId: string | null;
  readonly branchId: string | null;
  readonly deviceId: string | null;
  readonly displayName: string | null;
}

export interface AppContextValue {
  readonly locale: "ar";
  readonly session: AppSession;
  readonly setSession: (s: AppSession) => void;
}

const EMPTY: AppSession = {
  userId: null,
  tenantId: null,
  branchId: null,
  deviceId: null,
  displayName: null,
};
const Ctx = createContext<AppContextValue | null>(null);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AppSession>(EMPTY);
  const value = useMemo<AppContextValue>(() => ({ locale: "ar", session, setSession }), [session]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp خارج AppContextProvider");
  return v;
}
