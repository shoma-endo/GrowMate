# Email 移行 Runbook (Phase 1.5)

既存 LINE ユーザーに対して、同一 `users.id` を維持したまま Email ログインを手動付与する手順書。
オペレーターが用意するのは **(フルネーム, Email)** のペアのみ。

---

## 1. 事前準備: 移行マッピングの確認

VALUES にペアを埋め、`full_name` で LINE ユーザーと突合する。
全行が返ることを確認してから次へ進む（返らない行がある場合は `full_name` の表記揺れを確認）:

```sql
SELECT u.id AS source_user_id, u.full_name, u.line_display_name, t.email
  FROM (VALUES
    ('フルネーム1', 'user1@example.com'),
    ('フルネーム2', 'user2@example.com')
  ) AS t(full_name, email)
  JOIN users u ON u.full_name = t.full_name
 WHERE u.line_user_id IS NOT NULL
   AND u.supabase_auth_id IS NULL;
```

---

## 2. 一括移行

VALUES リストを埋めて実行する。
`auth.users` 作成・`public.users` リンクを **1 トランザクション**で処理し、いずれか 1 件でも失敗すると全件ロールバックされる。

```sql
DO $$
DECLARE
  r record;
  v_source_user_id uuid;
  v_auth_user_id uuid;
  v_email_conflict integer;
  v_ok integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- (full_name, email) ← ここだけ埋める
      ('フルネーム1', 'user1@example.com'),
      ('フルネーム2', 'user2@example.com')
    ) AS t(full_name, email)
  LOOP
    -- 1. full_name → source_user_id を解決 + ロック
    SELECT id INTO v_source_user_id
      FROM users
     WHERE full_name = r.full_name
       AND line_user_id IS NOT NULL
       AND supabase_auth_id IS NULL
     FOR UPDATE;

    IF v_source_user_id IS NULL THEN
      RAISE EXCEPTION 'No matching LINE user for full_name: %', r.full_name;
    END IF;

    -- 2. email が他ユーザーに使用されていないか確認
    SELECT count(*) INTO v_email_conflict
      FROM users
     WHERE lower(email) = lower(r.email)
       AND id != v_source_user_id;

    IF v_email_conflict > 0 THEN
      RAISE EXCEPTION 'Email already in use by another user: %', r.email;
    END IF;

    -- 3. auth.users を作成
    -- 注意: 以下の text 系列を省略すると NULL になり、GoTrue が string として読み込めず
    -- OTP 送信時に Database error finding user（Scan error on confirmation_token / email_change 等）になる。
    -- 手動 INSERT では空文字 '' を明示する。
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token,
      email_change, email_change_token_current, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated', 'authenticated',
      lower(r.email),
      '', now(),
      '', '',
      '', '', '',
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('display_name', r.full_name),
      now(), now()
    ) RETURNING id INTO v_auth_user_id;

    -- 4. auth.identities を作成
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_auth_user_id::text, v_auth_user_id,
      jsonb_build_object('sub', v_auth_user_id::text, 'email', lower(r.email)),
      'email', v_auth_user_id::text,
      now(), now(), now()
    );

    -- 5. public.users にリンク
    UPDATE users
       SET supabase_auth_id = v_auth_user_id,
           email = lower(r.email),
           full_name = r.full_name,
           updated_at = now()
     WHERE id = v_source_user_id;

    v_ok := v_ok + 1;
    RAISE NOTICE 'OK: % -> % (auth: %)', r.full_name, v_source_user_id, v_auth_user_id;
  END LOOP;

  RAISE NOTICE 'Migration complete: % succeeded', v_ok;
END;
$$;
```

### 結果確認

```sql
SELECT id, full_name, email, supabase_auth_id, line_display_name, updated_at
  FROM users
 WHERE supabase_auth_id IS NOT NULL
   AND line_user_id IS NOT NULL
 ORDER BY updated_at DESC;
```

`auth.users` 側で string 期待の列が NULL のまま残っていないか（OTP 失敗の原因になる）:

```sql
SELECT id, email,
       confirmation_token IS NULL AS confirmation_null,
       recovery_token IS NULL AS recovery_null,
       email_change IS NULL AS email_change_null,
       email_change_token_current IS NULL AS email_change_token_current_null,
       email_change_token_new IS NULL AS email_change_token_new_null
  FROM auth.users
 WHERE id IN (SELECT supabase_auth_id FROM users WHERE supabase_auth_id IS NOT NULL);
```

注意: ホストされている GoTrue の版によって列名が違う（例: `email_change_token` ではなく `email_change_token_current` / `email_change_token_new`）。列一覧は次で確認する:

