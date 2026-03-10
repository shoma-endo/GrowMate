# メールログイン（OTP）追加仕様 & 既存 LINE ユーザー手動移行方針

**作成日**: 2026-03-01  
**更新日**: 2026-03-10  
**ステータス**: ドラフト

---

## 1. 目的・背景

### 1.1 目的

本仕様の目的は以下の 2 点に限定する。

1. **Phase 1**: **メールログイン機能の開発** — 新規メールユーザー向けに、メールアドレスによる OTP（ワンタイムパスワード）ログインを追加する
2. **Phase 1.5**: **既存 LINE ユーザーをメールログイン可能なアカウントに移行** — 開発者が手動で同一 `users.id` のまま Email ログインを付与し、既存の業務データ（Stripe・owner 関係等）を維持したうえで Email ログイン可能にする（別 `users.id` へのデータ移行は行わない）

補足:

- Phase 1 以降の**新規ユーザー**は、`メール OTP` または `LINE ログイン` のいずれでも利用開始できる
- 本仕様では **`1 email = 1 account`** を採用する
- **既存 LINE ユーザー**は Phase 1 では自由に Email へ切り替える対象ではなく、Phase 1.5 の手動リンク対象とする

**フェーズのフォーカス**

| フェーズ | フォーカス |
|----------|-------------|
| **Phase 1** | メールログイン機能の開発（新規ユーザー向け OTP ログイン・セッション・既存全機能の両対応） |
| **Phase 1.5** | 既存 LINE ユーザーのメール移行（同一 `users.id` 維持・既存データはそのまま・手動リンク手順の整備） |

本仕様では、将来の認証多様化に向けた汎用基盤整備は目的に含めない。

### 1.2 背景

- LINE LIFF に依存した認証は、LINE アプリ未導入環境や PC 利用時の障壁になる
- B2B SaaS として、メールログインの提供は導入時の期待値と合致する
- 既存の `user_id` 参照テーブルが多いため、既存 LINE ユーザーを別 `users.id` へ移す設計は避けたい
- 今回は最小工数で Email ログインを導入するため、将来拡張前提の抽象化や段階ロールアウトは行わない

---

## 2. 設計原則

### 2.1 本仕様の結論

1. `public.users.id` は引き続きアプリケーションの主体とする
2. **Phase 1** では、新規 Email ユーザーのみを正式サポートする
3. **Phase 1** では、既存 LINE ユーザーの自動 Email リンクは行わない
4. **Phase 1** では、既存 LINE ユーザーに Email ログイン導線を表示しない（二重 `users.id` の発生を防ぐ）
5. **Phase 1.5** では、開発者が手動で既存 LINE ユーザーへ Email ログインを付与する
6. 既存 LINE ログインは維持し、LINE 導線停止や LINE セッション禁止は本仕様の対象外とする
7. **`1 email = 1 account` を採用し、`auth.users` と `public.users` は 1:1 で関連付ける**

### 2.2 採用しない案

- 既存 LINE ユーザーが自力で Email を追加できるセルフリンク機能
- OTP 検証時に `email` 一致だけで既存 `users` 行へ自動リンクする方式
- `authMiddleware` 全体を将来拡張前提で全面再設計する対応
- Feature Flag による `admin_only` / `allowlist` / `internal` などの段階ロールアウト
- LINE 導線停止や LINE 認証の段階的無効化
- 別 `users.id` への大規模データ移行
- 共有メール前提の複数アカウント選択 UI
- `public.user_auth_identities` のような中間テーブルを Phase 1 の必須構成にする設計

### 2.3 理由

- 今回の主目的は「新規 Email ログイン追加」と「既存 LINE ユーザーの手動移行」に限られる
- 汎用化や段階公開の仕組みは工数に対して効果が小さい
- 自動リンクは誤リンク・競合・運用判断のコストが高く、今回の最小実装方針と相性が悪い
- `1 email = 1 account` に固定する方が、OTP ログイン、セッション解決、UI、運用手順が単純で事故が少ない

---

## 3. MVP の境界（必要最低限の範囲）

本仕様は **必要最低限の MVP** に限定する。以下を満たす範囲を Phase 1 / Phase 1.5 のスコープとし、これを超える機能は Phase 2 以降とする。

### Phase 1 の MVP に含めるもの（これ以下だと「メールログイン」が成立しない）

- 新規ユーザーがメールアドレス + OTP でログインできること
- ログイン後に `/api/user/current` で `userId` が取得できること（クライアントが「誰でログインしているか」を判別できること）
- Email ユーザーが現在の LINE ユーザーと同様に `/` 配下の既存機能を利用できること
- 既存 LINE ログインに影響しないこと
- 二重 `users.id` を防ぐための最小措置（LINE ログイン済み時は Email 導線非表示、既存 LINE ユーザーへの自動リンク禁止）

### Phase 1 の MVP に含めないもの（意図的にスコープ外）

- 管理 UI・セルフリンク・段階ロールアウト用 Flag
- 監査ログ・自動リンク・パスワード認証・ソーシャルログイン
- アカウント選択 UI

### Phase 1.5 の MVP に含めるもの

- 既存 LINE ユーザーに Email ログインを手動で付与する手順（Runbook）
- 同一 `users.id` 維持による既存データの保持（別 ID へのデータ移行は行わない）

### Phase 1.5 の MVP に含めないもの

- 管理 UI・セルフリンク・承認フロー・全面データ移行 RPC

**判定**: 上記境界内に収まっているため、本仕様は必要最低限の MVP となっている。

---

## 4. スコープ（対象・非対象）

### 対象

- **Phase 1（メールログイン機能開発）**
  - OTP（6桁コード）による新規メールログイン機能の追加
  - 新規 Email ユーザー作成時の `public.users` 生成
  - 新規ユーザーが `メール OTP` または `LINE ログイン` のいずれかを選んで利用開始できる導線
  - Email セッションで `/api/user/current` を返せるようにする対応
  - Email セッションで `authMiddleware` / 認証解決を既存全機能で利用できるようにする対応
  - 既存 Route Handler / Server Action / service 層 / クライアント初期化の両対応
