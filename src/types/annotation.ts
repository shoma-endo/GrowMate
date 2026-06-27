export const ANNOTATION_FIELD_KEYS = [
  'main_kw',
  'kw',
  'impressions',
  'needs',
  'persona',
  'goal',
  'prep',
  'basic_structure',
  'opening_proposal',
] as const;

type AnnotationFieldTuple = typeof ANNOTATION_FIELD_KEYS;
export type AnnotationFieldKey = AnnotationFieldTuple[number];

type AnnotationFieldValue = string | null;

export type AnnotationFields = Partial<Record<AnnotationFieldKey, AnnotationFieldValue>>;

export interface AnnotationRecord extends AnnotationFields {
  id?: string;
  canonical_url?: string | null;
  wp_post_id?: number | null;
  wp_post_title?: string | null;
  wp_post_type?: string | null;
  wp_content_text?: string | null;
  wp_excerpt?: string | null;
  wp_content_cache?: string | null;
  wp_content_cached_at?: string | null;
  wp_categories?: number[] | null;
  wp_category_names?: string[] | null;
  session_id?: string | null;
  memo?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  user_id?: string;
}

export interface SessionAnnotationUpsertPayload extends AnnotationFields {
  session_id: string;
  canonical_url?: string | null;
}

/**
 * useAnnotationForm関連の型定義
 */
export type AnnotationFormState = Record<AnnotationFieldKey, string>;

interface SubmissionHandlerResult {
  success?: boolean;
  error?: string;
  canonical_url?: string | null;
  wp_post_title?: string | null;
  [key: string]: unknown;
}

interface SubmitPayload {
  fields: AnnotationFormState;
  canonicalUrl: string | null;
}

export interface SubmitOutcome {
  success: boolean;
  response?: SubmissionHandlerResult;
  normalizedCanonicalUrl: string | null;
}

export interface UseAnnotationFormOptions {
  initialFields?: AnnotationFields | AnnotationRecord | null;
  initialCanonicalUrl?: string | null;
  initialWpPostTitle?: string | null;
  onSubmit: (payload: SubmitPayload) => Promise<SubmissionHandlerResult | void>;
}

export interface UseAnnotationFormResult {
  form: AnnotationFormState;
  updateField: (field: AnnotationFieldKey, value: string) => void;
  canonicalUrl: string;
  updateCanonicalUrl: (value: string) => void;
  canonicalUrlError: string;
  isSaving: boolean;
  saveDone: boolean;
  wpPostTitle: string;
  submit: () => Promise<SubmitOutcome>;
}
