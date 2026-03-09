# メールログイン（OTP）追加仕様 & LINE 併存方針

**作成日**: 2026-03-01  
**更新日**: 2026-03-09  
**ステータス**: ドラフト

---

## 1. 目的・背景

### 1.1 目的

現行の LINE LIFF 認証に加え、メールアドレスによる OTP（ワンタイムパスワード）認証を追加する。  
ただし、認証手段の追加と課金プランは分離して扱い、`users.id` を変えずに既存ユーザーへ Email 認証を追加できる形を採用する。

### 1.2 背景

- LINE LIFF に依存した認証はモバイルブラウザ制約や LINE アプリ未導入環境で障壁となる
- B2B SaaS としてメールベースの認証は顧客の期待値に合致する
- `paid は email only / trial は line only` のように課金プランで認証方式を分けると、運用・保守・問い合わせ対応が複雑化する
- 既存の `user_id` 参照テーブルが多く、別ユーザーへの移行を基本設計にするとデータ移行コストが高い

---

## 2. 設計原則

### 2.1 本仕様の結論

本仕様では以下を採用する。

1. `users` はアプリケーションの主体（課金・権限・スタッフ構造・業務データの所有者）として固定する
2. 認証手段は `users` に対して追加される「ログイン手段」として扱う
3. LINE / Email は併存可能とする
4. 課金プランによってログイン方式を強制的に切り替えない
5. 将来的に「有料化時にメール登録必須」とすることは可能だが、「メールログイン専用化」は本 Phase では行わない

### 2.2 採用しない案

- `paid` ユーザーは Email のみ、`trial` ユーザーは LINE のみとする設計
- LINE ユーザーと Email ユーザーを別 `users.id` として保持し、移行時に全テーブルの `user_id` を付け替える設計
- `auth_provider='line' | 'email'` を単一値で持ち、排他的に管理する設計

### 2.3 理由

- 認証方式の変更が課金状態の変更に巻き込まれない
- 問い合わせ時の復旧手順が単純になる
- 既存の `user_id` 参照 18 テーブルを原則そのまま維持できる
- 将来的に他認証（Google 等）を追加しても破綻しにくい

---

## 3. スコープ

### 対象

- **Phase 1**: OTP（6桁コード）によるメールログイン機能の追加
- **Phase 1**: 既存 `users` に Email 認証をリンクする仕組みの追加
- **Phase 1.5**: 既存 LINE ユーザーへ Email 認証を安全に追加する運用手順の整備

### 非対象

- Phase 2 以降のマルチドメイン管理（`account_id` 導入）
- パスワード認証
- ソーシャルログイン（Google, GitHub 等）の追加
- LINE 認証の廃止
- 課金プランによる認証方式の強制切り替え
- 既存の業務データを別 `users.id` へ全面移行する大規模マイグレーション

---

## 4. 用語定義

| 用語 | 定義 |
|------|------|
| OTP（One-Time Password） | メールアドレスに送信される 6 桁の一回限りの認証コード |
| Supabase Auth | Supabase が提供する認証基盤。メール送信・トークン管理・セッション管理を担う |
| `auth.users` | Supabase Auth が内部管理するユーザーテーブル |
| `public.users` | アプリ独自のユーザーテーブル。課金、ロール、スタッフ構造、業務データの所有主体 |
| メール認証リンク | 既存 `users.id` に対して `auth.users.id` と email を関連付けること |
| 認証主体 | 実際にログインした手段（LINE または Email） |
| アプリ主体 | アプリ内の業務データ所有者。常に `public.users.id` を指す |

---

## 5. 前提条件

### 5.1 現行認証フロー

```text
LINE アプリ
  → LINE OAuth 2.1（/api/auth/line-oauth-init）
  → LINE Callback（/api/line/callback）
  → アクセストークン + リフレッシュトークンを httpOnly Cookie に保存
  → authMiddleware が Cookie からトークンを取得・検証
  → UserService.getUserFromLiffToken() でユーザー取得/作成
```

### 5.2 現行 Supabase 利用状況

- `@supabase/supabase-js` v2.75.0 を使用
- Supabase Auth 機能は未使用
- `@supabase/ssr` は未導入
- Supabase は PostgreSQL + RLS を主用途として利用中