- **Phase 1.5（既存 LINE ユーザーのメール移行）**
  - 既存 LINE ユーザーへ Email ログインを手動でリンクする手順の整備
  - 同一 `users.id` を維持するため、既存業務データの移行は不要（当該行へのカラム追加のみ）

### 非対象

- 既存 LINE ユーザーの自動 Email リンク
- エンドユーザー向けのセルフ移行 UI
- 認証多様化を見越した汎用認証基盤の整備
- Feature Flag による段階ロールアウト
- LINE ログイン導線の停止
- LINE 認証の廃止
- パスワード認証
- ソーシャルログイン（Google, GitHub 等）
- 既存の業務データを別 `users.id` へ全面移行するマイグレーション

---

## 5. 用語定義

| 用語 | 定義 |
|------|------|
| OTP（One-Time Password） | メールアドレスに送信される 6 桁の一回限りの認証コード |
| Supabase Auth | Supabase が提供する認証基盤。メール送信・トークン管理・セッション管理を担う |
| `auth.users` | Supabase Auth が内部管理するユーザーテーブル |
| `public.users` | アプリ独自のユーザーテーブル。課金、ロール、スタッフ構造、業務データの所有主体 |
| Email リンク | 既存 `public.users.id` に対して Email ログインを手動で関連付けること |
| 新規 Email ユーザー | Phase 1 で初めて Email OTP を使ってログインし、新規 `public.users` が作られるユーザー |

---

## 6. 前提条件

### 6.1 現行認証フロー

```text
LINE アプリ
  → LINE OAuth 2.1（/api/auth/line-oauth-init）
  → LINE Callback（/api/line/callback）
  → アクセストークン + リフレッシュトークンを httpOnly Cookie に保存
  → authMiddleware が Cookie からトークンを取得・検証
  → UserService.getUserFromLiffToken() でユーザー取得/作成
```

### 6.2 現行 Supabase 利用状況

- `@supabase/supabase-js` v2.75.0 を使用
- Supabase Auth 機能は未使用
- `@supabase/ssr` は未導入
- Supabase は PostgreSQL + RLS を主用途として利用中
- 保護ページの入場判定は `/api/auth/check-role` と `LiffProvider` が担っており、現状は LINE セッション前提で動作している

### 6.3 現行 users テーブル

```sql
CREATE TABLE users (
  id                     UUID PRIMARY KEY,
  line_user_id           TEXT NOT NULL UNIQUE,
  line_display_name      TEXT NOT NULL,
  line_picture_url       TEXT,
  line_status_message    TEXT,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  role                   TEXT NOT NULL DEFAULT 'trial'
                         CHECK (role IN ('trial','paid','admin','unavailable','owner')),
  owner_user_id          UUID REFERENCES users(id),
  owner_previous_role    TEXT,
  full_name              TEXT,
  last_login_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL,
  updated_at             TIMESTAMPTZ NOT NULL
);
```

### 6.4 基本方針

既存の `user_id` 参照が広いため、既存 LINE ユーザーを別 `users.id` へ移す設計は採用しない。  
既存 LINE ユーザーの Email 化が必要な場合は、Phase 1.5 で **同一 `users.id` に手動リンク** する。

---

## 7. Phase 1: 新規メール OTP ログイン

### 7.1 設計方針

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
  - auth.users と public.users の 1:1 紐付け
  - 新規 Email ユーザーの public.users 作成
  - /login UI
  - 認証解決層の LINE / Email 両対応
  - 既存機能を Email セッションでも利用可能にするための追従

Supabase SSR の実装原則:

- Browser 側は `createBrowserClient()`、Server 側は `createServerClient()` を分離する
- Server 側の認証確認は `supabase.auth.getSession()` ではなく `supabase.auth.getUser()` を基準にする
- client 側の認証状態を信頼せず、Route Handler / Server Action / Server Component 側で認証を確定する
- セッション更新は middleware で扱い、下流で refresh 責務を分散させない
- request 内での認証解決は共通層へ集約し、複数箇所で refresh を競合させない
```

### 7.2 認証モデル

#### 7.2.1 採用モデル

Phase 1 の対象は新規 Email ユーザーである。  
既存 LINE ユーザーへの Email リンクは Phase 1.5 で手動実施する。

```text
auth.users
  └─ 1:1 ─ public.users

users
├── id
├── role
├── stripe_customer_id
├── owner_user_id
├── ...
├── line_user_id           NULL許容
├── line_display_name      NULL許容
├── email                  NULL許容
└── supabase_auth_id       NULL許容 / UNIQUE
```

#### 7.2.2 重要な制約

- `users.id` は不変の業務主体
- `line_user_id` は一意
- `users.email` は **case-insensitive unique**
- `users.supabase_auth_id` は一意
- 1 つの `auth.users.id` は 1 つの `public.users.id` のみを解決する
- `auth_provider` のような排他的状態は持たない
- `public.users.email` を業務上の正とし、`auth.users.email` は認証基盤側の属性として扱う

### 7.3 DB変更

#### 7.3.1 users テーブル拡張

```sql
-- マイグレーション: add_email_auth_columns_to_users.sql

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN supabase_auth_id UUID UNIQUE;

ALTER TABLE users ALTER COLUMN line_user_id DROP NOT NULL;
ALTER TABLE users ALTER COLUMN line_display_name DROP NOT NULL;

ALTER TABLE users ADD CONSTRAINT users_auth_identity_check
  CHECK (
    line_user_id IS NOT NULL
    OR email IS NOT NULL
  );

CREATE UNIQUE INDEX users_email_unique_ci_idx
  ON users (LOWER(email))
  WHERE email IS NOT NULL;
