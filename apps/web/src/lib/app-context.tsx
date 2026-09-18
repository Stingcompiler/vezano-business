"use client";

/**
 * سياق الواجهة (§٤.٥): اللغة والمظهر والمستخدم والفرع وإعدادات واجهة قليلة — Context لا Redux.
 * المسودات والمعلّق والإسقاطات في التخزين المحلي (@sting/platform + @sting/sync-core) لا هنا.
 * رموز الجلسة في الذاكرة فقط (§٩.٤: لا localStorage لرمز التجديد)؛ Cookies الخادم لاحقاً.
 */
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

import { setAccessToken, setDeviceRefresh } from "@/lib/api";

export interface AppSession {
  readonly userId: string | null;
  readonly tenantId: string | null;
  readonly branchId: string | null;
  readonly deviceId: string | null;
  readonly displayName: string | null;
}

export interface AuthTokens {
  readonly access: string;
  readonly refresh: string;
  readonly sessionId: string;
}

export interface MembershipOption {
  readonly user_id: string;
  readonly tenant_id: string;
  readonly tenant_name: string;
  readonly is_owner: boolean;
}

/** ما بين ACC-02 وACC-03: تذكرة الاختيار وقائمة العضويات — تعيش في الذاكرة حتى الاختيار. */
export interface PendingSelection {
  readonly ticket: string;
  readonly memberships: readonly MembershipOption[];
}

/** جلسة نقل الجهاز (§٩.٤: هوية مختلفة عن جلسة المستخدم) — في الذاكرة فقط. */
export interface DeviceTokens {
  readonly deviceId: string;
  readonly prefix: string;
  readonly branchId: string;
  readonly access: string;
  readonly refresh: string;
}

export interface AppContextValue {
  readonly locale: "ar";
  readonly session: AppSession;
  readonly setSession: (s: AppSession) => void;
  readonly tokens: AuthTokens | null;
  readonly setTokens: (t: AuthTokens | null) => void;
  readonly selection: PendingSelection | null;
  readonly setSelection: (s: PendingSelection | null) => void;
  readonly device: DeviceTokens | null;
  readonly setDevice: (d: DeviceTokens | null) => void;
  /** الجلسة انتهت أو أُبطلت (401): الشاشات لا تعيد التوجيه إلى الدخول — ACC-08 يتولى ذلك. */
  readonly expired: boolean;
  readonly markExpired: () => void;
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
  const [tokens, setTokensState] = useState<AuthTokens | null>(null);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [device, setDevice] = useState<DeviceTokens | null>(null);
  const [expired, setExpired] = useState(false);
  const value = useMemo<AppContextValue>(
    () => ({
      locale: "ar",
      session,
      setSession,
      tokens,
      setTokens: (t) => {
        setAccessToken(t?.access ?? null);
        setTokensState(t);
        if (t) setExpired(false);
      },
      selection,
      setSelection,
      device,
      setDevice: (d) => {
        setDeviceRefresh(d?.refresh ?? null);
        setDevice(d);
      },
      expired,
      markExpired: () => {
        setAccessToken(null);
        setTokensState(null);
        setExpired(true);
      },
    }),
    [session, tokens, selection, device, expired],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp خارج AppContextProvider");
  return v;
}