```sql
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'auth'
   AND table_name = 'users'
 ORDER BY ordinal_position;
```

一括修復（NULL を空文字にそろえる。本番実行前に件数を `WHERE ... IS NOT NULL` の否定で確認すること）:

```sql
UPDATE auth.users
   SET confirmation_token = coalesce(confirmation_token, ''),
       recovery_token = coalesce(recovery_token, ''),
       email_change = coalesce(email_change, ''),
       email_change_token_current = coalesce(email_change_token_current, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       updated_at = now()
 WHERE confirmation_token IS NULL
    OR recovery_token IS NULL
    OR email_change IS NULL
    OR email_change_token_current IS NULL
    OR email_change_token_new IS NULL;
```

上記の列名が自環境に無い場合は、その列だけ UPDATE から外す。

---

## 3. 移行後の動作確認

代表ユーザー 1〜2 名に Email + OTP でログインしてもらい、既存データが正常に表示されることを確認。

---

## 4. LINE ログインの無効化

移行完了・動作確認後、ログイン画面から LINE ログインを非表示にする。

**対象ファイル**: `app/login/page.tsx`

削除箇所:
1. `loginWithLine` 関数（L33-50）
2. 「または」区切り線（L174-178）
3. 「LINEでログイン」ボタン（L180-186）
4. CardDescription の文言を `メールでログインできます` に変更（L128）

削除後、不要になった import やローディング表示（`view === 'loading'`）があれば併せて整理する。

---

## 5. エラーハンドリング

| エラーメッセージ | 原因 | 対処 |
|---|---|---|
| `No matching LINE user for full_name: <name>` | full_name が一致しない、既に移行済み、または LINE ユーザーでない | セクション 1 で突合を再確認 |
| `Email already in use by another user: <email>` | 同じ email の users 行が既に存在する（stray 行の可能性） | セクション 6-3 の手順で stray 行を削除 |
| `duplicate key value violates unique constraint` | auth.users に同一 email が既に存在する | セクション 6-1 で重複した auth.users を削除 |

---

## 6. 復旧手順

移行 SQL は 1 トランザクションなので、失敗時は `auth.users` / `auth.identities` / `public.users` すべてロールバックされる。
手動で部分実行した場合や、`resolveOrCreateEmailUser()` による stray 行が存在する場合のみ以下を実施する。

### 6-1. auth.users の削除

```sql
-- auth.identities → auth.users の順で削除（FK 制約）
DELETE FROM auth.identities WHERE user_id = '<AUTH_USER_ID>';
DELETE FROM auth.users WHERE id = '<AUTH_USER_ID>';
```

### 6-2. public.users のリンク済みの場合

```sql
UPDATE users
   SET supabase_auth_id = NULL,
       email = NULL,
       updated_at = now()
 WHERE id = '<SOURCE_USER_ID>';
```

その後 6-1 で auth.users を削除する。

### 6-3. stray な public.users 行の削除

`resolveOrCreateEmailUser()` が先行して走った場合、移行対象の email で新規 `public.users` 行が
作成されている可能性がある。この行が残ると DO ブロックが `Email already in use` で失敗する。

```sql
-- 衝突元を特定（line_user_id が NULL の行が stray）
SELECT id, email, line_user_id, supabase_auth_id, created_at
  FROM users
 WHERE lower(email) = lower('<EMAIL>');
```

LINE ユーザーでない行（`line_user_id IS NULL`）が stray 行。
関連データがないことを確認した上で削除する:

```sql
DELETE FROM users
 WHERE id = '<STRAY_USER_ID>'
   AND line_user_id IS NULL;
```

stray 行に `supabase_auth_id` がある場合は 6-1 で対応する auth.users も削除し、手順 2 を再実行する。

---

## 7. 作業記録テンプレート

| # | users.id | LINE 表示名 | 移行先 Email | auth_user_id | RPC 結果 | 確認 | 実施日時 | 備考 |
|---|----------|-------------|-------------|-------------|---------|------|---------|------|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |
| 4 | | | | | | | | |
| 5 | | | | | | | | |
| 6 | | | | | | | | |
| 7 | | | | | | | | |
| 8 | | | | | | | | |
| 9 | | | | | | | | |
| 10 | | | | | | | | |

---

## 8. 同期ルールと定期検証（`public.users` / `auth.users`）