```

Phase 1 では以下は実施しない。

- 監査ログテーブルの追加
- 自動リンク用の DB トリガー
- 管理 UI 用の補助テーブル
- migration rollback 対応

補足:

- `users.email` はログインおよび連絡先に使うため case-insensitive unique とする
- `auth.users.email` は整合がずれる可能性があるため、業務側の正は `public.users.email` とする
- 本 migration は既存データと新規認証データを跨るため、**irreversible（単純 rollback 不可）** として扱う

#### 7.3.2 auth.users 同期方針

Phase 1 では `auth.users` 作成時に、既存 `public.users` を `email` 一致だけで自動リンクしない。  
OTP 検証成功後は、`auth.users.id` に紐づく `public.users.supabase_auth_id` を解決する。

採用方針:

1. `users.supabase_auth_id = auth.users.id` の行を取得する
2. 1 件あれば、その `users.id` を採用する
3. 0 件なら、新規 `public.users` を **atomic に作成** する
4. 既存 LINE ユーザーへの自動リンクは行わない

実装要件:

- `public.users` の作成処理は再実行可能であること
- 新規ユーザー作成は `INSERT ... ON CONFLICT ... RETURNING` 等で atomic に整合を保つこと
- `verifyOtp()` の多重実行や複数タブ競合でも、同じ `auth.users.id` に対して `public.users` が重複作成されないこと
- cleanup 運用ではなく、同一入力で再試行しても最終状態が収束することを優先する
- ただし `signInWithOtp()` により `auth.users` が先行作成されうるため、**未使用の orphan `auth.users` を定期クリーンアップする運用**を別途持つ

### 7.4 OTP 認証フロー

#### 7.4.1 ステップ1: メールアドレス入力 → OTP 送信

```text
ユーザー:
  - /login でメールアドレスを入力
  - 「認証コードを送信」を押下

クライアント:
  - `/login` から Server Action / Route Handler / Edge Function を呼ぶ
  - browser client から `signInWithOtp()` を直接呼ばない

サーバー / Edge:
  - IP / email 単位のレート制限を検査する
  - Supabase client を通して `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })` を実行する
  - `detectSessionInUrl: false` を設定する
  - `persistSession: true` / `autoRefreshToken: true` を有効にする

Supabase Auth:
  - 6桁コードを送信する
```

注意:

- `shouldCreateUser: true` を維持する
- OTP 送信は **Server Action / Route Handler / Edge Function 経由を必須** とし、client 直呼びでのレート制限回避を許容しない
- エラー時はメール列挙攻撃対策のため汎用メッセージを返す
- Phase 1 では既存 LINE ユーザーへのリンク完了を保証しない
- OTP 再送信 UI を提供する
- `signInWithOtp()` は未登録メールに対して `auth.users` を作成しうるため、OTP 送信 API は abuse 対策を前提にする

#### 7.4.1.1 OTP abuse 対策

- `signInWithOtp()` は未登録メールに対して `auth.users` を事前作成しうるため、`public.users` 側だけでなく OTP 送信段階の防御を入れる
- 最低限、**IP 単位**および**email 単位**の送信レート制限を設ける
- レート制限は UI 表示だけでなく、**Server Action / Route Handler / Edge Function 側で強制**する
- 想定基準:
  - 1 email あたり: 60秒に1回まで
  - 1 IP あたり: 1分間に5回程度を上限の目安とする
- bot 由来の大量送信が懸念される環境では CAPTCHA を追加できる設計にしておく
- 新規ユーザー向けの `/login` では `shouldCreateUser: true` を維持する
- 将来、既存ユーザー専用の OTP 再認証導線を別途追加する場合は、`shouldCreateUser: false` を使い分けられる構造にする
- `signInWithOtp()` だけ実行されて `verifyOtp()` まで到達しなかった `auth.users` に備え、`last_sign_in_at IS NULL` かつ一定期間経過したレコードを対象にした cleanup job または手動 Runbook を用意する

#### 7.4.2 ステップ2: OTP 検証 → セッション確立

```text
クライアント:
  - Server Action に email / token を送る

サーバー:
  - createSupabaseServerClient() で verifyOtp()
  - Supabase セッション Cookie を設定
  - auth.users.id を解決
  - public.users を以下の順で解決する
      1. `users.supabase_auth_id` 一致を検索
      2. 0件なら `public.users` を atomic に新規作成
      3. 1件ならその `users.id` を採用
  - 途中失敗時も再実行で整合するよう idempotent に扱う
```

#### 7.4.3 public.users 解決ルール

`verifyOtp()` 成功後の `public.users` 解決ルールは以下とする。

1. `users.supabase_auth_id = auth.users.id` の行を取得する
2. 1 件なら、その `users.id` を採用する
3. 0 件なら、新規 Email ユーザーとして `public.users` を atomic に作成する
4. `email` 一致だけで既存 `users` 行へ自動リンクはしない

補足:

- 並列 `verifyOtp()` やブラウザ再送が起きても、同じ `auth.users.id` に対して `public.users` が重複作成されないこと
- `verifyOtp()` 後のユーザー作成は `SELECT -> INSERT` ではなく、`INSERT ... ON CONFLICT ... RETURNING` を基本形とする
- 主戦略は orphan cleanup ではなく、`public.users` 側の解決・作成を再実行可能にすること

### 7.5 セッション管理

- `@supabase/ssr` を導入する
- Email 認証は Supabase Auth Cookie を利用する
- LINE 認証は既存 Cookie を維持する
- Phase 1 では `/api/user/current` に加え、既存の保護ページ・Route Handler・Server Action・service 層で認証解決を両対応にする
- LINE ユーザーが現在使えている既存機能は、Email ユーザーでも同等に利用可能であることを要件とする

#### 7.5.0 Supabase SSR 基本ルール

- Browser 用 Supabase client は `src/lib/supabase/client.ts` に分離する
- Server 用 Supabase client は `src/lib/supabase/server.ts` に分離する
- middleware 用の cookie bridge は `src/lib/supabase/middleware.ts` に集約する
- Server 側の認証確認は `supabase.auth.getUser()` を使い、`getSession()` を認証可否判定に使わない
- middleware で `supabase.auth.getUser()` を実行し、必要な token refresh を先に済ませる
- Route Handler / Server Action / Server Component では、middleware 済み Cookie を前提に `getUser()` と `public.users` 解決を行う
- request 内の認証解決は共通層へ寄せ、refresh 責務を複数箇所に分散させない

#### 7.5.1 /api/user/current のセッション種別検出

`/api/user/current` は Email セッションと LINE セッションの両方をサポートする。Phase 1 では Route Handler 単位の個別対応に留めず、**認証解決の共通層で両方のセッションを扱えるようにする**。

| 項目 | 仕様 |
|------|------|
| **Cookie 確認順序** | 1. Supabase Auth セッション → 2. LINE セッションの順で確認する |
| **並行セッションの扱い** | Phase 1 では **同一ブラウザ内** の LINE / Email セッション同時併存を避ける。Email ログイン成功時は既存 LINE Cookie を削除し、LINE ログイン成功時は Supabase Auth セッションを破棄する。やむを得ず両方が存在する場合は、`active_session_type` 等の明示的な状態で解決元を決める |
| **authMiddleware との関係** | `authMiddleware` または同等の共通認証解決層で、Supabase Auth セッションと LINE セッションの両方を解決できるようにする。個別 Route Handler への局所対応ではなく、既存呼び出し元から利用できる形に寄せる |
| **Server 側の認証確認** | `supabase.auth.getUser()` を使用して Auth サーバーで再検証する。`getSession()` は認証可否の根拠にしない |

**解決ロジック（推奨実装）**

```text
getCurrentUser():
  0. active_session_type があればそれを優先する
  1. Supabase Auth セッションを確認
     - createSupabaseServerClient() で supabase.auth.getUser() を実行
     - 有効なセッションがあれば、`users.supabase_auth_id` から `public.users` を解決する
  2. 上記でユーザーが得られなければ、LINE セッションを確認（既存ロジック）
     - Cookie から LINE トークンを取得
     - あれば UserService.getUserFromLiffToken() で public.users を取得して返す
  3. いずれもなければ null を返す（未ログイン）