### 5.3 現行 users テーブル

```sql
CREATE TABLE users (
  id                    UUID PRIMARY KEY,
  line_user_id          TEXT NOT NULL UNIQUE,
  line_display_name     TEXT NOT NULL,
  line_picture_url      TEXT,
  line_status_message   TEXT,
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  role                  TEXT NOT NULL DEFAULT 'trial'
                        CHECK (role IN ('trial','paid','admin','unavailable','owner')),
  owner_user_id         UUID REFERENCES users(id),
  owner_previous_role   TEXT,
  full_name             TEXT,
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL
);
```

### 5.4 user_id を保持する全テーブル一覧

既存の `user_id` 参照が広いため、本仕様では **別ユーザーへのデータ移行を基本設計にしない**。  
既存の `users.id` を維持したまま Email 認証を追加する。

---

## 6. Phase 1: OTP（6桁コード）認証

### 6.1 設計方針

OTP のメール送信・トークン管理・セッション管理は **Supabase Auth に委譲** する。  
ただし、`public.users` は引き続きアプリの主体として保持し、`auth.users` をそのまま業務主体にはしない。

```text
Supabase Auth が担当するもの:
  - OTP コード生成
  - メール送信
  - OTP 検証
  - セッション発行
  - セッション更新

アプリ側が担当するもの:
  - auth.users と public.users の紐付け
  - authMiddleware の LINE / Email 二重対応
  - ログイン UI
  - Email 認証のリンク運用
```

### 6.2 認証モデル

#### 6.2.1 採用モデル

同一 `users.id` に対して LINE / Email を併存可能にする。

```text
users
├── id
├── role
├── stripe_customer_id
├── owner_user_id
├── ...
├── line_user_id           NULL許容
├── line_display_name      NULL許容
├── email                  NULL許容
└── supabase_auth_id       NULL許容
```

#### 6.2.2 重要な制約

- `users.id` は不変の業務主体
- `line_user_id` は引き続き一意
- `email` は一意
- `supabase_auth_id` は一意
- `line_user_id` と `email` は両方入っていてよい
- `auth_provider` のような排他的状態は持たない

### 6.3 DB変更

#### 6.3.1 users テーブル拡張

```sql
-- マイグレーション: add_email_auth_columns_to_users.sql

ALTER TABLE users ADD COLUMN email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN supabase_auth_id UUID UNIQUE;

ALTER TABLE users ALTER COLUMN line_user_id DROP NOT NULL;
ALTER TABLE users ALTER COLUMN line_display_name DROP NOT NULL;

ALTER TABLE users ADD CONSTRAINT users_auth_identity_check
  CHECK (
    line_user_id IS NOT NULL
    OR (email IS NOT NULL AND supabase_auth_id IS NOT NULL)
  );
```

同時に実施するもの:

- Email 認証リンク処理を記録する監査ログテーブル
- Email 認証向けの RLS / service_role 実行境界の明確化
- 手動リンク運用で使用する更新経路の制限

#### 6.3.2 auth.users 同期方針

`auth.users` 作成時に常に新しい `public.users` を作る方式は採用しない。  
理由は、既存 LINE ユーザーへ Email 認証を追加するケースで別 `users.id` が作られると、全面移行が必要になるためである。

採用方針:

1. **新規 Email ユーザー**
   - `auth.users` 作成後、対応する `public.users` が存在しなければ新規作成する
2. **既存 LINE ユーザーへの Email 追加**
   - 運用または明示的なリンク処理で、既存 `public.users` に `email` と `supabase_auth_id` を設定する
   - 自動トリガーで別 `users.id` を生やさない

推奨実装:

- `auth.users` への単純な `AFTER INSERT TRIGGER` は使わない
- Server Action / 管理用処理で `auth.users.id` と `public.users.id` の紐付けを明示的に行う
- 必要なら補助的な DB 関数は用意するが、「未リンクなら無条件に user 作成」は禁止する

### 6.4 OTP 認証フロー

#### 6.4.1 ステップ1: メールアドレス入力 → OTP 送信

