/**
 * الأطراف محلياً (§٧.٥؛ POS-04): الإسقاط `entity:parties.Party:*` تكتبه النسخة المادية وPULL وتضيف
 * إليه عملية الإنشاء السريع بلا اتصال (`party_create` + إسقاط في المعاملة نفسها). البحث بالبادئة
 * بعد التطبيع على الاسم والهاتف؛ التشابه المضلل (الاسم نفسه/الهاتف نفسه) يُعرض ويُسأل عنه قبل
 * الإنشاء ولا يُمنع ولا يُدمج — والفحص الخادمي يكتمل عند المزامنة.
 */
import { matchesPrefix, normalizeSearch } from "@sting/domain";
import type { StoragePort } from "@sting/platform";

import { saveOperation } from "./local-save";
import type { OperationDraft } from "./types";

export const PARTY_PREFIX = "entity:parties.Party:";

export interface LocalParty {
  readonly id: string;
  readonly name: string;
  readonly name_normalized: string;
  readonly phone: string;
  readonly credit_limit_minor: string;
  readonly is_customer: boolean;
  readonly is_supplier: boolean;
  readonly distinct_from_id: string;
  /** الرصيد الخادمي (موجب = عليه) بآخر مطابقة؛ المعلّق على هذا الجهاز يُركَّب مع PTY. */
  readonly balance_minor: string;
  readonly last_sale_at: string;
  readonly is_active: boolean;
  readonly deactivated_at: string;
  readonly updated_at: string;
  /** إنشاء سريع محلي لم يُؤكَّد بعد: معرّف عمليته. */
  readonly operation_id?: string | undefined;
}

export async function readLocalParties(storage: StoragePort): Promise<LocalParty[]> {
  const rows = await storage.read((tx) => tx.listProjections(PARTY_PREFIX));
  return rows.map((r) => {
    const v = r.value as { payload?: Record<string, unknown> } & Record<string, unknown>;
    const src = (v.payload ?? v) as unknown as Omit<LocalParty, "id">;
    return { ...src, id: r.key.slice(PARTY_PREFIX.length) };
  });
}

/** أرقام لاتينية فقط للمطابقة؛ العرض بالأصل. */
export function normalizePhone(phone: string): string {
  return phone.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^0-9]/g, "");
}

/** «0912 ••• 447»: أول أربعة وآخر ثلاثة أرقام — الوسط محجوب على الشاشة المشتركة. */
export function maskPhone(phone: string): string {
  const d = normalizePhone(phone);
  if (d.length < 8) return d;
  return `${d.slice(0, 4)} ••• ${d.slice(-3)}`;
}

export function searchLocalParties(parties: readonly LocalParty[], q: string): LocalParty[] {
  const query = q.trim();
  const digits = normalizePhone(query);
  return parties
    .filter((p) => p.is_active)
    .filter((p) => {
      if (!query) return true;
      if (matchesPrefix(p.name, query)) return true;
      return Boolean(digits) && normalizePhone(p.phone).startsWith(digits);
    })
    .sort((a, b) => a.name_normalized.localeCompare(b.name_normalized, "ar"));
}

export interface SimilarParties {
  readonly byName: readonly LocalParty[];
  readonly byPhone: readonly LocalParty[];
}

export function findSimilarLocal(
  parties: readonly LocalParty[],
  name: string,
  phone: string,
): SimilarParties {
  const n = normalizeSearch(name.trim());
  const digits = normalizePhone(phone);
  const active = parties.filter((p) => p.is_active);
  return {
    byName: n ? active.filter((p) => normalizeSearch(p.name) === n) : [],
    byPhone: digits ? active.filter((p) => normalizePhone(p.phone) === digits) : [],
  };
}

export interface CreatePartyInput {
  readonly operationId: string;
  readonly partyId: string;
  readonly name: string;
  readonly phone: string;
  /** «إنشاء منفصل مع تمييز»: قرار هوية صريح بأن هذا ليس ذاك. */
  readonly distinctFromPartyId?: string | undefined;
  readonly occurredAt: string;
}

export function partyCreateDraft(i: CreatePartyInput): OperationDraft {
  return {
    operationId: i.operationId,
    kind: "party_create",
    opVersion: 1,
    dependencies: [],
    members: [
      {
        entity: "parties.PartyCreated",
        id: i.partyId,
        schemaVersion: 1,
        payload: {
          party_id: i.partyId,
          name: i.name.trim(),
          phone: i.phone.trim(),
          ...(i.distinctFromPartyId ? { distinct_from_party_id: i.distinctFromPartyId } : {}),
          occurred_at: i.occurredAt,
        },
      },
    ],
  };
}

/** الإنشاء السريع محلياً: العملية والإسقاط في معاملة واحدة — يظهر الطرف فوراً ويُرفع عند الاتصال. */
export async function createPartyLocally(
  storage: StoragePort,
  input: CreatePartyInput,
): Promise<{ party: LocalParty; alreadySaved: boolean }> {
  const out = await saveOperation(storage, partyCreateDraft(input), async (tx, op) => {
    const party: LocalParty = {
      id: input.partyId,
      name: input.name.trim(),
      name_normalized: normalizeSearch(input.name.trim()),
      phone: input.phone.trim(),
      credit_limit_minor: "0",
      is_customer: true,
      is_supplier: false,
      distinct_from_id: input.distinctFromPartyId ?? "",
      balance_minor: "0",
      last_sale_at: "",
      is_active: true,
      deactivated_at: "",
      updated_at: input.occurredAt,
      operation_id: op.operationId,
    };
    await tx.putProjection({ key: PARTY_PREFIX + party.id, value: { ...party } });
  });
  const row = await storage.read((tx) => tx.getProjection(PARTY_PREFIX + input.partyId));
  return { party: row!.value as unknown as LocalParty, alreadySaved: out.alreadySaved };
}
