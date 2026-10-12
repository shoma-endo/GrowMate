# OAuth トークン平文保存の暗号化 移行設計書

## メタデータ

- 文書名: OAuth トークン平文保存の暗号化 移行設計書
- ステータス: `draft`（調査・設計のみ。コード変更・migration 適用は未実施）
- 作成日: 2026-10-10
- 作成者: shoma-endo（TAKT ai-task-run / clerical_task 支援）
- 承認者: 未定
- 調査対象: `develop` ブランチ `40fe017ba3352b823931887d6fe2e681b24a8783`（2026-10-08 コミット）時点のローカル checkout
- 関連: CodeRabbit レビュー指摘 <https://github.com/shoma-endo/industry-specific-mc-training/pull/174#discussion_r2721990619>（2026-01-23 投稿。「OAuth トークンの平文保存は暗号化またはハッシュ化が必要」）
- 外部資料の取得日時: 2026-10-10 01:07 JST

### 前提と範囲

- 「OAuth トークン」は、外部サービスの API を呼ぶために GrowMate が保持している資格情報（access token / refresh token / アプリケーションパスワード / クライアントシークレット）を指す。
- 社内発行の一時トークン（`employee_invitations.invitation_token`、`suggestion_job_token`、`job_token`）は外部サービスの資格情報ではないため対象外とし、§1.3 に参考として載せる。
- CodeRabbit 指摘の「ハッシュ化して保存」は採れない。GrowMate は OAuth の**クライアント側**で、保存したトークンをそのまま Google / WordPress.com / Instagram の API へ送る必要があり、一方向ハッシュからは元の値を復元できないため。

---

## 1. 平文保存箇所の一覧

### 1.1 一覧

| # | テーブル | カラム | 型 / NULL | 定義 migration | 読み書きコード（全て `src/server/services/supabaseService.ts`） |
|-|-|-|-|-|-|
| 1 | `gsc_credentials` | `refresh_token` | text not null | `supabase/migrations/20251112090000_create_gsc_credentials_table.sql` L5 | 読: `getGscCredentialByUserId` / 書: `upsertGscCredential` |
| 2 | `gsc_credentials` | `access_token` | text null | 同 L6 | 読: `getGscCredentialByUserId` / 書: `upsertGscCredential`, `updateGscCredential` |
| 3 | `google_ads_credentials` | `access_token` | text not null | `supabase/migrations/20260115000000_create_google_ads_credentials_table.sql` L13 | 読: `getGoogleAdsCredential` / 書: `saveGoogleAdsCredential` |
| 4 | `google_ads_credentials` | `refresh_token` | text not null | 同 L14 | 読: `getGoogleAdsCredential` / 書: `saveGoogleAdsCredential` |
| 5 | `instagram_credentials` | `access_token` | text not null | `supabase/migrations/20260726000000_create_instagram_credentials_table.sql` L15 | 読: `getInstagramCredential` → `mapInstagramCredentialRow` / 書: `saveInstagramCredential`, `updateInstagramCredential` |
| 6 | `wordpress_settings` | `wp_access_token` | text null | `supabase/migrations/20250603153000_create_wordpress_settings_table.sql` L7（`20251130030000_add_wp_tokens_to_wordpress_settings.sql` でも `add column if not exists`） | 読: `getWordPressSettingsResultByUserId` / 書: `createOrUpdateWordPressSettings`, `refreshWpComToken` |
| 7 | `wordpress_settings` | `wp_refresh_token` | text null | 同 L8（同上） | 読: `getWordPressSettingsResultByUserId` / 書: `createOrUpdateWordPressSettings`, `refreshWpComToken` |
| 8 | `wordpress_settings` | `wp_client_secret` | text（当初 not null → `20250614000000_update_wordpress_settings_for_selfhost.sql` L25 で null 許可） | `20250603153000_create_wordpress_settings_table.sql` L5 | 読: `getWordPressSettingsResultByUserId` / 書: `createOrUpdateWordPressSettings` |
| 9 | `wordpress_settings` | `wp_application_password` | text null | `20250614000000_update_wordpress_settings_for_selfhost.sql` L18 | 読: `getWordPressSettingsResultByUserId` / 書: `createOrUpdateSelfHostedWordPressSettings` |

補足（コードから読み取れる事実）:

- 4テーブルとも RLS は有効。ただしサーバー側は `SupabaseService` のコンストラクタで Service Role クライアントを使う（`supabaseService.ts` L60-64「RLSをバイパス」）。RLS は DB 漏洩・Service Role キー漏洩に対する防御にならない。
- 4テーブルの SELECT ポリシーはすべて本人の行だけ（`user_id = auth.uid()`）。オーナー/スタッフ共有モデルは廃止済みで、`get_accessible_user_ids` は本番 DB に存在せず、参照するポリシー・関数も無い（2026-10-10 に `supabase db query --linked` で `pg_proc` / `pg_policies` を確認。削除した migration はリポジトリにも適用履歴にも無い）。名残として `gsc_credentials` と `wordpress_settings` に `role <> 'owner'` を条件に含む書き込みポリシー（`*_mutation_own`）が本人限定ポリシーと重複して残っている。
- `wp_client_secret` は OAuth callback（`app/api/wordpress/oauth/callback/route.ts` L20-21, L198-204）で環境変数 `WORDPRESS_COM_CLIENT_SECRET` の値をそのまま行に複製して保存し、設定画面経由（`app/api/wordpress/settings/route.ts` L81-87、`src/server/actions/wordpress.actions.ts` L411）では `''` で上書きしている。読む側の `refreshWpComToken`（L935-936）は `settings.wpClientSecret || process.env.WORDPRESS_COM_CLIENT_SECRET` で、空なら環境変数に落ちる。**アプリ共通のシークレットを全ユーザー行に複製している構造**であり、暗号化より「保存をやめる」が筋（§4.2）。
- `wordpress_settings` には CHECK 制約 `wordpress_settings_fields_check`（`20250614000000_...` L32-37）があり、`wp_client_secret` と `wp_application_password` の NOT NULL を種別ごとに要求している。カラムを入れ替える migration ではこの制約の付け替えが必須。

### 1.2 DB 以外の平文保持（参考。今回の暗号化対象外）

- WordPress.com の access token は DB 保存に加えて、HttpOnly Cookie `wpcom_oauth_token` にも平文で入る（`app/api/wordpress/oauth/callback/route.ts` L211-220、定数は `src/server/services/wordpressContext.ts` L14）。ブラウザ側の保持であり DB 暗号化の範囲外。別タスク候補として §6 に載せる。

### 1.3 対象外としたトークン系カラム（参考）

| テーブル / 関数 | カラム・引数 | 対象外の理由 |
|-|-|-|
| `employee_invitations` | `invitation_token`（`20251227204537_add_employee_invitations.sql` L16） | 社内発行の招待トークン。外部 API 資格情報ではない（ハッシュ化は別論点） |
| GSC 提案ジョブ系 | `suggestion_job_token` uuid、`job_token` | 社内のジョブ識別子 |
| RPC 引数 | `p_token text`（招待受諾 RPC 群） | テーブル列ではない |

### 1.4 検索根拠（再現用コマンド）

対象 checkout のリポジトリ直下で実行。

```bash
# migration 内のトークン・秘密系カラム名の出現（列名ごとの件数）
rg -n -i '\b[a-z_]*(token|secret|password|api_key)[a-z_]*\b' supabase/migrations -o \
  | awk -F: '{print $3}' | sort | uniq -c | sort -rn
# → access_token / refresh_token / wp_access_token / wp_refresh_token / wp_client_secret /
#   wp_application_password と、対象外の invitation_token / suggestion_job_token / job_token / p_token のみ

# 型定義（DB 実体から生成された database.types.ts）側でも同じ集合か
rg -n -o '^\s+[a-z_]*(token|secret|password)[a-z_]*\??:' src/types/database.types.ts \
  | sed 's/^[0-9]*:\s*//' | tr -d ' ?:' | sort | uniq -c
# → access_token, access_token_expires_at, access_token_issued_at, refresh_token, job_token,
#   suggestion_job_token, wp_access_token, wp_application_password, wp_client_secret,
#   wp_refresh_token, wp_token_expires_at（migration 側と一致。migration 外で作られた列は無い）

# 暗号化の既存実装が無いこと
rg -l -i 'vault|pgsodium|pgcrypto|encrypt' supabase src app   # → 0 件

# トークン列に触れるコードが supabaseService.ts だけであること
rg -n "\b(access_token|refresh_token|wp_access_token|wp_refresh_token|wp_client_secret|wp_application_password)\b" \
  src app scripts -g '!**/database.types.ts' -g '!**/supabaseService.ts'
# → OAuth レスポンス JSON・外部 API へのリクエスト引数・Cookie のみ。DB 列への直接アクセスは 0 件

# 4テーブルを from() しているファイル
rg -n "(gsc_credentials|google_ads_credentials|instagram_credentials|wordpress_settings)" src app scripts -g '!**/database.types.ts'
# → supabaseService.ts 以外（analyticsContentService.ts / ga4Dashboard.actions.ts / scripts/check-active-users.ts）
#   は ga4_property_id・wp_site_url 等の非トークン列だけを select している
```

