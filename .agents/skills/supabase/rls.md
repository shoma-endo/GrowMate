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
- `get_accessible_user_ids` を前提としたオーナー/スタッフ共有アクセスのモデルを崩さない。

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
