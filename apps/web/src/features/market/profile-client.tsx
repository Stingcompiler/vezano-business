"use client";

import { Button, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "saving" | "permission_denied" | "success";

interface Draft {
  public_name: string;
  category_line: string;
  categories: string[];
  service_areas: string[];
  fulfilment: string[];
}

interface Pub extends Draft {
  verified: boolean;
  badge_label: string;
  badge_note: string;
  published_at: string;
  is_published: boolean;
}

interface Profile {
  draft: Draft;
  public: Pub;
  can_edit: boolean;
  role_name: string;
  portal_slug: string;
  seller_verified: boolean;
  not_published: string[];
}

const join = (xs: string[]) => xs.join(" · ");

/** MP-09 — إدارة صفحة المنشأة: المعاينة العامة هي الحقيقة (29-D22 ready/permission_denied · 43-D35 validation_error/saving/success). */
export function MarketProfileClient() {
  const router = useRouter();
  const app = useApp();
  const [p, setP] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [line, setLine] = useState("");
  const [cats, setCats] = useState("");
  const [areas, setAreas] = useState("");
  const [ful, setFul] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [areasError, setAreasError] = useState(false);
  const [preview, setPreview] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const apply = useCallback((prof: Profile) => {
    setP(prof);
    setName(prof.draft.public_name);
    setLine(prof.draft.category_line);
    setCats(join(prof.draft.categories));
    setAreas(join(prof.draft.service_areas));
    setFul(join(prof.draft.fulfilment));
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Fprofile");
      return;
    }
    void api()
      .GET("/api/market/profile")
      .then(({ data, response }) => {
        const body = data as unknown as { profile: Profile } | undefined;
        if (response.ok && body) apply(body.profile);
      })
      .catch(() => undefined);
  }, [router, apply]);

  const save = async (publish: boolean) => {
    if (saving || !p) return;
    setSaved(false);
    setAreasError(false);
    if (publish && !areas.trim()) {
      setAreasError(true);
      return;
    }
    setSaving(true);
    try {
      const { data, response } = await api().PUT("/api/market/profile", {
        body: {
          public_name: name,
          category_line: line,
          categories: cats,
          service_areas: areas,
          fulfilment: ful,
          publish,
        } as never,
      });
      if (response.status === 400) {
        setAreasError(true);
        return;
      }
      const body = data as unknown as { profile: Profile } | undefined;
      if (response.ok && body) {
        apply(body.profile);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const state: State =
    p && !p.can_edit
      ? "permission_denied"
      : saving
        ? "saving"
        : areasError
          ? "validation_error"
          : saved
            ? "success"
            : "ready";
  const pub = p?.public;

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-profile" />} footer={null}>
      <div className="sys mp" data-screen="MP-09" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">إدارة صفحة المنشأة — المعاينة العامة هي الحقيقة</h2>
            <span className="cat-head__hint">
              البائع يرى صفحته كما يراها الغريب تماماً، بما فيه حدود الشارة. ومناطق الخدمة وطرق
              التنفيذ تُعلَن هنا لأن المشتري يبني عليها قراره.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" && p ? (
              <Notice kind="locked" title="تحرير الصفحة للمالك">
                <p className="acc-lead">
                  مدير الفرع يحرّر عروضاً ولا يحرّر هوية المنشأة العامة. الاسم والشارة والمناطق
                  تمثّل المنشأة كلها، فتحريرها للمالك.
                </p>
              </Notice>
            ) : null}
            {state === "saving" ? (
              <Notice kind="info" title="جارٍ الحفظ">
                <p className="acc-lead">الحفظ للمسودة — والمنشور لا يتغيّر حتى يكتمل.</p>
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice kind="error" title="مناطق خدمة فارغة">
                <p className="acc-lead">
                  ملفٌ بلا منطقة خدمة لا يظهر في أي دليل — والناشر يظن نفسه منشوراً.
                </p>
                <p className="acc-choice__note">
                  <strong>الأثر لا الحقل</strong> · «بلا منطقة لن تظهر في نتائج أحد» — نسمّي العاقبة
                  لا «حقل مطلوب». الحقل الإلزامي بلا سبب يُملأ عبثاً.
                </p>
              </Notice>
            ) : null}
            {state === "success" ? (
              <Notice
                kind="success"
                title="حُفظت الصفحة"
                action={
                  <Button pos onClick={() => setPreview((v) => !v)}>
                    عاين كما يراها الزائر
                  </Button>
                }
              >
                <p className="acc-lead">
                  {pub?.is_published
                    ? "نُشرت الصفحة كما في المعاينة."
                    : "حُفظت مسوّدة — المنشور لا يتغيّر حتى تنشر."}{" "}
                  المعاينة بلا صلاحياتك وأسعارك الخاصة.
                </p>
                <p className="acc-choice__note">
                  <strong>الحقول المصرّح بها فقط</strong> · ما يُنشر قائمة معلنة: الهوية والمناطق
                  وطرق التنفيذ. العنوان التفصيلي والأرقام الداخلية لا تُنشر ولو مُلئت.
                </p>
              </Notice>
            ) : null}

            {pub ? (
              <div className="mp-preview" aria-label="المعاينة العامة">
                <div className="acc-choice__head">
                  <strong>المعاينة العامة</strong>
                  <span className="acc-choice__note">كما يراها أي مشترٍ</span>
                </div>
                {pub.is_published ? (
                  <>
                    <h3 className="cat-head__title">{pub.public_name}</h3>
                    <div className="cus-sub">{pub.category_line}</div>
                    {pub.verified ? (
                      <div>
                        <Status state="success" label={pub.badge_label} />
                        <div className="acc-choice__note">
                          {pub.badge_note} هذا النص يظهر للمشتري دائماً ولا يستطيع البائع إخفاءه.
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <div className="mp-check__hint">الفئات التي تخدمها</div>
                      <div>{join(pub.categories)}</div>
                    </div>
                    <div>
                      <div className="mp-check__hint">مناطق الخدمة</div>
                      <div>{join(pub.service_areas)}</div>
                    </div>
                    <div>
                      <div className="mp-check__hint">طرق التنفيذ</div>
                      <div>{join(pub.fulfilment)}</div>
                    </div>
                  </>
                ) : (
                  <p className="acc-choice__note">
                    لم تُنشر الصفحة بعد — الزائر لا يرى شيئاً حتى تنشر.
                  </p>
                )}
                <p className="acc-choice__note">
                  <strong>ما لا يظهر هنا</strong> · العنوان التفصيلي والهاتف — يُعطيهما البائع في
                  الطلب لا في الدليل
                </p>
              </div>
            ) : null}

            {p && p.can_edit && !preview ? (
              <>
                <h3 className="cat-head__title">تحرير الصفحة</h3>
                <TextField
                  label="اسم المنشأة العام"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <TextField
                  label="سطر النشاط"
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  hint="مثال: جملة مواد غذائية"
                />
                <TextField
                  label="الفئات التي تخدمها"
                  value={cats}
                  onChange={(e) => setCats(e.target.value)}
                  hint="افصل بـ «·» — سكر · شاي · زيوت · دقيق"
                />
                <TextField
                  label="مناطق الخدمة"
                  value={areas}
                  onChange={(e) => setAreas(e.target.value)}
                  hint="افصل بـ «·» — الخرطوم بحري · الخرطوم"
                  error={
                    areasError
                      ? "بلا منطقة لن تظهر في نتائج أحد — اكتب منطقة واحدة على الأقل."
                      : undefined
                  }
                />
                <TextField
                  label="طرق التنفيذ وشروطها"
                  value={ful}
                  onChange={(e) => setFul(e.target.value)}
                  hint="افصل بـ «·» — توصيل بحدّ أدنى 50,000 SDG · استلام من المخزن بموعد"
                />
                <div className="acc-actions">
                  <Button pos onClick={() => void save(true)} loading={saving}>
                    انشر الصفحة
                  </Button>
                  <Button onClick={() => void save(false)} loading={saving}>
                    احفظ مسوّدة
                  </Button>
                </div>
              </>
            ) : null}
            {preview ? (
              <div className="acc-actions">
                <Button onClick={() => setPreview(false)}>عودة إلى التحرير</Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
