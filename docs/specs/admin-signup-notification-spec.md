# 新規ユーザー登録の管理者メール通知

## メタデータ

- 文書名: 新規ユーザー登録の管理者メール通知
- ステータス: `implemented`
- 作成日: 2026-10-09
- 最終更新日: 2026-10-09
- 作成者: shoma-endo（Claude Code で起草）
- 承認者: 未承認
- 対象リリース: 未定
- 関連する依頼・Issue・PR: 2026-10-09 会話での依頼「ユーザー登録後、マスター（カオルさん）にメール連絡する」

## 現在地と次の一手

- 現在の工程: 実装 PR レビュー待ち
- 止まっている理由・待っている人: 人間の PR 確認と merge
- 次の一手: PR 確認と merge
- 未確認事項: PR 本文の `## 最終確認（引き継ぎ用）` を参照（6項目）
- 関連ブランチ・PR: `feature/admin-signup-notification`
- 更新日・更新した工程: 2026-10-09 spec-to-pr create_pr

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか:
  - 新規ユーザーはメール OTP で登録すると `role='unavailable'` で作られ（`src/server/services/supabaseService.ts` `createEmailUser`）、名前入力後に `/unavailable` へ送られる（`src/server/actions/auth.actions.ts` `registerFullName`）。admin が `/admin/users` でロールを変えるまで使えない。
  - 登録を管理者に知らせる仕組みが無い。管理者が `/admin/users` を自分で開かない限り、登録に気づけない。
- 放置した場合の影響:
  - 登録した見込み客が利用不可のまま放置され、離脱する。実際に気づかず放置された登録が発生している（依頼の背景）。

### 目的

- この開発で実現する状態:
  - 新規ユーザーが登録（名前入力）を完了すると、管理者（カオルさん）にメールが届く。メールには登録者の名前が載り、ユーザー一覧へのリンクから権限変更へ進める。
- 利用者・事業にとっての価値:
  - 登録から利用開始までの待ち時間が短くなり、見込み客の離脱を減らせる。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 登録完了の通知漏れ | 通知の仕組みが無い | 名前入力を完了した新規登録のすべてで通知メールが送られる | Resend の送信ログと `users.created_at` を照合 | リリース後1か月 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | 新規登録するユーザー | 登録手順は変わらない。通知の成否に影響されない |
| 運用担当 | 開発チーム | 環境変数 `ADMIN_SIGNUP_NOTIFICATION_EMAILS` の設定 |
| 管理者・承認者 | カオルさん（`admin`） | 通知メールを受け取り、`/admin/users` で権限を変更する |
| 外部サービス・連携先 | Resend | メール配信 |

### 主な利用シナリオ

1. **新規ユーザー**が、**メール OTP で認証して名前を入力したとき**、**通常どおり `/unavailable` へ進む**。
2. **カオルさん**が、**届いたメールで登録者の名前とメールアドレスを確認し、リンクからユーザー一覧を開いて権限を変更する**。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
ユーザー: OTP 認証 → users 行作成（unavailable）→ 名前入力 → /unavailable
管理者: 気づいたときに /admin/users を開く（気づく手段なし）
```

### 導入後（To-Be）

```text
ユーザー: OTP 認証 → users 行作成（unavailable）→ 名前入力 → /unavailable
                                                    └→（レスポンス後）管理者へ通知メール
