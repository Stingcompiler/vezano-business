/**
 * @sting/domain — نواة الحسابات المشتركة.
 * لا تستورد React ولا DOM ولا مشغّل منصة (§٤.٦ بند ١). المال والكميات بـ BigInt (§٦.١).
 */
export const DOMAIN_CONTRACT_VERSION = 1 as const;

export * from "./money";
