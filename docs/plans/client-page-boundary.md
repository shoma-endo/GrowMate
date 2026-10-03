# page.tsx から "use client" を外す（login / gsc-import / wordpress-import）

## メタデータ

- 文書名: page.tsx から "use client" を外す（login / gsc-import / wordpress-import）
- ステータス: `draft`
- 作成日: 2026-10-03
- 最終更新日: 2026-10-03
- 作成者: shoma-endo（Claude Code 支援）
- 承認者: 未定
- 対象リリース: 機能リリースと独立。`develop` へマージ後、次の通常デプロイに乗る
- 関連する依頼・Issue・PR: 2026-10-03 可読性レビュー（Next.js App Router の「page は薄く、`"use client"` は葉だけ」との突合）。同時に起こした `docs/plans/analytics-table-split.md` / `docs/plans/chat-layout-split.md`

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか: `app/**/page.tsx` 25 本のうち 3 本だけ、ファイル先頭に `'use client'` があり、画面の状態とハンドラを page.tsx が直接持っている（`app/login/page.tsx:1`・`app/gsc-import/page.tsx:1`・`app/wordpress-import/page.tsx:1`、実行行数 267 / 411 / 319、develop 4fd6ae2e）。残りの 22 本は「Server Component の page が Client 部品を描画する」形にそろっている（例: `app/chat/page.tsx` → `app/chat/ChatClient.tsx`、`app/setup/gsc/page.tsx` → `src/components/GscSetupClient.tsx`）。そのため、この 3 画面だけは page.tsx を開いても「どこからが Client か」「サーバー側で何をしているか」が他の画面と同じ読み方で読めない
- 放置した場合の影響: page に Client を直書きする前例として残り、新しい画面で写される。page.tsx では `metadata` の export も初期データのサーバー取得もできないため、どちらかが必要になった時点で今回と同じ移動を機能追加と混ぜて行うことになる

### 目的

- この開発で実現する状態: 25 本すべての page.tsx が Server Component になる。3 画面の Client 部分は page と同じディレクトリの `<Name>Client.tsx` に移る
- 利用者・事業にとっての価値: エンドユーザーへの価値はない（内部整理）。開発側は「page.tsx = 入口、`*Client.tsx` = 画面の状態」という読み方が全画面で通じるようになる

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 先頭に `'use client'` がある page.tsx | 3 本 | 0 本 | `for f in $(find app -name page.tsx); do head -1 "$f" \| grep -q "use client" && echo "$f"; done` が空 | PR レビュー時 |
| 3 画面の page.tsx の実行行数 | 267 / 411 / 319 | 各 20 以下 | `npm run hotspots` と同じ数え方（`grep -cvE '^\s*$\|^\s*//\|^\s*/\*\|^\s*\*'`） | PR レビュー時 |
| 移動のみであること | – | §7 の行比較で、差分が FR-005 の許可行だけ | §7「移動のみであることを行の多重集合で示す」 | PR レビュー時 |
| `eslint-suppressions.json` の件数 | `no-raw-colors`: login 6 / gsc-import 24 / wordpress-import 32 | 合計 62 のまま。`app/login/page.tsx` 1・`LoginClient.tsx` 5・`GscImportClient.tsx` 24・`WordPressImportClient.tsx` 32 | `git diff develop -- eslint-suppressions.json` と件数の合計 | PR レビュー時 |
| 既存テスト | 全件 pass | `npm run verify` が緑、`tests/` に差分なし | `npm run verify` / `git diff --stat develop -- tests` | PR 作成時 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | 該当なし（見た目・挙動は変わらない） | – |
| 運用担当 | 開発者（本人）・AI 実装者 | page.tsx は入口、状態は `*Client.tsx` という読み方で 3 画面も読める |
| 管理者・承認者 | 未定 | 移動のみであることの証跡（§7）を見てマージを判断する |
| 外部サービス・連携先 | 該当なし | – |

### 主な利用シナリオ