```text
ユーザー:
  - /login でメールアドレスを入力
  - 「認証コードを送信」を押下

クライアント:
  - createSupabaseBrowserClient() を使用
  - supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })

Supabase Auth:
  - 6桁コードを送信
```

注意:

- `shouldCreateUser: true` を維持する
- エラー時はメール列挙攻撃対策のため汎用メッセージを返す
- OTP 送信時点では、既存 LINE ユーザーへのリンク完了を保証しない

#### 6.4.2 ステップ2: OTP 検証 → セッション確立

```text
クライアント:
  - Server Action に email / token を送る

サーバー:
  - createSupabaseServerClient() で verifyOtp()
  - Supabase セッション Cookie を設定
  - auth.users.id を解決
  - public.users を以下の順で解決する
      1. supabase_auth_id 一致
      2. email 一致かつ未リンク
      3. どちらも無ければ新規 users 作成
```

#### 6.4.3 リンク時のルール

`verifyOtp()` 成功後の `public.users` 解決ルールは以下とする。

1. `supabase_auth_id = auth.users.id` の行があればそれを採用
2. なければ `email = auth.users.email` の既存行を検索
3. 既存行があり、`supabase_auth_id IS NULL` ならその `users` 行へリンクする
4. 既存行がなく、メール認証のみの新規利用者なら新規 `users` を作成する
5. 既存行があり、別の `supabase_auth_id` が入っている場合はエラー

この方式により、既存 LINE ユーザーへの Email 認証追加は **同一 `users.id` へのリンク** で完結する。

### 6.5 セッション管理

- `@supabase/ssr` を導入する
- Email 認証は Supabase Auth Cookie を利用する
- LINE 認証は既存 Cookie を維持する
- 認証優先順位は以下とする

```text
1. Supabase Auth セッション（Email）
2. LINE Cookie
3. どちらも無い場合は未認証
```

### 6.6 authMiddleware の理想形

#### 6.6.1 責務

`authMiddleware` は「どの認証方式で入ったか」を吸収し、最終的に **同じ `public.users.id` を返す** 層とする。

```text
責務:
  - Supabase Auth セッションの検証
  - LINE トークンの検証
  - 認証主体から app user を解決
  - role / subscription / owner view mode の共通判定

責務外:
  - 認証方式ごとの UI 振り分け
  - users レコードの大規模移行
```

#### 6.6.2 返却値の方針

`AuthenticatedUser` は `lineUserId` を主キー的に扱わず、`userId` を常に主とする。

```typescript
interface AuthenticatedUser {
  userId: string;
  authMethod: 'line' | 'email';
  lineUserId: string | null;
  email: string | null;
  userDetails: User | null;
  requiresSubscription: boolean;
  subscription: Stripe.Subscription | null;
  // 既存の viewMode, actorUserId, actorRole などは維持
}
```

#### 6.6.3 呼び出し側の変更原則

既存コードの多くが `line_access_token` を明示的に渡して `authMiddleware` を呼んでいる。  
Email 対応後は以下へ寄せる。

1. 呼び出し側が Cookie から LINE トークンを読む責務を減らす
2. `authMiddleware()` または `ensureAuthenticated()` が request context から両認証を解決する
3. 業務ロジックは `authResult.userId` を使う
4. `lineUserId` を必要とするのは LINE API 呼び出しなど最小範囲に限定する

#### 6.6.4 段階移行の原則

`lineUserId` 依存は一括で置換しない。以下の段階で進める。

1. `authMiddleware` が常に `userId` を返せる状態にする
2. 既存の `lineUserId` は互換フィールドとして当面維持する
3. 影響範囲の小さい呼び出し側から `userId` ベースへ順次切り替える
4. LINE API 呼び出しなど真に必要な箇所のみ `lineUserId` を残す

優先順:

- `/api/user/current`
- 設定系・管理系
- 読み取り系機能
- 更新系機能
- chat / subscription など影響が大きい機能

### 6.7 ログイン UI

#### 6.7.1 画面要件

- `/login` に Email OTP と LINE ログインの両方を配置
- OTP 入力 UI は 6 桁、数字のみ、ペースト対応、`autocomplete="one-time-code"` を有効にする
- エラー表示は列挙耐性を維持する

#### 6.7.2 文言方針