結論: **トークン列の DB 読み書きは `supabaseService.ts` の 12 メソッドに集約されている**。暗号化・復号をこの層に閉じれば、呼び出し元（callback route・server actions・cron サービス）は平文トークンを受け取る現在のインターフェースのまま動く。

---

## 2. 暗号化方式の比較と推奨案

### 2.1 一次資料で確認した事実（取得: 2026-10-10 01:07 JST）

- Supabase Vault（<https://supabase.com/docs/guides/database/vault>）
  - Secrets は Authenticated Encryption（libsodium ベースの AEAD）でディスク上に暗号化保存され、`vault.decrypted_secrets` ビューで復号済みの値が見える。
  - 暗号鍵はデータベース内に保存されず、Supabase がプロジェクトごとに管理する。DB ダンプを取られても見えるのは暗号文だけ。
  - 「`vault.decrypted_secrets` ビューにアクセスできる者は復号済み secret にアクセスできる」ため、権限設定で保護せよと明記。
  - 用途の想定は「Postgres Functions, Triggers, Webhooks から secret を使う」こと。
  - 同一プロジェクト内の復元・ブランチング・新プロジェクトへの Restore は鍵を引き継ぐが、手動 `pg_dump` / `pg_restore` で新プロジェクトへ移すと新しい鍵になり復号できない（Management API で root key をコピーする必要あり）。
- pgsodium（<https://supabase.com/docs/guides/database/extensions/pgsodium>）
  - Supabase は pgsodium の利用を推奨しない（deprecated 予定）。Vault を使えと明記。
  - pgsodium 由来の Transparent Column Encryption も「運用の複雑さと設定ミスのリスクが高い」ため推奨しない。
  - Supabase のプロジェクトはデフォルトで保存時暗号化されている。
- Vault の関数定義（supabase/vault リポジトリ `sql/supabase_vault--0.3.0.sql`、0.3.1 は SQL 変更なし。最新コミット `ace8280` 2026-09-29 時点 <https://github.com/supabase/vault>）
  - `vault.create_secret(new_secret text, new_name text = NULL, new_description text = '', new_key_id uuid = NULL) RETURNS uuid SECURITY DEFINER`
  - `vault.update_secret(secret_id uuid, new_secret text = NULL, new_name text = NULL, new_description text = NULL, new_key_id uuid = NULL) RETURNS void SECURITY DEFINER`
  - 両関数は `REVOKE ALL ... FROM PUBLIC`。`vault.secrets.name` は NULL 以外で一意。

### 2.2 候補の絞り込み

pgsodium（TCE 含む）は Supabase 公式が非推奨と明記しているため候補から外す。比較は **A: Supabase Vault** と **B: アプリ層 AEAD（Node 標準 `node:crypto` の AES-256-GCM、鍵は Vercel 環境変数）** の2案に絞る。

### 2.3 比較軸と評価

| 比較軸 | A: Supabase Vault | B: アプリ層 AES-256-GCM |
|-|-|-|
| DB ダンプ・バックアップ流出 | 防げる（鍵は DB 外） | 防げる（鍵は Vercel 側） |
| Service Role キー流出 | **防げない**。GrowMate のサーバーは Service Role で動くため、同じキーで復号 RPC を呼べば平文が取れる | 防げる。DB から取れるのは暗号文だけで、鍵（Vercel 環境変数）も別途必要 |
| 鍵管理の運用 | Supabase 管理。ローテーション・紛失を自前で考えなくてよい | 自前。鍵紛失＝全トークン復号不能（＝全ユーザー再連携）。ローテーション手順を持つ必要あり |
| DB 側でトークンを使う処理との相性 | 良い（Vault の想定用途） | DB 側では使えない。**現状 DB 側の利用者は無い**（`supabase/functions` 不在、migration 内の関数・cron にトークン参照なし） |
| 変更量 | migration（列追加・ラッパー RPC・削除トリガー）＋ `supabaseService.ts` の読み書きを RPC 経由へ | migration（列追加・制約付け替え）＋ `supabaseService.ts` に暗号化ヘルパー呼び出し。新規依存なし |
| 1リクエストあたりの往復 | 読み取りは RPC 1回（JOIN で取れる）。書き込みは `create_secret` / `update_secret` を伴う RPC | 変わらない（暗号化・復号はプロセス内） |
| 行削除時の後始末 | `vault.secrets` に孤児が残るため削除トリガーが必要（`users` の cascade 削除も含む） | 不要（暗号文は同じ行にある） |
| 環境間の可搬性 | 手動 dump/restore で鍵が変わる（公式明記） | 鍵を同じにすれば可搬。Preview/Production で鍵が違うと同じ DB の値を読めない |
| 公式ドキュメントでの位置づけ | Supabase が secret 保管手段として推奨 | Supabase 公式の範囲外（一般的なアプリ層暗号化） |