```

疑似コード:

```ts
// /api/user/current のセッション解決（疑似コード）
async function getCurrentUser(req: Request) {
  // 1. Supabase Auth セッションを先に確認
  const supabase = createSupabaseServerClient(/* ... */);
  const { data: { user: supabaseUser } } = await supabase.auth.getUser();
  if (supabaseUser?.id) {
    return findUserBySupabaseAuthId(supabaseUser.id);
  }

  // 2. LINE セッションを確認（既存ロジック）
  const lineToken = getLineTokenFromCookie(req);
  if (lineToken) {
    return getUserFromLiffToken(lineToken);
  }

  return null;
}
```

Phase 1 では、少なくとも `/api/user/current`、保護ページの入場判定、既存の主要 Route Handler、Server Action、service 層を上記ルールに従って両対応にする。

### 7.6 全機能両対応の実装方針

#### 7.6.1 authMiddleware / 認証解決

- `authMiddleware` または同等の共通認証解決層を LINE / Email 両対応にする
- Cookie 確認、`userId` 解決、role / subscription / owner view mode 判定は、認証方式に依存せず同じ `public.users.id` を返す形へ寄せる
- 既存の Route Handler / Server Action からは、可能な限り共通認証解決層を呼ぶ形に統一する
- Email ユーザーが LINE ユーザーと同様に既存機能を利用できることを Phase 1 の要件とする
- LINE / Email セッションの同時併存でユーザー解決が揺れないよう、ログイン時に他方のセッションを明示的に破棄する
- `resolveUser` / `requireUser` / `requireAdmin` のような server 側の認証ユーティリティ層を用意し、client 側で認証可否を確定しない

補足:

- Phase 1 で保証するのは **同一ブラウザ内のセッション排他** までとする
- **全デバイス横断の単一セッション制御**（例: `user_sessions` テーブルを追加して旧セッションを全失効させる）は、要件追加時に Phase 2 以降で検討する
- 現時点では Supabase 標準セッションモデルを前提とし、独自のセッション台帳は導入しない
- したがって、別ブラウザ・別端末での同時ログイン制御は Phase 1 の保証対象外とする

#### 7.6.2 呼び出し側の変更範囲

Phase 1 で変更対象とするのは以下を含む。

1. `/login`
2. Email OTP 用 Server Action
3. `/api/user/current`
4. `/api/auth/check-role` および同等の認証確認経路
5. `authMiddleware` 利用中の主要 Route Handler / Server Action
6. `userId` / `lineUserId` 前提が残る service 層と型定義
7. Email セッションで必要なクライアント状態同期（`LiffProvider` の入場判定・遷移制御を含む）

以下は Phase 1 の対象外とする。

- 認証以外の大規模リファクタリング
- 別認証方式追加を見越した汎用抽象化

### 7.6.3 Phase 1 における既存 LINE ユーザーの扱い（二重 users.id 防止）

Phase 1 では既存 LINE ユーザーへのリンクを保証しないため、既存ユーザーが Email OTP を試すと新規 `users.id` が作成され、同一人物が複数 ID を持ち業務データが分断する問題が起きる。これを避けるため、以下を必須とする。

| 対策 | 内容 |
|------|------|
| **UI での非表示** | 有効な LINE セッション（LINE ログイン済み）がある場合、`/login` 上で Email OTP ログイン導線を表示しない。既存 LINE ユーザーがログイン状態で /login を開いた場合に、誤って Email ログインを試すことを防ぐ。 |
| **サーバー側ガード** | OTP 検証後、`users.supabase_auth_id` の既存解決のみを許可し、`email` 一致で既存 LINE ユーザーへ自動リンクしない。未リンクであれば新規 `public.users` を作成し、既存 LINE ユーザーへのリンクは Phase 1.5 の手動手順に限定する。 |

未ログインの訪問者については、LINE ユーザーか新規かは判別できないため、上記サーバー側ガードのみで対応する。

### 7.7 ログイン UI

#### 7.7.1 画面要件

- `/login` に Email OTP ログイン導線を追加する
- **有効な LINE セッションがある場合は、Email OTP 導線を表示しない**（7.6.3 に従う）
- OTP 入力 UI は 6 桁、数字のみ、ペースト対応、`autocomplete="one-time-code"` を有効にする
- OTP 再送信 UI を設け、再送信制限中は適切に無効化する
- 既存 LINE ログイン導線は維持する
- 未ログインの新規訪問者は `メール OTP` または `LINE ログイン` のいずれでも利用開始できる
- 既存 LINE ユーザーについては、Phase 1 では Email への自由切替導線を提供しない
- Email セッションが有効な場合は、LINE 自動ログインへ進めず既存機能を利用できる画面へ遷移できること
- 文言は最小限とし、段階的な導線制御は行わない

#### 7.7.2 文言方針

- Email OTP 送信時: 汎用成功メッセージを表示する
- OTP 検証失敗時: 列挙耐性を保った汎用エラーメッセージを表示する
- 既存 LINE ユーザー向けの移行案内は Phase 1 では実施しない

### 7.8 Supabase Auth 設定

| 設定項目 | 値 |
|---------|-----|
| Site URL | `{NEXT_PUBLIC_SITE_URL}` |
| Email Auth | 有効 |
| メールテンプレート | OTP（`{{ .Token }}`） |
| OTP 有効期限 | 3,600秒（デフォルト維持） |
| OTP 再送信制限 | 60秒に1回 |
| Auth API rate limit | Supabase デフォルト + アプリ側の IP / email レート制限を追加 |
| Hosted email 送信枠 | 開発用途のみ。本番はカスタム SMTP を前提とする |

本番環境のメール送信設定、SMTP 選定、SPF / DKIM / DMARC、テンプレート文面、レート制限の運用基準は  
[docs/email-delivery-setup-guide.md](/Users/shoma.endo/private/GrowMate/docs/email-delivery-setup-guide.md) を参照する。

### 7.9 ログアウトフロー

- Email ユーザー: `supabase.auth.signOut()` + `active_session_type=email` の解除 + LINE Cookie クリア
- LINE ユーザー: 既存 `liff.logout()` + LINE Cookie クリア + Supabase Auth セッション破棄
- `/api/user/current` は最低限 `userId` とユーザー情報を返す

### 7.10 新規・変更ファイル一覧

```text
新規:
  src/lib/supabase/server.ts
  src/lib/supabase/middleware.ts
  src/lib/supabase/client.ts
  src/server/actions/auth.actions.ts
  src/server/auth/resolveUser.ts
  src/server/auth/requireUser.ts
  src/server/auth/requireAdmin.ts

