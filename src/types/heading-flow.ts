export interface SessionHeadingSection {
  id: string;
  headingKey: string;
  headingLevel: number;
  headingText: string;
  orderIndex: number;
  content: string;
  isConfirmed: boolean;
  /** 確定時の更新日時（ISO 文字列）。stale 判定に使用 */
  updatedAt?: string;
}

export interface SessionCombinedContent {
  id: string;
  versionNo: number;
  content: string;
  isLatest: boolean;
  createdAt: string;
}

// --- DB-style types (Transitional until supabase gen types is run) ---

export interface DbHeadingSection {
  id: string;
  session_id: string;
  heading_key: string;
  heading_level: number;
  heading_text: string;
  order_index: number;
  content: string;
  is_confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbCombinedContent {
  id: string;
  session_id: string;
  version_no: number;
  content: string;
  is_latest: boolean;
  created_at: string;
  updated_at: string;
}

export type DbSessionHeadingSectionInsert = Omit<
  DbHeadingSection,
  'id' | 'created_at' | 'updated_at'
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DbSessionCombinedContentInsert = Omit<
  DbCombinedContent,
  'id' | 'created_at' | 'updated_at'
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
