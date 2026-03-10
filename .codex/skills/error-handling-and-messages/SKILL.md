---
name: error-handling-and-messages
description: Next.js(App Router) の Server Actions を前提とした、エラーハンドリングと表示メッセージの統一ルール。
---

# エラーハンドリング & メッセージ設計（SSoT）

このスキルは、**Network Boundary を跨ぐエラーの扱い**と、**ユーザー向けメッセージの一元管理**を徹底するための規約です。
アプリ全体のエラーメッセージは `src/domain/errors/error-messages.ts` を単一の正解 (SSoT) とします。

## 1. 基本方針（必須）

- **例外をそのままクライアントに渡さない**  
  Server Action から `Error.message` を直接表示しない。Network Boundary を跨いだ `Error` は production で秘匿される。
- **Server Action は「表示可能なエラー」を値として返す**  
  例外は `Result` 形式（`success` / `failure`）に畳み込み、`message` は **安全に表示できる文言**に限定する。
- **表示メッセージは必ず `ERROR_MESSAGES` を経由**  
  直接の日本語文字列を散在させない。
- **内部詳細はログに集約**  
  スタックトレースや技術情報はサーバー側でログ化し、ユーザー表示には出さない。

## 2. 推奨パターン

### 2.1 Server Action の戻り値

- 返却は `ServerActionResult<T>` を基本形とする（`src/lib/async-handler.ts`）。
- 成功時は `{ success: true, data?: T }`（削除系などは `data` 省略可）。
- 失敗時は `{ success: false, error: string }` とし、`error` は `ERROR_MESSAGES` から生成する。
- 必要に応じて `needsReauth` / `requiresSubscription` などの追加フィールドを許容する。
- 参考: `ServerActionResult` の型定義

```ts
export interface ServerActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

### 2.2 クライアント側の共通ハンドリング

- **推奨**: 取得/更新の実行は `handleAsyncAction` で統一する（`src/lib/async-handler.ts`）。
- `onSuccess` / `setLoading` / `setMessage` で UI 状態とメッセージを集中管理する。
- **適用範囲**:
  - **必須**: 設定系の単発取得・更新（GSC / GA4 / Google Ads セットアップ、ステータス取得など）では `handleAsyncAction` を使用する。
  - **許容**: チャット送信・注釈保存・セッション一覧など、ストリーミングや複数状態を扱う画面では、Server Action を直接呼び `result.error` を自前で扱うパターンも可。その場合も `result.error` は表示専用とし、メッセージは `ERROR_MESSAGES` 由来に限定する。
- 参考: 実装例（`src/hooks/useGscSetup.ts` と同型の最小パターン）

```ts
await handleAsyncAction(fetchGscStatus, {
  onSuccess: data => setStatus(data as GscConnectionStatus),
  setLoading: setIsSyncingStatus,
  setMessage: setAlertMessage,
  defaultErrorMessage: ERROR_MESSAGES.GSC.STATUS_FETCH_FAILED,
});
```

### 2.3 メッセージ管理

- 表示メッセージは `ERROR_MESSAGES` を唯一の参照元とする。
- Server Action 側で文言を確定し、クライアントは `result.error` を表示するだけに留める。

### 2.4 例外の扱い（Server Action 側）

- 例外は `try/catch` で捕捉し、`{ success: false, error }` に畳み込む。
- 技術的詳細はログに集約し、ユーザー向けには安全な文言のみ返す。

## 3. 実装ルール（必須）

1. **メッセージ追加は `src/domain/errors/error-messages.ts` に集約**
2. **Server Action は `Error` を throw せず `{ success: false, error }` を返す**
3. **クライアントは `result.error` を表示するだけに留める**
4. **設定系の単発 Action では `handleAsyncAction` を使い、それ以外でも `result.error` 表示と `ERROR_MESSAGES` の利用を守る**

## 4. アンチパターン

- [ ] Client Component で `Error.message` を直接表示する
- [ ] Server Action で例外をそのまま throw する
- [ ] メッセージ文字列を任意のファイルに直接書く
- [ ] 設定系の単発 Action で `handleAsyncAction` を使わずにエラーハンドリングを分散させる

## 5. セルフレビュー項目

- [ ] `ERROR_MESSAGES` に追加した文言が他用途で重複しないか
- [ ] Server Action の返却が `ServerActionResult` の形に沿っているか
- [ ] Network Boundary 越しに `Error.message` を使っていないか
- [ ] 設定系では `handleAsyncAction` を使っているか。他では `result.error` と `ERROR_MESSAGES` を守っているか