変更:
  app/login/page.tsx
  app/api/user/current/route.ts
  app/api/auth/check-role/route.ts
  app/api/**/*
  src/server/actions/**/*
  src/server/services/userService.ts
  src/server/services/supabaseService.ts
  src/types/user.ts
  src/server/middleware/auth.middleware.ts
  middleware.ts
  src/components/LiffProvider.tsx
  package.json

マイグレーション:
  supabase/migrations/XXXXXX_add_email_auth_columns_to_users.sql

マイグレーション後:
  supabase gen types typescript --project-id <ref> > src/types/database.types.ts
```

### 7.11 Feature Flag 方針

Phase 1 では Feature Flag は最小構成とする。

```text
email_auth_enabled
  - Email OTP ログイン機能の新規受付 on/off
  - OFF 時: 新規 Email 導線を非表示・新規 OTP 送信/検証を停止する
  - 既存 Email セッションの扱いは既定では維持とし、強制停止が必要な場合は別の kill switch または運用手順で対応する
  - データ削除は行わない（詳細は 12.4 ロールバック・データ方針）

補足:

- `email_auth_enabled` は **新規ログイン受付停止用のフラグ** として扱う
- 既存 Email セッションまで即時停止したい場合は、middleware で Email セッションを拒否して `supabase.auth.signOut()` 相当の処理へ誘導する **別運用** が必要であり、Phase 1 の必須要件には含めない
- kill switch が必要になりうることは前提として残しつつ、Phase 1 では実装コストを抑えるため通常フラグと分離する
```

それ以外の段階公開用 Flag は導入しない。

---

## 8. Phase 1.5: 既存 LINE ユーザーのメール移行（手動）

### 8.1 概要

Phase 1.5 のフォーカスは、**既存 LINE ユーザーをメールログイン可能なアカウントに移行すること**である。

- 既存 LINE ユーザーを**別 `users.id` に移す**フェーズではない。同一 `users.id` を維持する。
- 開発者が手動で、既存 `users.id` に対して `supabase_auth_id` と `email` を設定し、同一アカウントのまま Email ログイン可能にする。
- **データ移行の扱い**: 当該ユーザーの既存業務データ（Stripe・owner 関係・その他 `user_id` 参照）は**そのまま同じ `users.id` に紐づいたまま**である。別テーブルへのデータ移行や別 `users.id` への付け替えは行わない。移行作業は `supabase_auth_id` 設定と、必要に応じた `users.email` 更新で完結する。

### 8.2 標準フロー

```text
前提:
  - source_user_id は既存 LINE ユーザーの users.id
  - target_email は追加したいメールアドレス

要件:
  - 既存の source_user_id を維持したまま Email ログイン可能にする
  - auth.users と public.users を安全に手動リンクできれば手段は問わない
  - 同一 email は 1 つの public.users のみが持てる
  - 新規 public.users を誤作成した場合の後始末手順を Runbook に含める
```

### 8.3 実装方針

#### 8.3.1 採用

- `users.id` は維持する
- `supabase_auth_id` を既存行へ設定して手動リンクする
- `users.email` は必要に応じて設定し、case-insensitive unique を維持する
- 移行手順は開発者向け Runbook として残す
- 移行前に競合チェックを行う
- `auth.users` の作成方法は固定しない。既存 `users.id` を維持して安全に紐付けできる手順を採用する
- 実際のリンク処理は、**transaction 保証された DB function または管理 RPC** を経由して行う
- 誤って Email 専用 `public.users` が作成された場合の削除または再リンク判断を Runbook に含める

#### 8.3.2 採用しない

- 管理 UI
- ユーザー自身が行うセルフリンク
- 承認フローのシステム化
- rollout 制御
- LINE 導線停止
- LINE セッション停止制御
- 全面データ移行 RPC

### 8.4 手動移行手順（Runbook）

```text
1. 対象ユーザー特定
   - source_user_id を確定する

