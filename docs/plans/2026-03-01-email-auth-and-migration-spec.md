# メールログイン（Magic Link）& LINE→Email アカウント移行 仕様書

**作成日**: 2026-03-01
**ステータス**: ドラフト

---

## 1. 目的・背景

### 1.1 目的

現行の LINE LIFF 認証に加え、メールアドレスによる Magic Link 認証を導入する。
また、既存の LINE アカウントユーザーが任意でメールアカウントへ移行できる機能を提供し、LINE に依存しないログイン手段を確立する。

### 1.2 背景

- LINE LIFF に依存した認証はモバイルブラウザ制約や LINE アプリ未導入環境で障壁となる
- B2B SaaS としてメールベースの認証は顧客の期待値に合致する
- 将来的なマルチドメイン（account_id）管理の前提基盤として、認証手段の柔軟化が必要

---

## 2. スコープ

### 対象

- **Phase 1**: Magic Link によるメールログイン機能
- **Phase 1.5**: 既存 LINE ユーザーからメールアカウントへのデータ移行機能（ユーザー任意）

### 非対象

- Phase 2 以降のマルチドメイン管理（`account_id` 導入）
- Phase 3: Stripe 廃止
- パスワード認証（Magic Link のみ）
- ソーシャルログイン（Google, GitHub 等）の追加
- LINE 認証の廃止（既存ユーザー向けに併存を維持）

---

## 3. 用語定義

| 用語 | 定義 |
|------|------|
| Magic Link | メールアドレスに送信される一回限りの認証リンク。クリックでログインが完了する |
| Supabase Auth | Supabase が提供する認証基盤。メール送信・トークン管理・セッション管理を一括で担う |
| 認証プロバイダ (`auth_provider`) | ユーザーの認証手段を示す識別子。`line` または `email` |
| `auth.users` | Supabase Auth が内部管理するユーザーテーブル。メールログイン時に自動作成される |
| `public.users` | アプリ独自のユーザーテーブル。LINE / メール両方のユーザー情報を格納する |
| 移行元アカウント | LINE 認証で作成された既存ユーザーレコード |
| 移行先アカウント | Magic Link で作成された新規メールユーザーレコード |
| アカウント統合 | 移行元の全データを移行先に紐付け直し、移行元を無効化する操作 |

---

## 4. 前提条件

### 4.1 現行認証フロー

```
LINE アプリ
  → LINE OAuth 2.1（/api/auth/line-oauth-init）
  → LINE Callback（/api/line/callback）
  → アクセストークン + リフレッシュトークンを httpOnly Cookie に保存
  → authMiddleware が Cookie からトークンを取得・検証
  → UserService.getUserFromLiffToken() でユーザー取得/作成
```

### 4.2 現行 Supabase 利用状況

- `@supabase/supabase-js` v2.75.0 を使用
- Supabase Auth 機能は **未使用**（`autoRefreshToken: false`, `persistSession: false`）
- `@supabase/ssr` は **未インストール**
- `auth.users` テーブルは空（LINE 認証は独自実装）
- Supabase はデータベース（PostgreSQL）+ RLS のみ活用

### 4.3 現行 users テーブル

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

### 4.4 user_id を保持する全テーブル一覧（18テーブル, 20カラム参照）

| # | テーブル名 | カラム名 | 型 | FK | CASCADE |
|---|-----------|----------|-----|-----|---------|
| 1 | users | id (PK) | UUID | — | — |
| 2 | users | owner_user_id | UUID | YES | NO |
| 3 | chat_sessions | user_id | TEXT | NO | — |
| 4 | chat_messages | user_id | TEXT | NO | — |
| 5 | briefs | user_id | TEXT | NO | — |
| 6 | content_annotations | user_id | TEXT | NO | — |
| 7 | wordpress_settings | user_id | UUID | YES | CASCADE |
| 8 | gsc_credentials | user_id | UUID | YES | CASCADE |
| 9 | gsc_page_metrics | user_id | UUID | YES | CASCADE |
| 10 | gsc_article_evaluations | user_id | UUID | YES | CASCADE |
| 11 | gsc_article_evaluation_history | user_id | UUID | YES | CASCADE |
| 12 | gsc_query_metrics | user_id | UUID | YES | CASCADE |
| 13 | ga4_page_metrics_daily | user_id | UUID | YES | CASCADE |
| 14 | google_ads_credentials | user_id | UUID | YES | CASCADE |
| 15 | employee_invitations | owner_user_id | UUID | YES | CASCADE |
| 16 | employee_invitations | used_by_user_id | UUID | YES | NO |
| 17 | prompt_templates | created_by / updated_by | UUID | YES | SET NULL |
| 18 | prompt_versions | created_by | UUID | YES | SET NULL |
| 19 | session_heading_sections | (間接: session_id → chat_sessions) | — | — | CASCADE |
| 20 | session_combined_contents | (間接: session_id → chat_sessions) | — | — | CASCADE |

**注意**: TEXT 型 user_id（#3〜#6）は FK 制約がないため、移行時にアプリ層で整合性を保証する必要がある。

---

## 5. Phase 1: Magic Link 認証

### 5.1 設計方針: Supabase Auth の活用

Magic Link のメール送信・トークン管理・セッション管理は **Supabase Auth に委譲** する。

```
独自実装しないもの（Supabase Auth が担当）:
  ✗ magic_link_tokens テーブル → Supabase Auth が内部管理
  ✗ app_sessions テーブル      → Supabase Auth セッションを使用
  ✗ emailService.ts            → Supabase がメール送信
  ✗ sessionService.ts          → Supabase Auth がセッション管理
  ✗ Resend / SendGrid 等の外部メールサービス連携

独自実装するもの（アプリ層で管理）:
  ✓ auth.users → public.users の同期（DB trigger）
  ✓ authMiddleware の LINE/Email 二重対応
  ✓ ログイン UI
```

