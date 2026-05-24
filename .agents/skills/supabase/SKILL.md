---
name: supabase
description: Supabase のサービス層（SupabaseService / Service Role）利用規約、RLS ポリシー設計、マイグレーション、SECURITY DEFINER 関数の実装規約。Supabase クエリ追加、Service Role 利用、RLS 変更、DB マイグレーションのときに使う。
---

# Supabase 技術規約

Supabase 操作（アプリ層）と RLS（DB 層）の統合規約。**該当するサブファイルのみ**読む（段階的開示）。

## 読む順序

| 作業内容 | 参照ファイル |
|----------|-------------|
| SupabaseService / Service Role / クライアント生成 | [`service-usage.md`](service-usage.md) |
| RLS ポリシー / マイグレーション / SECURITY DEFINER | [`rls.md`](rls.md) |

## 関連スキル

- 実装ポリシー全般: `implementation-guidelines`
- Server Actions からの呼び出し: `nextjs-server`