2. 事前確認
   - target_email に対応する auth.users.id を取得できることを確認する
   - source_user_id が既に supabase_auth_id を持っていないことを確認する
   - target_email を使う別 users 行が存在しないことを確認する

3. email freeze
   - 対象 email の OTP ログインを一時的に禁止する
   - 方式は固定しない（allowlist 除外、運用フラグ、送信 API 側の一時ブロック、手動監視など）
   - 目的は、移行作業中に `verifyOtp()` が走って新規 public.users が誤作成される競合を避けること

4. auth.users 準備
   - target_email に対応する auth.users.id を取得する
   - auth.users の作成方法は固定しない（管理操作、事前作成、OTP を利用した作成など、既存 users.id を維持できる方法でよい）

5. リンク処理
   - DB function または管理 RPC（例: `link_email_to_user(source_user_id, auth_user_id, target_email)`）を実行する
   - 関数内部で、競合確認、`users.supabase_auth_id` 設定、必要に応じた `users.email` 更新、ロックまたは transaction 制御を一括実行する
   - もし同一 target_email で誤って Email 専用 public.users が作成されている場合は、その行をどう扱うか（削除、再リンク、作業中止）を個別判断し、衝突を解消してから関数を実行する

6. email freeze 解除
   - リンク完了後に、対象 email の OTP ログイン停止を解除する

7. 完了確認
   - LINE ログインで同一 users.id が返る
   - Email ログインで同一 users.id が返る
   - 既存データに変化がない