### 2.4 推奨案

**推奨: B（アプリ層 AES-256-GCM）。A（Vault）は次点。**

根拠:

1. GrowMate の脅威で最も現実的なのは「Service Role キー（Vercel 環境変数・ローカル `.env.local` に存在）の流出」と「DB ダンプの流出」。A は後者しか防げない。サーバーが Service Role で全テーブルに触れる構成（§1.1 補足）では、復号 RPC を service_role 限定にしても、そのキーを持つ攻撃者は復号できる。B は DB 側の権限が何であっても、Vercel 側の鍵を併せて盗まれない限り平文にならない。
2. Vault の公式想定用途は DB 内（関数・トリガー・Webhook）で secret を使うこと。GrowMate にはトークンを DB 内で使う処理が無く（§2.3）、アプリが毎回取り出して外部 API に送るだけなので、Vault の利点が活きない。
3. トークン列の読み書きが `supabaseService.ts` の 12 メソッドに集約済み（§1.4）なので、B の変更は1ファイル＋ヘルパー1つに閉じる。暗号化は Node 標準 `node:crypto` で足り、依存追加は不要（Node 24.x、`package.json` engines）。
4. B 最大の弱点「鍵紛失＝全トークン失効」は、トークンが再 OAuth で取り直せる性質のため、データ消失ではなく「全ユーザーに再連携を依頼する」事象にとどまる（§5）。

A を選ぶべき条件（要人間判断）: 自前の鍵ローテーション運用を持ちたくない、または将来 DB 内（pg_cron・DB 関数）からトークンを使う計画がある場合。その場合の SQL 下書きは §3.4 に置く。

---

## 3. 推奨案（B）の migration 案と既存データの移行手順

### 3.1 暗号文の形式

- 1値を `text` 1列に格納: `v1:<keyId>:<iv base64url>:<authTag base64url>:<ciphertext base64url>`
  - `bytea` にしない理由: supabase-js は `bytea` を 16 進文字列で受け渡しするため扱いが煩雑で、型生成（`database.types.ts`）も `string` になり利点が無い。
- アルゴリズム: AES-256-GCM、IV は値ごとに 12 byte 乱数、認証タグ 16 byte。
- AAD（追加認証データ）: `<table>:<column>:<user_id>`。別ユーザー行・別列への暗号文の付け替えを復号失敗にする。
- 鍵: 環境変数 `TOKEN_ENCRYPTION_KEYS`（`keyId=base64(32byte)` をカンマ区切り）と `TOKEN_ENCRYPTION_ACTIVE_KEY_ID`。暗号化は active 鍵、復号は暗号文の keyId で鍵を引く（ローテーション用）。

### 3.2 migration 下書き（3段階: 拡張 → 移行 → 縮退）

**M1: 拡張（暗号文列を追加し、平文列の NOT NULL を外す）** — `supabase/migrations/<ts>_add_encrypted_token_columns.sql`

```sql
-- 暗号文列を追加。平文列は M3 まで残す（ロールバックはコードの revert だけで済む）

alter table public.gsc_credentials
  add column if not exists refresh_token_enc text,
  add column if not exists access_token_enc text;
alter table public.gsc_credentials
  alter column refresh_token drop not null;

alter table public.google_ads_credentials
  add column if not exists access_token_enc text,
  add column if not exists refresh_token_enc text;
alter table public.google_ads_credentials
  alter column access_token drop not null,
  alter column refresh_token drop not null;

alter table public.instagram_credentials
  add column if not exists access_token_enc text;
alter table public.instagram_credentials
  alter column access_token drop not null;

alter table public.wordpress_settings
  add column if not exists wp_access_token_enc text,
  add column if not exists wp_refresh_token_enc text,
  add column if not exists wp_application_password_enc text;

-- self_hosted の必須条件を「平文 or 暗号文のどちらか」に緩める。
-- wordpress_com の wp_client_secret 必須も外す（§4.2: 環境変数から読むため行に持たない）
alter table public.wordpress_settings
  drop constraint if exists wordpress_settings_fields_check;
alter table public.wordpress_settings
  add constraint wordpress_settings_fields_check check (
    (wp_type = 'wordpress_com' and wp_site_id is not null)
    or
    (wp_type = 'self_hosted' and wp_site_url is not null and wp_username is not null
      and (wp_application_password is not null or wp_application_password_enc is not null))
  );

comment on column public.gsc_credentials.refresh_token_enc is 'AES-256-GCM 暗号文（v1:keyId:iv:tag:ct）';
-- 他の *_enc 列にも同じコメントを付ける

-- Rollback:
--   alter table public.wordpress_settings drop constraint if exists wordpress_settings_fields_check;
--   alter table public.wordpress_settings add constraint wordpress_settings_fields_check check (
--     (wp_type = 'wordpress_com' and wp_client_id is not null and wp_client_secret is not null and wp_site_id is not null)
--     or (wp_type = 'self_hosted' and wp_site_url is not null and wp_username is not null and wp_application_password is not null));
--   alter table public.gsc_credentials drop column if exists refresh_token_enc, drop column if exists access_token_enc;
--   alter table public.google_ads_credentials drop column if exists access_token_enc, drop column if exists refresh_token_enc;
--   alter table public.instagram_credentials drop column if exists access_token_enc;
--   alter table public.wordpress_settings drop column if exists wp_access_token_enc,
--     drop column if exists wp_refresh_token_enc, drop column if exists wp_application_password_enc;
--   NOT NULL の再付与は、M2 以降に平文列が null の行があると失敗する。null 行の有無を確認してから行う
```