**理由:**
- Supabase Auth は Magic Link に必要な機能（メール送信、トークン生成・検証、セッション管理、レート制限）を標準提供している
- 独自実装は車輪の再発明であり、セキュリティリスクと工数を増大させる
- `auth.users` と `public.users` の同期は DB trigger で自動化でき、二重管理の懸念は最小限

### 5.2 DB変更

#### 5.2.1 users テーブル拡張

```sql
-- マイグレーション: add_email_auth_to_users.sql

-- 1. email カラム追加
ALTER TABLE users ADD COLUMN email TEXT UNIQUE;

-- 2. 認証プロバイダ識別子
ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'line'
  CHECK (auth_provider IN ('line', 'email'));

-- 3. Supabase Auth ユーザー ID（auth.users.id との紐付け）
ALTER TABLE users ADD COLUMN supabase_auth_id UUID UNIQUE;

-- 4. line_user_id の NOT NULL 制約を解除（メールユーザーは LINE ID を持たない）
ALTER TABLE users ALTER COLUMN line_user_id DROP NOT NULL;

-- 5. line_display_name の NOT NULL 制約を解除
ALTER TABLE users ALTER COLUMN line_display_name DROP NOT NULL;

-- 6. 排他制約: line ユーザーは line_user_id 必須、email ユーザーは email 必須
-- 注意: auth_provider='line' のユーザーが email を持つことは許容する（移行前の準備状態）
--       auth_provider='email' のユーザーが line_user_id を持つことは禁止する
ALTER TABLE users ADD CONSTRAINT users_auth_provider_check
  CHECK (
    (auth_provider = 'line' AND line_user_id IS NOT NULL) OR
    (auth_provider = 'email' AND email IS NOT NULL AND supabase_auth_id IS NOT NULL AND line_user_id IS NULL)
  );

-- ロールバック
-- ALTER TABLE users DROP CONSTRAINT users_auth_provider_check;
-- ALTER TABLE users ALTER COLUMN line_display_name SET NOT NULL;
-- ALTER TABLE users ALTER COLUMN line_user_id SET NOT NULL;
-- ALTER TABLE users DROP COLUMN supabase_auth_id;
-- ALTER TABLE users DROP COLUMN auth_provider;
-- ALTER TABLE users DROP COLUMN email;
```

#### 5.2.2 auth.users → public.users 同期トリガー

Supabase Auth で新規メールユーザーが作成された際、`public.users` に自動でレコードを作成する。

```sql
-- マイグレーション: add_auth_user_sync_trigger.sql

-- メールユーザー作成時に public.users へ同期
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- メール認証ユーザーのみ対象（LINE ユーザーは別経路で作成済み）
  IF NEW.email IS NOT NULL THEN
    INSERT INTO public.users (
      id,
      email,
      auth_provider,
      supabase_auth_id,
      role,
      full_name,
      last_login_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      NEW.email,
      'email',
      NEW.id,
      'trial',
      COALESCE(NEW.raw_user_meta_data->>'full_name', NULL),
      now(),
      now(),
      now()
    )
    ON CONFLICT (email) DO UPDATE SET
      supabase_auth_id = NEW.id,
      auth_provider = 'email',
      last_login_at = now(),
      updated_at = now()
    -- LINE ユーザーが email を持つ場合でも、Supabase Auth ログイン時に email 認証に切り替える
    WHERE public.users.auth_provider = 'email'
       OR public.users.supabase_auth_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_auth_user();

-- ロールバック
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- DROP FUNCTION IF EXISTS handle_new_auth_user();
```

**変更後の users テーブル（主要カラム）:**

```
users
├── id                    UUID PK
├── email                 TEXT UNIQUE (NULL: LINE ユーザー)
├── auth_provider         TEXT NOT NULL ('line' | 'email')
├── supabase_auth_id      UUID UNIQUE (NULL: LINE ユーザー)
├── line_user_id          TEXT UNIQUE (NULL: メールユーザー)
├── line_display_name     TEXT (NULL: メールユーザー)
├── line_picture_url      TEXT
├── line_status_message   TEXT
├── stripe_customer_id    TEXT
├── stripe_subscription_id TEXT
├── role                  TEXT NOT NULL
├── owner_user_id         UUID FK
├── full_name             TEXT
├── last_login_at         TIMESTAMPTZ
├── created_at            TIMESTAMPTZ
└── updated_at            TIMESTAMPTZ
```

### 5.3 Magic Link 認証フロー

#### 5.3.1 ログイン（メール送信）

```
ユーザー: メールアドレスを入力して「ログインリンクを送信」をクリック

クライアント処理:
  1. email バリデーション（Zod）
  2. Supabase Auth API を呼び出し:
     supabase.auth.signInWithOtp({
       email,
       options: {
         emailRedirectTo: '{SITE_URL}/api/auth/callback'
       }
     })
  3. Supabase が自動的に Magic Link メールを送信
  4. 送信完了画面を表示

※ Supabase Auth がメール送信・トークン生成・有効期限管理を一括で処理
※ 送信レート制限も Supabase Auth 側で適用される
```

#### 5.3.2 コールバック・ログイン完了

```
ユーザー: メール内のリンクをクリック

GET /api/auth/callback?code={code}

サーバー処理:
  1. Supabase Auth がリダイレクト URL にコードを付与
  2. サーバー側で code → session に交換:
     supabase.auth.exchangeCodeForSession(code)
  3. Supabase Auth セッション確立（Cookie 自動設定）
  4. auth.users にユーザーが存在 → trigger で public.users に同期済み
  5. リダイレクト: / (トップページ)
```

#### 5.3.3 セッション管理

Supabase Auth のセッション管理を利用する。`@supabase/ssr` パッケージを導入し、
サーバーサイドでの Cookie ベースセッション管理を行う。

