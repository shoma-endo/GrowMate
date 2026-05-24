---
name: nextjs-server
description: Next.js App Router の Server Actions / Route Handlers、Zod 4 バリデーション、ServerActionResult / ERROR_MESSAGES によるエラーハンドリングの実装規約。Server Action 追加、Route Handler 追加、zod スキーマ定義、入力検証、エラー表示メッセージ追加のときに使う。
---

# Next.js サーバー層 技術規約

Server Actions / Route Handlers / Zod / エラーハンドリングの統合規約。**該当するサブファイルのみ**読む（段階的開示）。

## 読む順序

| 作業内容 | 参照ファイル |
|----------|-------------|
| Server Actions / Route Handlers の追加・変更 | [`actions-and-routes.md`](actions-and-routes.md) |
| Zod スキーマ定義・バリデーション | [`zod-validation.md`](zod-validation.md) |
| エラー返却・`ERROR_MESSAGES`・`handleAsyncAction` | [`error-handling.md`](error-handling.md) |

## 関連スキル

- 実装ポリシー全般: `implementation-guidelines`
- Supabase 操作: `supabase`
- 命名規則: `project-naming`