管理者: メール受信 → リンクから /admin/users → 権限変更
```

### 業務ルール

- BR-01: 通知は「名前が未保存のユーザーが、名前を初めて保存した」ときに1回だけ送る。
- BR-02: 通知の成否はユーザーの登録処理の結果に影響させない。
- BR-03: 宛先は環境変数 `ADMIN_SIGNUP_NOTIFICATION_EMAILS`（カンマ区切り）。未設定なら送らない。
- 例外: 名前入力前に離脱したユーザーは通知対象にならない（Non-goals 参照）。

## 4. 対象範囲と Non-goals

### 対象範囲

- 画面・操作: なし（UI 変更なし）
- 影響する既存機能: `registerFullName` の呼び出し元2つ。通常ログイン（`app/login/LoginClient.tsx`）と審査用ログイン（`src/components/ReviewLoginForm.tsx`、R-003）の名前保存。どちらも UI は変わらない
- API・外部連携: Resend によるメール送信（既存 `EmailService` にメソッドを追加）
- データ・DB: なし（migration なし）
- 権限・ロール: 通知のきっかけは `unavailable` ユーザーの登録、受信者は管理者（§6 権限の例外を参照）
- 運用・監視: 送信失敗はサーバーログ（`console.error`）に残す

### Non-goals（今回の対象外）

| 対象外 | 理由 | 将来検討する条件 |
| --- | --- | --- |
| 名前入力前に離脱したユーザーへの通知 | 依頼の「名前を出す」を満たせない。離脱者は `/admin/users` に名前空欄の行として残るので確認はできる | 離脱者の放置が問題になったとき |
| 再送・リトライ基盤、送信履歴テーブル | MVP 優先（AGENTS.md）。失敗はログで追え、`/admin/users` の登録日で取りこぼしを確認できる | 送信失敗による取りこぼしが実際に起きたとき |
| 通知設定画面・宛先の DB 管理 | 宛先は1〜数件で変更頻度が低く、環境変数で足りる | 宛先を運用者が頻繁に変えるようになったとき |
| Slack / Lark / LINE への通知 | 依頼はメール。アプリ内に Slack / Lark の送信基盤が無い | メールが読まれず放置が続くとき |
| ユーザー本人への登録完了メール | 依頼の範囲外 | 別途依頼があったとき |
| Kill Switch・feature flag | 要件に無い。止めたいときは環境変数を外せば送信されない | なし |

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `仮置き`（2026-10-09）
- 含めるもの: 実装・単体テスト・本仕様書・本番の環境変数設定と受信確認
- 含めないもの: spec-review の往復、カオルさんの受信確認待ち

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 仕様 | 本仕様書 | 1.5 | 0.19 |
| 実装 | 環境変数・メール本文・`EmailService`・`registerFullName` | 2.5 | 0.31 |
| テスト | 単体テスト3種 | 2.0 | 0.25 |
| 品質ゲート・PR | `npm run verify`、セルフレビュー、PR | 1.0 | 0.13 |
| 本番設定・確認 | Vercel 環境変数設定、本番で1件登録して受信確認 | 0.5 | 0.06 |
| **合計** |  | **7.5（幅 6〜8）** | **約1** |

幅の理由: `registerFullName` のテストで `after()` と Supabase クライアントのモック構成に既存の型があるかで ±1h。

### 内訳

| 区分 | 内容 | 工数（時間） |
| --- | --- | ---: |
| 環境変数 | `src/env.ts` のスキーマ・ランタイムマップ・`serverOnlyKeys`、README の環境変数表 | 0.5 |
| メール本文 | `src/server/lib/admin-signup-notification-email.ts` | 0.5 |
| 送信 | `EmailService.sendAdminSignupNotification` | 0.5 |
| 起点 | `registerFullName` で初回保存を判定し `after()` で送信 | 1.0 |

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: spec-review 1〜2往復
- クライアント確認・たたき台合意の見込み: カオルさんに通知メールの受信を確認してもらう
- 希望リリース時期との関係: 指定なし

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | 名前未保存のユーザーが名前を保存したら、管理者へ通知メールを送る | Must | 依頼（2026-10-09）、Q-002 | 名前保存の成功後に1通送信される |
| FR-002 | 名前を保存済みのユーザーには送らない | Must | BR-01 | `registerFullName` が再度呼ばれても送信されない |
| FR-003 | メールに登録者の名前・メールアドレス・登録日時（日本時間）・ユーザー一覧へのリンクを載せる。登録日時は `users.created_at`（`resolveOrCreateEmailUser` が返す `user.createdAt`）を Asia/Tokyo で表示し、`/admin/users` の「登録日」と同じ値にする（送信時刻は使わない）。「権限を変更するまで…利用できません」の一文は `user.role` が `unavailable` のときだけ載せる | Must | 依頼「誰が登録したのか分かるように名前も出す」「ユーザー一覧画面のリンクへ誘導」 | 本文に各項目があり、リンクが `${NEXT_PUBLIC_SITE_URL}/admin/users`。登録日時が `users.created_at` と一致する。`unavailable` 以外のロールでは最後の一文が無い |
| FR-004 | 宛先は `ADMIN_SIGNUP_NOTIFICATION_EMAILS`（カンマ区切り）。未設定なら送らない。`src/env.ts` のスキーマは `z.string().min(1).optional()` にとどめ、カンマ区切りの分割・trim・空要素の除去は送信時に `src/server/lib/admin-signup-notification-email.ts`（またはその呼び出し側）で行う。個々のアドレス形式は検証しない（不正なら Resend のエラーとしてログに残る）。env スキーマで厳しく検証すると、値の打ち間違い1つで `env` を読む全サーバー処理が起動時に例外になり BR-02 に反するため | Must | Q-001、BR-02 | 未設定時、または分割結果が0件のときは送信せず警告ログのみ。不正な値でもアプリの起動とログインは妨げない |
| FR-005 | 送信失敗・未設定でも登録処理は成功として返す | Must | BR-02 | Resend 失敗時も `registerFullName` が `success: true` |
| FR-006 | 名前の連続送信で重複メールを送らない | Should | 冪等性 | Resend の Idempotency-Key に `admin-signup-notification/<userId>` を渡す |

### 入力・出力・状態遷移

- 入力値・形式・必須条件: `registerFullName(fullName)` の既存入力（1〜100文字）。変更しない。
- 正常時の出力:
  - 件名: `【GrowMate】新規ユーザー登録：<名前>`
  - 本文: 名前、メールアドレス、登録日時（`users.created_at` を Asia/Tokyo で表示）、「ユーザー一覧を開く」リンク、「権限を変更するまで、このユーザーは GrowMate を利用できません。」（最後の一文は `user.role` が `unavailable` のときだけ載せる）
- エラー時の出力: ユーザーへの表示は変えない。サーバーログに `[admin-signup-notification]` 接頭辞で記録する。
- 状態と遷移条件: `users.full_name` が空 → 保存成功 → 通知を `after()` で予約。
- 冪等性・重複実行時の挙動: 2回目以降は `full_name` が保存済みなので送らない。同時に2回呼ばれても Idempotency-Key で1通になる（Resend のキー保持期間は24時間）。2通目は Resend が 409（`concurrent_idempotent_requests`、または本文が異なる場合の `invalid_idempotent_request`）を返し、`[admin-signup-notification]` のエラーログに残る。これは想定内で、追加の処理はしない。名前の異なる2回の同時保存では、DB の名前とメールの名前がずれうる（受容）。

### 画面設計

UI 変更なし。

### 権限

AGENTS.md の既定（新規機能は `admin` / `paid` に提供）に対する例外として明記する。本機能はユーザーに機能を提供するものではなく、`unavailable` ロールで作られる新規ユーザーの登録をきっかけに**管理者へ**通知するものである。通知のきっかけを `unavailable` に限定するのではなく、名前の初回保存を条件にする（新規ユーザーは必ず `unavailable` で作られるため）。ただし名前未保存の既存ユーザー（`paid` など）や、名前入力前に admin が権限を変えたユーザーも対象になりうるため、「利用できません」の一文はロールが `unavailable` のときだけ載せる（FR-003）。

承認: 依頼者（2026-10-09 の依頼「ユーザー登録後、マスター（カオルさん）にメール連絡する」）。新規登録＝`unavailable` ユーザーの登録をきっかけにすることが依頼内容そのもの。Q-001・Q-002 で宛先・時点も回答済み。

| ロール | 閲覧 | 作成・実行 | 更新 | 削除・解除 |
| --- | --- | --- | --- | --- |
| 新規ユーザー（`unavailable`） | なし | 名前保存で通知がサーバー側で送られる（本人は操作しない） | なし | なし |
| 管理者（宛先） | メールを受信。リンク先 `/admin/users` は既存の admin 認可（`proxy.ts` / `admin.actions.ts`）で保護 | なし | なし | なし |

サーバー側の認可: 送信はサーバーアクション内で、Supabase セッションで本人確認済みのユーザーについてだけ行う（既存 `registerFullName` の認証をそのまま使う）。宛先はサーバー環境変数で、クライアントから指定できない。

## 7. Gherkin受け入れ条件

```gherkin
Feature: 新規ユーザー登録の管理者メール通知

  Rule: 名前を初めて保存したときだけ管理者に通知する

  Scenario: 新規ユーザーが名前を保存すると管理者にメールが届く
    Given 通知先メールアドレスが設定されている
    And 名前が未登録のユーザーがログインしている
    When ユーザーが名前「山田太郎」を保存する
    Then ユーザーは承認待ち画面（`/unavailable`）へ進む
    And 管理者に件名「【GrowMate】新規ユーザー登録：山田太郎」のメールが送られる
    And メール本文に名前・メールアドレス・登録日時・ユーザー一覧へのリンクが含まれる

  Scenario: 名前を登録済みのユーザーには通知しない
    Given 名前が登録済みのユーザーがログインしている
    When 名前の保存処理が再度呼ばれる
    Then 管理者にメールは送られない

  Scenario: 通知先が未設定なら送らずに登録は成功する
    Given 通知先メールアドレスが設定されていない
    And 名前が未登録のユーザーがログインしている
    When ユーザーが名前を保存する
    Then 名前の保存は成功する
    And 管理者にメールは送られない

  Scenario: メール送信に失敗しても登録は成功する
    Given 通知先メールアドレスが設定されている
    And メール配信サービスがエラーを返す
    When 名前が未登録のユーザーが名前を保存する
    Then 名前の保存は成功する

  Scenario: 名前に HTML が含まれていても本文にそのまま埋め込まない
    Given 名前が未登録のユーザーがログインしている
    When ユーザーが名前「<b>太郎</b>」を保存する
    Then メール本文の名前はエスケープされて表示される
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| 新規ユーザーが名前を保存すると管理者にメールが届く | FR-001, FR-003 | Q-001, Q-002 |
| 名前を登録済みのユーザーには通知しない | FR-002 | BR-01 |
| 通知先が未設定なら送らずに登録は成功する | FR-004, FR-005 | Q-001 |
| メール送信に失敗しても登録は成功する | FR-005 | BR-02 |
| 名前に HTML が含まれていても本文にそのまま埋め込まない | FR-003 | §8 セキュリティ |

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 名前保存の応答時間を増やさない | 送信を `after()` でレスポンス後に実行 | 確定 |
| 可用性・信頼性 | 送信失敗時のリトライはしない | 単体テスト | Non-goals |
| セキュリティ・プライバシー | 名前・メールアドレスは HTML エスケープし `sanitizeEmailHtml` を通す。宛先は管理者のみ（サーバー環境変数） | 単体テスト | 確定 |
| 認証・認可 | 既存 `registerFullName` のセッション検証を流用。リンク先は既存 admin 認可 | コードレビュー | 確定 |
| 監査・ログ | 失敗時は userId とエラーをログに残す。メールアドレス・名前はログに出さない。Idempotency-Key 重複による 409 も失敗としてログに残るが想定内（§6 冪等性） | コードレビュー | 確定 |
| 障害対応 | Resend 障害時は通知が欠ける。`/admin/users` の登録日で取りこぼしを確認できる | 運用 | 確定 |
| バックアップ・復旧 | 対象外（保存データなし） | - | 対象外 |
| 運用・監視 | 対象外（専用監視は作らない） | - | Non-goals |
| 拡張性・互換性 | 宛先は複数指定可 | 単体テスト | 確定 |
| アクセシビリティ | 対象外（UI 変更なし） | - | 対象外 |
| コスト | 登録1件につき1通。Resend の既存枠内 | - | 確定 |

