# PC ファーストのアプリシェル（左サイドバーナビ）仕様書

## メタデータ

- 文書名: PC ファーストのアプリシェル（左サイドバーナビ）
- ステータス: `implemented`
- 作成日: 2026-09-09
- 最終更新日: 2026-09-09
- 作成者: shoma-endo（Claude Code 同席）
- 承認者: shoma-endo
- 対象リリース: develop 次回マージ
- 関連する依頼・Issue・PR: ブランチ `feature/pc-first-app-shell`

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 共通ナビが画面下部固定の 3 項目（`src/components/Footer.tsx`、本実装で削除）で、モバイル前提の設計だった。利用者の 9 割は PC で、PC では下部固定バーが視線から遠く、設定・コンテンツ一覧・Google Ads 分析へはマイホームのカード経由でしか到達できなかった。
- chat 画面はヘッダーが `fixed` でビューポート全幅を占め、ルート高が実体の無い旧補正（`calc(100vh-3rem)`）のままで、入力欄の下端がフッターの下に隠れていた。

### 目的

- 共通ナビを左サイドバーへ移し、全画面から主要機能へ 1 クリックで移動できる状態にする。
- ナビ項目の定義を 1 か所（`src/lib/app-nav.ts`）に集約し、役割による出し分けをサーバー側ゲート（`proxy.ts`）と同じ条件に揃える。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 主要 7 画面への到達クリック数（PC） | 1〜2 | 1 | 手動確認 | 実装時 |
| 認証必須画面での横スクロール発生 | 0 | 0 | `scrollWidth === clientWidth` | 実装時 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者 | admin / paid / trial | 自分の役割で使える画面だけがナビに出る |
| 管理者・承認者 | admin | 管理者ダッシュボードがナビから開ける |

### 主な利用シナリオ

1. **PC 利用者が**、**どの画面からでも**、サイドバーで別機能へ移動する。
2. **スマホ利用者が**、上部バーのメニューからドロワーを開き、同じ項目で移動する。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
下部固定バー（マイホーム / 事業者情報 / チャット）→ 設定・一覧・広告分析はマイホームのカードから
```

### 導入後（To-Be）

```text
lg 以上: 左サイドバー（240px、役割で 4〜7 項目）＋本文
lg 未満: 上部バー（56px、メニューボタン）→ 左ドロワー（同じ項目）
```

### 業務ルール

- ルール ID: NAV-01
- ルール: ナビの出し分けは UI の補助であり、認可は `proxy.ts` のパス別ゲートが担う。両者の条件は一致させる。
- 例外: なし

## 4. 対象範囲と Non-goals

### 対象範囲

- 画面・操作: 認証必須の全画面（公開パスと `/unavailable` を除く）に共通シェルを適用。`/admin` の独自トップバーは撤去。
- データ: なし
- 権限: `src/lib/app-nav.ts` の `access`（`all` / `paid` / `admin`）

### Non-goals

- サイドバーの折りたたみ・幅ドラッグ・幅の永続化: MVP では固定幅で足りる。
- マイホーム（`/`）のカード再設計: サイドバーと重複するが、まずナビ移動を先行させる。次段で扱う。
- shadcn `sidebar.tsx` の導入: 依存追加（separator / collapsible）と未使用 export が増え、knip に弾かれる。既存 primitives（`sheet` / `button`）で足りる。
- ダークモード切替 UI: `--sidebar-*` トークンはダーク定義済みだが、切替 UI 自体が未導入。
- `/admin` 配下（users / prompts）のサイドバー掲載: 管理者ダッシュボードのカードから到達できる。
- 768px 未満の chat 固有レイアウト（`useMobile` 基準）の再設計: 既存の Sheet 版セッション一覧をそのまま使う。

## 5. 受け入れ条件

```gherkin
Feature: アプリ共通ナビ

  Scenario: admin が PC で開く
    Given admin でログインし幅 1024px 以上で "/" を開く
    Then 左サイドバーに 7 項目が表示され「マイホーム」がアクティブになる
    And ページ全体に横スクロールが発生しない

  Scenario: paid の出し分け
    Given paid でログインする
    Then サイドバーに「管理者ダッシュボード」は表示されない
    And 「コンテンツ一覧」「設定」は表示される

  Scenario: trial の出し分け
    Given trial でログインする
    Then サイドバーは「マイホーム」「事業者情報」「チャット」「Google Ads 分析」の 4 項目になる

  Scenario: 配下パスのアクティブ表示
    Given "/analytics/<id>" または "/ga4-dashboard" を開く
    Then 「コンテンツ一覧」がアクティブになる

  Scenario: モバイル幅のドロワー
    Given 幅 1024px 未満で "/chat" を開く
    Then 下部固定バーは無く、上部バーの「メニュー」でドロワーが開く
    When ドロワーの「設定」を押す
    Then "/setup" へ遷移しドロワーが閉じる

  Scenario: 公開パス
    Given "/privacy" "/login" "/home" "/unavailable" を開く
    Then サイドバー・上部バーは表示されない

  Scenario: chat 画面
    Given "/chat" を開く
    Then chat ヘッダーはサイドバーの右から始まり、ページにスクロールバーが出ない
    And Canvas を開くと見出しが chat ヘッダーの直下に収まる
