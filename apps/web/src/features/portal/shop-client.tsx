"use client";

import { Button, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./portal.css";
import { dayMonth } from "@/features/home/format";
import { api } from "@/lib/api";

type State = "loading" | "ready" | "empty" | "expired";

export interface Announcement {
  id: string;
  title: string;
  message: string;
  sent_at: string;
  valid_until: string;
  expired: boolean;
}

export interface ShopPage {
  shop: { name: string; address: string; hours: string; slug: string };
  announcements: Announcement[];
  link_state: "" | "expired";
  push_public_key: string;
}

const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** «أمس» / «قبل 4 أيام» / «اليوم» — بالأيام التقويمية المحلية لا بـ24 ساعة (قبل منتصف الليل «أمس 22:00» أمسٌ لا «اليوم») */
export function whenWord(iso: string): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const n = Math.max(0, Math.round((startOf(new Date()) - startOf(new Date(iso))) / 86_400_000));
  if (n === 0) return "اليوم";
  if (n === 1) return "أمس";
  if (n === 2) return "قبل يومين";
  return `قبل ${n} أيام`;
}

/** «سارٍ حتى الجمعة» ضمن الأسبوع، وإلا بالتاريخ */
export function validWord(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days >= 0 && days < 7) return `سارٍ حتى ${WEEKDAYS[d.getDay()]}`;
  const { day, month } = dayMonth(d.toISOString());
  return `سارٍ حتى ${day} ${month}`;
}

/** CUS-01 — صفحة محل عبر رابط أو QR (21-D16 ready · 37-D29 loading/empty/expired). */
export function ShopClient({ slug, campaign }: { slug: string; campaign: string }) {
  const router = useRouter();
  const [page, setPage] = useState<ShopPage | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .GET("/api/portal/{slug}", {
        params: { path: { slug }, query: campaign ? { c: campaign } : {} },
      })
      .then(({ data, response }) => {
        if (cancelled) return;
        if (response.status === 404) {
          // رابط محل آخر أو لا وجود له يعطي الرسالة نفسها (PUB-04)
          router.replace("/link-expired");
          return;
        }
        const body = data as unknown as ShopPage | undefined;
        if (response.ok && body) setPage(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, campaign, router]);

  const state: State = !page
    ? "loading"
    : page.link_state === "expired"
      ? "expired"
      : page.announcements.length
        ? "ready"
        : "empty";
  const follow = () => router.push(`/portal/${slug}/subscribe`);

  return (
    <Frame title={page?.shop.name ?? "Sting"} footer={null}>
      <div className="sys cus" data-screen="CUS-01" data-state={state}>
        {state === "loading" ? (
          <div className="cat-table pos-card">
            <div className="acc-card__body">
              <Notice kind="info" title="جارٍ الفتح">
                <p className="acc-lead">
                  صفحةٌ خفيفة تُفتح في ثانية على شبكة بطيئة. لا خطوط ثقيلة ولا صور كبيرة قبل
                  المحتوى.
                </p>
              </Notice>
              <div className="cus-skeleton" />
              <div className="cus-skeleton" />
            </div>
          </div>
        ) : null}

        {page ? (
          <>
            {state === "expired" ? (
              <Notice
                kind="warning"
                title="الرابط منتهٍ"
                action={<Button onClick={follow}>تابع المحل</Button>}
              >
                <p className="acc-lead">
                  هذا العرض انتهى — هذه صفحة المحل. رابط مؤقت لعرضٍ انتهى أو حملةٍ مضت.
                </p>
                <p className="acc-choice__note">
                  <strong>لا نترك بابًا مغلقاً</strong> · نُحوّل إلى صفحة المحل الدائمة. الزبون جاء
                  مهتمّاً، فلا نطرده.
                </p>
              </Notice>
            ) : null}

            <div className="cat-table pos-card">
              <div className="acc-card__body cus-head">
                <h1>{page.shop.name}</h1>
                <div className="cus-sub">صفحة المحل · فُتحت برابط أو QR</div>
                <div className="acc-actions">
                  <Button pos onClick={follow}>
                    {state === "empty" ? "تابعنا لتصلك العروض" : "تابع المحل"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="cat-table pos-card">
              <div className="cat-head">
                <h2 className="cat-head__title">ساعات العمل والموقع</h2>
                <span className="cat-head__hint">ما نشره التاجر بنفسه ولا شيء سواه</span>
              </div>
              <div className="acc-card__body cus-facts">
                {page.shop.hours ? <div>ساعات العمل: {page.shop.hours}</div> : null}
                {page.shop.address ? <div>الموقع: {page.shop.address}</div> : null}
                {!page.shop.hours && !page.shop.address ? (
                  <div className="acc-choice__note">لم ينشر المحل ساعاته وموقعه بعد.</div>
                ) : null}
              </div>
            </div>

            <div className="cat-table pos-card">
              <div className="cat-head">
                <h2 className="cat-head__title">آخر إعلانات المحل</h2>
                <span className="cat-head__hint">
                  {state === "empty" ? "المحل لم ينشر شيئاً" : "ثلاثة منشورات بتواريخها"}
                </span>
              </div>
              <div className="acc-card__body">
                {state === "empty" ? (
                  <Notice kind="empty" title="المحل لم ينشر شيئاً">
                    <p className="acc-lead">الصفحة قائمة والمحل لم يضع رسائل ولا عروضاً.</p>
                    <p className="acc-choice__note">
                      <strong>لا صفحة فارغة</strong> · نعرض ما يعرفه المحل عن نفسه: الاسم والعنوان
                      وساعات العمل. ثم «تابعنا لتصلك العروض» — وهي نقطة القيمة.
                    </p>
                  </Notice>
                ) : (
                  <ul className="cus-list">
                    {page.announcements.map((a) => (
                      <li key={a.id} className={a.expired ? "cus-item--expired" : undefined}>
                        <div>
                          <strong>{a.title}</strong>{" "}
                          {a.expired ? <Status state="expired" label="انتهى" /> : null}
                        </div>
                        <div className="cus-sub">
                          من {page.shop.name} · {whenWord(a.sent_at)}
                          {a.valid_until && !a.expired ? ` · ${validWord(a.valid_until)}` : ""}
                        </div>
                        <div>{a.message}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <p className="acc-choice__note">
              <strong>لا أسعار ولا مخزون</strong> · إلا ما اختار التاجر نشره صراحة. لا تسجيل دخول
              ولا ملف زبون. الصفحة محتوى منشور، والزبون زائر لا مستخدم في دفتر التاجر.
            </p>
          </>
        ) : null}
      </div>
    </Frame>
  );
}
