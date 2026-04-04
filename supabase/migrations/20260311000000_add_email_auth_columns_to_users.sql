-- Phase 1: メールログイン対応カラム追加
-- irreversible (単純 rollback 不可) — feature rollback は Flag と運用手順で対応

-- 1. email カラム追加
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. supabase_auth_id カラム追加 (auth.users.id との 1:1 紐付け)
ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_auth_id UUID UNIQUE;

-- 3. line_user_id の NOT NULL 解除（Email 専用ユーザーは NULL）
ALTER TABLE users ALTER COLUMN line_user_id DROP NOT NULL;

-- 4. line_display_name の NOT NULL 解除（Email 専用ユーザーは NULL）
ALTER TABLE users ALTER COLUMN line_display_name DROP NOT NULL;

-- 5. 認証 identity の整合性チェック制約
--    line_user_id または email のいずれかが必ず存在すること
ALTER TABLE users ADD CONSTRAINT users_auth_identity_check
  CHECK (
    line_user_id IS NOT NULL
    OR email IS NOT NULL
  );

-- 6. email の case-insensitive unique index
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_ci_idx
  ON users (LOWER(email))
  WHERE email IS NOT NULL;

-- 7. supabase_auth_id の検索用インデックス
CREATE INDEX IF NOT EXISTS users_supabase_auth_id_idx
  ON users (supabase_auth_id)
  WHERE supabase_auth_id IS NOT NULL;