### AI機能の追加観点

対象外（LLM を使わない）。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ: なし（既存の `users.full_name` 更新に便乗するだけ）
- データの所有者: -
- 保持期間・削除条件: -
- 移行・既存データとの互換性: 既存の名前未保存ユーザーが今後名前を保存した場合も通知される（新規登録と同じ扱いで問題ない。ロールが `unavailable` 以外なら「利用できません」の一文は載せない。FR-003）
- RLS・Service Role・ユーザー境界: 変更なし

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| Resend | 通知メール送信 | `emails.send`（既存 `RESEND_API_KEY`）、`idempotencyKey` オプション、`to` は配列可 | ログに残して終了。登録処理は成功のまま | https://resend.com/docs/api-reference/emails/send-email 、https://resend.com/docs/dashboard/emails/idempotency-keys |

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準: Next.js App Router の Server Action、`after()`（next/server）、Resend
- 再利用する既存実装:
  - 再利用: `EmailService`（`src/server/services/emailService.ts`）の送信パターン。Idempotency-Key を渡す形は `sendGa4ContentEvaluation` 等と同じ
  - 再利用: `sanitizeEmailHtml`（`src/server/lib/email-html.ts`）、本文組み立ての形は `src/server/lib/instagram-blog-draft-email.ts`
  - 再利用: `after()` の利用例 `app/api/instagram/blog-drafts/route.ts`（Route Handler）。Server Action 内での前例はリポジトリに無いが、公式で Server Functions での利用が明記されている（https://nextjs.org/docs/app/api-reference/functions/after 、確認日 2026-10-09。引用: "It can be used in Server Components (including generateMetadata), Server Functions, Route Handlers, and Proxy."）
  - 拡張: `registerFullName`（`src/server/actions/auth.actions.ts`）に送信予約を追加
  - 新規: 環境変数 `ADMIN_SIGNUP_NOTIFICATION_EMAILS`（`src/env.ts`。スキーマは `z.string().min(1).optional()`、分割・検証は送信時。FR-004）