```
パッケージ追加:
  npm install @supabase/ssr

セッション構成:
  - Supabase Auth が access_token / refresh_token を Cookie で管理
  - サーバーサイドでは createServerClient() で Cookie を読み書き
  - トークンリフレッシュは Supabase Auth が自動で処理
```

**Supabase クライアントの使い分け:**

```
1. 既存クライアント（SupabaseClientManager / src/lib/client-manager.ts）:
   - データベース操作（CRUD）専用
   - auth: { autoRefreshToken: false, persistSession: false }
   - 変更不要。そのまま維持。

2. 新規クライアント（src/lib/supabase/server.ts）:
   - Supabase Auth 操作（セッション管理、ユーザー認証）専用
   - @supabase/ssr の createServerClient を使用
   - Cookie ベースでセッションを管理

重要: 2つのクライアントは異なる目的で共存する。
既存の SupabaseClientManager は一切変更しない。
```

**Cookie 構成（メール認証導入後）:**

```
LINE ユーザー:
  - line_access_token    (httpOnly, Secure, SameSite=Lax)
  - line_refresh_token   (httpOnly, Secure, SameSite=Lax)

メールユーザー:
  - sb-<ref>-auth-token          (httpOnly, Supabase Auth 自動管理)
  - sb-<ref>-auth-token-code-verifier (PKCE 用)

共通:
  - owner_view_mode              (非httpOnly)
  - owner_view_mode_employee_id  (非httpOnly)

認証優先順位（authMiddleware）:
  1. Supabase Auth セッション（sb-* Cookie）→ メール認証
  2. LINE Cookie（line_access_token）→ LINE 認証
  3. いずれもなし → 未認証エラー
```

**Supabase クライアント構成（メール認証用）:**

```typescript
// src/lib/supabase/server.ts（新規）

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}
```

```typescript
// src/lib/supabase/middleware.ts（新規）

import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

export async function updateSupabaseSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // セッションリフレッシュ（Supabase Auth が自動処理）
  await supabase.auth.getUser();

  return response;
}
```

### 5.4 authMiddleware の二重対応

現行の `authMiddleware` は LINE トークンのみ対応。メール認証との共存のため以下を変更する。

```typescript
// 認証フロー分岐の擬似コード

export async function ensureAuthenticated(
  request?: NextRequest
): Promise<AuthenticatedUser> {

  // 1. Supabase Auth セッションをチェック（メール認証）
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (authUser) {
    return authenticateBySupabaseAuth(authUser);
  }

  // 2. LINE トークンをチェック（後方互換）
  const lineAccessToken = getCookie('line_access_token');
  const lineRefreshToken = getCookie('line_refresh_token');
  if (lineAccessToken || lineRefreshToken) {
    return authenticateByLine(lineAccessToken, lineRefreshToken);
  }

  // 3. 認証なし
  return { error: '認証が必要です' };
}

async function authenticateBySupabaseAuth(
  authUser: SupabaseAuthUser
): Promise<AuthenticatedUser> {
  // 1. supabase_auth_id で public.users を検索
  const user = await userService.getUserBySupabaseAuthId(authUser.id);
  if (!user) {
    return { error: 'ユーザーが見つかりません' };
  }

  // 2. ロール・サブスク状態チェック（既存ロジックを共通化）
  // 3. viewMode / スタッフ関連ロジック（既存と同一）
  // 4. AuthenticatedUser を返却
}

async function authenticateByLine(
  accessToken: string | undefined,
  refreshToken: string | undefined
): Promise<AuthenticatedUser> {
  // 既存の LINE 認証フロー（変更なし）
}
```

**重要: 型変更が必要**

```typescript
// auth.middleware.ts: AuthenticatedUser インターフェース
export interface AuthenticatedUser {
  lineUserId: string | null;  // 変更: string → string | null（メールユーザーは null）
  // ...他フィールドは変更なし
}

// types/user.ts: User インターフェース
export interface User {
  lineUserId: string | null;       // 変更: string → string | null
  lineDisplayName: string | null;   // 変更: string → string | null
  // ...
}
// toUser() / toDbUser() も nullable 対応が必要
```

#### 5.4.1 lineUserId 参照箇所の影響範囲

| ファイル | 用途 | 対応方針 |
|---------|------|---------|
| `auth.middleware.ts` | LINE プロフィール取得 | メールユーザーはスキップ |
| `userService.ts` | `getUserFromLiffToken()` | メール用の `getUserBySupabaseAuthId()` を新設 |
| `userService.ts` | `updateStripeCustomerId()` | メソッドシグネチャを `(userId: string, ...)` に変更し、`updateUserById()` を使用 |
| `userService.ts` | `updateStripeSubscriptionId()` | 同上 |
| `supabaseService.ts` | `getUserByLineId()` | メールユーザーは `getUserBySupabaseAuthId()` を使用 |
| `login.actions.ts` | LINE プロフィール取得 | メールユーザーは別経路 |
| `subscription.actions.ts` | `lineProfile.userId` で Stripe customer 作成 | `authResult.userId`（UUID）ベースに変更。`user.email` を Stripe customer name に使用 |
| `authUtils.ts` | `getUserRole()` / `getUserRoleWithRefresh()` が `getUserFromLiffToken()` を呼出 | メール認証セッション対応の分岐を追加 |
| `prompt.actions.ts` | `auth.lineUserId` で `getUserByLineId()` を呼出 | `auth.userId` で `getUserById()` に変更 |
| `middleware.ts`（ルート） | `line_access_token` Cookie のみチェック | Supabase Auth セッションとの分岐を追加 |
| `app/api/user/current` | `lineUserId` をクライアントに返却 | `null` を返却可能にする |

### 5.5 ログイン UI

#### 5.5.1 画面構成

