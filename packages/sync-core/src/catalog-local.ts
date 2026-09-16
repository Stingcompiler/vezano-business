/**
 * الكتالوج المحلي (CAT-01 «المحلي أولاً»): يُقرأ من إسقاطات الجهاز التي كتبتها النسخة المادية وPULL
 * (`entity:catalog.Item:*`، `entity:catalog.ItemGroup:*`)؛ البحث بالبادئة بعد التطبيع (§٧.٥) على الاسم
 * والأسماء البديلة والباركود. المعطَّل يبقى محفوظاً بشاهده ولا يظهر افتراضياً (ACC-45).
 */
import { matchesPrefix, normalizeSearch } from "@sting/domain";
import type { StoragePort } from "@sting/platform";

export interface LocalItemUnit {
  /** معرّف وحدة الصنف (CAT-03) — غائب في إسقاطات قبل T1.9. */
  readonly id?: string | undefined;
  readonly unit_id: string;
  readonly code: string;
  readonly name: string;
  readonly decimal_places?: 0 | 1 | 2 | 3 | undefined;
  readonly factor_milli: string;
  /** باركود لكل وحدة (CAT-03). */
  readonly barcode?: string | undefined;
}
export interface LocalItem {
  readonly id: string;
  readonly name: string;
  readonly name_normalized: string;
  readonly group_id: string;
  readonly group_name: string;
  readonly base_unit_id: string;
  readonly base_unit_code: string;
  readonly base_unit_name: string;
  readonly base_unit_decimal_places?: 0 | 1 | 2 | 3 | undefined;
  readonly units: readonly LocalItemUnit[];
  readonly barcode: string;
  readonly sale_price_minor: string;
  readonly price_updated_at: string;
  /** الصورة لا تصل الأجهزة في PULL — حضورها فقط (0005 §١٢). */
  readonly image_present?: boolean | undefined;
  readonly image_updated_at?: string | undefined;
  readonly aliases: readonly string[];
  readonly is_active: boolean;
  readonly deactivated_at: string;
  readonly updated_at: string;
}
export interface LocalGroup {
  readonly id: string;
  readonly name: string;
  readonly parent_id: string;
  readonly parent_name: string;
  readonly sort_order: number;
  readonly note: string;
}

export const ITEM_PREFIX = "entity:catalog.Item:";
export const GROUP_PREFIX = "entity:catalog.ItemGroup:";

export async function readLocalItems(storage: StoragePort): Promise<LocalItem[]> {
  const rows = await storage.read((tx) => tx.listProjections(ITEM_PREFIX));
  return rows.map((r) => ({
    ...(r.value as unknown as Omit<LocalItem, "id">),
    id: r.key.slice(ITEM_PREFIX.length),
  }));
}

export async function readLocalGroups(storage: StoragePort): Promise<LocalGroup[]> {
  const rows = await storage.read((tx) => tx.listProjections(GROUP_PREFIX));
  return rows
    .map((r) => ({
      ...(r.value as unknown as Omit<LocalGroup, "id">),
      id: r.key.slice(GROUP_PREFIX.length),
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ar"));
}

export interface LocalItemQuery {
  readonly q?: string;
  readonly groupId?: string;
  readonly includeInactive?: boolean;
}

/** يطابق صنفاً واحداً: بادئة الاسم أو أي كلمة فيه، أو بادئة اسم بديل، أو بادئة الباركود. */
export function itemMatches(item: LocalItem, q: string): boolean {
  const query = q.trim();
  if (!query) return true;
  if (matchesPrefix(item.name, query)) return true;
  if (item.aliases.some((a) => matchesPrefix(a, query))) return true;
  return item.barcode.startsWith(normalizeSearch(query));
}

export function filterLocalItems(items: readonly LocalItem[], query: LocalItemQuery): LocalItem[] {
  return items
    .filter((i) => (query.includeInactive ? true : i.is_active))
    .filter((i) => (query.groupId ? i.group_id === query.groupId : true))
    .filter((i) => itemMatches(i, query.q ?? ""))
    .sort((a, b) => a.name_normalized.localeCompare(b.name_normalized, "ar"));
}