```

### 8.5 例外ケース

#### 8.5.1 既に別ユーザーへ紐付いた email

- リンク処理を停止する
- 本 Phase では users 統合を扱わない

#### 8.5.2 既に supabase_auth_id が存在する場合

- リンク処理を停止する

#### 8.5.3 誤って新規 Email ユーザーが作成された場合

- その `auth.users.id` と誤作成された `public.users.id` を確認する
- 既存 LINE ユーザーへ再リンクする場合は、誤作成された行をどう扱うかを先に決め、`users.email` / `users.supabase_auth_id` の競合を解消してから DB function / 管理 RPC 経由で source_user_id に値を設定する
- 誤作成行を残置するか削除するかは運用判断とするが、少なくとも放置して source_user_id へ同じ値を設定しない
- 本仕様では自動統合は行わない

---

## 9. セキュリティ考慮事項

### 9.1 メール認証

| 脅威 | 対策 |
|------|------|
| OTP の盗聴 | HTTPS 必須、Supabase Auth の短期コードを利用 |
| OTP 送信 abuse / `auth.users` スパム化 | Supabase Auth の制限に加えて、Server Action / Route Handler / Edge Function 側で IP / email 単位の送信レート制限を強制する。必要に応じて CAPTCHA を追加できる構造にする |
| orphan `auth.users` の蓄積 | `last_sign_in_at IS NULL` かつ一定期間未使用の `auth.users` を対象に、定期 cleanup job または手動 Runbook で整理する |
| ブルートフォース | Supabase Auth の送信・検証レート制限を使用 |
| メール列挙攻撃 | `shouldCreateUser: true` と汎用エラーメッセージを採用 |
| セッションハイジャック | httpOnly Cookie を使用 |
| CSRF | SameSite Cookie を使用 |

### 9.2 手動リンク運用

| 脅威 | 対策 |
|------|------|
| 他人アカウントへの Email 追加 | 対象 `users.id` と email を事前確認してから手動実行する |
| 誤リンク | `users.email` / `users.supabase_auth_id` の一意制約 + 競合確認 + DB function / 管理 RPC による transaction 制御 |
| 移行中の OTP 競合 | 対象 email の OTP ログインを一時凍結してからリンクし、完了後に解除する |
| 監査不能 | 最低限、実施日時・実施者・対象 `users.id`・email を手順書または運用記録に残す |

### 9.3 レート制限

| 対象 | 制限 |
|------|------|
| OTP 送信 | Supabase Auth デフォルト + Server Action / Route Handler / Edge Function 側の IP / email レート制限 |
| OTP 検証 | Supabase Auth デフォルト |

---

## 10. 工数見積もり

### Phase 1: 新規メール OTP ログイン

- DB変更と型再生成: 1-1.5日
- Supabase Auth クライアント整備: 1日
- Supabase SSR client 分離と middleware refresh 整備: 1-2日
- `/login` UI とログイン遷移整理: 1-2日
- `authMiddleware` と認証解決層の両対応化: 4-8日
- 既存 API / Server Action / service 層の両対応化: 7-10日
- クライアント初期化、入場制御、状態同期の修正: 3-5日
- idempotent な users 解決、セッション競合制御、失敗時後始末の実装と検証: 2-4日
- 動作確認と回帰確認: 5-10日

### Phase 1.5: 既存 LINE ユーザー手動移行

- Runbook 作成: 0.5日
- 手動リンク手順の確認: 0.5-1日
- 検証: 0.5日

### 合計

18-34営業日程度（約4-7週間）

---

## 11. 実装順序

### 11.1 Step 1: DB 変更

実装:

- `users` へ `email` を追加
- `users` へ `supabase_auth_id` を追加
- case-insensitive unique index を追加

テスト:

- 既存 LINE 認証に影響がない
- 既存クエリが壊れない

検証:

- migration 適用後に既存機能が動作する

### 11.2 Step 2: Supabase Auth 基盤追加

実装:

- Supabase client / server / middleware を追加
- `email_auth_enabled` を追加
- `verifyOtp()` 成功後に `public.users` 解決へ失敗した場合でも再実行で整合する方針を実装する
- `detectSessionInUrl: false`、`persistSession: true`、`autoRefreshToken: true` を明示する
- Browser / Server / middleware の Supabase client 分離を行う
- middleware で token refresh を扱う
- Server 側の認証確認は `getUser()` 基準で統一する
- OTP 送信 API に IP / email 単位のレート制限を追加し、Server Action / Route Handler / Edge Function 側で強制する
- orphan `auth.users` を整理する cleanup job または運用 Runbook を用意する

テスト:

- Flag `off` では既存挙動を維持する
- OTP 送信と OTP 検証の最小確認を行う
- OTP 送信レート制限が機能する
- middleware 経由で session refresh が機能する
- Server 側で `getUser()` により認証確認できる

検証:

- 開発環境で新規 Email ユーザーがログインできる

### 11.3 Step 3: 認証解決層の両対応化

実装:

- `authMiddleware` または同等の共通認証解決層で Email / LINE の両セッションを扱えるようにする
- role / subscription / owner view mode 判定を Email ユーザーでも成立させる
- 既存呼び出し元が同じ `public.users.id` ベースで動作するように調整する
- LINE / Email のセッション競合が起きないよう、ログイン時の排他制御を追加する
- `resolveUser` / `requireUser` / `requireAdmin` のような認証共通層を追加する
- request 内での認証解決責務を分散させず、refresh 競合を避ける

テスト:

- LINE ユーザーで既存認証が回帰しない
- Email ユーザーで共通認証解決層が同じ `userId` / role を返せる

検証:

- 主要な Route Handler / Server Action で Email セッションが認証通過できる

### 11.4 Step 4: `/login` とクライアント入場制御対応

実装:

- `/login` に Email OTP UI を追加
- `/api/user/current` と `/api/auth/check-role` を Email セッションでも返せるようにする
- `LiffProvider` の入場判定・遷移制御を Email セッションと両立させる
- OTP 再送信 UI と制御を追加する

テスト:

- 新規 Email ユーザーでログイン成功
- 既存 LINE ユーザーは従来通りログイン可能

検証:

- クライアント初期化時に Email セッションでユーザー情報が取得できる
- Email ユーザーが `/` 配下の既存画面へ遷移・表示できる

### 11.5 Step 5: 既存機能の両対応化

実装:

- `authMiddleware` 利用中の既存 Route Handler / Server Action / service 層を Email セッション対応させる
- `lineUserId` 必須前提の型・変換・参照箇所を整理する
- 外部連携、チャット、管理画面、設定画面など既存主要機能が Email ユーザーでも動作するよう調整する

テスト:

- 主要機能で Email ユーザーが LINE ユーザー同等に利用できる
- LINE ユーザーの既存挙動が維持される

検証:

- 主要画面と高リスク機能を通しで回帰確認する

### 11.6 Step 6: Phase 1.5 手動移行手順整備

実装:

- Runbook を確定
- 手動リンクに必要な確認項目を確定
- 手動リンク用の DB function または管理 RPC を確定する
- 対象 email の一時凍結と解除の手順を確定する

テスト:

- 同一 `users.id` へ Email がリンクされる
- 既存データに変化がない
- 同時に OTP 側の作成処理が走っても、transaction 制御によりリンク処理が破綻しない
- email freeze 中は対象 email で OTP 送信または検証が通らない

検証:

- 1 件の既存 LINE ユーザーで手動移行リハーサルを実施する

---

## 12. テスト・検証戦略

### 12.1 認証

- 新規 Email ユーザーがログインできる
- 既存 LINE ユーザーが従来通りログインできる
- `/api/user/current` が Email セッションで `userId` を返せる
- `/api/auth/check-role` または同等の認証確認経路が Email セッションで既存保護画面への入場を許可できる
- Email ユーザーが `/login` から `/` 配下の既存画面へ到達できる
- **二重 users.id 防止**: LINE ログイン済みで `/login` を開いた場合、Email OTP 導線が表示されないこと
- **セッション検出**: `/api/user/current` で Supabase Auth セッションを先に確認し、なければ LINE セッションを確認すること
- **セッション競合**: LINE ログイン後に Email ログインした場合、またはその逆の場合でも、解決ユーザーが不定にならないこと
- **同一ブラウザ内セッション排他**: LINE と Email を同一ブラウザで切り替えた際に、旧セッション Cookie が期待どおり破棄されること
- **idempotency**: `verifyOtp()` の多重実行やリトライが起きても `public.users` が重複作成されないこと
- **後始末**: `verifyOtp()` 後に `public.users` 解決へ失敗した場合でも、再実行可能であり、中途半端なログイン状態を残さないこと
- **Server 認証確認**: Route Handler / Server Action 側で `getUser()` により認証確定できること
- **middleware refresh**: access token 期限切れ時でも middleware 経由でセッション更新できること
- **refresh 競合回避**: 認証解決を複数箇所で分散実行しても refresh race が起きにくい構造になっていること
- **OTP abuse 対策**: 同一 IP または同一 email から短時間に送信を繰り返した場合に制限されること
- **OTP 送信経路**: `signInWithOtp()` が client 直呼びではなく server / edge 側の制御下で実行されること
- **orphan cleanup**: `verifyOtp()` に到達しなかった `auth.users` を cleanup job または運用手順で整理できること
- **多端末セッション**: 別ブラウザ・別端末での同時ログインは Phase 1 の制御対象外であることを前提に、同一ブラウザ内排他だけを検証対象とする

### 12.2 既存機能影響

- `/login`
- `/api/user/current`
- `/api/auth/check-role`
- LIFF 初期化後のクライアント状態同期
- 既存 Route Handler / Server Action
- chat / setup / analytics / admin / 各外部連携画面

上記の既存主要機能で、Email ユーザーが LINE ユーザー同等に利用できることを確認する。

### 12.2.1 `verifyOtp()` 後の失敗時方針

- `verifyOtp()` 成功後に `public.users` 解決または作成に失敗した場合、そのまま成功扱いで画面遷移させない
- 少なくともサーバー側で失敗を返し、必要に応じて Supabase セッションを破棄する
- 主戦略は手動 cleanup ではなく、再実行で整合する idempotent 実装とする
- 孤児化した auth.users や誤作成された public.users が残る場合に備え、開発者向けの手動クリーンアップ手順を別途 Runbook に含める

### 12.3 手動移行検証

- 既存 LINE ユーザーへ Email を設定できる
- LINE / Email の両方で同じ `users.id` に到達する
- 競合時にリンク処理を停止できる
- DB function / 管理 RPC により、手動リンクが transaction 内で完結すること
- email freeze 中に対象 email の OTP 送信や検証が抑止されること

### 12.4 ロールバック・データ方針

#### 12.4.1 方針の結論

- **フラグ OFF = 機能の無効化であり、データ削除は行わない**。既存の `public.users` および `auth.users` レコードはロールバック時も**そのまま残す**。
- **`email_auth_enabled = off` は新規 Email ログイン受付停止を意味し、既に有効な Email セッションは既定で維持する**（既存ユーザーを突然ログアウトさせない）。
- **既存 Email セッションまで即時停止したい場合は、通常フラグとは別に運用上の kill switch を用いる**。Phase 1 では middleware で Email セッションを拒否し、必要に応じて `supabase.auth.signOut()` 相当の処理へ誘導する運用を想定し、必須実装には含めない。
- 完全に機能を廃止し、Email 由来のデータを削除したい場合は、本仕様の範囲外として**別 Runbook（手動データクリーンアップ）**で対応する。
- **ロールバックは schema rollback ではなく feature rollback を前提** とする。DB schema は維持したまま、Flag と運用手順で切り戻す。

#### 12.4.2 フラグ OFF 時の挙動

| 対象 | 挙動 |
|------|------|
| **UI** | Email OTP ログイン導線を表示しない。新規の OTP 送信・検証は受け付けない |
| **既存 Email セッション** | 有効な Supabase Auth Cookie がある場合、`/api/user/current` は従来どおり Supabase セッションを解決し、当該ユーザーを返す（ログイン状態を維持） |
| **LINE** | 従来どおり。既存 LINE ログイン・既存機能に影響なし |
| **DB** | 追加した `email` カラム、`supabase_auth_id` カラムおよび既存データは変更・削除しない |

補足:

- 障害対応として既存 Email セッションを即時停止したい場合は、別運用の kill switch を用いて middleware 側で Email セッションを拒否する
- Phase 1 では kill switch 自体の実装は必須にせず、運用方針の整理に留める

#### 12.4.3 Phase 1 で作成された Email 専用ユーザーの扱い

- **ロールバック時**: `public.users` の当該行も `auth.users` の当該レコードも**削除しない**。フラグ OFF にしても、そのユーザーはセッションが切れるまで利用可能であり、セッション切れ後は Email ログイン導線が非表示になるため新規 Email ログインはできない。
- **データ管理**: Phase 1 で作成されたユーザー（`line_user_id` が NULL で `supabase_auth_id` を持つ行）を、運用上「Email 専用ユーザー」として識別できる。これらのレコードの削除や無効化が必要な場合は、**別途データクリーンアップ手順**で対応する（本仕様では定義しない）。
- **orphan `auth.users`**: `signInWithOtp()` のみ実行され `public.users` が未作成のレコードは、一定期間経過後に cleanup job または手動 Runbook で整理する。feature rollback 時にも自動削除は行わない。

#### 12.4.4 Phase 1.5 でリンクされたユーザーの扱い

- **ロールバック時**: 既存 LINE ユーザーに手動で追加した Email 情報は**そのまま残す**。フラグ OFF にすると Email ログイン導線は見えなくなるが、LINE ログインは従来どおり利用可能。必要に応じて後から Email 情報を無効化または削除する運用は可能だが、ロールバックの必須手順としては行わない。

#### 12.4.5 確認項目（ロールバック検証）

- `email_auth_enabled = off` にした際に、既存 LINE ログインが問題なく利用できること
- DB に追加したカラムが存在していても、既存機能（LINE 認証・業務処理）が継続動作すること
- フラグ OFF 後も、既に有効な Email セッションを持つユーザーが `/api/user/current` で `userId` を取得できること（セッション期限まで）
- migration 自体は rollback 前提ではなく、Flag による機能停止と運用上の kill switch によって切り戻すこと

---

## 13. 補足方針

本仕様では「新規 Email ログイン追加」と「既存 LINE ユーザーの手動 Email 化」にのみ集中する。  
認証方式の一般化、段階ロールアウト、LINE 導線停止は別仕様として扱う。

### 13.1 将来の認証完成形メモ

Phase 1 では `1 email = 1 account` の単純化を優先し、`public.users.supabase_auth_id` を使う。  
ただし、将来 Google / GitHub / SSO / identity linking など複数認証方式を恒常的に併用する要件が出た場合は、`auth.users` と `public.users` を中間テーブルで結ぶ構造へ移行しうる。

将来の完成形イメージ:

```text
auth.users
  └─< user_auth_identities >─ public.users