**M2: 既存データの移行**（SQL ではなくスクリプト。鍵が DB の外にあるため）— §3.3

**M3: 縮退（平文列を消す）** — 観察期間を置いた後の別 migration `<ts>_drop_plaintext_token_columns.sql`

```sql
-- 前提: 全行で暗号文列が埋まっていること（下の検証クエリが 0 件）
alter table public.gsc_credentials drop column if exists refresh_token, drop column if exists access_token;
alter table public.google_ads_credentials drop column if exists access_token, drop column if exists refresh_token;
alter table public.instagram_credentials drop column if exists access_token;
alter table public.wordpress_settings
  drop column if exists wp_access_token,
  drop column if exists wp_refresh_token,
  drop column if exists wp_application_password,
  drop column if exists wp_client_secret;

alter table public.wordpress_settings drop constraint if exists wordpress_settings_fields_check;
alter table public.wordpress_settings add constraint wordpress_settings_fields_check check (
  (wp_type = 'wordpress_com' and wp_site_id is not null)
  or (wp_type = 'self_hosted' and wp_site_url is not null and wp_username is not null
      and wp_application_password_enc is not null)
);

-- 元の NOT NULL 契約を暗号文列で回復
alter table public.gsc_credentials alter column refresh_token_enc set not null;
alter table public.google_ads_credentials
  alter column access_token_enc set not null,
  alter column refresh_token_enc set not null;
alter table public.instagram_credentials alter column access_token_enc set not null;

-- Rollback: 平文列は復元できない。§5.2 の「M3 後のロールバック」手順（復号スクリプト）で戻す
```

M3 前の検証クエリ（全て 0 件であること）:

```sql
select count(*) from public.gsc_credentials        where refresh_token is not null and refresh_token_enc is null;
select count(*) from public.gsc_credentials        where access_token  is not null and access_token_enc  is null;
select count(*) from public.google_ads_credentials where refresh_token is not null and refresh_token_enc is null;
select count(*) from public.google_ads_credentials where access_token  is not null and access_token_enc  is null;
select count(*) from public.instagram_credentials  where access_token  is not null and access_token_enc  is null;
select count(*) from public.wordpress_settings     where wp_refresh_token is not null and wp_refresh_token_enc is null;
select count(*) from public.wordpress_settings     where wp_access_token  is not null and wp_access_token_enc  is null;
select count(*) from public.wordpress_settings     where wp_application_password is not null and wp_application_password_enc is null;
```

### 3.3 既存平文データの移行手順

| 段階 | 作業 | 完了確認 |
|-|-|-|
| 0 | 鍵を生成（`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`）し、Vercel の Production / Preview / Development とローカル `.env.local` に `TOKEN_ENCRYPTION_KEYS` / `TOKEN_ENCRYPTION_ACTIVE_KEY_ID` を登録。鍵のバックアップ先（パスワードマネージャ等）を決めて保管 | 全環境で同じ鍵か、Preview が本番 DB を見ない構成かを確認（§6） |
| 1 | M1 を適用 | `database.types.ts` を再生成し `*_enc` 列が出ること |
| 2 | **二重書き込み版**のコードをデプロイ。書き込みは平文列と暗号文列の両方、読み取りは「暗号文があれば復号、無ければ平文」 | 新規連携・トークン更新後の行で `*_enc` が埋まること |
| 3 | バックフィルスクリプト `scripts/backfill-encrypt-tokens.ts`（新規）を実行。対象は `*_enc is null and 平文 is not null` の行。各行を暗号化して `*_enc` を `update ... where id = ? and *_enc is null` で書く（並行するリフレッシュとの競合時は二重書き込み側の値を優先）。dry-run で件数を出してから本実行 | §3.2 の検証クエリが全て 0 件。各テーブルからランダム抽出した行を復号し平文列と一致すること |
| 4 | **暗号文のみ**版のコードをデプロイ。平文列への書き込みを止め、読み取りも暗号文だけにする | エラーログに復号失敗が無いこと。GSC / GA4 / Google Ads / Instagram / WordPress の cron が観察期間中に成功していること |
| 5 | 観察期間（【推測】最低1週間。週次 cron が一巡する長さ）の後、M3 を適用 | M3 適用後も cron・手動操作が成功すること |

