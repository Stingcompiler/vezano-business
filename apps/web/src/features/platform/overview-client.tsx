"use client";

import { Button, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./platform.css";
import { hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "loading" | "ready" | "permission_denied";
type Tone = "ok" | "info" | "warn" | "danger";

interface Tile {
  key: string;
  label: string;
  value: number;
  note: string;
  href: string;
  tone: Tone;
}
interface Payload {
  measured_at: string;
  tenants_total: number;
  attention: number;
  subscriptions: Tile[];
  queues: Tile[];
  technical: Tile[];
  rule: string;
}

/** PLT-00 — النظرة العامة: عدّادات ما ينتظر فعلاً، كل بطاقة تفتح شاشتها؛ أرقام من السجل بختم وقتها. */
export function OverviewClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data: d, response } = await platformApi().GET("/api/platform/overview");
    if (response.status === 403 || response.status === 401) {
      setDenied(true);
      return;
    }
    const b = d as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const state: State = denied ? "permission_denied" : data ? "ready" : "loading";

  const group = (title: string, tiles: Tile[]) => (
    <>
      <h3 className="cat-head__title">{title}</h3>
      <div className="plt-tiles">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            className="plt-tile"
            data-tone={t.tone}
            onClick={() => router.push(t.href)}
          >
            <span className="plt-tile__label">{t.label}</span>
            <span className="plt-tile__value sting-mono">{t.value}</span>
            <span className="plt-tile__note">{t.note}</span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <PlatformFrame current="overview">
      <div className="sys plt-frame" data-screen="PLT-00" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">النظرة العامة — ما ينتظر فعلاً</h2>
            <span className="cat-head__hint">
              عدّادات من السجل بختم وقتها؛ كل بطاقة تفتح شاشتها. لا مبيعات ولا أسماء زبائن هنا.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب العدّادات">
                <p className="acc-lead">الاستحقاق والطوابير وصحة المزامنة — من السجل لا من كاش.</p>
              </Notice>
            ) : null}
            {denied ? (
              <Notice kind="warning" title="مساحة المشغّل فقط">
                <p className="acc-lead">
                  النظرة العامة تُقرأ بصفة مشغّل — لا دفاتر فيها ولا باب خلفي.
                </p>
              </Notice>
            ) : null}
            {data ? (
              <>
                <div className="plt-overview__head">
                  <div>
                    <strong className="plt-overview__total">
                      <span className="sting-mono">{data.tenants_total}</span> مستأجراً
                    </strong>
                    <div className="cus-sub">
                      قِيس <span className="sting-mono">{hhmm(data.measured_at)}</span>
                    </div>
                  </div>
                  <div className="acc-actions plt-overview__tools">
                    <Status
                      state={data.attention ? "stale" : "success"}
                      label={
                        data.attention ? (
                          <>
                            يحتاج انتباهاً · <span className="sting-mono">{data.attention}</span>
                          </>
                        ) : (
                          "لا شيء ينتظر"
                        )
                      }
                    />
                    <Button
                      variant="secondary"
                      loading={refreshing}
                      onClick={() => {
                        setRefreshing(true);
                        void load().finally(() => setRefreshing(false));
                      }}
                    >
                      حدّث
                    </Button>
                  </div>
                </div>
                {/* 0005 §١٣٥: ما ينتظر قراراً أولاً، ثم حال المستأجرين، ثم صحة النظام — بأسماء
                    مجموعات القائمة نفسها */}
                {group("ما ينتظر قراراً", data.queues)}
                {group("المستأجرون والاشتراكات", data.subscriptions)}
                {group("صحة النظام", data.technical)}
                <p className="acc-choice__note">{data.rule}</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