```
┌─────────────────────────────────────────┐
│                GrowMate                 │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  メールアドレスでログイン          │  │
│  │                                   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │ email@example.com           │  │  │
│  │  └─────────────────────────────┘  │  │
│  │                                   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │   ログインリンクを送信       │  │  │
│  │  └─────────────────────────────┘  │  │
│  │                                   │  │
│  │  ─────── または ───────           │  │
│  │                                   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │   LINEでログイン             │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

#### 5.5.2 メール送信完了画面

```
┌─────────────────────────────────────────┐
│                GrowMate                 │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  メールを送信しました             │  │
│  │                                   │  │
│  │  user@example.com に              │  │
│  │  ログインリンクを送信しました。    │  │
│  │                                   │  │
│  │  メール内のリンクをクリックして    │  │
│  │  ログインを完了してください。      │  │
│  │                                   │  │
│  │  ※ 届かない場合は                 │  │
│  │    再送信してください。            │  │
│  │                                   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │      リンクを再送信          │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

#### 5.5.3 UI 遷移フロー

```
/login
  ├── メールアドレス入力
  │     → supabase.auth.signInWithOtp({ email })
  │     → 送信完了画面（再送信ボタン付き）
  │     → ユーザーがメールのリンクをクリック
  │     → /api/auth/callback（code → session 交換）
  │     → / (トップページ)
  │
  └── LINE でログイン → /api/auth/line-oauth-init → LINE OAuth → /api/line/callback → /
```

### 5.6 Supabase Auth 設定

Supabase ダッシュボードで以下を設定する。

| 設定項目 | 値 |
|---------|-----|
| Site URL | `{NEXT_PUBLIC_SITE_URL}` |
| Redirect URLs | `{NEXT_PUBLIC_SITE_URL}/api/auth/callback`, `{NEXT_PUBLIC_SITE_URL}/api/auth/account-migration/callback` |
| Email Auth | 有効 |
| Magic Link | 有効（OTP は無効） |
| Email template | カスタム（日本語テンプレート） |
| Rate limit (email) | Supabase デフォルト（3600秒あたり30件） |

**環境変数**: 新規追加は不要。既存の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` をそのまま使用。

### 5.7 ログアウトフロー

| 認証プロバイダ | ログアウト処理 |
|---------------|---------------|
| LINE | `liff.logout()` + `clearAuthCookies()`（`line_access_token`, `line_refresh_token` 削除） |
| Email | `supabase.auth.signOut()` → Supabase Cookie 自動クリア（`sb-*-auth-token`） |

```
ログアウト UI:
  - ログアウトボタンを認証プロバイダに応じて分岐
  - メールユーザー: supabase.auth.signOut() → /login にリダイレクト
  - LINE ユーザー: 既存の liff.logout() フロー（変更なし）
  - 判定方法: Cookie の存在で分岐（sb-* → メール、line_* → LINE）
```

### 5.8 新規・変更ファイル一覧

```
新規:
  src/lib/supabase/server.ts              # Supabase サーバークライアント（Cookie対応）
  src/lib/supabase/middleware.ts           # Supabase セッションリフレッシュ
  app/api/auth/callback/route.ts          # Supabase Auth コールバック
  app/login/page.tsx                      # ログインページ（既存改修）

変更:
  src/server/middleware/auth.middleware.ts  # LINE/Email 二重対応 + AuthenticatedUser.lineUserId を string | null に変更
  src/server/services/userService.ts       # getUserBySupabaseAuthId() 追加 + updateStripeCustomerId/SubscriptionId を userId ベースに変更
  src/server/services/supabaseService.ts   # getUserBySupabaseAuthId() 追加
  src/types/user.ts                        # User 型に email, auth_provider, supabase_auth_id 追加
                                           # + lineUserId, lineDisplayName を string | null に変更
                                           # + toUser() / toDbUser() の nullable 対応
  src/authUtils.ts                         # getUserRole() / getUserRoleWithRefresh() のメール認証対応
  src/server/actions/subscription.actions.ts # Stripe 顧客作成フローの LINE 依存除去（userId ベースに変更）
  src/server/actions/prompt.actions.ts     # lineUserId → userId ベースに変更
  middleware.ts                            # Next.js ミドルウェアに Supabase セッション更新を追加
                                           # ※ 既知の問題: isPublicPath が '/' を含むため全パスが公開扱い。
                                           #   本 Phase ではこのバグ修正をスコープ外とするが、
                                           #   Supabase セッションリフレッシュは isPublicPath 判定前に実行する。
  package.json                             # @supabase/ssr 追加

マイグレーション:
  supabase/migrations/XXXXXX_add_email_auth_to_users.sql
  supabase/migrations/XXXXXX_add_auth_user_sync_trigger.sql

マイグレーション後の作業:
  supabase gen types typescript --project-id <ref> > src/types/database.types.ts
```

---

## 6. Phase 1.5: LINE → Email アカウント移行

### 6.1 概要

既存の LINE アカウントユーザーが、メールアカウントへ全データを移行できるセルフサービス機能。
移行はユーザー任意であり、LINE ログインは移行後も他ユーザー向けに維持される。

### 6.2 移行パターン

#### パターン A: 新規メールアカウントへの統合（主要フロー）

```
前提: ユーザーは LINE アカウントでログイン済み

1. LINE ユーザー（UUID-A）が設定画面で「メールアカウントに切り替え」を選択
2. メールアドレスを入力
3. Supabase Auth の signInWithOtp() でメール送信（所有権確認）
4. Magic Link クリック → /api/auth/account-migration/callback で検証完了
5. auth.users にメールユーザーが作成される → trigger で public.users (UUID-B) が作成
6. UUID-A の全データを UUID-B に移行（migrate_user_data RPC）
7. UUID-A を無効化（role='unavailable', auth_provider そのまま）
8. UUID-B の Supabase Auth セッションで自動ログイン
```

#### パターン B: 既存メールアカウントへの統合

```
前提: ユーザーが LINE と Email の両方のアカウントを既に持っている場合

