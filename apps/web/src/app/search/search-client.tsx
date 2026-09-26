"use client";

import { Button, Frame, Notice, Status } from "@sting/ui-web";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { countLocalPending } from "@/features/home/home-cache";
import type { Notice as NoticeRow, SearchResponse, SearchResult } from "@/features/home/types";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "loading" | "empty" | "permission_denied" | "offline";

const KINDS: readonly { kind: string; label: string; entityPrefix: string }[] = [
  { kind: "parties", label: "أطراف", entityPrefix: "entity:parties." },
  { kind: "documents", label: "مستندات", entityPrefix: "entity:documents." },
  { kind: "items", label: "أصناف", entityPrefix: "entity:catalog." },
];

/** بحث محلي بلا اتصال على ما خُزّن على الجهاز (الإسقاطات) — الأصناف والأطراف والمستندات. */
async function searchLocal(q: string): Promise<SearchResponse> {
  const needle = q.trim();
  const groups = await Promise.all(
    KINDS.map(async (k) => {
      const rows = needle
        ? await getStorage().read((tx) => tx.listProjections(k.entityPrefix))
        : [];
      const results: SearchResult[] = rows
        .filter((r) => JSON.stringify(r.value).includes(needle))
        .slice(0, 20)
        .map((r) => ({
          id: r.key,
          title:
            typeof r.value.name === "string"
              ? r.value.name
              : typeof r.value.title === "string"
                ? r.value.title
                : r.key,
          meta: "",
          tag: "محلي",
          tag_kind: "muted" as const,
          href: "#",
        }));
      return { kind: k.kind, label: k.label, results };
    }),
  );
  return {
    query: q,
    groups,
    restricted: [],
    suggestions: { nearest: [], other_branches: false, create: false },
    total: groups.reduce((n, g) => n + g.results.length, 0),
    kinds_with_results: groups.filter((g) => g.results.length).length,
    elapsed_ms: 0,
  };
}

/**
 * HOME-03. مدخل واحد يبحث في الأصناف والأطراف والمستندات؛ الأنواع بعناوين وترتيب ثابت؛ المحجوب داخل
 * المنشأة عدداً بلا محتوى، وخارجها لا شيء؛ بلا اتصال بحث محلي والإشعارات «متوقفة بلا اتصال».
 * في 390 الإشعارات تبويب ثانٍ لا عمود جانبي.
 */
