"use client";

/**
 * جلسة المشغّل في الذاكرة فقط (PLT-01): حساب من نوع آخر، إطار منفصل عن تطبيق المتاجر؛ لا تُحفظ في
 * المتصفح — إعادة التحميل تعيد إلى الدخول (كل جلسة مقيّدة بمدّة وتُسجَّل).
 */
import { type ContractsClient, createContractsClient } from "@sting/contracts";

import { apiBaseUrl } from "@/lib/api";

let token: string | null = null;
let name = "";
// 0005 §١١٨ — «الدعم» يقرأ ولا يغيّر؛ الخادم يفرض والواجهة تُعلن
// غياب الدور في الاستجابة (خادم أقدم) يُعرض «مديراً» — الوسم للإعلان فقط والفرض على الخادم
let role: "admin" | "support" = "admin";
let client: ContractsClient | null = null;

export function setOperatorSession(
  access: string,
  displayName: string,
  operatorRole: "admin" | "support" = "admin",
): void {
  token = access;
  name = displayName;
  role = operatorRole;
}

export function clearOperatorSession(): void {
  token = null;
  name = "";
  role = "admin";
}

export function operatorRole(): "admin" | "support" {
  return role;
}

export function operatorToken(): string | null {
  return token;
}

export function operatorName(): string {
  return name;
}

export function platformApi(): ContractsClient {
  if (!client)
    client = createContractsClient({ baseUrl: apiBaseUrl(), getAccessToken: () => token });
  return client;
}