メール OTP やアプリのユーザー解決は **`auth.users` と `public.users` の両方**に依存する。手動 SQL・部分移行・メール変更のあとにズレると、ログイン失敗や「別人として表示」につながる。移行作業後だけでなく、**手動で `auth` または `public.users` を触ったタイミング**で本節の SELECT を実行し、0 件であることを確認する。

### 8-1. 同期ルール（守るべきインバリアント）

1. **`supabase_auth_id` の向き先**: `public.users.supabase_auth_id` が非 NULL のとき、対応する `auth.users.id` が必ず存在する（孤立リンクを作らない）。
2. **メールの一致**: 上記リンクがある行では、`lower(trim(public.users.email))` と `lower(trim(auth.users.email))` を一致させる（表示・サポート・突合用に `public.email` を正とする運用なら、変更時は **両方同じトランザクション**で更新する）。
3. **`auth.users` の text 列**: 手動 `INSERT` や古い行で `confirmation_token` / `recovery_token` / `email_change` / `email_change_token_current` / `email_change_token_new` が NULL のままだと、GoTrue が `Scan error` / `Database error finding user` を返す。原則 **空文字 `''`** にそろえる（検査・一括修復は **セクション 2** のクエリを使う）。
4. **メールの一意性**: `auth.users` 上で同一メール（大小文字の正規化後）の重複がないこと。`public.users` の `email` もアプリの制約どおり重複しないこと。

### 8-2. 検証用クエリ（いずれも「行が返らない」ことが期待）

**A. `public` と `auth` のメール不一致**（リンク済みユーザー）

```sql
SELECT
  u.id AS public_id,
  u.email AS public_email,
  au.id AS auth_id,
  au.email AS auth_email
FROM public.users u
JOIN auth.users au ON au.id = u.supabase_auth_id
WHERE u.supabase_auth_id IS NOT NULL
  AND lower(trim(coalesce(u.email, ''))) <> lower(trim(coalesce(au.email, '')));
```

**B. `supabase_auth_id` の孤立**（`auth` 側に行がない）

```sql
SELECT u.id, u.email, u.supabase_auth_id
FROM public.users u
LEFT JOIN auth.users au ON au.id = u.supabase_auth_id
WHERE u.supabase_auth_id IS NOT NULL
  AND au.id IS NULL;
```

**C. `auth.users` でのメール重複**（正規化後）

```sql
SELECT lower(trim(email)) AS email_norm, count(*) AS cnt
FROM auth.users
GROUP BY lower(trim(email))
HAVING count(*) > 1;
```

**D. OTP 障害の原因になる NULL**（該当列は環境の GoTrue 版で異なる場合あり。列一覧はセクション 2 の `information_schema` クエリで確認。判定ロジックは **セクション 2「結果確認」** の `auth.users` チェックと同じで、**0 行が正常**）

```sql
SELECT id, email,
       confirmation_token IS NULL AS confirmation_null,
       recovery_token IS NULL AS recovery_null,
       email_change IS NULL AS email_change_null,
       email_change_token_current IS NULL AS email_change_token_current_null,
       email_change_token_new IS NULL AS email_change_token_new_null
  FROM auth.users
 WHERE confirmation_token IS NULL
    OR recovery_token IS NULL
    OR email_change IS NULL
    OR email_change_token_current IS NULL
    OR email_change_token_new IS NULL;
```

（セクション 2 の結果確認では `id IN (SELECT supabase_auth_id FROM public.users WHERE ...)` で **リンク済み**に限定している。こちらは **全 `auth.users`** を対象にする。リンク済みだけを見たい場合は同じ `WHERE id IN (...)` を付け足す。）

**E. （任意）`auth.identities` の email プロバイダ**  
`identity_data` のキーはインスタンスで異なることがある。必要なら 1 件サンプルを `SELECT identity_data FROM auth.identities WHERE provider = 'email' LIMIT 1` で確認したうえで、メールが `auth.users.email` と揃っているかを調べる。

### 8-3. 検出時の扱い（方針のみ）

| 検証 | 方針の例 |
|------|----------|
| A（メール不一致） | どちらを正とするか決め、`public.users` / `auth.users` / `auth.identities` を **同一トランザクション**で更新。他ユーザーとのメール衝突を事前に確認する。 |
| B（孤立） | 誤リンクなら `supabase_auth_id`（と必要なら `email`）を NULL に戻すか、正しい `auth.users` 行を復元する。 |
| C（重複） | どちらを残すか決め、重複行の削除・マージは **セクション 6** の手順と衝突しないよう個別設計する。 |
| D（NULL 列） | **セクション 2** の `UPDATE auth.users ... coalesce(..., '')` を実行。 |

---
