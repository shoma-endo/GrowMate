# Supabase RLS パフォーマンス & ベストプラクティス

Supabase の Row Level Security (RLS) を安全かつ高効率に実装するための「唯一の正解 (SSoT)」を定義します。

## 命名規則・実装ガイドライン

### 1. パフォーマンス最適化

- **インデックス**: `USING` 句で使用されるカラム（`user_id`, `org_id` 等）には必ず B-tree インデックスを作成してください。
- **initPlan (キャッシュ)**: `auth.uid()` 等の JWT 関数を `(SELECT auth.uid())` でラップし、実行計画での値のキャッシュを有効にすることを推奨してください。

### 2. セキュリティ境界の定義

- **現行のサーバー経路**: `SupabaseService` 経由の Server Action / Route Handler は Service Role Client を使用するため、RLS は適用されません。認証・認可と、対象リソースの所有者/アクセス可能ユーザー ID の明示的な検証をアプリケーション層で行い、`.eq()` / `.in()` はアクセス範囲をクエリに反映するために必ず付けてください。
- **RLS が有効な経路**: Anon/session Client を使用する経路では、RLS をセキュリティ境界として担保します。コード上のフィルタはクエリの意図明示・性能最適化に加え、RLS と組み合わせて利用してください。Service Role 経路の詳細は [`service-usage.md`](service-usage.md) を参照してください。

### 3. SECURITY DEFINER の安全策

- [WARNING] 権限昇格を防ぐため、以下の措置を必須としてください。
  - `SET search_path = public` を明示的に指定する。
  - 関数内での参照は `public.table_name` のように**スキーマ名で修飾**する。
  - **入力検証の使い分け**:
    - **RETURN false**: 値の欠損（NULL 等）や権限のないデータへのアクセスなど、通常の「許可しない」結果として扱える場合に使用。
    - **RAISE EXCEPTION**: セキュリティ上の重大な違反や、予期しない致命的な不正値など、処理を即座に中断すべき場合に使用。

### 4. マイグレーションフロー

- RLS の変更は必ず `supabase/migrations/` 配下に SQL ファイルとして隔離し、ロールバック（`DROP POLICY ...`）の手順をコメントで残してください。
- スキーマ変更は権限だけの SQL（`GRANT` / `REVOKE`）や緊急修正も含め、必ず `supabase/migrations/` にマイグレーションファイルを追加してください。ユーザーが直接 SQL 適用を指示した場合も同じです（リポの migration と本番の適用履歴を一致させるため）。
- マイグレーションを適用する CI は無いため、CI の代わりに次の手順で手作業で適用してください。管理者が自分で適用する場合も、承認以外の手順は同じです。
  - 適用には、リポのファイル名のバージョンを本番の適用履歴にそのまま記録する `supabase db push --linked` を使う。Supabase MCP の `apply_migration` は、サーバー側で新しいバージョンを振るため、リポと本番の履歴が必ずずれ、リモートだけの記録が残る（[supabase-community/supabase-mcp#241](https://github.com/supabase-community/supabase-mcp/issues/241)）。SQL エディタ等での直接実行も、適用履歴が残らないので使わない。
  - Supabase CLI が未ログインなら、エージェントは `supabase login` をせず、ユーザーにログインを頼んで止まる。
  1. 適用前に `get_advisors` を `security` と `performance` の両方で実行し、結果を控える。
  2. `supabase migration list --linked` で、リポにだけあって本番に無いマイグレーションが今回適用するものだけであること、本番にだけある記録が無いことを確かめる。違えば適用せず、ユーザーへ報告して止まる（`supabase migration repair` で勝手に揃えない）。
  3. `supabase db push --linked --dry-run` で、流れるファイルが手順2と同じであることを確かめる。今回のファイルのバージョンが本番適用済みの最新より古く、`--include-all` を求められた場合も、付けずにユーザーへ報告して止まる。
  4. エージェントが適用するときは、手順2・3の結果を示してユーザー（管理者）の承認を得てから `supabase db push --linked` を実行する。
  5. 適用後に同じ2種類の `get_advisors` を実行し、適用前に無かった指摘だけを取り出す。前からある指摘では止まらない。新しい指摘が出たら完了扱いにせず、指摘の説明と修正案を添えてユーザーへ報告して止まる。
  6. もう一度 `supabase migration list --linked` を実行し、今回のファイルが本番に同じバージョンで記録され、リポと本番に差分が無いことを確かめる。差分があれば完了扱いにせず、ユーザーへ報告して止まる。
- owner/staff共有モデルは廃止済みです。`get_accessible_user_ids`、`owner_user_id`、`owner_previous_role` を新規コード・RLS・RPCで参照しないでください。
- このブランチで足したマイグレーションに変更を足すときは、共有 DB にまだ適用されていないと分かっている場合だけ、新しいファイルを作らず同じファイルにまとめてください。適用済みのとき、または適用済みかどうか分からないときは、新しいマイグレーションで追補してください（適用済みのファイルを編集しても再実行されない）。

### 5. RPC の権限境界

- Service Role クライアント専用のRPCは、`PUBLIC` / `anon` / `authenticated` への `EXECUTE` を revoke し、`service_role` のみに grant してください。PostgreSQL関数のデフォルト権限を前提にしてはいけません。
- `SECURITY DEFINER` RPCで `p_user_id` 等を受け取る場合、Service Role専用なら `auth.role() = 'service_role'` を検証し、authenticated経路を許可するなら `auth.uid() = p_user_id` を検証してください。`auth.uid()` はService Role経路ではNULLになり得ます。
- RPCの認証方式を変更したら、実際の呼び出しクライアント（Service Role / authenticated / anon）ごとに成功・拒否を確認し、`information_schema.routine_privileges` と `pg_get_functiondef()` を検査してください。

## 安全な実装例

```sql
-- 1. 最適化されたポリシー
CREATE POLICY "Secure item access" ON public.items
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
  );

-- 2. 堅牢な SECURITY DEFINER 関数
CREATE OR REPLACE FUNCTION public.check_access(target_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF target_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.records
    WHERE id = target_id
    AND owner_id = (SELECT auth.uid())
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Internal security function error: %', SQLERRM;
END;
$$;
```

## 関連

- アプリ層の Supabase 操作: [`service-usage.md`](service-usage.md)