```

## 6. 機能要件

### 画面設計

PC（lg 以上）:

```text
┌────────────┬───────────────────────────────┐
│ GrowMate   │                               │
│────────────│  本文（main, flex-1 min-w-0）  │
│ マイホーム   │                               │
│ 事業者情報   │                               │
│ チャット     │                               │
│ コンテンツ一覧 (paid/admin)                   │
│ Google Ads 分析                              │
│ 設定        (paid/admin)                     │
│ 管理者ダッシュボード (admin)                  │
│────────────│                               │
│ 氏名 / 役割 / ログアウト                       │
└────────────┴───────────────────────────────┘
  w-60 sticky top-0 h-screen
```

lg 未満: 上部バー（`h-14`、メニューボタン＋ブランド）→ `Sheet side="left"`（240px）に同じナビ＋ユーザーブロック。

### ナビ項目（正本: `src/lib/app-nav.ts`）

| ラベル | href | 表示条件 | アクティブ判定 |
| --- | --- | --- | --- |
| マイホーム | `/` | 全員 | 完全一致 |
| 事業者情報 | `/business-info` | 全員 | 前方一致 |
| チャット | `/chat` | 全員 | 前方一致 |
| コンテンツ一覧 | `/analytics` | paid/admin | 前方一致 ＋ `/ga4-dashboard` `/gsc-import` `/wordpress-import` |
| Google Ads 分析 | `/google-ads-dashboard` | 全員 | 前方一致 |
| 設定 | `/setup` | paid/admin | 前方一致 |
| 管理者ダッシュボード | `/admin` | admin | 前方一致 |

前方一致は `pathname === href || pathname.startsWith(href + '/')`（`public-paths` と同じ境界ルール）。

## 7. 設計

| ファイル | 役割 |
| --- | --- |
| `src/lib/app-nav.ts` | 項目定義・`getVisibleNavItems`・`isNavItemActive`（純粋ロジック） |
| `src/components/AppShell.tsx` | サイドバー / 上部バー / ドロワー / ユーザーブロック。CSS ブレークポイント（`lg`）で出し分け |
| `src/components/AuthProvider.tsx` | `showAppNav`（旧 `showFooter` と同条件）で `AppShell` を描画 |
| `app/admin/layout.tsx` | 独自トップバーを撤去。`bg-gray-50` と container のみ |
| `app/chat/components/*` | ヘッダーを `fixed` → `absolute`、ルートを `relative` ＋ `h-[calc(100dvh-3.5rem)] lg:h-dvh`。Canvas / Annotation の `sticky` 見出しをフロー内 `pt-16` へ。セッション一覧は 1280px 未満で既定折りたたみ |

### 設計判断

- **出し分けは CSS ブレークポイント**: `useMobile` は初回 width 0 で描画が跳ねるため使わない。chat 固有の `isMobile`（768px）はそのまま。768〜1023px はシェルが上部バー、chat は PC 版セッション一覧を出す。
- **z-index**: `<main>` に `isolate` を付け、ページ内の z-index（chat ヘッダー 50、分析テーブルの sticky セル 30/40/60）をシェルのクロームより下に閉じ込める。上部バー 40、サイドバー 30、Sheet/Dialog は body ポータルの 50。
- **chat ヘッダーは absolute**: `InputArea` が返す fragment の先頭にあり `MessageArea` の後に描画されるため、フローに戻すには構造変更が要る。`relative` なルート基準の `absolute` なら既存の `pt-16` 群がそのまま生きる。

## 8. 非機能・セキュリティ

- 認可はサーバー側（`proxy.ts`）が担う。ナビの非表示は補助であり、直接 URL を開いた場合の拒否は既存どおり。
- 新規依存なし。

## 9. 検証

- `npm run verify`（lint / test / build / knip）、`npm run verify:ui-text`
- 単体: `tests/unit/lib/app-nav.test.ts`（役割別の項目数・アクティブ判定・境界）
- 手動（実装時、admin）: 1600px で `/` `/analytics` `/chat`、800px で `/chat`（上部バー・ドロワー開閉→遷移・Canvas 見出し位置）、`/admin` `/business-info` `/privacy`。
- 未検証: 768px 未満（chat の履歴ボタン `History` アイコン）、trial / paid での出し分けの実画面（単体テストのみ）。

## 10. リスク・未決定事項

- 1024〜1279px で Canvas を開くと本文が狭い（既存の挙動。セッション一覧の既定折りたたみで緩和）。
- マイホームのカードとサイドバーの重複（Non-goal、次段）。
