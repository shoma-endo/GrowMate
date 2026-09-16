import type {
  FieldColumnOption,
  FieldConfigState,
  StoredFieldConfig,
} from '@/types/field-config';

/**
 * フィールド構成の正規化ロジック（純粋関数）。
 *
 * `FieldConfigurator` から切り出してある。コンポーネントに埋めたままだと
 * vitest の environment が `node` のみ（jsdom 未導入）でテストできず、
 * 「列カタログが変わったときの復元」という壊れると気づきにくい箇所が無防備になるため。
 */

/** 列カタログから既定のフィールド構成を作る */
export function getDefaultFieldConfig(columns: readonly FieldColumnOption[]): FieldConfigState {
  return {
    visibleIds: columns.filter(c => c.defaultVisible !== false).map(c => c.id),
    orderedIds: columns.map(c => c.id),
  };
}

/** 重複を落としつつ、既知の列IDだけを元の順序で残す */
function keepKnownUnique(ids: readonly string[], knownIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!knownIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * 保存済みの構成を現在の列カタログへ合わせる。
 *
 * - 未知の列ID（カタログから消えた列）は落とす
 * - 並び順に無い既知の列は末尾へ追補する
 * - **保存後に新設された既定表示の列**は表示側へも追補する
 * - `visibleIds` の空配列は「全解除」として尊重し、既定値へ戻さない
 */
export function normalizeFieldConfig(
  columns: readonly FieldColumnOption[],
  stored: StoredFieldConfig | null
): FieldConfigState {
  const defaults = getDefaultFieldConfig(columns);
  if (!stored) {
    return defaults;
  }

  const knownIds = new Set(columns.map(c => c.id));
  const visibleSource = stored.visibleIds ?? defaults.visibleIds;
  const orderSource = stored.orderedIds ?? defaults.orderedIds;

  // **新設列の判定は「保存時点の並び順」で行う。** 先に並び順を正規化すると既知IDが
  // すべて埋まってしまい、新設列を検出できなくなる（＝追加した列が誰にも表示されない）。
  const knownAtSaveTime = new Set([...visibleSource, ...orderSource]);
  const newlyAddedDefaultVisibleIds = columns
    .filter(c => c.defaultVisible !== false && !knownAtSaveTime.has(c.id))
    .map(c => c.id);

  const visibleIds = [
    ...keepKnownUnique(visibleSource, knownIds),
    ...newlyAddedDefaultVisibleIds,
  ];

  const normalizedOrder = keepKnownUnique(orderSource, knownIds);
  const orderedIds = [
    ...normalizedOrder,
    ...columns.map(c => c.id).filter(id => !normalizedOrder.includes(id)),
  ];

  return { visibleIds, orderedIds };
}

/**
 * localStorage に残っている旧データを読む（DB へ移行する初回のみ使う）。
 *
 * 旧フォーマットは2種類ある。
 * - `string[]`         … 表示列のみを保存していた最初期の形式
 * - `{ visible, order }` … 並び替え追加後の形式
 */
export function parseLegacyStoredFieldConfig(raw: string | null): StoredFieldConfig | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(item => typeof item === 'string');

  if (isStringArray(parsed)) {
    return { visibleIds: parsed, orderedIds: null };
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const { visible, order } = parsed as { visible?: unknown; order?: unknown };
    if (!isStringArray(visible) && !isStringArray(order)) {
      return null;
    }
    return {
      visibleIds: isStringArray(visible) ? visible : null,
      orderedIds: isStringArray(order) ? order : null,
    };
  }

  return null;
}

/** 2つの構成が同値か（保存の空振りを避けるための比較） */
export function isSameFieldConfig(a: FieldConfigState, b: FieldConfigState): boolean {
  const sameList = (x: string[], y: string[]) =>
    x.length === y.length && x.every((id, i) => id === y[i]);
  return sameList(a.visibleIds, b.visibleIds) && sameList(a.orderedIds, b.orderedIds);
}
