import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ANNOTATION_FIELD_KEYS,
  type AnnotationFieldKey,
  type AnnotationFields,
  type AnnotationRecord,
  type AnnotationFormState,
  type SubmitOutcome,
  type UseAnnotationFormOptions,
  type UseAnnotationFormResult,
} from '@/types/annotation';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import {
  isEmailLinkConflictResult,
  replaceToEmailLinkConflictLogin,
} from '@/lib/auth/emailLinkConflictClient';
import { validateOptionalUrl } from '@/lib/validators/common';

const EMPTY_FORM_ENTRIES = ANNOTATION_FIELD_KEYS.map(key => [key, ''] as const);
const EMPTY_FORM = Object.fromEntries(EMPTY_FORM_ENTRIES) as AnnotationFormState;

const toFormState = (
  fields?: AnnotationFields | AnnotationRecord | null
): AnnotationFormState => {
  return ANNOTATION_FIELD_KEYS.reduce(
    (acc, key) => {
      acc[key] = fields?.[key] ?? '';
      return acc;
    },
    { ...EMPTY_FORM }
  );
};

export function useAnnotationForm({
  initialFields,
  initialCanonicalUrl,
  initialWpPostTitle,
  onSubmit,
}: UseAnnotationFormOptions): UseAnnotationFormResult {
  const [form, setForm] = useState<AnnotationFormState>(() => toFormState(initialFields));
  const [canonicalUrl, setCanonicalUrl] = useState<string>(() => initialCanonicalUrl ?? '');
  const [canonicalUrlError, setCanonicalUrlError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveDone, setSaveDone] = useState(false);
  const [wpPostTitle, setWpPostTitle] = useState<string>(() => initialWpPostTitle ?? '');
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setForm(toFormState(initialFields));
  }, [initialFields]);

  useEffect(() => {
    setCanonicalUrl(initialCanonicalUrl ?? '');
    setCanonicalUrlError('');
  }, [initialCanonicalUrl]);

  useEffect(() => {
    setWpPostTitle(initialWpPostTitle ?? '');
  }, [initialWpPostTitle]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const updateField = useCallback((field: AnnotationFieldKey, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const updateCanonicalUrl = useCallback((value: string) => {
    setCanonicalUrl(value);
    if (canonicalUrlError) {
      setCanonicalUrlError('');
    }
  }, [canonicalUrlError]);

  const submit = useCallback(async (): Promise<SubmitOutcome> => {
    const trimmed = canonicalUrl.trim();
    let normalizedUrl: string | null = null;

    if (trimmed.length > 0) {
      const urlError = validateOptionalUrl(trimmed);
      if (urlError) {
        setCanonicalUrlError(urlError);
        return { success: false, normalizedCanonicalUrl: null };
      }
      try {
        normalizedUrl = new URL(trimmed).toString();
      } catch {
        setCanonicalUrlError(ERROR_MESSAGES.VALIDATION.INVALID_URL);
        return { success: false, normalizedCanonicalUrl: null };
      }
    }

    setCanonicalUrlError('');
    setIsSaving(true);
    setSaveDone(false);

    try {
      const response = (await onSubmit({ fields: form, canonicalUrl: normalizedUrl })) ?? undefined;
      if (isEmailLinkConflictResult(response)) {
        replaceToEmailLinkConflictLogin();
        return { success: false, normalizedCanonicalUrl: normalizedUrl };
      }
      const success = Boolean(response?.success);

      if (success) {
        setSaveDone(true);
        if (resetTimerRef.current) {
          clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = setTimeout(() => {
          setSaveDone(false);
          resetTimerRef.current = null;
        }, 900);

        const nextCanonical =
          response?.canonical_url !== undefined
            ? response.canonical_url ?? ''
            : normalizedUrl ?? '';
        setCanonicalUrl(nextCanonical);
        setCanonicalUrlError('');
        if (response?.wp_post_title !== undefined) {
          setWpPostTitle(response.wp_post_title ?? '');
        } else if (normalizedUrl === null && trimmed.length === 0) {
          setWpPostTitle('');
        }

        const outcome: SubmitOutcome = {
          success: true,
          normalizedCanonicalUrl: normalizedUrl,
        };
        if (response) {
          outcome.response = response;
        }

        return outcome;
      }

      const message = response?.error || ERROR_MESSAGES.COMMON.SAVE_FAILED;
      setCanonicalUrlError(message);

      const outcome: SubmitOutcome = {
        success: false,
        normalizedCanonicalUrl: normalizedUrl,
      };
      if (response) {
        outcome.response = response;
      }

      return outcome;
    } catch {
      setCanonicalUrlError(ERROR_MESSAGES.COMMON.SAVE_FAILED);
      return { success: false, normalizedCanonicalUrl: normalizedUrl };
    } finally {
      setIsSaving(false);
    }
  }, [canonicalUrl, form, onSubmit]);

  return {
    form,
    updateField,
    canonicalUrl,
    updateCanonicalUrl,
    canonicalUrlError,
    isSaving,
    saveDone,
    wpPostTitle,
    submit,
  };
}