- 既存ユーザー向けには「LINE でもメールでもログインできます」
- 有料化導線などでメール登録を推奨する場合は「推奨」であって強制ではない

### 6.8 Supabase Auth 設定

| 設定項目 | 値 |
|---------|-----|
| Site URL | `{NEXT_PUBLIC_SITE_URL}` |
| Email Auth | 有効 |
| メールテンプレート | OTP（`{{ .Token }}`） |
| OTP 有効期限 | 3,600秒（デフォルト維持） |
| OTP 再送信制限 | 60秒に1回 |
| Auth API rate limit | Supabase デフォルト |
| Hosted email 送信枠 | 開発用途のみ。本番はカスタム SMTP を前提とする |

本番環境のメール送信設定、SMTP 選定、SPF / DKIM / DMARC、テンプレート文面、レート制限の運用基準は  
[docs/email-delivery-setup-guide.md](/Users/shoma.endo/private/GrowMate/docs/email-delivery-setup-guide.md) を参照する。

### 6.9 ログアウトフロー

- Email ユーザー: `supabase.auth.signOut()`
- LINE ユーザー: 既存 `liff.logout()` + LINE Cookie クリア
- `/api/user/current` は `authMethod` と `email` を返す
- 取得失敗時のフォールバックとして両方のクリーンアップを許容する

### 6.10 新規・変更ファイル一覧

```text
新規:
  src/lib/supabase/server.ts
  src/lib/supabase/middleware.ts
  src/lib/supabase/client.ts
  src/server/actions/auth.actions.ts
  app/login/page.tsx

変更:
  src/server/middleware/auth.middleware.ts
  src/server/services/userService.ts
  src/server/services/supabaseService.ts
  src/types/user.ts
  src/authUtils.ts
  app/api/user/current/route.ts
  middleware.ts
  src/hooks/useLiff.ts
  src/components/LiffProvider.tsx
  package.json

マイグレーション:
  supabase/migrations/XXXXXX_add_email_auth_columns_to_users.sql
  supabase/migrations/XXXXXX_create_email_auth_audit_logs.sql

マイグレーション後:
  supabase gen types typescript --project-id <ref> > src/types/database.types.ts

### 6.11 Feature Flag 方針

Email 認証は段階的に公開する。少なくとも以下の Feature Flag を導入する。

```text
email_auth_enabled
  - Email 認証機能全体のマスター制御

email_auth_login_enabled
  - /login 上で Email OTP UI を表示するか

email_auth_linking_enabled
  - 既存 LINE ユーザーへの Email リンク処理を許可するか

email_auth_rollout_scope
  - 公開対象: admin_only / internal / allowlist / all
```

推奨ロールアウト順:

1. `admin_only`
2. `internal`
3. `allowlist`
4. `all`

Flag が `off` の間は、既存 LINE ログインの挙動を完全維持することを要件とする。
```

---

## 7. Phase 1.5: 既存 LINE ユーザーへの Email 認証追加

### 7.1 概要

Phase 1.5 は「LINE ユーザーのデータを別 `users.id` へ移すフェーズ」ではない。  
既存 `users.id` に対して Email 認証をリンクする運用を整備するフェーズである。

### 7.2 標準フロー

```text
前提:
  - source_user_id は既存 LINE ユーザーの users.id
  - target_email は追加したいメールアドレス

流れ:
  1. 運用担当が本人確認を行う
  2. Supabase Auth 側で target_email の OTP ログインを成立させる
  3. auth.users.id を取得する
  4. public.users(source_user_id) に email / supabase_auth_id を設定する
  5. Email / LINE の両方で同じ users.id にログインできることを確認する
```

### 7.3 実装方針

#### 7.3.1 採用

- `users.id` は維持
- `email` と `supabase_auth_id` を既存行へ追加
- LINE ログインは維持

#### 7.3.2 採用しない

- `migrate_user_data(source_user_id, target_user_id)` のような全面データ移行 RPC
- `role='unavailable'` にして旧アカウントを無効化することを前提とした運用
- スタッフ構造や Stripe 情報を別 user に移す処理

### 7.4 運用手順（Runbook）

