'use server';

import { authMiddleware } from '@/server/middleware/auth.middleware';
import { headingFlowService } from '@/server/services/headingFlowService';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';
import { z } from 'zod';
import { hasOwnerRole } from '@/authUtils';

const initializeHeadingSchema = z.object({
  sessionId: z.string().min(1),
  step5Markdown: z.string().min(1),
  liffAccessToken: z.string().min(1),
});

const saveHeadingSectionSchema = z.object({
  sessionId: z.string().min(1),
  headingKey: z.string().min(1),
  content: z.string().refine(v => v.trim().length > 0, { message: '本文が空です' }),
  liffAccessToken: z.string().min(1),
});

const getHeadingSectionsSchema = z.object({
  sessionId: z.string().min(1),
  liffAccessToken: z.string().min(1),
});

const getLatestCombinedContentSchema = z.object({
  sessionId: z.string().min(1),
  liffAccessToken: z.string().min(1),
});

const getCombinedContentVersionsSchema = z.object({
  sessionId: z.string().min(1),
  liffAccessToken: z.string().min(1),
});

const resetHeadingSectionsSchema = z.object({
  sessionId: z.string().min(1),
  liffAccessToken: z.string().min(1),
});
const rebuildCombinedContentSchema = z.object({
  sessionId: z.string().min(1),
  liffAccessToken: z.string().min(1),
});

/**
 * セッションへの読み取り権限を確認する。
 */
async function verifySessionReadAccess(sessionId: string, userId: string) {
  const sessionRes = await headingFlowService.getChatSessionById(sessionId, userId);
  return sessionRes.success && !!sessionRes.data;
}

/**
 * Step 5確定時に呼び出し、見出しセクションを初期化する。
 */