1. **AI 実装者が**、**GSC インポート画面に初期データのサーバー取得を足すとき**、`app/gsc-import/page.tsx` に取得処理を書き、`GscImportClient` に props で渡すだけで済む（`app/setup/gsc/page.tsx:8-23` と同じ形）
2. **レビュアーが**、**ログイン画面の差分を読むとき**、`'use client'` の境界が `app/login/LoginClient.tsx` の先頭にあることで、Server と Client の区別がファイル単位でつく

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
app/login/page.tsx          'use client' / LoginPageContent（状態・effect 3 本・ハンドラ 4 本・JSX） + default LoginPage（Suspense で包む）
app/gsc-import/page.tsx     'use client' / 型・日付ヘルパー・isOAuthTokenError + default GscImportPage（状態・effect・JSX）
app/wordpress-import/page.tsx 'use client' / 型・isWordPressAuthError + default WordPressImportPage（状態・JSX）
```

### 導入後（To-Be）

```text
app/login/page.tsx            Server Component。Suspense（fallback は現行のまま）で <LoginClient /> を包む
app/login/LoginClient.tsx     'use client' / 現行 LoginPageContent の本体（新規）

app/gsc-import/page.tsx       Server Component。<GscImportClient /> を返すだけ
app/gsc-import/GscImportClient.tsx   'use client' / 現行 page.tsx の全内容。関数名だけ GscImportClient（新規）