```

想定テーブル:

```text
public.user_auth_identities
  - id
  - app_user_id         -> public.users.id
  - auth_user_id        -> auth.users.id
  - provider            -> email / line / google / github / ...
  - provider_user_id    -> provider 側の一意 ID
  - created_at
  - updated_at
```

この構造の利点:

- `public.users.id` を業務主体として固定したまま、複数の認証手段を追加できる
- Stripe、RBAC、owner 関係、既存業務データが auth provider の追加や変更に引きずられない
- Email / LINE / Google / GitHub 等の複数 login method を 1 人の業務ユーザーへ安全に紐付けやすい
- 将来の identity linking や複数認証手段併存時に、`public.users.supabase_auth_id` の単一列より破綻しにくい

運用上の原則:

- 認証確認は常に `supabase.auth.getUser()` を起点に行う
- 認証後の業務ユーザー解決は `auth_user_id -> app_user_id` を辿って行う
- 権限、課金、owner 判定、業務データ参照は常に `public.users.id` ベースで扱う

Phase 1 でこの構造を採用しない理由:

- 現要件は `1 email = 1 account` であり、`public.users.supabase_auth_id` の単一列で満たせる
- 中間テーブル化は将来拡張には有利だが、Phase 1 の実装コストと運用複雑性を増やす
- 現時点では最小コストでの Email ログイン導入を優先する

将来 Phase 2 以降で以下の要件が出た場合は、この構造への移行を検討する。

- Google / GitHub 等の追加プロバイダ導入
- 1 人のユーザーが複数の認証手段を恒常的に併用する要件
- Supabase Auth の identity linking を本格利用する要件
- 組織単位のログイン選択、SSO、より高度なメンバーシップ管理が必要になった場合