### 制約条件

- 納期・予算・人員: 指定なし
- 法令・契約・審査: なし（社内管理者への通知）
- 変更できない既存仕様: 新規ユーザーの初期ロール `unavailable`、名前入力ダイアログの表示条件

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| 本番の `RESEND_API_KEY` | 設定済み（OTP メールで使用中） | 既存 | 送信不可 |
| 本番の `ADMIN_SIGNUP_NOTIFICATION_EMAILS` | カオルさんのアドレスを設定 | Vercel 環境変数 | 通知されない |
| カオルさんのアカウントが `admin` | Q-003 | `/admin/users` で確認 | リンク先が開けない |

## 11. トレードオフ判断

### ALT-001: 通知の起点

- 判断: 名前の初回保存（`registerFullName`）を起点にする
- 比較した案:
  - 案A: 名前の初回保存時（`registerFullName`）
  - 案B: `users` 行の作成時（`resolveOrCreateEmailUser`）
- 採用案: 案A
- 採用理由: 依頼の「名前を出す」を満たせるのは案Aだけ。案Bの時点では `full_name` が null
- 却下した案と理由: 案B。名前を載せられない。名前入力前の離脱者も拾えるが、依頼の主目的ではない
- 影響: 名前入力前の離脱者は通知されない（Non-goals）
- 将来変更する条件: 離脱者の放置が問題になったとき
- 判断者・判断日: 依頼者（2026-10-09、Q-002）

