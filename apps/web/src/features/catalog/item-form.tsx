"use client";

import {
  Button,
  formatMinor,
  parseMoneyInput,
  SelectField,
  TextField,
  Upload,
  type UploadItem,
} from "@sting/ui-web";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { api, apiBaseUrl, getAccessToken } from "@/lib/api";

import {
  describeError,
  errorsTitle,
  type ItemFieldError,
  type ServerFieldError,
} from "./item-errors";

export type ItemFormState = "ready" | "validation_error" | "saving" | "success";

export interface UnitRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly is_base: boolean;
  readonly decimal_places: number;
}
export interface GroupRow {
  readonly id: string;
  readonly name: string;
}
/** بطاقة الصنف كما يعيدها الخادم (`catalog/items/{id}`). */
export interface ItemCard {
  readonly id: string;
  readonly name: string;
  readonly group_id: string;
  readonly base_unit_id: string;
  readonly base_unit_name: string;
  readonly units: readonly {
    readonly id: string;
    readonly unit_id: string;
    readonly name: string;
    readonly factor_milli: string;
    readonly barcode: string;
  }[];
  readonly barcode: string;
  readonly sale_price_minor: string;
  readonly image_data_url: string;
  readonly base_unit_locked: boolean;
}

interface SavingStep {
  readonly t: string;
  readonly pct: string;
  readonly done: boolean;
}

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** استجابات البطاقة غير موصوفة في العقد (responses: None) — تُقرأ على شكل ItemCard. */
const asCard = (x: unknown): ItemCard => x as ItemCard;

/** يصغّر الصورة على الجهاز حتى تدخل الحدّ (كما في شعار ACC-10). */
async function shrinkImage(file: File, maxBytes: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  let scale = 1;
  for (let i = 0; i < 8; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.82);
    if (url.length <= maxBytes) return url;
    scale *= 0.7;
  }
  throw new Error("cannot_shrink");
}

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(typeof r.result === "string" ? r.result : "");
    r.onerror = () => rej(new Error("read_failed"));
    r.readAsDataURL(f);
  });
}