`wp_client_secret` は暗号化せず、段階2のコードから読み書きをやめ（§4.2）、M3 で列ごと落とす。

### 3.4 次点案（A: Vault）を採る場合の SQL 下書き

```sql
-- 例: gsc_credentials.refresh_token。他の列も同型
alter table public.gsc_credentials add column if not exists refresh_token_secret_id uuid;

-- 既存行の移行（鍵は Supabase 側にあるため SQL だけで完結する）
update public.gsc_credentials
set refresh_token_secret_id = vault.create_secret(refresh_token, null, 'gsc_credentials.refresh_token:' || user_id)
where refresh_token is not null and refresh_token_secret_id is null;

-- 読み取り用ラッパー。vault スキーマは PostgREST に公開しないため、public の関数を service_role 限定で公開する
create or replace function public.get_gsc_refresh_token(p_user_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from public.gsc_credentials c
  join vault.decrypted_secrets ds on ds.id = c.refresh_token_secret_id
  where c.user_id = p_user_id
$$;
revoke all on function public.get_gsc_refresh_token(uuid) from public, anon, authenticated;
grant execute on function public.get_gsc_refresh_token(uuid) to service_role;

-- 行削除（users の cascade 含む）で vault.secrets に孤児を残さない
create or replace function public.delete_gsc_credential_secrets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.refresh_token_secret_id;
  return old;
end
$$;
create trigger delete_gsc_credential_secrets
  after delete on public.gsc_credentials
  for each row execute function public.delete_gsc_credential_secrets();
```

- 書き込みも `vault.create_secret` / `vault.update_secret` を呼ぶ service_role 限定ラッパー RPC が要る（アクセストークンは期限切れのたびに更新されるため `update_secret` の呼び出し頻度が高い。`saveGoogleAdsCredential` は `expires_in` が無いとき期限を1時間後に置いている: L1065-1070）。
- `security definer` 関数から `vault.secrets` を削除できるかは、関数所有ロール（通常 `postgres`）の権限に依存する。**未確認**（§6）。

---

## 4. 読み書きコードの変更点（推奨案 B）

### 4.1 新規: 暗号化ヘルパー

- `src/server/lib/token-crypto.ts`（新規、`import 'server-only'`）
  - `encryptToken(plain: string, aad: { table: string; column: string; userId: string }): string`
  - `decryptToken(cipher: string, aad: ...): string`（認証タグ不一致・未知の keyId は例外。黙って平文や null に倒さない）
  - 鍵は `src/env.ts` の既存パターンでサーバー専用環境変数として検証する。
- 単体テスト `tests/unit/server/lib/token-crypto.test.ts`（往復・AAD 違いで失敗・keyId ローテーション）。

### 4.2 `src/server/services/supabaseService.ts`（関数単位）

| メソッド（現行行番号） | 変更 |
|-|-|
| `getWordPressSettingsResultByUserId`（L778） | `wpAccessToken` / `wpRefreshToken` / `wpApplicationPassword` を `*_enc` から復号して返す（段階2は平文フォールバックあり）。`wpClientSecret` は返さない |
| `createOrUpdateWordPressSettings`（L819） | `accessToken` / `refreshToken` を暗号化して `wp_access_token_enc` / `wp_refresh_token_enc` に書く。「渡されたときだけ書く」条件付き展開（L840-847 のコメントの契約）は維持。`wpClientSecret` 引数と `wp_client_secret` 書き込みを削除（呼び出し元3箇所も追随） |
| `createOrUpdateSelfHostedWordPressSettings`（L868） | `wp_application_password_enc` に暗号化して書く |
| `refreshWpComToken`（L918） | 更新結果を暗号化して書く。クライアントシークレットは `process.env.WORDPRESS_COM_CLIENT_SECRET` のみから取る（`settings.wpClientSecret ||` を削除）。現状 `update` の `error` を見ていない（L978-986）ので、暗号化導入時に失敗を検知するよう直すかは別判断 |
| `getGscCredentialByUserId`（L1004） | `refreshToken` / `accessToken` を復号 |
| `saveGoogleAdsCredential`（L1054） | `access_token_enc` / `refresh_token_enc` に暗号化して書く |
| `getGoogleAdsCredential`（L1100） | 復号して返す |
| `upsertGscCredential`（L1454） | `refresh_token_enc` / `access_token_enc` に暗号化して書く |
| `updateGscCredential`（L1525） | `accessToken` 指定時に暗号化して書く |
| `mapInstagramCredentialRow`（L2651。`getInstagramCredential` L2715 から呼ばれる） | `accessToken` を復号 |
| `saveInstagramCredential`（L2669） | `access_token_enc` に暗号化して書く |
| `updateInstagramCredential`（L2734） | `accessToken` 指定時に暗号化して書く |

