---
name: nextjs-server
description: Next.js App Routerのサーバー実装で必ず使う規約。Server Actions、Route Handlers / API endpoints、Zod 4スキーマ、入力検証、ServerActionResult、ERROR_MESSAGES、エラーハンドリングを扱う。Server Action・Route Handler・API endpoint・zod schema・認証入力・エラー表示メッセージを追加・変更するときに使う。純粋なUIレイアウト変更では使わない。
---

# Next.js サーバー層 技術規約

Server Actions / Route Handlers / Zod / エラーハンドリングの統合規約。**該当するサブファイルのみ**読む（段階的開示）。

## 読む順序

| 作業内容 | 参照ファイル |
|----------|-------------|
| Server Actions / Route Handlers の追加・変更 | [`actions-and-routes.md`](actions-and-routes.md) |
| Zod スキーマ定義・バリデーション | [`zod-validation.md`](zod-validation.md) |
| エラー返却・`ERROR_MESSAGES`・`handleAsyncAction` | [`error-handling.md`](error-handling.md) |