### ALT-002: 宛先の決め方

- 判断: 環境変数で指定する
- 比較した案:
  - 案A: 環境変数 `ADMIN_SIGNUP_NOTIFICATION_EMAILS`
  - 案B: `admin` ロールのユーザー全員
- 採用案: 案A
- 採用理由: 宛先をカオルさんに絞れる。変更はデプロイ設定だけで済む
- 却下した案と理由: 案B。開発者にも届き、admin が増えるたびに宛先が増える
- 影響: 本番で環境変数の設定作業が必要
- 将来変更する条件: 宛先を画面で管理したくなったとき
- 判断者・判断日: 依頼者（2026-10-09、Q-001）

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | メールが読まれず放置が続く | 受信箱で埋もれる | 件名に名前を入れて目立たせる。効果が無ければ通知チャネルを見直す | 開発チーム | 監視 |
| R-002 | 名前入力前の離脱者に気づけない | OTP 認証後に名前を入れずに離脱 | `/admin/users` に名前空欄の行として残る | - | 受容 |
| R-003 | Meta 審査用アカウントでの名前保存でも通知される | 審査用アカウントが名前未保存の場合 | 1回だけなので受容 | - | 受容 |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 | 回答 | 回答日 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q-001 | 通知の宛先をどう決めるか | 実装方式が変わる | 依頼者 | - | 回答済み | 環境変数で指定（カンマ区切りで複数可） | 2026-10-09 |
| Q-002 | どの時点で送るか | 名前を載せられるかが変わる | 依頼者 | - | 回答済み | 名前の入力完了時 | 2026-10-09 |
| Q-003 | カオルさんの GrowMate アカウントは `admin` ロールか | リンク先 `/admin/users` は admin でないと開けない。本番の環境変数を設定する前のリリース前ゲート。回答がどうであっても要件・Gherkin・実装は変わらないため、仕様レビューと実装着手のブロッカーにしない | 開発チーム | 本番設定前 | 未回答（リリース前ゲート） |  |  |

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | Slack / Lark への通知追加 | メールで放置が解消するかを先に見る | リリース1か月後 | 依頼者 |

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体:
  - メール本文の組み立て（項目・リンク・エスケープ・日本時間。登録日時が `users.created_at` 由来であること、`unavailable` 以外のロールで最後の一文が出ないこと）
  - `EmailService.sendAdminSignupNotification`（未設定キー・成功・失敗・Idempotency-Key）
  - `registerFullName` の送信条件（名前未保存のみ送信、保存済みは送らない、宛先未設定、送信失敗でも成功）