- 戻り値の型（`GscCredential`、`InstagramCredential`、`WordPressSettings`、`getGoogleAdsCredential` の戻り値）は平文トークンのまま変えない。これで呼び出し元は無変更にできる。
- 復号失敗時の扱い: 例外をそのまま上げると cron が全件止まるため、`get*` 系では「資格情報なし（null）」ではなく**再連携が必要**と区別できる失敗を返す設計にする。既存の再連携導線（例: `ensureValidInstagramToken` の `needsReauth`）との接続方法は実装時に決める。

### 4.3 変更しないもの（理由付き）

- `src/server/services/googleTokenService.ts`: トークン交換・リフレッシュの HTTP 呼び出しだけで、DB に触れない（全 223 行を確認）。永続化は呼び出し元が渡す `persistToken` 経由で `supabaseService` に届く。変更不要。
- `src/server/services/instagramTokenService.ts` / `src/server/lib/instagram-token.ts`: 同上。
- OAuth callback route（`app/api/gsc/oauth/callback/route.ts`、`app/api/google-ads/oauth/callback/route.ts`、`app/api/instagram/oauth/callback/route.ts`、`app/api/wordpress/oauth/callback/route.ts`）: `supabaseService` に平文を渡すだけなので無変更。例外は WordPress callback の `createOrUpdateWordPressSettings` 呼び出し（L198-204）で、`clientSecret` 引数の削除に追随する。
- `app/api/wordpress/settings/route.ts` L81-87、`src/server/actions/wordpress.actions.ts` L411: `clientSecret` に `''` を渡している呼び出しを、引数削除に追随させる。
- トークンを受け取って使う側（`src/server/lib/google-auth.ts`、`src/server/lib/home-google-credential.ts`、`src/server/actions/{googleAds,gscSetup,ga4Setup,gscDashboard,instagramSetup,instagramSync,wordpress,wordpressImport}.actions.ts`、`src/server/services/{ga4Import,gscImport,ga4ContentEvaluation,googleAdsAiAnalysis,googleAdsNegativeKeywordsSuggestion,instagramSync}Service.ts` ほか）: 平文を受け取るインターフェースが変わらないため無変更。

### 4.4 更新が必要なテスト

トークン列を参照しているテスト（`rg -l 'access_token|refresh_token|wp_access_token|wpAccessToken|saveGoogleAdsCredential|saveInstagramCredential|upsertGscCredential' tests`）:

- `tests/unit/server/services/supabaseService.wordpressSettings.test.ts`
- `tests/unit/server/services/supabaseService.instagramCredential.test.ts`
- `tests/unit/server/services/instagramService.test.ts`
- `tests/unit/server/actions/googleAds.actions.test.ts`
- `tests/unit/server/services/wordpressContentSync.test.ts`
- `tests/unit/server/lib/instagram-connection.test.ts`

DB 行のモックが平文列を前提にしている箇所を `*_enc` に置き換える（テスト用の固定鍵を環境変数で与える）。

### 4.5 並行計画との関係

`docs/plans/supabase-service-split.md`（ステータス approved）が `supabaseService.ts` をドメイン別に分割する計画。どちらを先に入れるかで §4.2 の変更先ファイルが変わる。順序は要人間判断（§6）。

---

## 5. ロールバック手順とリスク

### 5.1 段階別のロールバック

| 失敗が出た時点 | 戻し方 | 再連携が必要になるか |
|-|-|-|
| 段階1（M1 適用後） | M1 の Rollback SQL | ならない |
| 段階2（二重書き込み） | コードを revert。平文列は常に最新なので旧コードがそのまま動く | ならない |
| 段階3（バックフィル） | スクリプト停止。`*_enc` を null に戻す（`update ... set *_enc = null`）か放置して段階2のまま | ならない |
| 段階4（暗号文のみ） | コードを段階2版へ戻す。ただし段階4の間に更新されたトークンは平文列に書かれていない。戻す前に「`*_enc` を復号して平文列へ書き戻す」スクリプト（バックフィルの逆）を実行する | 書き戻しを省くと、段階4中に refresh token が更新された行（WordPress.com は更新時に新しい refresh token を返し得る: `refreshWpComToken` L982 `json.refresh_token ?? refreshToken`）で古いトークンを使うことになり失敗し得る |
| 段階5（M3 適用後） | 平文列を `add column` で戻し、逆スクリプトで復号して書き戻し、旧コードをデプロイ | 鍵が残っていればならない |