```text
1. 依頼受付
   - ユーザーからメールログイン追加希望を受領

2. 本人確認
   - target_email 宛に確認コードを送信
   - 既存アカウント情報を照合
   - 承認者と実行者を分離する

3. 事前確認
   - source_user_id を確定
   - target_email が他 users に既に紐付いていないことを確認
   - target_email が他 supabase_auth_id に既に紐付いていないことを確認

4. Email 認証成立
   - OTP ログインまたは Admin API で auth.users を作成
   - auth.users.id を取得

5. リンク処理
   - users.id = source_user_id の行へ email / supabase_auth_id を設定

6. 完了確認
   - LINE ログインで同一 users.id が返る
   - Email ログインで同一 users.id が返る
   - Stripe / owner_user_id / 既存データに変化がない

7. 監査ログ保存
   - 実行者、承認者、実行時刻、source_user_id、email、supabase_auth_id を記録
```

### 7.5 例外ケース

#### 7.5.1 既に別ユーザーへ紐付いた email

- 既存他ユーザーに `email` が入っている場合はリンク禁止
- データ統合が必要な場合は個別ケースとして別途判断する
- 本 Phase の標準運用では「2 つの users を統合する」ことを扱わない

#### 7.5.2 既に別 `supabase_auth_id` が紐付いている場合

- リンク処理を停止し、誤紐付けとして管理者確認へ回す

#### 7.5.3 LINE 未保有の新規 Email ユーザー

- 新規 `users` を作成して通常利用を開始する

---

## 8. セキュリティ考慮事項

### 8.1 メール認証

| 脅威 | 対策 |
|------|------|
| OTP の盗聴 | HTTPS 必須、Supabase Auth の短期コードを利用 |
| ブルートフォース | Supabase Auth の送信・検証レート制限を使用 |
| メール列挙攻撃 | `shouldCreateUser: true` と汎用エラーメッセージを採用 |
| セッションハイジャック | httpOnly Cookie を使用 |
| CSRF | SameSite Cookie を使用 |

### 8.2 Email リンク運用

| 脅威 | 対策 |
|------|------|
| 他人アカウントへの Email 追加 | 本人確認 + 承認フロー |
| 誤リンク | `email` / `supabase_auth_id` の一意制約 + 事前確認 |
| 監査不能 | 実行者、承認者、対象 user を監査ログへ保存 |

### 8.3 レート制限

| 対象 | 制限 |
|------|------|
| OTP 送信 | Supabase Auth デフォルト |
| OTP 検証 | Supabase Auth デフォルト |
| Email リンク運用の確認コード | 運用ツール側で制限する。実装時に保存先を別途定義する |

### 8.4 監査ログ

最低限、以下のイベントを監査対象とする。

- Email OTP ログイン成功 / 失敗
- `auth.users.id` と `public.users.id` のリンク成功 / 失敗
- 手動 Email リンク運用の実行
- Feature Flag による拒否
- 既存 `supabase_auth_id` 競合の検知

---

## 9. 工数見積もり

### Phase 1: OTP 認証追加

- DB変更（RLS / 監査ログ含む）: 1-1.5日
- Feature Flag 導入: 0.5-1日
- Supabase Auth クライアント整備: 1日
- authMiddleware 二重対応: 2-3日
- `/login` UI 実装: 1-2日
- `/api/user/current` とクライアント追従: 1-2日
- 呼び出し側の段階移行: 2-4日

### Phase 1.5: Email リンク運用整備

- Runbook 作成: 0.5-1日
- 管理用リンク処理または運用手順の整備: 1-2日
- 検証: 1日

### 合計

7-13日程度

---

## 10. 実装順序

### 10.1 Step 1: DB 変更

実装:

- `users` へ `email` / `supabase_auth_id` を追加
- 監査ログテーブルを追加
- RLS / service_role 境界を定義

テスト:

- 既存 LINE 認証に影響がない
- 既存クエリが壊れない

検証:

- migration 適用後に既存機能が動作する

ロールバック:

- Email 認証をまだ使用していない段階なら migration rollback 可能

### 10.2 Step 2: Feature Flag 導入

実装:

- `email_auth_enabled`
- `email_auth_login_enabled`
- `email_auth_linking_enabled`
- `email_auth_rollout_scope`

テスト:

- すべて `off` の状態で現行挙動を維持できる