/** رفع الصورة بتقدّم معلن (XMLHttpRequest) — بعد حفظ الصنف لا قبله. */
function uploadImage(itemId: string, dataUrl: string, onProgress: (pct: number) => void) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBaseUrl()}/api/catalog/items/${itemId}/image`);
    xhr.setRequestHeader("Content-Type", "application/json");
    const token = getAccessToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.send(JSON.stringify({ image_data_url: dataUrl }));
  });
}

export interface ItemFormProps {
  readonly mode: "create" | "edit";
  readonly units: readonly UnitRow[];
  readonly groups: readonly GroupRow[];
  readonly initial?: ItemCard | undefined;
  readonly initialName?: string | undefined;
  readonly onState: (s: ItemFormState) => void;
  readonly onSaved?: ((card: ItemCard) => void) | undefined;
}

/**
 * CAT-02 — إنشاء صنف وبطاقته (31-D23): الوحدة قبل السعر. الحقول: الاسم، الوحدة الأساسية، وحدة أكبر
 * وتحويلها، الباركود، سعر بيع الوحدة؛ صورة اختيارية؛ المعاينة «بطاقة الصنف كما تُقرأ».
 * saving: تحقّق من تفرّد الباركود → حفظ البطاقة → رفع الصورة (بعد الصنف لا قبله).
 * validation_error: كل الأخطاء معاً وما كتبتَه باقٍ كما هو، والتمرير إلى أول خطأ.
 */
export function ItemForm({
  mode,
  units,
  groups,
  initial,
  initialName,
  onState,
  onSaved,
}: ItemFormProps) {
  const larger0 = initial?.units[0];
  const [name, setName] = useState(initial?.name ?? initialName ?? "");
  const [groupId, setGroupId] = useState(initial?.group_id ?? "");
  const [baseUnitId, setBaseUnitId] = useState(initial?.base_unit_id ?? "");
  const [largerUnitId, setLargerUnitId] = useState(larger0?.unit_id ?? "");
  const [factor, setFactor] = useState(larger0 ? String(Number(larger0.factor_milli) / 1000) : "");
  const [barcode, setBarcode] = useState(initial?.barcode ?? "");
  const [price, setPrice] = useState(
    initial ? formatMinor(initial.sale_price_minor, 2, false) : "",
  );
  const [imageUrl, setImageUrl] = useState(initial?.image_data_url ?? "");
  const [imageFile, setImageFile] = useState<{ item: UploadItem; url: string } | null>(null);
  const [imageError, setImageError] = useState<string | undefined>(undefined);
  const [state, setStateRaw] = useState<ItemFormState>("ready");
  const [errors, setErrors] = useState<ItemFieldError[]>([]);
  const [steps, setSteps] = useState<SavingStep[]>([]);
  const [saved, setSaved] = useState<ItemCard | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const firstErrorRef = useRef<HTMLDivElement>(null);
  const setState = (s: ItemFormState) => {
    setStateRaw(s);
    onState(s);
  };

  const baseUnit = units.find((u) => u.id === baseUnitId);
  const largerUnit = units.find((u) => u.id === largerUnitId);
  const factorMilli = useMemo(() => {
    const latin = factor.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(latin);
    if (!m) return null;
    return (BigInt(m[1]!) * 1000n + BigInt((m[2] ?? "").padEnd(3, "0"))).toString();
  }, [factor]);
  const priceMinor = parseMoneyInput(price || "0");
  const errorFor = (key: string) => errors.find((e) => e.key === key)?.msg;

  // التمرير يذهب إلى أول خطأ ومؤشّر الكتابة فيه
  useEffect(() => {
    if (state === "validation_error" && errors.length) {
      firstErrorRef.current?.scrollIntoView({ block: "center" });
      const first = errors[0]!;
      const el = document.querySelector<HTMLElement>(
        `[data-field="${first.key}"] input, [data-field="${first.key}"] select`,
      );
      el?.focus();
    }
  }, [errors, state]);

  const onFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setImageError(undefined);
    if (!f.type.startsWith("image/")) {
      setImageError("الملف ليس صورة — اختر ملف صورة.");
      return;
    }
    const url =
      f.size > IMAGE_MAX_BYTES ? await shrinkImage(f, IMAGE_MAX_BYTES) : await readAsDataUrl(f);
    setImageFile({
      item: { id: f.name, name: f.name, sizeLabel: `${Math.round(url.length / 1024)} KB` },
      url,
    });
  };

  const save = async (addAnother: boolean) => {
    if (state === "saving") return;
    setErrors([]);
    setSaved(null);
    const stepList: SavingStep[] = [
      { t: "تحقّق من تفرّد الباركود", pct: "", done: false },
      { t: mode === "create" ? "حفظ بطاقة الصنف" : "حفظ بطاقة الصنف", pct: "", done: false },
      ...(imageFile ? [{ t: "رفع الصورة", pct: "", done: false }] : []),
    ];
    setSteps(stepList);
    setState("saving");
    const mark = (i: number, pct: string, done: boolean) =>
      setSteps((s) => s.map((x, j) => (j === i ? { ...x, pct, done } : x)));

    const found: ServerFieldError[] = [];
    if (!baseUnitId) found.push({ field: "base_unit_id", code: "required" });
    if (barcode.trim()) {
      const { data } = await api().GET("/api/catalog/barcode", {
        params: {
          query: { value: barcode.trim(), ...(initial ? { exclude_item_id: initial.id } : {}) },
        },
      });
      const chk = data as unknown as {
        taken: boolean;
        owner_item_id: string;
        owner_item_name: string;
        owner_unit_name: string;
        barcode: string;
      } | null;
      if (chk?.taken)
        found.push({
          field: "barcode",
          code: "barcode_taken",
          barcode: chk.barcode,
          owner_item_id: chk.owner_item_id,
          owner_item_name: chk.owner_item_name,
          owner_unit_name: chk.owner_unit_name,
        });
    }
    if (found.length) {
      setErrors(found.map(describeError));
      setState("validation_error");
      return;
    }
    mark(0, "تمّ", true);

    let card: ItemCard | null = null;
    if (mode === "create") {
      const { data, error, response } = await api().POST("/api/catalog/items", {
        body: {
          name,
          base_unit_id: baseUnitId,
          ...(groupId ? { group_id: groupId } : {}),
          barcode: barcode.trim(),
          sale_price_minor: priceMinor ?? price,
          larger_unit_id: largerUnitId,
          larger_factor_milli: largerUnitId ? (factorMilli ?? factor) : "",
        },
      });
      if (response.status === 400 && error) {
        setErrors(((error as { errors?: ServerFieldError[] }).errors ?? []).map(describeError));
        setState("validation_error");
        return;
      }
      if (!response.ok || !data) {
        setState("ready");
        return;
      }
      card = asCard(data);
    } else if (initial) {
      const { data, error, response } = await api().PATCH("/api/catalog/items/{item_id}", {
        params: { path: { item_id: initial.id } },
        body: {
          name,
          group_id: groupId,
          ...(initial.base_unit_locked ? {} : { base_unit_id: baseUnitId }),
          barcode: barcode.trim(),
          sale_price_minor: priceMinor ?? price,
        },
      });
      if (response.status === 400 && error) {
        setErrors(((error as { errors?: ServerFieldError[] }).errors ?? []).map(describeError));
        setState("validation_error");
        return;
      }
      if (!response.ok || !data) {
        setState("ready");
        return;
      }
      card = asCard(data);
    }
    if (!card) return;
    mark(1, "تمّ", true);

    if (imageFile) {
      try {
        const r = await uploadImage(card.id, imageFile.url, (p) => mark(2, `${p}%`, false));
        if (r.status === 200 && r.body) {
          card = asCard(r.body);
          setImageUrl(card.image_data_url);
          setImageFile(null);
          mark(2, "تمّ", true);
        } else {
          // انقطع الرفع: الصنف محفوظ بلا صورة — لا ملف يتيم
          mark(2, "", false);
        }
      } catch {
        mark(2, "", false);
      }
    }
    setSaved(card);
    onSaved?.(card);
    setState("success");
    if (addAnother) resetKeepingUnit();
  };

  const resetKeepingUnit = () => {
    setName("");
    setBarcode("");
    setPrice("");
    setImageFile(null);
    setImageUrl("");
    setErrors([]);
  };

  const busy = state === "saving";
  const disabledReason = busy ? "جارٍ الحفظ" : undefined;
  const previewName = `${name.trim() || "—"} — ${baseUnit?.name ?? "—"}`;
  const previewUnits =
    largerUnit && factor.trim() && baseUnit ? (
      <>
        {largerUnit.name} = <span className="sting-mono">{factor.trim()}</span> {baseUnit.name} ·
        البيع بال{baseUnit.name} وال{largerUnit.name}
      </>
    ) : null;
  const priceLabel = baseUnit ? `سعر بيع ال${baseUnit.name}` : "سعر البيع";

  return (
    <div className="cat-form">
      {state === "validation_error" && errors.length ? (
        <div className="cat-errors" ref={firstErrorRef} role="alert">
          <div className="cat-errors__title">{errorsTitle(errors.length)}</div>
          {errors.map((e) => (
            <div key={e.key + e.msg} className="cat-error">
              <div className="cat-error__head">
                <span className="cat-error__field">{e.field}</span>
                <span className="cat-error__msg">{e.msg}</span>
              </div>
              {e.why ? <div className="cat-error__why">{e.why}</div> : null}
              {e.fix ? (
                <div className="cat-error__fix">
                  <strong>المخرج:</strong> {e.fix}
                </div>
              ) : null}
              {e.link ? (
                <Link href={e.link.href} className="c-btn c-btn--secondary">
                  {e.link.label}
                </Link>
              ) : null}
            </div>
          ))}
          <p className="cat-errors__foot">
            ما كتبتَه باقٍ كما هو. لا نمسح حقلاً صحيحاً لأن جاره خطأ، ولا نُرجعك إلى أعلى النموذج —
            التمرير يذهب إلى أول خطأ ومؤشّر الكتابة فيه.
          </p>
        </div>
      ) : null}

      {state === "saving" ? (
        <div className="cat-saving" role="status" aria-live="polite">
          <div className="cat-saving__title">جارٍ الحفظ</div>
          <ol className="cat-steps">
            {steps.map((s) => (
              <li key={s.t} className={`cat-step${s.done ? " cat-step--done" : ""}`}>
                <span className="cat-step__dot" aria-hidden="true" />
                <span className="cat-step__t">{s.t}</span>
                <span className="cat-step__pct">
                  {s.done ? "تمّ" : s.pct ? <span className="sting-mono">{s.pct}</span> : null}
                </span>
              </li>
            ))}
          </ol>
          <p className="cat-saving__note">
            <strong>الأزرار معطّلة والنافذة لا تُغلق.</strong> الصورة ترفع بعد الصنف لا قبله: لو
            انقطع الرفع بقي الصنف محفوظاً بلا صورة، ولو حفظنا الصورة أولاً لبقيت ملفاً يتيماً بلا
            صنف يملكه.
          </p>
        </div>
      ) : null}

      {state === "success" && saved ? (
        <div className="cat-success" role="status">
          <div className="cat-success__title">حُفظ الصنف</div>
          <div className="cat-preview__card">
            <div className="cat-preview__name">
              {saved.name} — {saved.base_unit_name}
            </div>
            <div className="cat-preview__units">
              {[
                saved.barcode ? "الباركود مرتبط" : null,
                saved.units[0]
                  ? `البيع بال${saved.base_unit_name} وال${saved.units[0].name} مفعّل`
                  : null,
                "الرصيد الافتتاحي صفر",
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <p className="cat-success__note">
            <strong>الصنف موجود ولا رصيد له.</strong> بيعه الآن يُخرج المخزون إلى سالب، وهذا قرار لا
            خطأ — فلا نمنعه ولا نخفيه.
          </p>
          <div className="acc-links">
            <Link href={`/inventory/opening?item=${saved.id}`} className="c-btn c-btn--primary">
              أضف رصيداً افتتاحياً لهذا الصنف
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                resetKeepingUnit();
                setSaved(null);
                setState("ready");
              }}
            >
              أنشئ صنفاً آخر بنفس الوحدة والمجموعة
            </Button>
            <Link href={`/catalog/${saved.id}`} className="c-btn c-btn--secondary">
              افتح بطاقة الصنف
            </Link>
          </div>
        </div>
      ) : null}

      <div className="cat-form__grid">
        <div className="cat-form__fields">
          <div data-field="name">
            <TextField
              label="اسم الصنف"
              hint="كما ينطقه الكاشير"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errorFor("name")}
              disabledReason={disabledReason}
              required
            />
          </div>
          <div data-field="base_unit_id">
            <SelectField
              label="الوحدة الأساسية"
              hint="لا تتغيّر بعد أول حركة"
              value={baseUnitId}
              onChange={(e) => setBaseUnitId(e.target.value)}
              options={[
                { value: "", label: "" },
                ...units.map((u) => ({ value: u.id, label: u.name })),
              ]}
              error={errorFor("base_unit_id")}
              disabledReason={initial?.base_unit_locked ? "لا تتغيّر بعد أول حركة" : disabledReason}
              required
            />
          </div>
          {mode === "create" ? (
            <div className="cat-form__pair" data-field="units">
              <SelectField
                label="وحدة أكبر وتحويلها"
                hint="اختيارية"
                value={largerUnitId}
                onChange={(e) => setLargerUnitId(e.target.value)}
                options={[
                  { value: "", label: "" },
                  ...units
                    .filter((u) => u.id !== baseUnitId)
                    .map((u) => ({ value: u.id, label: u.name })),
                ]}
                error={errorFor("units")}
                disabledReason={disabledReason}
              />
              <TextField
                label="المعامل"
                mono
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
                disabledReason={largerUnitId ? disabledReason : "اختر الوحدة الأكبر أولاً"}
              />
            </div>
          ) : (
            <div className="acc-choice__note">
              {initial?.units.length ? (
                initial.units.map((u) => (
                  <span key={u.id}>
                    {u.name} = <span className="sting-mono">{Number(u.factor_milli) / 1000}</span>{" "}
                    {initial.base_unit_name}{" "}
                  </span>
                ))
              ) : (
                <span>وحدة أكبر وتحويلها — اختيارية</span>
              )}
              {initial ? (
                <Link href={`/catalog/${initial.id}/units`} className="c-btn c-btn--secondary">
                  الوحدات
                </Link>
              ) : null}
            </div>
          )}
          <div data-field="barcode">
            <TextField
              label="الباركود"
              hint="هوية لا اسم — لا يحمله صنفان"
              mono
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              error={errorFor("barcode")}
              disabledReason={disabledReason}
            />
          </div>
          <div data-field="sale_price_minor">
            <TextField
              label={priceLabel}
              hint="شامل الضريبة"
              mono
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              error={errorFor("sale_price_minor")}
              disabledReason={disabledReason}
            />
          </div>
          {groups.length ? (
            <div data-field="group_id">
              <SelectField
                label="المجموعة"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                options={[
                  { value: "", label: "" },
                  ...groups.map((g) => ({ value: g.id, label: g.name })),
                ]}
                disabledReason={disabledReason}
              />
            </div>
          ) : null}
        </div>

        <div className="cat-form__side">
          <Button
            variant="secondary"
            className="cat-preview__toggle"
            onClick={() => setShowPreview((v) => !v)}
            aria-expanded={showPreview}
          >
            اعرض البطاقة
          </Button>
          <div className={`cat-preview${showPreview ? " cat-preview--open" : ""}`}>
            <div className="cat-preview__label">بطاقة الصنف كما تُقرأ</div>
            <div className="cat-preview__card">
              {imageUrl || imageFile ? (
                <img
                  className="cat-preview__img"
                  src={imageFile?.url ?? imageUrl}
                  alt={`صورة ${name.trim() || "الصنف"}`}
                />
              ) : null}
              <div className="cat-preview__name">{previewName}</div>
              {previewUnits ? <div className="cat-preview__units">{previewUnits}</div> : null}
              {barcode.trim() ? (
                <div className="cat-preview__barcode sting-mono">{barcode.trim()}</div>
              ) : null}
            </div>
          </div>
          <div className="cat-upload" data-field="image_data_url">
            <p className="cat-upload__hint">
              اختيارية. الكاشير يتعرّف بالصورة أسرع من الاسم في الزحام.
            </p>
            <Upload
              label="صورة الصنف"
              accept="image/*"
              camera
              constraintsText="الحدّ 2 ميجابايت"
              items={imageFile ? [imageFile.item] : []}
              onFiles={(fs) => void onFiles(fs)}
              onRemove={() => setImageFile(null)}
              error={imageError ?? errorFor("image_data_url")}
            />
          </div>
        </div>
      </div>

      <div className="cat-form__actions">
        <Button onClick={() => void save(false)} loading={busy} disabledReason={disabledReason}>
          احفظ الصنف
        </Button>
        {mode === "create" ? (
          <Button
            variant="secondary"
            onClick={() => void save(true)}
            disabledReason={disabledReason}
          >
            احفظ وأضف آخر
          </Button>
        ) : null}
      </div>
    </div>
  );
}