export function SearchClient() {
  const router = useRouter();
  const params = useSearchParams();
  const app = useApp();
  const online = useOnline();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [notices, setNotices] = useState<{ items: NoticeRow[]; needs_action: number } | null>(null);
  const [tab, setTab] = useState<"results" | "notices">("results");
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!app.tokens && !app.expired) router.replace("/login?next=%2Fsearch");
  }, [app.expired, app.tokens, router]);

  useEffect(() => {
    void countLocalPending().then(setPending);
    void getStorage()
      .read((tx) => tx.getMeta("home.cache"))
      .then((raw) => {
        if (raw) setLastSync((JSON.parse(raw) as { savedAt: string }).savedAt);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!online || !app.tokens) return;
    void api()
      .GET("/api/notices")
      .then(({ data }) => {
        if (data) setNotices(data as unknown as { items: NoticeRow[]; needs_action: number });
      })
      .catch(() => undefined);
  }, [app.tokens, online]);

  const run = useCallback(
    async (query: string) => {
      const mine = ++seq.current;
      if (!query.trim()) {
        setResult(null);
        return;
      }
      setSearching(true);
      try {
        const r = online
          ? await api()
              .GET("/api/search", { params: { query: { q: query } } })
              .then(({ data }) => data as unknown as SearchResponse | undefined)
          : await searchLocal(query);
        if (mine === seq.current && r) setResult(r);
      } catch {
        if (mine === seq.current) setResult(await searchLocal(query));
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    },
    [online],
  );

  useEffect(() => {
    void run(q);
    // يُنفَّذ عند تغيّر الاستعلام أو الاتصال
  }, [q, run]);

  const restrictedCount = result?.restricted.reduce((n, r) => n + r.count, 0) ?? 0;
  const state: State = !online
    ? "offline"
    : searching
      ? "loading"
      : result && result.total === 0 && q.trim()
        ? restrictedCount > 0
          ? "permission_denied"
          : "empty"
        : result && restrictedCount > 0
          ? "permission_denied"
          : "ready";

  return (
    <Frame
      title="فيزانو بلص"
      nav={<AppNav currentId="search" />}
      footer={null}
      notice={!online ? <Status state="offline" label="بلا اتصال" /> : undefined}
    >
      <div className="home" data-screen="HOME-03" data-state={state}>
        <div className="acc-card" style={{ inlineSize: "100%" }}>
          <div className="acc-card__head acc-card__head--tone">
            <h2 className="acc-card__title" style={{ fontSize: 16.5 }}>
              {q.trim() ? <>نتائج «{q.trim()}»</> : "بحث"}
            </h2>
          </div>
          <div className="acc-card__body">
            <div className="search-box">
              <input
                aria-label="بحث"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="الأصناف والأطراف والمستندات"
              />
              {state === "loading" ? (
                <span className="search-box__meta">
                  نبحث في <span className="sting-mono">{KINDS.length}</span> أنواع
                </span>
              ) : result && result.total > 0 ? (
                <span className="search-box__meta">
                  <span className="sting-mono">{result.total}</span> نتائج في{" "}
                  <span className="sting-mono">{result.kinds_with_results}</span> أنواع ·{" "}
                  <span className="sting-mono">{(result.elapsed_ms / 1000).toFixed(1)}</span> ث
                </span>
              ) : null}
              {!online ? <Status state="offline" label="محلي" dot={false} /> : null}
            </div>
            {!online ? (
              <p className="acc-choice__note">
                آخر مزامنة <span className="sting-mono">{lastSync ? hhmm(lastSync) : "—"}</span> ·
                لم يُزامَن من جهازك <span className="sting-mono">{pending}</span>
              </p>
            ) : null}
          </div>

          <div className="search-tabs acc-card__body" style={{ paddingBlockStart: 0 }}>
            <Button
              variant={tab === "results" ? "primary" : "secondary"}
              onClick={() => setTab("results")}
            >
              نتائج
            </Button>
            <Button
              variant={tab === "notices" ? "primary" : "secondary"}
              onClick={() => setTab("notices")}
            >
              إشعارات سريعة
            </Button>
          </div>

          <div className="search-layout">
            <div data-tab="results" data-active={tab === "results"}>
              {state === "loading" ? (
                <div className="acc-card__body acc-skeletons" role="status" aria-label="نبحث">
                  <div className="acc-skeleton" style={{ blockSize: 12 }} />
                  <div className="acc-skeleton" style={{ blockSize: 12 }} />
                  <div className="acc-skeleton" style={{ blockSize: 12 }} />
                </div>
              ) : null}

              {state === "empty" && result ? (
                <div className="acc-card__body">
                  <Notice kind="empty" title="لا نتائج">
                    <p className="acc-lead">بحثٌ عن «{result.query}» بلا تطابق.</p>
                    <div className="acc-links">
                      {result.suggestions.nearest.map((n) => (
                        <Button key={n} variant="secondary" onClick={() => setQ(n)}>
                          <span className="sting-mono">{n}</span>
                        </Button>
                      ))}
                      {result.suggestions.other_branches ? (
                        <Button variant="secondary">البحث في الفروع الأخرى</Button>
                      ) : null}
                      {result.suggestions.create ? (
                        <Button variant="secondary">إنشاء مستند بهذا الرقم</Button>
                      ) : null}
                    </div>
                  </Notice>
                </div>
              ) : null}

              {result && state !== "loading" && result.total > 0
                ? result.groups.map((g) => (
                    <section key={g.kind} aria-label={g.label}>
                      <div className="search-group__head">
                        <span>{g.label}</span>
                        <span className="sting-mono">{g.results.length}</span>
                      </div>
                      {g.results.map((r) => (
                        <Link key={r.id} href={r.href} className="search-result">
                          <span className="search-result__title">{r.title}</span>
                          <span className="search-result__meta">{r.meta}</span>
                          <span
                            className={`acc-tag home-kpi__note--${r.tag_kind === "warn" ? "warn" : r.tag_kind === "ok" ? "ok" : "info"}`}
                          >
                            {r.tag}
                          </span>
                        </Link>
                      ))}
                    </section>
                  ))
                : null}

              {restrictedCount > 0 && result ? (
                <div className="acc-card__body">
                  <Notice kind="info" title="نتائج خارج صلاحيتك">
                    {result.restricted.map((r) => (
                      <p key={r.kind_label} className="acc-lead">
                        <span className="sting-mono">{r.count}</span> في {r.kind_label} خارج صلاحيتك
                      </p>
                    ))}
                    <div className="acc-links">
                      <Button variant="secondary">اطلب الإذن من المالك</Button>
                    </div>
                  </Notice>
                </div>
              ) : null}
            </div>

            <aside
              data-tab="notices"
              data-active={tab === "notices"}
              className="acc-card"
              style={{ inlineSize: "100%" }}
            >
              <div className="acc-card__head">
                <h3 className="acc-card__title" style={{ fontSize: 15.5 }}>
                  إشعارات سريعة
                </h3>
                {online && notices && notices.needs_action > 0 ? (
                  <span
                    className="acc-tag acc-tag--suspended"
                    style={{ marginInlineStart: "auto" }}
                  >
                    <span className="sting-mono">{notices.needs_action}</span> تحتاج فعلاً
                  </span>
                ) : null}
              </div>
              {!online ? (
                <div className="acc-card__body">
                  <p className="acc-lead">متوقفة بلا اتصال</p>
                </div>
              ) : (
                (notices?.items ?? []).map((n) => (
                  <Link key={n.id} href={n.href} className="notice-row">
                    <span
                      className={`home-dot${n.needs_action ? " home-dot--danger" : ""}`}
                      aria-hidden="true"
                    />
                    <div className="home-row__body">
                      <div className="home-row__title">{n.title}</div>
                      <div className="acc-choice__note">{n.detail}</div>
                    </div>
                    {n.when ? <span className="notice-row__when sting-mono">{n.when}</span> : null}
                  </Link>
                ))
              )}
            </aside>
          </div>
        </div>
      </div>
    </Frame>
  );
}
