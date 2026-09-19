"use client";

import { Button, Frame, Notice, Status, TimeList } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./notify.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "empty" | "expired" | "permission_denied";
type Category = "" | "operational" | "account" | "marketing";

interface Item {
  id: string;
  kind: string;
  category: "operational" | "account" | "marketing";
  category_label: string;
  title: string;
  body: string;
  href: string;
  screen: string;
  needs_action: boolean;
  locked: boolean;
  expired: boolean;
  resolved: boolean;
  read: boolean;
  occurred_at: string;
  expires_at: string;
  link_token: string;
  link_expires_at: string;
}

interface Payload {
  items: Item[];
  needs_action: number;
  unread: number;
  category: string;
  as_of: string;
}

type OpenResult = {
  status: "ok" | "link_expired" | "expired" | "permission_denied";
  title: string;
  href: string;
  screen?: string;
};

const LAST_COUNT = "not.inbox_count";

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "أمس";
  if (diff === 2) return "قبل يومين";
  return `قبل ${diff} أيام`;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className={`pos-chip${on ? " pos-chip--on" : ""}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * NOT-01 — صندوق الوارد والتفاصيل (17-D12 ready · 36-D28 loading/empty/expired/permission_denied):
 * التشغيلي فوق التسويقي دائماً؛ مصدر الحقيقة خادمي — غير المقروء يُعلَّم بعد الوصول لا قبله؛ الرابط
 * داخل الإشعار يحمل صلاحية وبعد انتهائها نقول ذلك ونعرض الوجهة بديلاً (ACC-113)؛ الإشعار المنتهي
 * يُوسم ويُعطَّل زرّه ولا يُمحى؛ ما يخصّ المالك يظهر عنوانه ويُحجب محتواه (§١١.٥؛ ACC-110).
 */
export function InboxClient({ initialId = "" }: { initialId?: string }) {
  const router = useRouter();
  const app = useApp();
  const [category, setCategory] = useState<Category>("");
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [opened, setOpened] = useState<OpenResult | null>(null);
  const [lastCount, setLastCount] = useState(3);
  const appRef = useRef(app);
  appRef.current = app;

  const fetchInbox = useCallback(async () => {
    setFailed(false);
    try {
      const { data, response } = await api().GET("/api/notifications", {
        params: { query: category ? { category } : {} },
      });
      const body = data as unknown as Payload | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setData(body);
      try {
        localStorage.setItem(LAST_COUNT, String(body.items.length));
      } catch {
        /* بلا تخزين */
      }
    } catch {
      setFailed(true);
    }
  }, [category]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(
        `/login?next=${encodeURIComponent(initialId ? `/notify/inbox/${initialId}` : "/notify/inbox")}`,
      );
      return;
    }
    try {
      const n = Number(localStorage.getItem(LAST_COUNT) ?? "3");
      if (n > 0) setLastCount(Math.min(n, 8));
    } catch {
      /* بلا تخزين */
    }
  }, [router, initialId]);

  useEffect(() => {
    void fetchInbox();
  }, [fetchInbox]);

  // الرابط العميق: يُعاد فحص التخويل على الخادم عند الفتح (ACC-113)
  const open = useCallback(
    async (item: Item) => {
      setSelected(item);
      setOpened(null);
      if (item.locked) {
        setOpened({ status: "permission_denied", title: item.title, href: "" });
        return;
      }
      const { data, response } = await api().POST("/api/notifications/{notification_id}/{action}", {
        params: { path: { notification_id: item.id, action: "open" } },
        body: { token: item.link_token } as never,
      });
      const out = (data ??
        (response.status === 403
          ? { status: "permission_denied", title: item.title, href: "" }
          : null)) as OpenResult | null;
      setOpened(
        out ?? { status: "link_expired", title: item.title, href: item.href, screen: item.screen },
      );
      if (out?.status === "ok") void fetchInbox();
    },
    [fetchInbox],
  );

  const deepLinked = useRef(false);
  useEffect(() => {
    if (!initialId || !data || deepLinked.current) return;
    deepLinked.current = true;
    const item = data.items.find((i) => i.id === initialId);
    if (item) void open(item);
  }, [initialId, data, open]);

  const muteMarketing = async () => {
    await api().PUT("/api/notifications/preferences", {
      body: { prefs: { marketing: { in_app: false } } } as never,
    });
    void fetchInbox();
  };

  const items = data?.items ?? [];
  const state: State = selected
    ? opened?.status === "permission_denied" || (selected.locked && !opened)
      ? "permission_denied"
      : selected.expired || opened?.status === "expired"
        ? "expired"
        : "ready"
    : !data && !failed
      ? "loading"
      : items.length === 0
        ? "empty"
        : "ready";

  const byCategory = (cat: Item["category"]) => items.filter((i) => i.category === cat);
  const label: Record<Item["category"], string> = {
    operational: "تشغيلي",
    account: "حسابي",
    marketing: "تسويقي",
  };

  const entryOf = (i: Item) => ({
    id: i.id,
    at: i.occurred_at,
    atLabel: hhmm(i.occurred_at),
    title: i.title,
    detail: (
      <span>
        {dayLabel(i.occurred_at)} <span className="sting-mono">{hhmm(i.occurred_at)}</span>
        {" · "}
        {i.locked ? (
          "يخصّ المالك"
        ) : (
          <>
            {i.body}
            {i.expired ? " — انتهت صلاحيته" : i.resolved ? " — زال سببه" : ""}
          </>
        )}
      </span>
    ),
    badge: !i.read ? (
      <Status state="pending_sync" label="غير مقروء" />
    ) : i.expired ? (
      <Status state="expired" />
    ) : undefined,
  });

  return (
    <Frame title="الإشعارات" nav={<AppNav currentId="inbox" />} footer={null}>
      <div className="sys not" data-screen="NOT-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">صندوق الوارد — التشغيلي فوق التسويقي دائماً</h2>
            <span className="cat-head__hint">
              إشعار «وردية مفتوحة منذ 3 أيام» لا يقف في طابور واحد مع عرض ترقية الباقة.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-inv__filters">
              <div className="pos-chips" role="group" aria-label="النوع">
                <Chip on={category === ""} onClick={() => setCategory("")}>
                  الوارد
                </Chip>
                <Chip on={category === "operational"} onClick={() => setCategory("operational")}>
                  تشغيلي
                </Chip>
                <Chip on={category === "account"} onClick={() => setCategory("account")}>
                  حسابي
                </Chip>
                <Chip on={category === "marketing"} onClick={() => setCategory("marketing")}>
                  تسويقي
                </Chip>
              </div>
              {data ? (
                <p className="acc-choice__note">
                  <span className="sting-mono">{data.needs_action}</span> تحتاج إجراءً ·{" "}
                  <span className="sting-mono">{data.unread}</span> غير مقروء
                </p>
              ) : null}
            </div>

            {state === "loading" ? (
              <Notice kind="info" title="جلب الوارد">
                <p className="acc-lead">
                  هياكل بعدد آخر قائمة. غير المقروء يُعلَّم بعد الوصول لا قبله.
                </p>
              </Notice>
            ) : null}
            {state === "loading" ? (
              <TimeList label="الوارد" entries={[]} loading={lastCount} />
            ) : null}

            {state === "empty" ? (
              category ? (
                <Notice
                  kind="empty"
                  title="لا نتائج لهذا المرشّح"
                  action={<Button onClick={() => setCategory("")}>امسح المرشّح</Button>}
                >
                  <p className="acc-lead">
                    <strong>نفرّق</strong> · الفراغ بعد ترشيح يقول «لا نتائج لهذا المرشّح» مع زرّ
                    مسحه. الخلط بينهما يجعل المستخدم يظنّ أنه لم يصله شيء.
                  </p>
                </Notice>
              ) : (
                <Notice kind="empty" title="لا إشعارات">
                  <p className="acc-lead">صندوقٌ فارغ فعلاً لا مرشَّحٌ لا يطابق.</p>
                </Notice>
              )
            ) : null}

            {selected ? (
              <section className="not-detail" aria-label="تفاصيل الإشعار">
                <div className="cat-head">
                  <h3 className="cat-head__title">{selected.title}</h3>
                  <span className="cat-head__hint">
                    {label[selected.category]} · {dayLabel(selected.occurred_at)}{" "}
                    <span className="sting-mono">{hhmm(selected.occurred_at)}</span>
                  </span>
                </div>
                {state === "permission_denied" ? (
                  <Notice kind="locked" title="إشعار لدورٍ آخر">
                    <p className="acc-lead">
                      إشعار عن اعتماد اشتراك وصل لأن الجهاز مشترك، والموظف الحالي لا يملك فتحه.
                    </p>
                    <p className="acc-lead">
                      <strong>العنوان بلا التفصيل</strong> · يظهر العنوان ويُحجب المحتوى ومعه «يخصّ
                      المالك». الإخفاء الكامل يجعله يظنّ أن الإشعار ضاع.
                    </p>
                  </Notice>
                ) : state === "expired" ? (
                  <Notice kind="warning" title="إشعار انتهت صلاحيته">
                    <p className="acc-lead">
                      إشعار عن عرض سوق انتهى أو دعوة مضت. يبقى مقروءاً ولا يُخفى.
                    </p>
                    <p className="acc-lead">
                      <strong>لا نمسح التاريخ</strong> · الإشعار المنتهي يُوسم ويُعطَّل زرّه. محوُه
                      يجعل المستخدم يظنّ أنه لم يصله شيء ويسأل عنه.
                    </p>
                    <p className="acc-choice__note">{selected.body}</p>
                    <div className="cat-form__actions">
                      <Button disabledReason="انتهت صلاحية هذا الإشعار">
                        {selected.screen ? `افتح ${selected.screen} ←` : "التفاصيل ←"}
                      </Button>
                    </div>
                  </Notice>
                ) : (
                  <>
                    <p className="acc-lead">{selected.body}</p>
                    {opened?.status === "link_expired" ? (
                      <Notice kind="warning" title="انتهت صلاحية هذا الرابط">
                        <p className="acc-lead">
                          الرابط داخل الإشعار يحمل صلاحية: بعد انتهائها نقول «انتهت صلاحية هذا
                          الرابط» ونعرض الوجهة بديلاً — لا صفحة خطأ عامة.
                        </p>
                      </Notice>
                    ) : null}
                    <div className="cat-form__actions">
                      {selected.href ? (
                        <Button pos onClick={() => router.push(selected.href)}>
                          {selected.screen ? `افتح ${selected.screen} ←` : "التفاصيل ←"}
                        </Button>
                      ) : null}
                      {selected.category === "marketing" ? (
                        <Button onClick={() => void muteMarketing()}>إيقاف هذا النوع</Button>
                      ) : null}
                    </div>
                  </>
                )}
                <div className="cat-form__actions">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSelected(null);
                      setOpened(null);
                    }}
                  >
                    رجوع
                  </Button>
                </div>
              </section>
            ) : null}

            {!selected && items.length ? (
              <>
                {(["operational", "account", "marketing"] as const).map((cat) =>
                  byCategory(cat).length ? (
                    <section key={cat} className="not-group" aria-label={label[cat]}>
                      <h3 className="cat-head__title">{label[cat]}</h3>
                      <TimeList
                        label={label[cat]}
                        entries={byCategory(cat).map(entryOf)}
                        onOpen={(e) => {
                          const item = items.find((i) => i.id === e.id);
                          if (item) void open(item);
                        }}
                      />
                    </section>
                  ) : null,
                )}
                <p className="acc-choice__note">
                  الرابط داخل الإشعار يحمل صلاحية: بعد انتهائها نقول «انتهت صلاحية هذا الرابط» ونعرض
                  الوجهة بديلاً — لا صفحة خطأ عامة.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