1. LINE ユーザー（UUID-A）が設定画面で「メールアカウントに切り替え」を選択
2. メールアドレスを入力
3. 入力されたメールが既存ユーザー（UUID-B）に紐付いている場合
4. 確認ダイアログ: 「このメールアドレスには既にアカウントがあります。データを統合しますか？」
   ※ UUID-B 側に既存データがある場合、両者のデータが統合される
5. Supabase Auth の signInWithOtp() でメール送信（所有権確認）
6. Magic Link クリック → 移行確認画面
7. UUID-A の全データを UUID-B に移行（既存データとマージ）
8. UUID-A を無効化
9. UUID-B の Supabase Auth セッションで自動ログイン
```

### 6.3 移行フロー詳細

#### 6.3.1 ステップ 1: 移行開始（設定画面）

```
アクセス条件:
  - LINE 認証でログイン中（auth_provider = 'line'）
  - role が 'unavailable' でない

表示場所: /settings または /account（新規ページ）
```

#### 6.3.2 ステップ 2: メールアドレス入力・検証開始

```
POST /api/auth/account-migration/initiate
  Headers: Cookie (LINE セッション)
  Body: { email: string }

サーバー処理:
  1. authMiddleware で LINE ユーザーを認証
  2. email バリデーション（Zod: メール形式 + 空文字チェック）
  3. 同一メールで public.users に既存ユーザーが存在するかチェック
     a. 存在する場合: パターン B（merge）
     b. 存在しない場合: パターン A（new）
  4. migration_tokens テーブルにレコード作成
     - token: crypto.randomUUID()
     - source_user_id: UUID-A（LINE ユーザー）
     - target_email: 入力されたメールアドレス
     - target_user_id: UUID-B（既存メールユーザー）or NULL
     - migration_type: 'new' | 'merge'
     - expires_at: now() + 30分
     - status: 'pending'
  5. Supabase Auth でメール送信:
     supabase.auth.signInWithOtp({
       email,
       options: {
         emailRedirectTo: '{SITE_URL}/api/auth/account-migration/callback?migration_token={token}'
       }
     })
     ※ Supabase Auth (PKCE flow) は emailRedirectTo に &code={code} を付与する。
       最終 URL: /api/auth/account-migration/callback?migration_token={token}&code={code}
       Supabase Auth v2.x で動作確認済みであることを実装時に検証する。
  6. レスポンス:
     { success: true, migrationType: 'new' | 'merge' }
```

#### 6.3.3 ステップ 3: メール検証・移行確認

```
GET /api/auth/account-migration/callback?code={code}&migration_token={token}

サーバー処理:
  1. Supabase Auth で code → session 交換（メール所有権確認完了）
  2. migration_tokens からトークン取得・検証
     - 存在確認、status='pending'確認、有効期限確認
  3. パターン A の場合:
     - auth.users への INSERT は Supabase Auth が処理済み
     - trigger により public.users にレコードが作成済み
  4. 確認画面にリダイレクト: /account-migration/confirm?migration_token={token}
```

#### 6.3.4 ステップ 4: 移行実行

```
確認画面で「移行を実行」ボタンをクリック

POST /api/auth/account-migration/execute
  Body: { migrationToken: string }

サーバー処理:
  1. Supabase Auth セッションでメールユーザーを認証（所有権の二重確認）
  2. migration_tokens からトークン取得・再検証
  3. status を 'processing' に更新（二重実行防止）
  4. 移行先ユーザー（UUID-B）を特定:
     - パターン A: trigger で作成済みの public.users を supabase_auth_id で検索
     - パターン B: 既存の public.users を email で検索
  5. migrate_user_data RPC を実行（後述 6.4）
  6. migration_tokens.status を 'completed' に更新
  7. レスポンス: { success: true, redirectTo: '/' }

エラー時:
  - migration_tokens.status を 'failed' に更新
  - エラー詳細を migration_tokens.error_message に記録
  - ユーザーに再試行を案内
```

### 6.4 移行 RPC 関数: `migrate_user_data`

```sql
-- マイグレーション: add_migrate_user_data_rpc.sql

