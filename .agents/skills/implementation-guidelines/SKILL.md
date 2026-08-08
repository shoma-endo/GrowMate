---
name: implementation-guidelines
description: GrowMate の実装ポリシー（TypeScript / React / Next.js / Supabase）とフロント・サーバー実装時の注意点。機能実装を開始するとき、コンポーネントやサーバー処理を追加・変更するとき、型・スキーマ設計やページ種別ごとの制約・機密情報の扱いを確認するときに使う。
---

# 実装ポリシー（TypeScript / React / Next.js）

- **TypeScript 前提**
  - `strict` 前提で型を定義する。
  - 可能な限り `any` を避け、`unknown` + narrowing か、適切な型／`zod` スキーマを使う。
  - オブジェクト形状は基本 `interface` を使い、`type` はユニオンなど `interface` で表現できない場合に限定する。

- **型・スキーマ**
  - 共有する型定義は `src/types/` に置き、フロント・サーバー両方から参照する。
  - バリデーションが必要なデータは `zod` スキーマを定義し、Server Actions や Route Handlers で入力を検証する。

# Next.js / サーバー通信

- **Server Actions と Route Handlers の使い分け**
  - 機密情報（API キー、Service Role キーなど）を扱う処理はサーバー側に限定し、クライアントに露出させない。
  - どちらを使うかは `nextjs-server` スキル（`actions-and-routes.md`）の方針に従う（セッションや認可チェックが絡む処理は特に注意）。
- **Server Actions の呼び出し位置**
  - ユーザー操作に起因する Server Action は、`useEffect` ではなくイベントハンドラー、または `<form action>` から直接呼び出す。
  - `useEffect` からの Server Action 呼び出しは、再レンダーや React Strict Mode による重複実行を招きやすいため、原則避ける。
  - `useEffect` は外部システムとの同期など、ライフサイクル起因の処理に限定する。
- **Server Component と Client Component の責務**
  - Server Component は、初期データ取得・認証/認可・画面構成を担当する。
  - Client Component は、ユーザー操作・UI 状態・イベント発火を担当する。
  - Server Component から Client Component へ渡す props は、必要最小限かつ機密情報を除いたシリアライズ可能な表示用モデルにする。
  - 更新後は Server Action で変更し、必要に応じて `revalidatePath`、`revalidateTag`、`router.refresh()` などで表示を更新する。

- **機密情報の取り扱い**
  - `.env.local` の値をクライアントバンドルに含めないようにする。どうしても必要な場合は public prefix など Next.js のガイドラインに従う。
  - Supabase Service Role / Google 系のクレデンシャルは必ずサーバー側のみで参照する。

# Supabase 関連

- **RLS / セキュリティ**
  - RLS ポリシーや `SECURITY DEFINER` 関数の設計は `supabase` スキル（`rls.md`）に従う。
  - owner/staff共有モデルは廃止済み。`get_accessible_user_ids`、`owner_user_id`、`owner_previous_role` を新規コード・RLS・RPCで参照しない。
  - ユーザー処理は自分のIDに限定し、管理者・バッチ処理だけが明示的な認可のもとで別ユーザーのIDを扱う。

- **クライアント生成 / Service Role**
  - Supabase クライアントの生成・Service Role の利用パターンは `supabase` スキル（`service-usage.md`）に従い、重複実装を避ける。

# フロントエンド設計

- **状態管理とサービス層**
  - 画面ロジックと API 呼び出しは `src/domain/` のサービス層（例: `ChatService`, `SubscriptionService`）を通すことを優先し、同種のロジックを画面側に直書きしない。

# ページ種別ごとの制約

- **一般ユーザー向けパブリックページ**
  - `/home`, `/privacy` などのパブリックページでは、ログインユーザー情報（通知トースト、ユーザー名、認証状態など）を一切表示しない。
  - 非認証ユーザーがアクセスしても破綻しないよう、認証前提の UI コンポーネントは埋め込まない。
