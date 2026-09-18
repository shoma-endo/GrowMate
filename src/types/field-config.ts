/**
 * 一覧テーブルの「フィールド構成」（表示列・並び順）の共有型。
 * フロント（`FieldConfigurator`）とサーバー（Server Action / サービス層）の両方から参照する。
 */

/** 永続化の対象となる一覧。DB の `user_table_field_configs.table_key` と 1:1 で対応する */
export type FieldConfigTableKey = 'analytics' | 'instagram_media';

/** `FieldConfigurator` に渡す列カタログの1件 */
export interface FieldColumnOption {
  id: string;
  label: string;
  /** 省略時は表示。`false` のときだけ既定で非表示にする */
  defaultVisible?: boolean;
}

/** 正規化済みのフィールド構成。`visibleIds` の空配列は「全解除」で、既定値とは別物 */
export interface FieldConfigState {
  visibleIds: string[];
  orderedIds: string[];
}

/**
 * 永続化層から読み出した生の値。列カタログの変更に追随していない可能性があるため、
 * 利用前に `normalizeFieldConfig()` を通す。
 */
export interface StoredFieldConfig {
  visibleIds: string[] | null;
  orderedIds: string[] | null;
}
