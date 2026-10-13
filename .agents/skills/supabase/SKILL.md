---
name: supabase
description: Supabaseを使う実装・DB変更で必ず使う規約。SupabaseService、Service Role、クエリ、テーブル、RLS、RPC、SECURITY DEFINER、SQLマイグレーション、database.types.ts / pending typesを扱う。Supabaseデータアクセス、認可、RLS/RPC、Service Role、スキーマ、マイグレーション、生成型を追加・変更するときに使う。
---

# Supabase 技術規約

ローカル・プレビュー・本番は同じ DB を使っている。マイグレーションとデータ操作は本番への操作として扱い、適用前に本番への影響と、適用からデプロイまでの間に旧コードと並存しても壊れないかを説明する。

Supabase 操作（アプリ層）と RLS（DB 層）の統合規約。**該当するサブファイルのみ**読む（段階的開示）。

## 読む順序

| 作業内容 | 参照ファイル |
|----------|-------------|
| SupabaseService / Service Role / クライアント生成 | [`service-usage.md`](service-usage.md) |
| RLS ポリシー / マイグレーション / SECURITY DEFINER | [`rls.md`](rls.md) |