- Gherkinシナリオとの対応: §7 の全シナリオを単体テストで確認する
- 外部API・失敗系・境界条件: Resend はモック。宛先のカンマ区切り（空白・空要素・分割結果0件は未設定扱い）を確認する
- セキュリティ・権限・RLS: 名前の HTML エスケープ
- 実画面確認: preview 環境で開発者のアドレスを宛先にし、新規メールアドレスで登録して受信とリンクを確認する

### リリース方針

- リリース単位・段階展開: 一括
- Feature Flag / allowlist: なし（環境変数が未設定なら送られない）
- データベース変更の適用順序: なし
- 本番確認項目: 環境変数設定後、テスト用アドレスで1件登録し受信を確認。確認後、テストユーザーを `/admin/users` から削除する

### ロールバック方針

- アプリケーションの戻し方: 環境変数 `ADMIN_SIGNUP_NOTIFICATION_EMAILS` を外す（送信停止）、またはデプロイを巻き戻す
- DB変更の戻し方・逆マイグレーション: なし
- データ不整合時の復旧: なし
- ロールバック判断者: 開発チーム

## 14. 実装手順・チェックポイント

### 手順

1. 本仕様書のレビュー（`takt -w spec-review`）
2. 実装（`takt -w spec-to-pr`）
   1. `src/env.ts` に `ADMIN_SIGNUP_NOTIFICATION_EMAILS`（任意。`z.string().min(1).optional()`。分割・検証は送信時に行う。FR-004）を追加
   2. `src/server/lib/admin-signup-notification-email.ts` を新規作成
   3. `EmailService.sendAdminSignupNotification` を追加
   4. `registerFullName` で `user.fullName` が空かつ保存成功時に `after()` で送信
   5. 単体テストを追加
   6. README の環境変数表に1行追加
3. 品質ゲート（`npm run verify`）
4. PR 作成・レビュー・マージ
5. 本番の環境変数設定と受信確認

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| 本番設定前 | Q-003（カオルさんが admin か）。リリース前ゲート。仕様レビューと実装着手のブロッカーにしない | 開発チーム | 未確認 |
| リリース後 | カオルさんが通知メールを受信できたか | 依頼者 | 未確認 |

## 15. 完了条件

- Definition of Done:
  - §7 の全シナリオに対応する単体テストが通る
  - `npm run verify` が通る
  - 本番で環境変数が設定され、テスト登録の通知メールをカオルさんが受信し、リンクから `/admin/users` を開けた
