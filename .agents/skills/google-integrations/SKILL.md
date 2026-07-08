---
name: google-integrations
description: GSC / GA4 / Google Ads 連携の共通規約。Google OAuth トークンの refresh・永続化、needsReauth 返却規約、再認証導線、API エラー分類。Google 系 API 呼び出しの追加・変更、トークン期限切れ対応、setup 画面の連携ステータス実装のときに使う。
---

# Google 連携（GSC / GA4 / Google Ads）共通規約

GSC / GA4 / Google Ads を横断する OAuth トークン管理とエラー返却の規約。実装前に必ず対象機能の実ファイル（下記ポインタ）を読み、既存パターンを踏襲する。

## 1. トークン管理（SSoT: `googleTokenService`）

- アクセストークンの有効性確認・refresh・永続化は `src/server/services/googleTokenService.ts` の共通関数に集約する。独自の refresh 処理を actions / services に直書きしない。
  - `ensureValidAccessToken(credential, { refreshAccessToken, persistToken })` — 有効なら再利用、期限切れならドメイン別サービスの refresh コールバックで更新し、`persistToken` で Supabase の credential を更新する。使用例: `src/server/actions/gscSetup.actions.ts`（`ensureAccessToken` ラッパー）
  - `hasReusableAccessToken(...)` — 連携ステータス判定用。使用例: `src/server/lib/gsc-status.ts`, `src/server/lib/ga4-status.ts`
- **credential は GSC / GA4 で共有**（`supabaseService.getGscCredentialByUserId`）。GA4 は同じ credential の `scope` に GA4 スコープが含まれるかを確認し、不足時は `needsReauth: true` を返す（`ga4Setup.actions.ts` の `resolveGa4ActionContext`）。

## 2. needsReauth 返却規約

再認証が必要な失敗は、`ServerActionResult` の拡張フィールドとして `needsReauth: true` を付けて返す。

```ts
return { success: false, error: ERROR_MESSAGES.GA4.AUTH_EXPIRED_OR_REVOKED, needsReauth: true };
```

- **判定**: トークン期限切れ / 取り消しは文言判定ヘルパーに集約する（`invalid_grant`, `token has been expired`, `token has been revoked` 等）。例: `gscSetup.actions.ts` の `isTokenExpiredError`、GA4 側の `isGa4ReauthError`。判定条件を呼び出し箇所へ複製しない。
- **発火条件**: (a) refresh 失敗（期限切れ・取り消し）、(b) 必要スコープの不足。いずれも `ERROR_MESSAGES` 由来の文言とセットで返す（`nextjs-server` スキル `error-handling.md` §2.1 に準拠）。
- **類似フラグ**: メールリンク競合は `emailLinkConflict: true` を別フィールドで返す（`gscSetupReturnAuthError` 参照）。フラグを握りつぶして `error` 文字列だけにしない。

## 3. 再認証導線（UI）

- `needsReauth` を受けたクライアントは、エラーメッセージ表示に加えて **`/setup/*` への再連携導線** を必ず提示する（growmate-ui-ux「セットアップ」指針: OAuth 失敗時の復帰導線）。
- 実装例: `src/components/GscSetupClient.tsx`, `src/components/Ga4SetupClient.tsx`, `src/components/SetupDashboard.tsx`, `src/components/ui/GscStatusBadge.tsx`, `src/hooks/useGscSetup.ts`
- サイレントに未連携状態へフォールバックしない。連携済み / 要再認証 / 未連携をステータスとして区別する。

## 4. API エラー分類

- 再認証系（→ `needsReauth: true`）とそれ以外（→ 機能別の `ERROR_MESSAGES` 文言）を catch 節で分類する。`Error.message` をそのままクライアントへ返さない。
- 詳細ログはサーバー側 `console.error`（プレフィックス例: `[GA4 Setup]`）に集約する。

## 主な関連ファイル

| 領域 | ファイル |
|------|---------|
| トークン共通処理 | `src/server/services/googleTokenService.ts` |
| Setup actions | `src/server/actions/gscSetup.actions.ts`, `ga4Setup.actions.ts`, `googleAds.actions.ts` |
| ステータス判定 | `src/server/lib/gsc-status.ts`, `src/server/lib/ga4-status.ts` |
| ドメインサービス | `gscService.ts`, `gscImportService.ts`, `ga4Service.ts`, `ga4ImportService.ts`, `googleAdsService.ts`, `googleAdsAiAnalysisService.ts` ほか（`src/server/services/`） |

## 関連スキル

- エラー返却形式・`ERROR_MESSAGES`: `nextjs-server`（`error-handling.md`）
- credential の保存先・Service Role: `supabase`
- 連携変更後の画面確認（/gsc-dashboard, /gsc-import 等）: `quality-gate`（`manual-testing.md`）
