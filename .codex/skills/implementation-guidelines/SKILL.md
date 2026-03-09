---
name: implementation-guidelines
description: GrowMate の実装ポリシーとフロント/サーバー実装時の注意点
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
  - どちらを使うかは `server-actions-and-routes` スキルの方針に従う（セッションや認可チェックが絡む処理は特に注意）。

- **機密情報の取り扱い**
  - `.env.local` の値をクライアントバンドルに含めないようにする。どうしても必要な場合は public prefix など Next.js のガイドラインに従う。
  - Stripe / Supabase Service Role / Google 系のクレデンシャルは必ずサーバー側のみで参照する。

# Supabase 関連

- **RLS / セキュリティ**
  - RLS ポリシーや `SECURITY DEFINER` 関数の設計は `supabase-rls` スキルに従う。
  - `get_accessible_user_ids` を前提としたオーナー/スタッフ共有アクセスのモデルを崩さない。

- **クライアント生成 / Service Role**
  - Supabase クライアントの生成・Service Role の利用パターンは `supabase-service-usage` スキルに従い、重複実装を避ける。

# フロントエンド実装

- **UI 実装方針**
  - レイアウト・スタイルは Tailwind CSS を基本とし、冗長なユーティリティクラスは必要に応じて `cva` 等で整理する。
  - コンポーネントは既存の shadcn ベースコンポーネント（`src/components/`）を優先して再利用する。

- **状態管理とサービス層**
  - 画面ロジックと API 呼び出しは `src/domain/` のサービス層（例: `ChatService`, `SubscriptionService`）を通すことを優先し、同種のロジックを画面側に直書きしない。

# ページ種別ごとの制約

- **一般ユーザー向けパブリックページ**
  - `/home`, `/privacy` などのパブリックページでは、ログインユーザー情報（通知トースト、ユーザー名、認証状態など）を一切表示しない。
  - 非認証ユーザーがアクセスしても破綻しないよう、認証前提の UI コンポーネントは埋め込まない。

# セルフレビューとの連携

- コーディング完了後は、`self-review` スキルで定義された **2 パスの自己レビュー手順**に必ず従う。
- 自己レビューでは以下を特に確認する:
  - 型エラーが出ないか（`npm run lint` / `npm run build` の結果）。
  - 既存の命名規則・ディレクトリ構造・責務分割に沿っているか。
  - Supabase / 認証 / 課金まわりでセキュリティ上の抜けがないか。