app/wordpress-import/page.tsx Server Component。<WordPressImportClient /> を返すだけ
app/wordpress-import/WordPressImportClient.tsx 'use client' / 現行 page.tsx の全内容。関数名だけ WordPressImportClient（新規）
```

### 業務ルール

- ルール ID: BR-01
- ルール: マークアップ・クラス・文言・状態・effect・Server Action 呼び出し・`fetch` 先を 1 つも変えない。本体は移動のみ。変えてよい行は FR-005 に列挙したものだけ
- 例外: なし。改善したい箇所があっても本仕様では触らず、§12 の OPEN に記録する

- ルール ID: BR-02
- ルール: 描画モードを変えない。ルートレイアウト `app/layout.tsx:15` の `export const dynamic = 'force-dynamic'` によって 3 画面とも現状すでに動的描画なので、page を Server Component にしても静的プリレンダーにはならない。page.tsx に `dynamic` などの route segment config を追加しない
- 例外: なし

## 4. 対象範囲と Non-goals

> **判断軸: GrowMate は MVP 開発を最優先とする**（`AGENTS.md` Core Rules）。要件に無い機能は入れない。

### 対象範囲

- 画面・操作: `/login`・`/gsc-import`・`/wordpress-import`。ファイルの置き場所を変えるだけで、見た目・操作は変わらない
- API・外部連携: 該当なし
- データ・DB: 該当なし（migration なし）
- 権限・ロール: 該当なし（現行の Client 側判定 `canImport` と `proxy.ts` の制御をそのまま残す）
- 運用・監視: `eslint-suppressions.json` の件数をファイル間で付け替える（FR-006・ALT-003）

### Non-goals（今回の対象外）

- 対象外にするもの:
  - GSC 連携状態の取得（`app/gsc-import/page.tsx:106-142` の `useEffect` → `fetchGscStatus`）を Server page での初期取得に変えること → OPEN-001
  - 3 画面に `metadata` を足すこと
  - ハードコードされたエラー文言を `ERROR_MESSAGES` へ寄せること → OPEN-002
  - `app/` 全体を `features/` 構成へ移すこと。理由: 既存 22 本の page がルート同居（`app/chat/components/` など）と `src/components/*Client.tsx` の 2 形ですでに読めており、全面移行の差分に見合う改善がない
  - `app/api` の更新系 Route Handler を Server Action に移すこと。理由: 呼び出し元の調査がこの仕様の範囲外で、「page を薄くする」とは別の論点
  - `eslint-plugin-jsx-a11y` の導入と、`eslint-suppressions.json` の `shadcn/no-raw-colors`（1424 件）の解消。理由: 画面側の可読性の論点で、コードの置き場所の整理とは別に判断する
- 対象外にする理由: 本仕様の価値は「差分を移動だけにして、全 page の読み方をそろえる」こと。挙動の変更を混ぜると手動確認の範囲が広がり、移動のみの証跡（§7）が成り立たなくなる
- 将来検討する条件・時期: §12 の OPEN を参照

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `仮置き`（2026-10-03、Claude 案）
- 含めるもの: 移動・`npm run verify`・3 画面の手動確認
- 含めないもの: 仕様レビューの往復

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 移動 | 新規 3 ファイルと page.tsx 3 本の書き換え | 0.5 | 0.1 |
| 検証 | `npm run verify`・§7 の行比較・3 画面の手動確認 | 1 | 0.1 |
| **合計** |  | 1.5 | 0.2 |

### カレンダー上の前提（工数外）

- 仕様レビュー・承認の見込み: `spec-review` 1 回
- クライアント確認・たたき台合意の見込み: 該当なし（内部作業）
- 希望リリース時期との関係: 制約なし

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | `app/login/LoginClient.tsx`（新規）に `'use client'`、現行 `app/login/page.tsx:3-18` の import・型（`LoginView`）と `:20-281` の `LoginPageContent` 本体を移し、`export default function LoginClient()` とする。`app/login/page.tsx` は現行 `:283-296` の `Suspense` と fallback をそのまま保ち、子を `<LoginClient />` にする | Must | §3 To-Be | `app/login/page.tsx` の先頭に `'use client'` がなく、`useSearchParams` を使う `LoginClient` が `Suspense` の内側にある |
| FR-002 | `app/gsc-import/GscImportClient.tsx`（新規）に現行 `app/gsc-import/page.tsx` の全内容を移し、`export default function GscImportPage()`（`:78`）を `export default function GscImportClient()` に改名する。`app/gsc-import/page.tsx` は `GscImportClient` を import して返すだけにする | Must | §3 To-Be | `app/gsc-import/page.tsx` が import 1 行と関数 1 つだけ |
| FR-003 | `app/wordpress-import/WordPressImportClient.tsx`（新規）に現行 `app/wordpress-import/page.tsx` の全内容を移し、`export default function WordPressImportPage()`（`:58`）を `export default function WordPressImportClient()` に改名する。`app/wordpress-import/page.tsx` は `WordPressImportClient` を import して返すだけにする | Must | §3 To-Be | `app/wordpress-import/page.tsx` が import 1 行と関数 1 つだけ |
| FR-004 | 新しい page.tsx 3 本の default export 関数名は現行どおり `LoginPage` / `GscImportPage` / `WordPressImportPage` とし、props を取らない | Must | BR-01 | 関数名が現行と一致する |
| FR-005 | 移動元と移動先で内容が変わってよいのは次の行だけ: (a) 新規 `*Client.tsx` の関数宣言行（改名）、(b) `app/login/page.tsx` の import 行（`Suspense`・`Loader2`・`LoginClient` のみ残す）と `<LoginPageContent />` → `<LoginClient />` の 1 行、(c) gsc-import / wordpress-import の page.tsx 本体（import 1 行・関数 3 行程度）。`LoginClient.tsx` から `Suspense` の import を外す | Must | BR-01 | §7 の行比較で差分がこの範囲に収まる |
| FR-006 | `eslint-suppressions.json` の `shadcn/no-raw-colors` の件数を付け替える。`app/login/page.tsx` の 6 件は、page に残る fallback の `text-gray-500`（現行 `:289`）の 1 件と、`app/login/LoginClient.tsx` の 5 件に分ける。`app/gsc-import/page.tsx` の 24 件と `app/wordpress-import/page.tsx` の 32 件は、それぞれ `*Client.tsx` のキーへ移す。JSON を直接編集し、`--suppress-all` / `--suppress-rule` は使わない（ALT-003） | Must | `AGENTS.md`「件数は増やさない」 | 成功指標の「`eslint-suppressions.json` の件数」を満たし、`npm run lint` が通る |

### 入力・出力・状態遷移

該当なし（変更なし）。

### 画面設計

見た目は変えない。マークアップとクラスを移動するだけなので、growmate-ui-ux の「UI 既存パターン対照表」は該当なし。ファイルの置き場所だけは既存の 2 パターンから選んでいる（ALT-001）。

#### 画面一覧

| 画面 | パス | 新規/既存 | 概要・変更点 |
| --- | --- | --- | --- |
| ログイン | `/login` | 既存 | ファイルの置き場所だけ変える |
| GSC インポート | `/gsc-import` | 既存 | 同上 |
| WordPress インポート | `/wordpress-import` | 既存 | 同上 |

### 権限

| ロール | 閲覧 | 作成・実行 | 更新 | 削除・解除 |
| --- | --- | --- | --- | --- |
| 全ロール | 現行どおり（`proxy.ts` と各画面の `canImport` 判定） | 現行どおり | – | – |

新規機能ではないため、「新規機能は admin / paid だけ」のルール（`AGENTS.md` Core Rules）は適用しない。

## 7. Gherkin受け入れ条件

```gherkin
Feature: page.tsx から "use client" を外す

  Rule: すべての page.tsx が Server Component になる

    Scenario: 'use client' 付きの page が残らない
      When app 配下の page.tsx の 1 行目を全件調べる
      Then 'use client' で始まるものが 0 件である

    Scenario: ログインの Suspense 境界が保たれる
      Given LoginClient が useSearchParams を使う
      When 実装後の app/login/page.tsx を読む
      Then JSX が Suspense で LoginClient を包む形で、fallback の 6 行（現行 :286-291）が行比較で一致する

  Rule: 挙動を変えない

    Scenario: 移動のみであることを行の多重集合で示す
      Given develop の app/login/page.tsx・app/gsc-import/page.tsx・app/wordpress-import/page.tsx を連結したもの
      And 実装後の page.tsx 3 本と *Client.tsx 3 本を連結したもの
      When §13 の norm で import ブロック・空行・閉じ括弧だけの行を除き、sort して比べる
      Then 差分が FR-005 の許可行だけである

    Scenario: lint の抑制件数の合計が変わらない
      When npm run lint を実行する
      Then lint が通り、eslint-suppressions.json の 3 画面分の no-raw-colors の合計が 62 のままである

    Scenario: ログインの流れが変わらない
      Given 未ログインで /login を開く
      When メールアドレスを入力して認証コードを送信し、届いた 6 桁を入力してログインする
      Then 現行と同じ文言・順序で画面が切り替わり、ログイン後の遷移先も現行と同じである

    Scenario: GSC インポートが変わらない
      Given GSC 連携済みの paid ユーザーで /gsc-import を開く
      Then 連携状態の読み込み表示のあと、期間・検索タイプ・最大行数の入力欄が現行と同じ初期値で表示される

    Scenario: WordPress インポートの権限表示が変わらない
      Given unavailable ロールのユーザーで /wordpress-import を開く
      Then 「この画面を利用する権限がありません。」が表示される
```

### シナリオ対応表

| シナリオ | 対応する機能要件 | 対応する決定事項 |
| --- | --- | --- |
| 'use client' 付きの page が残らない | FR-001〜003 | – |
| ログインの Suspense 境界が保たれる | FR-001 | BR-02 |
| 移動のみであることを行の多重集合で示す | FR-005 | BR-01 |
| lint の抑制件数の合計が変わらない | FR-006 | ALT-003 / Q-001 |
| ログインの流れが変わらない | FR-001 / FR-004 | BR-01 |
| GSC インポートが変わらない | FR-002 | BR-01 |
| WordPress インポートの権限表示が変わらない | FR-003 | BR-01 |

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 現行と同等。page.tsx が Server Component になっても、Client 部分のバンドルは移動前と同じ内容 | – | BR-02 |
| 可用性・信頼性 | 対象外 | – | 対象外 |
| セキュリティ・プライバシー | 新しく Server から Client へ渡すデータはない（props なし） | コードレビュー | FR-004 |
| 認証・認可 | 現行どおり | §7 WordPress のシナリオ | 現状維持 |
| 監査・ログ | 対象外 | – | 対象外 |
| 障害対応 | 対象外 | – | 対象外 |
| バックアップ・復旧 | 対象外 | – | 対象外 |
| 運用・監視 | 対象外 | – | 対象外 |
| 拡張性・互換性 | 3 画面とも、Server page で初期データを取って `*Client` に props で渡す形を追加できるようになる | – | OPEN-001 |
| アクセシビリティ | 現行どおり（マークアップを変えない） | – | BR-01 |
| コスト | 対象外 | – | 対象外 |

### AI機能の追加観点

対象外（AI 機能を含まない）。

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ: 該当なし
- データの所有者: 該当なし
- 保持期間・削除条件: 該当なし
- 移行・既存データとの互換性: 該当なし
- RLS・Service Role・ユーザー境界: 不変

### 外部連携

該当なし。

## 10. 制約・前提・依存関係

### 技術前提

- 既存システム・ライブラリ・社内標準: Next.js App Router（このリポジトリの版は `node_modules/next/dist/docs/` を正とする）。`'use client'` ファイルを Server Component から import して描画できる
- 再利用する既存実装: 既存の page と Client の分け方。`app/chat/page.tsx` → `app/chat/ChatClient.tsx`（同じディレクトリに置き、`export default`）
- 既存規約からの乖離とその理由: なし。ファイル名は `project-naming` の「カスタム: `PascalCase.tsx`（例: `ChatClient.tsx`）」（`.agents/skills/project-naming/SKILL.md:21`）に合わせる

### 制約条件

- 納期・予算・人員: なし
- 法令・契約・審査: なし
- 変更できない既存仕様: URL（`/login`・`/gsc-import`・`/wordpress-import`）、`proxy.ts` と `src/lib/public-paths.ts:15` の公開パス

### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- |
| 3 ファイルを変更中の PR・仕様 | なし（2026-10-03 時点で、オープン PR #596 と `shoma-endo/blog-draft-types` は 3 ファイルを変更していない） | 着手前に `gh pr list --state open --json number,files --jq '.[] \| select(.files[].path \| test("app/(login\|gsc-import\|wordpress-import)/page.tsx")) \| .number'` が空 | rebase で衝突する |

## 11. トレードオフ判断

### ALT-001: Client ファイルの置き場所（Claude 案・未確認）

- 判断: 移動先を route と同じディレクトリにするか、`src/components/` にするか
- 比較した案:
  - 案A: `app/<route>/<Name>Client.tsx`（`app/chat/ChatClient.tsx` と同じ）
  - 案B: `src/components/<Name>Client.tsx`（`src/components/GscSetupClient.tsx` など setup 系 4 本、および `/review-login` の `src/components/ReviewLoginForm.tsx` と同じ）
- 採用案: 案A
- 採用理由: 3 本とも 1 つの route からしか使わない。URL のディレクトリを開けば page と Client が並ぶので、「この URL のコードはどこか」に答えやすい。`src/components/` は複数画面で使う部品の置き場として残す
- 却下した案と理由: 案B は setup 系や隣の `/review-login` とそろうが、1 画面専用の部品が共有部品と同じ場所に混ざる
- 影響: setup 系 4 本は案B のまま残り、置き場所の流儀が 2 つ並ぶ。setup 系を移すかどうかは本仕様の範囲外
- 将来変更する条件: setup 系を同じ形にそろえると決めたとき
- 判断者・判断日: Claude 案（2026-10-03）。承認者の確認待ち

### ALT-002: 初期データ取得を Server へ移すか

- 判断: gsc-import の連携状態の取得（`app/gsc-import/page.tsx:106-142`）を今回 Server page へ移すか
- 比較した案:
  - 案A: 移さない（移動のみ）
  - 案B: `app/setup/gsc/page.tsx:15-23` と同じく、Server で `requireSetupAuth` と状態解決を行い props で渡す
- 採用案: 案A
- 採用理由: 案B は読み込み表示の有無、メール連携衝突時のリダイレクト（`:116-118`）、`unavailable` ロールの早期 return（`:107-110`）の挙動が変わる。移動のみの証跡を保つため、別の仕様に分ける
- 却下した案と理由: 案B は挙動変更を含み、BR-01 に反する
- 将来変更する条件: OPEN-001
- 判断者・判断日: Claude 案（2026-10-03）。承認者の確認待ち

### ALT-003: lint の抑制件数の扱い

- 判断: 違反のあるマークアップを新しいファイルへ移すとき、`eslint-suppressions.json` をどう扱うか
- 前提: 抑制の記録はファイルのパスごとに付く。移した先には記録がないため lint が落ち、移した元には記録が余るため lint が落ちる（`eslint.config.mjs:185-188`）
- 比較した案:
  - 案A: 件数をファイル間で付け替える。合計は変えない。JSON を直接編集する
  - 案B: 違反を直してから移す（生の色をトークンに置き換える）
- 採用案: 案A（Q-001 で承認済み。`docs/plans/analytics-table-split.md` の ALT-002 と同じ論点）
- 採用理由: `AGENTS.md` と `eslint.config.mjs:187` が防ぎたいのは違反が増えること。案A は違反の数が変わらない
- 却下した案と理由: 案B は色クラスが変わり、BR-01 と growmate-ui-ux（`SKILL.md:22`）に反する
- 判断者・判断日: shoma-endo・2026-10-03（Q-001 で案A を承認）

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | `Suspense` を Server page 側に置くことで、ログインの fallback の出方が変わる | `LoginClient` 側にも `Suspense` を残す、または外し忘れる | FR-001 / FR-005 で `Suspense` を page 側だけに置くと決めている。§7 のシナリオで手動確認する | 実装者 | 対策済み |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-001 | 違反の数を変えずに、`eslint-suppressions.json` の記録をファイル間で付け替えてよいか（ALT-003 案A） | `AGENTS.md` と `eslint.config.mjs:185-188` は記録を増やすことを禁じているが、付け替えについては書いていない。認められないと、移動のみでは lint を通せない | shoma-endo | spec-review の前 | 回答済み（2026-10-03 shoma-endo: 付け替えを認める） |

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | gsc-import の連携状態の取得を Server page へ移すか（ALT-002 案B） | 挙動が変わるため、移動のみの本仕様には混ぜない | gsc-import を次に機能変更するとき | shoma-endo |
| OPEN-002 | 文言の直書きを `ERROR_MESSAGES` に寄せるか（`app/login/page.tsx:103` / `:117` / `:131` / `:142`、`app/gsc-import/page.tsx:130`） | 文言の扱いは `src/domain/errors/error-messages.ts` の方針に従う別作業で、移動と混ぜると差分を検証しにくい | 該当画面を次に触るとき | shoma-endo |

## 13. テスト・リリース・ロールバック

### テスト方針

- 単体テスト: 追加しない。3 画面とも既存テストがなく、移動のみの変更に対してキャラクタライズテストを足す費用が見合わない（Claude 案・未確認）
- 自動検証: `npm run verify`（audit / lint / test:coverage / build / knip）
- 手動確認: §7 の 3 シナリオをローカルの dev サーバーで確認する
- 移動の証跡: 次の `norm` で移動前と移動後を比べ、出力を PR 本文に貼る。複数行の import は、`import` で始まり `;` で終わる行までを 1 ブロックとして落とす

```bash
norm() { awk '/^(import|export \{.*\} from|export \{$)/{imp=1} imp{ if (/;[[:space:]]*$/) imp=0; next } {print}' "$@" \
  | sed -E 's/^[[:space:]]+//' | grep -vE '^$|^[]\)\}>;,]+$' | sort; }
diff <(git show develop:app/login/page.tsx develop:app/gsc-import/page.tsx develop:app/wordpress-import/page.tsx | norm) \
     <(norm app/login/*.tsx app/gsc-import/*.tsx app/wordpress-import/*.tsx)
```

### リリース方針

- 通常デプロイに乗せる。段階リリースやフラグは使わない

### ロールバック方針

- PR を revert する。データ変更はない

## 14. 実装手順・チェックポイント

### 手順

1. §10 の依存確認コマンドを実行し、空であることを確かめる
2. `git mv app/gsc-import/page.tsx app/gsc-import/GscImportClient.tsx` のあと関数名を変え、新しい `page.tsx` を書く。wordpress-import も同様にする（`git mv` で履歴を追えるようにする）
3. login は `git mv app/login/page.tsx app/login/LoginClient.tsx` のあと、`LoginPage`（`Suspense` ラッパー）を新しい `page.tsx` に切り出す
4. `npm run verify` を実行する
5. FR-006 の抑制記録を付け替え、`npm run lint` を通す
6. §13 の `norm` で行比較を実行し、差分が FR-005 の範囲に収まることを確かめる
7. 3 画面を手動確認する

### チェックポイント

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| CP-1 spec-review 前 | Q-001 の回答 | shoma-endo | 確認済み（2026-10-03） |
| CP-2 PR 作成時 | `git diff --stat develop` の変更が `app/login/`・`app/gsc-import/`・`app/wordpress-import/`・`eslint-suppressions.json`（と `vitest.config.ts` の閾値ラチェット）だけ | 実装者 | 未確認 |

## 15. 完了条件

- Definition of Done（すべて満たして完了）:
  - §1 の成功指標をすべて満たす
  - §7 のシナリオをすべて満たす
  - `npm run verify` が緑
- 検証方法・証跡（テスト結果・画面確認・ログ等）:
  - `norm` の行比較の出力と、3 画面の手動確認の結果を PR 本文に書く
- 完了確認者・確認日: 未定

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| 0（起票時のセルフレビュー） | 2026-10-03 | 1 / 1 / 4 | 全件反映（🔴 の抑制記録の付け替えは FR-006 に書き、可否は Q-001 で承認済み） | なし |

#### 公式ドキュメント照合

- 実施 / 未実施: 対象外（外部サービス連携なし）

### 承認

| 役割 | 氏名 | 判定 | 日付 | コメント |
| --- | --- | --- | --- | --- |
| 要件承認者 |  | 未承認 |  |  |
| 技術レビュー |  | 未承認 |  |  |

### 変更履歴

| 日付 | 変更内容 | 変更理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-10-03 | 起票 | 可読性レビュー | shoma-endo（Claude Code 支援） |