export async function initializeHeadingSections(data: z.infer<typeof initializeHeadingSchema>) {
  const parseResult = initializeHeadingSchema.safeParse(data);
  if (!parseResult.success) {
    const isTokenError = parseResult.error.issues.some(
      i => i.path.includes('liffAccessToken') || i.path.join('') === 'liffAccessToken'
    );
    const error = isTokenError
      ? '認証トークンが無効です。LINEで再ログインしてください。'
      : '入力データが不正です。ページを更新してから再度お試しください。';
    if (process.env.NODE_ENV === 'development') {
      console.warn('[initializeHeadingSections] Validation failed:', parseResult.error.issues);
    }
    return { success: false, error };
  }
  const parsed = parseResult.data;
  const auth = await authMiddleware(parsed.liffAccessToken);

  if (auth.error || !auth.userId) {
    return { success: false, error: auth.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }

  // 認可チェック: 読み取り権限
  if (!(await verifySessionReadAccess(parsed.sessionId, auth.userId))) {
    return { success: false, error: 'セッションへのアクセス権がありません' };
  }

  // 認可チェック: 書き込み権限（閲覧専用ロール・ビューモードは拒否）
  if (auth.viewMode || hasOwnerRole(auth.userDetails?.role ?? null)) {
    return { success: false, error: '閲覧モードでは編集できません' };
  }

  const result = await headingFlowService.initializeHeadingSections(
    parsed.sessionId,
    parsed.step5Markdown
  );
  if (!result.success) {
    return { success: false, error: result.error.userMessage };
  }

  return { success: true };
}

/**
 * 全ての見出しセクションを取得する。
 */
export async function getHeadingSections(data: z.infer<typeof getHeadingSectionsSchema>) {
  const parseResult = getHeadingSectionsSchema.safeParse(data);
  if (!parseResult.success) {
    const isTokenError = parseResult.error.issues.some(
      i => i.path.includes('liffAccessToken') || i.path.join('') === 'liffAccessToken'
    );
    const error = isTokenError
      ? '認証トークンが無効です。LINEで再ログインしてください。'
      : '入力データが不正です。ページを更新してから再度お試しください。';
    if (process.env.NODE_ENV === 'development') {
      console.warn('[getHeadingSections] Validation failed:', parseResult.error.issues);
    }
    return { success: false, error, data: [] };
  }
  const parsed = parseResult.data;
  const auth = await authMiddleware(parsed.liffAccessToken);

  if (auth.error || !auth.userId) {
    return { success: false, error: auth.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED, data: [] };
  }

  // 認可チェック
  if (!(await verifySessionReadAccess(parsed.sessionId, auth.userId))) {
    return { success: false, error: 'セッションへのアクセス権がありません', data: [] };
  }

  const result = await headingFlowService.getHeadingSections(parsed.sessionId);
  if (!result.success) {
    return { success: false, error: result.error.userMessage, data: [] };
  }

  // Frontend用の型に変換
  const sections = result.data.map(s => ({
    id: s.id,
    headingKey: s.heading_key,
    headingLevel: s.heading_level,
    headingText: s.heading_text,
    orderIndex: s.order_index,
    content: s.content,
    isConfirmed: s.is_confirmed,
    updatedAt: s.updated_at,
  }));

  return { success: true, data: sections };
}

/**
 * 見出しセクションを保存する。
 */
export async function saveHeadingSection(data: z.infer<typeof saveHeadingSectionSchema>) {
  const parseResult = saveHeadingSectionSchema.safeParse(data);
  if (!parseResult.success) {
    const isTokenError = parseResult.error.issues.some(
      i => i.path.includes('liffAccessToken') || i.path.join('') === 'liffAccessToken'
    );
    const isContentError = parseResult.error.issues.some(
      i => i.path.includes('content') || (i.message && i.message.includes('本文'))
    );
    const error = isTokenError
      ? '認証トークンが無効です。LINEで再ログインしてください。'
      : isContentError
        ? '本文が空です。内容を入力してから保存してください。'
        : '入力データが不正です。ページを更新してから再度お試しください。';
    if (process.env.NODE_ENV === 'development') {
      console.warn('[saveHeadingSection] Validation failed:', parseResult.error.issues);
    }
    return { success: false, error };
  }
  const parsed = parseResult.data;
  const auth = await authMiddleware(parsed.liffAccessToken);

  if (auth.error || !auth.userId) {
    return { success: false, error: auth.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }

  // 認可チェック: 読み取り権限
  if (!(await verifySessionReadAccess(parsed.sessionId, auth.userId))) {
    return { success: false, error: 'セッションへのアクセス権がありません' };
  }

  // 認可チェック: 書き込み権限（閲覧専用ロール・ビューモードは拒否）
  if (auth.viewMode || hasOwnerRole(auth.userDetails?.role ?? null)) {
    return { success: false, error: '閲覧モードでは編集できません' };
  }

  const result = await headingFlowService.saveHeadingSection(
    parsed.sessionId,
    parsed.headingKey,
    parsed.content
  );
  if (!result.success) {
    return { success: false, error: result.error.userMessage };
  }

  return { success: true };
}

/**
 * 最新の完成形を取得する（Step 7用）。
 */
export async function getLatestCombinedContent(
  data: z.infer<typeof getLatestCombinedContentSchema>
) {
  const parseResult = getLatestCombinedContentSchema.safeParse(data);
  if (!parseResult.success) {
    const isTokenError = parseResult.error.issues.some(
      i => i.path.includes('liffAccessToken') || i.path.join('') === 'liffAccessToken'
    );
    const error = isTokenError
      ? '認証トークンが無効です。LINEで再ログインしてください。'
      : '入力データが不正です。ページを更新してから再度お試しください。';
    if (process.env.NODE_ENV === 'development') {
      console.warn('[getLatestCombinedContent] Validation failed:', parseResult.error.issues);
    }
    return { success: false, error, data: null };
  }
  const parsed = parseResult.data;
  const auth = await authMiddleware(parsed.liffAccessToken);

  if (auth.error || !auth.userId) {
    return {
      success: false,
      error: auth.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
      data: null,
    };
  }

  // 認可チェック
  if (!(await verifySessionReadAccess(parsed.sessionId, auth.userId))) {
    return { success: false, error: 'セッションへのアクセス権がありません', data: null };
  }

  const result = await headingFlowService.getLatestCombinedContent(parsed.sessionId);
  if (!result.success) {
    return { success: false, error: result.error.userMessage, data: null };
  }

  return { success: true, data: result.data };
}

/**
 * 完成形の全バージョン一覧を取得する（バージョン管理UI用）。
 */
export async function getCombinedContentVersions(
  data: z.infer<typeof getCombinedContentVersionsSchema>
) {
  const parseResult = getCombinedContentVersionsSchema.safeParse(data);
  if (!parseResult.success) {
    const isTokenError = parseResult.error.issues.some(
      i => i.path.includes('liffAccessToken') || i.path.join('') === 'liffAccessToken'
    );
    const error = isTokenError
      ? '認証トークンが無効です。LINEで再ログインしてください。'
      : '入力データが不正です。ページを更新してから再度お試しください。';
    if (process.env.NODE_ENV === 'development') {
      console.warn('[getCombinedContentVersions] Validation failed:', parseResult.error.issues);
    }
    return { success: false, error, data: [] };
  }
  const parsed = parseResult.data;
  const auth = await authMiddleware(parsed.liffAccessToken);

  if (auth.error || !auth.userId) {
    return {
      success: false,
      error: auth.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED,
      data: [],
    };
  }

  if (!(await verifySessionReadAccess(parsed.sessionId, auth.userId))) {
    return { success: false, error: 'セッションへのアクセス権がありません', data: [] };
  }

  const result = await headingFlowService.getCombinedContentVersions(parsed.sessionId);
  if (!result.success) {
    return { success: false, error: result.error.userMessage, data: [] };
  }

  return {
    success: true,
    data: result.data.map(v => ({
      id: v.id,
      versionNo: v.version_no,
      content: v.content,
      isLatest: v.is_latest,
    })),
  };
}

/**
 * 見出し構成データを初期化（全削除）する。
 */
export async function resetHeadingSections(data: z.infer<typeof resetHeadingSectionsSchema>) {
  const parseResult = resetHeadingSectionsSchema.safeParse(data);
  if (!parseResult.success) {
    const isTokenError = parseResult.error.issues.some(
      i => i.path.includes('liffAccessToken') || i.path.join('') === 'liffAccessToken'
    );
    const error = isTokenError
      ? '認証トークンが無効です。LINEで再ログインしてください。'
      : '入力データが不正です。ページを更新してから再度お試しください。';
    if (process.env.NODE_ENV === 'development') {
      console.warn('[resetHeadingSections] Validation failed:', parseResult.error.issues);
    }
    return { success: false, error };
  }
  const parsed = parseResult.data;
  const auth = await authMiddleware(parsed.liffAccessToken);

  if (auth.error || !auth.userId) {
    return { success: false, error: auth.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }

  // 認カチェック
  if (!(await verifySessionReadAccess(parsed.sessionId, auth.userId))) {
    return { success: false, error: 'セッションへのアクセス権がありません' };
  }

  if (auth.viewMode || hasOwnerRole(auth.userDetails?.role ?? null)) {
    return { success: false, error: '閲覧モードでは初期化できません' };
  }

  const result = await headingFlowService.resetHeadingSections(parsed.sessionId);
  if (!result.success) {
    return { success: false, error: result.error.userMessage };
  }

  return { success: true };
}

/**
 * 最新の見出し確定内容から完成形を再生成し、新バージョンとして保存する。
 */
export async function rebuildCombinedContentFromHeadings(
  data: z.infer<typeof rebuildCombinedContentSchema>
) {
  const parseResult = rebuildCombinedContentSchema.safeParse(data);
  if (!parseResult.success) {
    const isTokenError = parseResult.error.issues.some(
      i => i.path.includes('liffAccessToken') || i.path.join('') === 'liffAccessToken'
    );
    const error = isTokenError
      ? '認証トークンが無効です。LINEで再ログインしてください。'
      : '入力データが不正です。ページを更新してから再度お試しください。';
    if (process.env.NODE_ENV === 'development') {
      console.warn('[rebuildCombinedContentFromHeadings] Validation failed:', parseResult.error.issues);
    }
    return { success: false, error };
  }
  const parsed = parseResult.data;
  const auth = await authMiddleware(parsed.liffAccessToken);

  if (auth.error || !auth.userId) {
    return { success: false, error: auth.error ?? ERROR_MESSAGES.AUTH.USER_AUTH_FAILED };
  }

  if (!(await verifySessionReadAccess(parsed.sessionId, auth.userId))) {
    return { success: false, error: 'セッションへのアクセス権がありません' };
  }

  if (auth.viewMode || hasOwnerRole(auth.userDetails?.role ?? null)) {
    return { success: false, error: '閲覧モードでは実行できません' };
  }

  const result = await headingFlowService.combineSections(parsed.sessionId, auth.userId);
  if (!result.success) {
    return { success: false, error: result.error.userMessage };
  }

  return { success: true };
}