CREATE OR REPLACE FUNCTION migrate_user_data(
  p_source_user_id UUID,  -- 移行元（LINE ユーザー）
  p_target_user_id UUID   -- 移行先（メールユーザー）
)
RETURNS TABLE (
  migrated_tables TEXT,
  migrated_rows   INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_exists BOOLEAN;
  v_target_exists BOOLEAN;
  v_row_count     INT;
BEGIN
  -- ============================================
  -- バリデーション
  -- ============================================
  SELECT EXISTS(SELECT 1 FROM users WHERE id = p_source_user_id) INTO v_source_exists;
  SELECT EXISTS(SELECT 1 FROM users WHERE id = p_target_user_id) INTO v_target_exists;

  IF NOT v_source_exists THEN
    RAISE EXCEPTION '移行元ユーザーが存在しません: %', p_source_user_id;
  END IF;

  IF NOT v_target_exists THEN
    RAISE EXCEPTION '移行先ユーザーが存在しません: %', p_target_user_id;
  END IF;

  IF p_source_user_id = p_target_user_id THEN
    RAISE EXCEPTION '移行元と移行先が同一です';
  END IF;

  -- ============================================
  -- TEXT 型 user_id テーブル（FK 制約なし）
  -- ============================================

  -- 1. chat_sessions
  UPDATE chat_sessions
    SET user_id = p_target_user_id::TEXT
    WHERE user_id = p_source_user_id::TEXT;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'chat_sessions';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- 2. chat_messages
  UPDATE chat_messages
    SET user_id = p_target_user_id::TEXT
    WHERE user_id = p_source_user_id::TEXT;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'chat_messages';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- 3. briefs（UNIQUE 制約あり: user_id）
  --    移行先に既にデータがある場合は移行先を優先（移行元を削除）
  IF EXISTS (SELECT 1 FROM briefs WHERE user_id = p_target_user_id::TEXT) THEN
    DELETE FROM briefs WHERE user_id = p_source_user_id::TEXT;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    migrated_tables := 'briefs (skipped: target exists)';
    migrated_rows := 0;
  ELSE
    UPDATE briefs
      SET user_id = p_target_user_id::TEXT
      WHERE user_id = p_source_user_id::TEXT;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    migrated_tables := 'briefs';
    migrated_rows := v_row_count;
  END IF;
  RETURN NEXT;

  -- 4. content_annotations（UNIQUE 制約: user_id, wp_post_id）
  --    移行先に同一 wp_post_id のデータが存在する場合は移行元を削除
  DELETE FROM content_annotations
    WHERE user_id = p_source_user_id::TEXT
      AND wp_post_id IN (
        SELECT wp_post_id
        FROM content_annotations
        WHERE user_id = p_target_user_id::TEXT
      );

  UPDATE content_annotations
    SET user_id = p_target_user_id::TEXT
    WHERE user_id = p_source_user_id::TEXT;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'content_annotations';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- ============================================
  -- UUID 型 user_id テーブル（FK CASCADE あり）
  -- ============================================

  -- 5. wordpress_settings（UNIQUE: user_id）
  IF EXISTS (SELECT 1 FROM wordpress_settings WHERE user_id = p_target_user_id) THEN
    DELETE FROM wordpress_settings WHERE user_id = p_source_user_id;
    migrated_tables := 'wordpress_settings (skipped: target exists)';
    migrated_rows := 0;
  ELSE
    UPDATE wordpress_settings
      SET user_id = p_target_user_id
      WHERE user_id = p_source_user_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    migrated_tables := 'wordpress_settings';
    migrated_rows := v_row_count;
  END IF;
  RETURN NEXT;

  -- 6. gsc_credentials（UNIQUE: user_id）
  IF EXISTS (SELECT 1 FROM gsc_credentials WHERE user_id = p_target_user_id) THEN
    DELETE FROM gsc_credentials WHERE user_id = p_source_user_id;
    migrated_tables := 'gsc_credentials (skipped: target exists)';
    migrated_rows := 0;
  ELSE
    UPDATE gsc_credentials
      SET user_id = p_target_user_id
      WHERE user_id = p_source_user_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    migrated_tables := 'gsc_credentials';
    migrated_rows := v_row_count;
  END IF;
  RETURN NEXT;

  -- 7. gsc_page_metrics
  UPDATE gsc_page_metrics
    SET user_id = p_target_user_id
    WHERE user_id = p_source_user_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'gsc_page_metrics';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- 8. gsc_article_evaluations
  UPDATE gsc_article_evaluations
    SET user_id = p_target_user_id
    WHERE user_id = p_source_user_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'gsc_article_evaluations';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- 9. gsc_article_evaluation_history
  UPDATE gsc_article_evaluation_history
    SET user_id = p_target_user_id
    WHERE user_id = p_source_user_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'gsc_article_evaluation_history';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- 10. gsc_query_metrics
  UPDATE gsc_query_metrics
    SET user_id = p_target_user_id
    WHERE user_id = p_source_user_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'gsc_query_metrics';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- 11. ga4_page_metrics_daily
  UPDATE ga4_page_metrics_daily
    SET user_id = p_target_user_id
    WHERE user_id = p_source_user_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'ga4_page_metrics_daily';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- 12. google_ads_credentials（UNIQUE: user_id）
  IF EXISTS (SELECT 1 FROM google_ads_credentials WHERE user_id = p_target_user_id) THEN
    DELETE FROM google_ads_credentials WHERE user_id = p_source_user_id;
    migrated_tables := 'google_ads_credentials (skipped: target exists)';
    migrated_rows := 0;
  ELSE
    UPDATE google_ads_credentials
      SET user_id = p_target_user_id
      WHERE user_id = p_source_user_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    migrated_tables := 'google_ads_credentials';
    migrated_rows := v_row_count;
  END IF;
  RETURN NEXT;

  -- ============================================
  -- スタッフ・招待関連
  -- ============================================

  -- 13. employee_invitations: owner_user_id の付替え
  UPDATE employee_invitations
    SET owner_user_id = p_target_user_id
    WHERE owner_user_id = p_source_user_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'employee_invitations (owner)';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- 14. employee_invitations: used_by_user_id の付替え
  UPDATE employee_invitations
    SET used_by_user_id = p_target_user_id
    WHERE used_by_user_id = p_source_user_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'employee_invitations (used_by)';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- 15. users.owner_user_id: スタッフの親参照を付替え
  UPDATE users
    SET owner_user_id = p_target_user_id
    WHERE owner_user_id = p_source_user_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  migrated_tables := 'users (staff owner_user_id)';
  migrated_rows := v_row_count;
  RETURN NEXT;

  -- ============================================
  -- ロール・サブスク情報の引き継ぎ
  -- ============================================

  -- 16. 移行元のロール・Stripe情報を移行先に引き継ぐ
  UPDATE users
    SET
      role = (SELECT role FROM users WHERE id = p_source_user_id),
      stripe_customer_id = (SELECT stripe_customer_id FROM users WHERE id = p_source_user_id),
      stripe_subscription_id = (SELECT stripe_subscription_id FROM users WHERE id = p_source_user_id),
      owner_user_id = (SELECT owner_user_id FROM users WHERE id = p_source_user_id),
      owner_previous_role = (SELECT owner_previous_role FROM users WHERE id = p_source_user_id),
      updated_at = now()
    WHERE id = p_target_user_id;
  migrated_tables := 'users (role/stripe transfer)';
  migrated_rows := 1;
  RETURN NEXT;

  -- 17. 移行元を無効化
  UPDATE users
    SET
      role = 'unavailable',
      stripe_customer_id = NULL,
      stripe_subscription_id = NULL,
      owner_user_id = NULL,
      updated_at = now()
    WHERE id = p_source_user_id;
  migrated_tables := 'users (source deactivated)';
  migrated_rows := 1;
  RETURN NEXT;

  RETURN;
END;
$$;

-- ロールバック
-- DROP FUNCTION IF EXISTS migrate_user_data(UUID, UUID);
```

### 6.5 migration_tokens テーブル

```sql
CREATE TABLE migration_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           TEXT NOT NULL UNIQUE,
  source_user_id  UUID NOT NULL REFERENCES users(id),
  target_email    TEXT NOT NULL,
  target_user_id  UUID REFERENCES users(id),  -- NULL: 新規作成パターン
  migration_type  TEXT NOT NULL CHECK (migration_type IN ('new', 'merge')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message   TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_migration_tokens_token ON migration_tokens(token);
CREATE INDEX idx_migration_tokens_source ON migration_tokens(source_user_id);

-- 有効期限切れトークンの自動削除（30日後）
-- pg_cron または定期バッチで実行
```

### 6.6 移行 UI（ステップウィザード）

#### 6.6.1 Step 1: 移行案内

```
┌─────────────────────────────────────────────┐
│  アカウント設定                              │
│                                             │
│  現在の認証方法: LINE                        │
│  LINE ID: @user_display_name               │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  メールアカウントに切り替える        │    │
│  │                                     │    │
│  │  メールアドレスでログインできるように │    │
│  │  アカウントを移行します。            │    │
│  │  すべてのデータは自動的に引き継がれ  │    │
│  │  ます。                             │    │
│  │                                     │    │
│  │  ※ 移行後は LINE ログインは          │    │
│  │    使用できなくなります              │    │
│  │                                     │    │
│  │  ┌───────────────────────────────┐  │    │
│  │  │ メールアドレスを入力          │  │    │
│  │  └───────────────────────────────┘  │    │
│  │                                     │    │
│  │  [確認メールを送信]                  │    │
│  └─────────────────────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

#### 6.6.2 Step 2: メール送信完了

```
┌─────────────────────────────────────────────┐
│  アカウント移行                              │
│                                             │
│  確認メールを送信しました                    │
│                                             │
│  user@example.com に確認メールを             │
│  送信しました。                              │
│  メール内のリンクをクリックして               │
│  移行を続行してください。                    │
│                                             │
│  ※ 30分以内にリンクをクリックしてください    │
│                                             │
└─────────────────────────────────────────────┘
```

#### 6.6.3 Step 3: 移行確認（メールリンク先）

```
┌─────────────────────────────────────────────┐
│  アカウント移行の確認                        │
│                                             │
│  以下の内容でアカウントを移行します:          │
│                                             │
│  移行元: LINE (@user_display_name)          │
│  移行先: user@example.com                   │
│                                             │
│  移行されるデータ:                           │
│  ・チャット履歴                              │
│  ・事業者情報                                │
│  ・WordPress 設定                            │
│  ・GSC/GA4 データ                            │
│  ・サブスクリプション情報                     │
│  ・スタッフ管理情報                           │
│                                             │
│  ※ この操作は取り消せません。                │
│  移行後は LINE ログインが無効になります。      │
│                                             │
│  [キャンセル]        [移行を実行する]         │
│                                             │
└─────────────────────────────────────────────┘
```

#### 6.6.4 Step 4: 移行完了

```
┌─────────────────────────────────────────────┐
│  アカウント移行完了                          │
│                                             │
│  アカウントの移行が完了しました。             │
│                                             │
│  今後は user@example.com で                  │
│  ログインしてください。                       │
│                                             │
│  移行結果:                                   │
│  ・チャットセッション: 24件                   │
│  ・メッセージ: 156件                          │
│  ・アノテーション: 12件                       │
│  ・その他データ: すべて移行完了               │
│                                             │
│  [ダッシュボードへ]                           │
│                                             │
└─────────────────────────────────────────────┘
```

### 6.7 エッジケース

#### 6.7.1 スタッフがオーナーを移行する場合

```
状況: LINE ユーザー（UUID-A, role='paid', owner_user_id=UUID-X）がメールに移行

対応:
  1. migrate_user_data RPC 内で users.owner_user_id は変更しない
     （UUID-A → UUID-B に移行しても、owner_user_id=UUID-X のまま）
  2. ただし owner 側の get_accessible_user_ids は UUID-B を返す必要がある
  3. RPC 内で owner 側の参照が正しく UUID-B を指すよう更新済み（ステップ 15）
```

#### 6.7.2 オーナーがスタッフを持つ場合

```
状況: LINE ユーザー（UUID-A, role='owner'）がメールに移行。
      スタッフ（UUID-S, owner_user_id=UUID-A）が存在。

対応:
  1. スタッフの owner_user_id を UUID-A → UUID-B に更新（RPC ステップ 15）
  2. employee_invitations の owner_user_id も UUID-B に更新（RPC ステップ 13）
  3. 移行後もスタッフからオーナーへのアクセスが維持される
```

#### 6.7.3 Stripe サブスクリプションの付替え

```
状況: LINE ユーザー（UUID-A）が Stripe サブスクリプションを持つ

対応:
  1. RPC 内で stripe_customer_id / stripe_subscription_id を UUID-B に転記（ステップ 16）
  2. Stripe 側のメタデータ更新は不要
     （Stripe は customer_id で管理しており、アプリ側の user_id は参照しない）
  3. ただし stripe_customer_id でユーザー検索する箇所（webhook 等）が
     UUID-B を正しく返すことを確認する
```

#### 6.7.4 移行中のエラー・中断

```
対応方針:
  - RPC は単一トランザクションで実行されるため、途中エラーは自動ロールバック
  - migration_tokens.status = 'failed' に更新し、error_message に詳細を記録
  - ユーザーには「移行に失敗しました。データは変更されていません。」と表示
  - 再試行: 新しい migration_token を発行して再実行可能
```

#### 6.7.5 移行中の同時アクセス

```
対応方針:
  - migration_tokens.status = 'processing' をセマフォとして使用
  - 同一 source_user_id に対して status='processing' のレコードが存在する場合、新規移行を拒否
  - RPC 実行前に SELECT ... FOR UPDATE で移行元ユーザーをロック
```

#### 6.7.6 prompt_templates / prompt_versions の created_by

```
状況: 管理者（admin）が移行する場合、created_by に UUID-A が入っている可能性

対応:
  - prompt_templates.created_by / updated_by は ON DELETE SET NULL のため、
    移行元削除時に NULL になるが、移行ではなく無効化のため影響なし
  - 明示的に UUID-B への付替えは行わない（管理者の作成履歴として UUID-A を保持）
  - 理由: prompt_templates は共有リソースであり、作成者情報の書き換えは監査上望ましくない
  - 長期的考慮: 将来 role='unavailable' ユーザーの物理削除を実装する場合、
    created_by / updated_by が SET NULL される。
    必要に応じてその時点で UUID-B への付替えを検討する。
```

### 6.8 移行 API 一覧

| メソッド | エンドポイント | 用途 |
|---------|---------------|------|
| POST | `/api/auth/account-migration/initiate` | 移行開始・Supabase Auth でメール送信 |
| GET | `/api/auth/account-migration/callback` | Supabase Auth コールバック・メール検証 |
| POST | `/api/auth/account-migration/execute` | 移行実行 |
| GET | `/api/auth/account-migration/status` | 移行ステータス確認 |

### 6.9 新規ファイル一覧

```
app/api/auth/account-migration/initiate/route.ts
app/api/auth/account-migration/callback/route.ts
app/api/auth/account-migration/execute/route.ts
app/api/auth/account-migration/status/route.ts
app/account-migration/confirm/page.tsx
app/account-migration/complete/page.tsx
src/server/services/migrationService.ts
supabase/migrations/XXXXXX_create_migration_tokens.sql
supabase/migrations/XXXXXX_add_migrate_user_data_rpc.sql
```

---

## 7. セキュリティ考慮事項

### 7.1 メール認証

| 脅威 | 対策 |
|------|------|
| Magic Link の盗聴 | HTTPS 必須。Supabase Auth がトークンを1回限り使用 + 有効期限管理 |
| ブルートフォース | Supabase Auth 側のレート制限が適用される |
| メール列挙攻撃 | Supabase Auth はデフォルトで存在/非存在に関わらず同一レスポンスを返す |
| セッションハイジャック | Supabase Auth が httpOnly Cookie でセッション管理 |
| CSRF | SameSite Cookie + Supabase Auth の PKCE フロー |

### 7.2 アカウント移行

| 脅威 | 対策 |
|------|------|
| 他人のアカウントへの不正移行 | Supabase Auth の Magic Link でメール所有権を検証 |
| 二重移行 | migration_tokens.status による排他制御 |
| 移行中のデータ不整合 | 単一トランザクション + FOR UPDATE ロック |
| 移行後の旧アカウント悪用 | role='unavailable' に設定。LINE トークンでのログイン時にエラー表示 |

### 7.3 レート制限

| 対象 | 制限 |
|------|------|
| Magic Link 送信 | Supabase Auth デフォルト（3600秒あたり30件） |
| 移行開始 | アプリ層で制御: 同一ユーザー 3回/1時間 |

---

## 8. 工数見積もり

### Phase 1: Magic Link 認証 — 5-9日

| タスク | 工数 |
|--------|------|
| DB マイグレーション（users 拡張 + auth.users 同期 trigger） | 1-2日 |
| `@supabase/ssr` 導入 + Supabase サーバークライアント構築 | 1日 |
| Auth コールバック API + Next.js ミドルウェア | 1-2日 |
| authMiddleware の LINE/Email 二重対応 | 1-2日 |
| ログイン UI 改修 | 1-2日 |

### Phase 1.5: LINE→Email 移行 — 8-13日

| タスク | 工数 |
|--------|------|
| DB マイグレーション（migration_tokens + migrate_user_data RPC） | 2-3日 |
| 移行 API（initiate / callback / execute / status） | 2-3日 |
| 移行 UI（ステップウィザード 4画面） | 2-3日 |
| migrationService 実装 | 1-2日 |
| エッジケース対応（スタッフ・Stripe 等） | 1-2日 |

### 合計: 13-22日

前回の独自実装案（16-28日）から **約3-6日の短縮**。
Supabase Auth への委譲により、メール送信・トークン管理・セッション管理の実装が不要となった。

---

## 9. 実装順序

```
Phase 1 (Magic Link 認証)
  │
  ├── 1. DB マイグレーション（users 拡張 + auth.users 同期 trigger）
  ├── 2. @supabase/ssr 導入 + サーバークライアント構築
  ├── 3. /api/auth/callback + Next.js ミドルウェア
  ├── 4. authMiddleware 二重対応
  └── 5. ログイン UI
  │
Phase 1.5 (LINE→Email 移行)
  │
  ├── 6. migration_tokens テーブル作成
  ├── 7. migrate_user_data RPC 実装
  ├── 8. migrationService 実装
  ├── 9. 移行 API（initiate / callback / execute / status）
  ├── 10. 移行 UI（4画面）
  └── 11. エッジケース対応 + 統合検証
```
