import * as WebBrowser from "expo-web-browser";

/** عنوان الويب للشاشات التي لم تُبنَ على الجوال بعد (خطة الجوال §٢.٤ — الإطلاق التدريجي). */
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? "https://plus.vezano.app";

export function openOnWeb(href: string): Promise<WebBrowser.WebBrowserResult> {
  return WebBrowser.openBrowserAsync(`${WEB_URL}${href}`);
}