- 検証方法・証跡: CI 結果、受信メールのスクリーンショット
- 完了確認者・確認日:

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-09 | 0 / 4 / 5 | F-01〜F-09 をすべて本文へ反映（F-01: env スキーマは緩く送信時に分割、F-02: 登録日時=`users.created_at`、F-03: ロール例外の承認を明記、F-04: Q-003 をリリース前ゲートと明記、F-05: 409 は想定内、F-06: 最後の一文は `unavailable` のみ、F-07: Gherkin を承認待ち画面へ、F-08: `after()` 公式根拠、F-09: 呼び出し元2つ） | Q-003 は未回答のまま残置。本番の環境変数設定前のリリース前ゲートで、要件・実装に影響しないため仕様レビューの未解決に数えない（audit cycle 1 F-04） |
| 2 | 2026-10-09 | 0 / 0 / 3 | approved。cycle 1 の F-01〜F-09 の反映を本文と実コードで確認。新規 🟢 N-01〜N-03（README 更新予告の書き方、本文のメールアドレスの出どころ、Gherkin シナリオ1の Given にロール）は任意のため本文は未変更。spec-to-pr の readme_sync・実装で判断する | Q-003 は未回答のままリリース前ゲートとして残置（本番の環境変数設定前に開発チームが確認。仕様レビュー・実装着手のブロッカーにしない）。N-01〜N-03 は任意の明確化として残置 |

#### 公式ドキュメント照合

- 実施（2026-10-09、spec-review audit cycle 1 で WebFetch）
- 参照 URL と確認日:
  - https://resend.com/docs/api-reference/emails/send-email （2026-10-09）。引用: "Recipient email address. For multiple addresses, send as an array of strings." / "Max 50." / "Idempotency keys expire after 24 hours" / "Have a maximum length of 256 characters"
    - 解釈: `to` 配列・Idempotency-Key の指定は本仕様と一致。キー `admin-signup-notification/<UUID>` は63文字で上限内
  - https://resend.com/docs/dashboard/emails/idempotency-keys （2026-10-09）。引用: "Idempotency keys are kept in the system for 24 hours." / "`409`: `concurrent_idempotent_requests` - another request with the same idempotency key is in progress." / "`409`: `invalid_idempotent_request` - this idempotency key has already been used on a request that had a different payload."
    - 解釈: 重複送信の2通目は 409 になり、ログに残る（§6 冪等性）
  - https://nextjs.org/docs/app/api-reference/functions/after （version 16.4.0、2026-10-09）。引用: "It can be used in Server Components (including generateMetadata), Server Functions, Route Handlers, and Proxy." / "`after` will run for the platform's default or configured max duration of your route."
    - 解釈: Server Action（`registerFullName`）内での `after()` 利用は公式で可（§10）

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 |  | 未承認 |  |  |
| 技術レビュー |  | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-10-09 | 初版作成。Q-001・Q-002 を回答済みで記録 | 依頼「ユーザー登録後にカオルさんへメール連絡」 | shoma-endo（Claude Code で起草） |
| 2026-10-09 | spec-review cycle 1 の指摘 F-01〜F-09 を反映（環境変数の検証位置、登録日時の出どころ、ロール例外の承認、Q-003 のリリース前ゲート化、409 の扱い、最後の一文のロール条件、Gherkin の画面名、`after()` 公式根拠、呼び出し元2つ）。公式ドキュメント照合を記録 | spec-review audit cycle 1 | Claude Code（spec-review revise） |
| 2026-10-09 | spec-review 通過（audit cycle 2 approved、🔴0 / 🟡0 / 🟢3）。cycle 1 の F-01〜F-09 は revise で反映済み。ステータスを `approved` に更新。Q-003 はリリース前ゲートとして残置 | 仕様レビュー | spec-review |
| 2026-10-09 | 実装 PR 作成（feature/admin-signup-notification）。名前の初回保存時に `after()` で `ADMIN_SIGNUP_NOTIFICATION_EMAILS` の管理者へ通知メールを送る（Server Action・メール組み立て lib・EmailService 送信メソッド・環境変数・単体テスト） | 仕様に沿った実装 | spec-to-pr |