検証:

- 管理画面または設定値変更で公開対象を制御できる

ロールバック:

- Flag を `off` に戻すことで機能を即時停止できる

### 10.3 Step 3: Supabase Auth 基盤追加

実装:

- Supabase client / server / middleware を追加

テスト:

- Flag `off` では未使用
- 基盤追加のみで既存挙動に変化がない

検証:

- 開発環境で OTP 送信・検証の最小確認を行う

ロールバック:

- Flag `off` のままなら影響遮断可能

### 10.4 Step 4: authMiddleware 二重対応

実装:

- `authMiddleware` を Email / LINE 二重対応にする
- `userId` を主、`lineUserId` を互換として返す

テスト:

- LINE ユーザーの回帰確認
- Email ユーザーの認証成功

検証:

- `/api/user/current` を除く既存主要画面で LINE 認証が維持される

ロールバック:

- Email 系 Flag を閉じ、LINE 認証のみ運用へ戻す

### 10.5 Step 5: `/login` と `/api/user/current` の段階公開

実装:

- `/login` に Email OTP UI を追加
- `/api/user/current` を両認証対応に更新

テスト:

- `admin_only` で admin のみ Email ログイン可能
- 一般ユーザーは既存 LINE ログインのみ見える

検証:

- 内部テストユーザーで OTP ログイン成功

ロールバック:

- `email_auth_login_enabled = off`

### 10.6 Step 6: 呼び出し側の段階移行

実装:

- `lineUserId` 依存を `userId` 依存へ順次置換

順序:

1. `/api/user/current`
2. 設定系 / 管理系
3. 読み取り中心の機能
4. 更新系
5. chat / subscription のような高リスク機能

テスト:

- 各機能単位で `実装 → 画面確認 → API 確認 → 権限制御確認`

検証:

- 1機能ずつマージ / 展開して回帰を抑える

ロールバック:

- 問題のある機能だけ差し戻せる単位で進める
- 一括置換はしない

### 10.7 Step 7: Email リンク運用の整備

実装:

- Runbook 確定
- 監査ログ運用確定
- allowlist ユーザーで運用テスト

テスト:

- 同一 `users.id` へ Email がリンクされる
- Stripe / owner_user_id に変化がない

検証:

- `admin_only` → `internal` → `allowlist` → `all` の順で公開

ロールバック:

- `email_auth_linking_enabled = off`
- `email_auth_rollout_scope` を直前段階へ戻す

---

## 11. テスト・検証戦略

### 11.0 基本サイクル

各ステップは必ず以下で進める。

```text
実装
  → 単体テスト / 手動テスト
  → 検証環境確認
  → ロールバック条件の確認
  → 次ステップへ進む
```

### 11.1 認証

- 新規 Email ユーザーがログインできる
- 既存 LINE ユーザーが従来通りログインできる
- 同一ユーザーが LINE / Email の両方で同一 `users.id` に到達する
- Supabase セッション優先、LINE フォールバックが機能する

### 11.2 既存機能影響

- `/setup/*`
- `/analytics`
- chat 系 API
- GSC / GA4 / Google Ads / WordPress 連携
- 管理画面

上記すべてで Email ユーザーが `authMiddleware` を通過できることを確認する。

### 11.3 段階的ロールアウト検証

- `admin_only` で管理者のみ Email ログイン可能
- `internal` で社内検証ユーザーのみ利用可能
- `allowlist` で限定顧客のみ利用可能
- `all` へ拡大後も LINE ログインが維持される

### 11.4 ロールバック確認

- Feature Flag を `off` に戻した際に既存 LINE ログインへ復帰できる
- Email ログイン公開停止時に管理画面・主要導線が壊れない
- DB に追加したカラムが存在していても既存機能が継続動作する

### 11.5 運用

- Email リンク時に `users.id` が変わらない
- Stripe 情報が維持される
- `owner_user_id` が維持される
- 監査ログを残せる

---

## 12. 補足方針

本仕様では「認証手段の追加」と「課金プランの制御」を明確に分離する。  
将来的に有料化時の要件としてメールアドレス登録必須を導入することは可能だが、それでもなお **ログイン手段を 1 つに強制しない** ことを原則とする。