### 5.2 再認証（再連携）が必要になる条件

1. **暗号鍵の紛失**: 全テーブルの暗号文が復号不能になり、全ユーザーで GSC / GA4 / Google Ads / Instagram / WordPress.com の再連携が必要。セルフホスト WordPress はアプリケーションパスワードの再入力が必要。→ 鍵のバックアップを段階0の完了条件にする。
2. **環境間の鍵不一致**: Preview や別環境が本番 DB を見ていて鍵が違う場合、その環境で書いた行は本番で復号できない（AES-GCM の認証タグ不一致）。
3. **AAD 不一致**: `user_id` を書き換える運用（アカウント統合など）があると、その行の暗号文は復号できない。【推測】現行コードに `user_id` を更新する処理があるかは未確認（§6）。
4. **段階4のロールバックで書き戻しを省いた場合**（§5.1）。
5. 暗号化と無関係に、プロバイダ側でトークンが失効している場合（ユーザーによる連携解除、期限切れなど）。各プロバイダの失効条件は本調査の範囲外で**未確認**。

### 5.3 その他のリスク

- **ログへの平文流出は今回の対象外**: 暗号化しても、復号後の値をログに出せば漏れる。現状 `googleTokenService.ts` はエラー時にレスポンス本文（L143-147, L186-189）をログに出しているが、これはトークン交換エラーの本文でありトークン自体ではない。他経路のログに平文トークンが出ていないかは全件は未確認。
- **鍵ローテーション中の書き込み競合**: ローテーションは「新鍵を active にしてから再暗号化スクリプト」で行う。旧鍵は全行の再暗号化が終わるまで鍵リングから外さない。
- **性能**: AES-256-GCM の暗号化・復号はリクエストあたり数個の短い文字列で、【推測】体感できる影響は無い。計測はしていない。

---

## 6. 未確認事項（ローカルのコードだけでは判断できない点）

| # | 未確認事項 | 確かめ方 | 影響 |
|-|-|-|-|
| 1 | 本番 DB の各テーブルの行数、および平文列が埋まっている行数 | 本番 DB で §3.2 の検証クエリの平文側だけを実行 | バックフィル所要時間・M3 の判断 |
| 2 | `wordpress_settings.wp_client_secret` に、環境変数 `WORDPRESS_COM_CLIENT_SECRET` と**異なる**値（ユーザーごとの独自アプリ）を持つ行があるか | 本番で `select count(*) from wordpress_settings where coalesce(wp_client_secret,'') <> ''` を取り、値の一致を人が確認 | 異なる行があれば §4.2 の「保存をやめる」は採れず、暗号化対象に戻す |
| 3 | Vercel の Preview / Development 環境が本番 Supabase を見ているか | Vercel の環境変数設定を確認 | 見ているなら全環境で同じ鍵が必須（§5.2-2） |
| 4 | 暗号鍵の保管先（Vercel 以外のバックアップ） | 人が決める | 鍵紛失時の全ユーザー再連携リスク |
| 5 | Supabase プロジェクトで Vault 拡張が有効か・そのバージョン | Supabase ダッシュボード（Database → Extensions）。今回は操作していない | A 案を採る場合のみ |
| 6 | A 案の削除トリガー（`security definer`）が `vault.secrets` を削除できる権限を持つか | ステージング DB で試す | A 案を採る場合のみ |
| 7 | 検証用のステージング Supabase プロジェクトの有無 | `supabase/` 配下に `config.toml` が無く、ローカル Supabase の構成はリポジトリから確認できなかった | migration の事前検証手段 |
| 8 | `user_id` を後から書き換える処理・運用（アカウント統合等）の有無 | `rg "user_id" src` で update 経路を追う、運用者に確認 | AAD に `user_id` を含める設計の可否（§5.2-3） |
| 9 | Supabase Auth 経由（anon key + ユーザー JWT）でこれら4テーブルを直接 select できる経路が実運用で使われているか | `src/lib/supabase/server.ts` 等の利用箇所確認、PostgREST のログ。ポリシーが本人の行だけを返すことは確認済み（§1.1 補足） | 使われていなければ SELECT ポリシー自体を削る選択肢がある |
| 10 | `supabase-service-split` 計画との実施順 | 人が決める | §4.2 の変更先ファイル |
| 11 | WordPress.com access token を Cookie `wpcom_oauth_token` に平文で置いている件（§1.2）を同時に扱うか | 人が決める | 別タスク化するか |
| 12 | 各プロバイダ（Google / Meta / WordPress.com）のトークン失効条件 | 各社公式ドキュメント | 再連携が必要になる頻度の見積もり |
