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
lg 以上: 左サイドバー（240px ⇔ 64px のアイコンレールに折りたたみ可。役割で 4〜7 項目をグループ見出し付きで表示）＋本文
lg 未満: 上部バー（56px、メニューボタン）→ 左ドロワー（同じ項目。折りたたみ無し）
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

- サイドバーの幅ドラッグ: 折りたたみ（240px ⇔ 64px のアイコンレール）で足りる。折りたたみ状態は localStorage に持つ（`APP_SHELL_STORAGE_KEYS.SIDEBAR_COLLAPSED`）が、幅の自由変更は作らない。
- マイホーム（`/`）のカード・アカウント情報カード・見出し「GrowMate」の再設計: サイドバー（ナビ項目・ブランド・ログアウト）と重複するが、まずナビ移動を先行させる。→ [`home-today-spec.md`](home-today-spec.md) で実施（2026-09-09）。
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

  Scenario: サイドバーの折りたたみ
    Given 幅 1024px 以上でサイドバーが表示されている
    When 「メニューを折りたたむ」を押す
    Then サイドバーは 64px のアイコンレールになり、各項目はアイコンだけになる
    And アイコンにマウスを載せると項目名がツールチップで出る
    And 別画面へ移動・リロードしても折りたたみ状態が保たれる
    When 「メニューを広げる」を押す
    Then サイドバーは 240px に戻る

  Scenario: モバイル幅のドロワー
    Given 幅 1024px 未満で "/chat" を開く
    Then 下部固定バーは無く、上部バーの「メニューを開く」ボタンでドロワーが開く
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
展開（240px）                       折りたたみ（64px）
┌────────────────┬──────────────┐  ┌────┬──────────────┐
│ GrowMate      ⊏│              │  │ ⊐  │              │
│────────────────│  本文         │  │────│  本文         │
│ メイン          │  (main,      │  │────│              │
│ ▏⌂ マイホーム    │   flex-1     │  │ ⌂ │ ← hover で    │
│  ▤ 事業者情報   │   min-w-0)   │  │ ▤ │   ツールチップ │
│  ✉ チャット     │              │  │ ✉ │              │
│ 分析            │              │  │────│              │
│  ≡ コンテンツ一覧 (paid/admin)  │  │ ≡ │              │
│  ⚡ Google Ads 分析            │  │ ⚡ │              │
│ 管理            │              │  │────│              │
│  ⚙ 設定 (paid/admin)          │  │ ⚙ │              │
│  ⛨ 管理者ダッシュボード (admin) │  │ ⛨ │              │
│────────────────│              │  │────│              │
│ (顔) 氏名 / 役割        [⇥]    │  │(顔)│              │
└────────────────┴──────────────┘  │[⇥] │              │
  sticky top-0 h-dvh                └────┴──────────────┘
```

- ヘッダー: 「GrowMate」（`/` へのリンク。アイコンやロゴマークは付けない。2026-09-09 にユーザー指示で撤去）、右端に折りたたみトグル（`PanelLeftClose` / `PanelLeftOpen`、`aria-expanded`、ツールチップ「メニューを折りたたむ／広げる」）。折りたたみ時はブランド名を出さずトグルだけ。
- グループ見出し「メイン」「分析」「管理」（`text-[11px] uppercase tracking-wider`、`text-sidebar-foreground/50`）。折りたたみ時は見出しの代わりに区切り線。
- アクティブ項目: `bg-sidebar-accent` ＋ `font-semibold` ＋ 左端 2px のアクセントバー（`bg-sidebar-primary`）。折りたたみ時はバー無し。
- 折りたたみ時の各項目: アイコンのみ＋ `aria-label` ＋右側ツールチップ（既存 `tooltip.tsx`）。
- ユーザーブロック: アバター（`linePictureUrl` があれば画像、無ければ頭文字）＋氏名／役割＋ログアウトのアイコンボタン（ツールチップ）。折りたたみ時はアバターとログアウトだけを縦に並べ、氏名／役割はツールチップ。
- 幅の遷移は `transition-[width] duration-200`（`motion-reduce` で無効）。

lg 未満: 上部バー（`h-14`、「メニューを開く」ボタン＋ブランド）→ `Sheet side="left"`（240px、タイトル「メインメニュー」）に同じナビ＋ユーザーブロック。ドロワー内のナビ項目は 44px のタッチターゲット（`py-3`）。

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

### 項目とグループの追加基準（2026-09-09 決定）

画面が増えたときにサイドバーを膨らませないための基準。`src/lib/app-nav.ts` を変えるときはここに照らす。

- **サイドバーに足すのは「他の画面から辿れないハブ」だけ。** 既存ハブの配下で開く画面（例: Instagram 分析 → コンテンツ一覧のタブ、ネガティブキーワード → Google Ads 分析、GA4 ダッシュボード／取り込み → コンテンツ一覧、ユーザー／プロンプト管理 → 管理者ダッシュボード）は足さず、親項目の `activePrefixes` にパスを追加して親をアクティブにする。
- **グループは今の 3 つ（メイン／分析／管理）を据え置く。** 新しい項目は既存グループのどれかに入れる。グループを増やすのは、どのグループにも入らない項目が 2 つ以上たまったときだけ。
- **グループ単位の折りたたみは作らない。** 項目 7 個で隠す理由が無く、初心者の発見性を下げる。サイドバー全体のレール折りたたみで足りる。
- **項目が 10 個を超えたら**、グループ折りたたみではなく「アクティブなハブの配下だけ子項目を展開する」階層表示を検討する（その時点で別仕様）。

## 7. 設計

| ファイル | 役割 |
| --- | --- |
| `src/lib/app-nav.ts` | 項目定義（`group` 付き）・グループ定義・`getVisibleNavItems`・`getVisibleNavGroups`・`isNavItemActive`（純粋ロジック） |
| `src/components/AppShell.tsx` | サイドバー（折りたたみ・グループ・ツールチップ） / 上部バー / ドロワー / ユーザーブロック。CSS ブレークポイント（`lg`）で出し分け。折りたたみ状態は `useSidebarCollapsed`（localStorage、AuthProvider がロード中は children を描画しないので初期値で読んで hydration 安全） |
| `src/components/AuthProvider.tsx` | `showAppNav`（旧 `showFooter` と同条件）で `AppShell` を描画 |
| `app/admin/layout.tsx` | 独自トップバーを撤去。`bg-gray-50` と container のみ |
| `app/chat/components/*` | ヘッダーを `fixed` → `absolute`、ルートを `relative` ＋ `h-[calc(100dvh-3.5rem)] lg:h-dvh`。Canvas / Annotation の `sticky` 見出しをフロー内 `pt-16` へ。セッション一覧は 1280px 未満で既定折りたたみ（折りたたみレールは `History` アイコン＋「チャット履歴を開く」）。`ChatLayoutContent` の `SheetTrigger`（旧 fixed ヘッダーの下に `absolute top-2 left-2 z-10` で置かれ押せなかった）を削除。開閉は `InputArea` の「チャット履歴を開く」ボタンが担う |
| `app/business-info/page.tsx` / `app/globals.css` | フッター補正 `pb-24` と未使用の `.footer-tab-active` を削除 |
| `app/layout.tsx` | `Toaster` を `AuthProvider` の外へ。Sonner はポータルしないため `main`（`isolate`）内に置くと Dialog / Sheet のオーバーレイの下に潜る |
| `src/components/AuthProvider.tsx` `logout` | `signOutEmail` の失敗を `false` で返す。失敗時にローカルだけクリアして `/login` へ飛ばすと Cookie が残り proxy が `/` へ戻す（押しても何も起きないように見える）。サイドバーとマイホームのログアウトは同じ `logout()` を使い、失敗は toast `ERROR_MESSAGES.AUTH.LOGOUT_FAILED` で伝える |
| `src/components/ui/sheet.tsx` | `SheetTitle` を追加（Radix Dialog のタイトル必須）。閉じるボタンを「閉じる」（sr-only）＋ 44px のヒット領域に |

### 設計判断

- **出し分けは CSS ブレークポイント**: `useMobile` は初回 width 0 で描画が跳ねるため使わない。chat 固有の `isMobile`（768px）はそのまま。768〜1023px はシェルが上部バー、chat は PC 版セッション一覧を出す。
- **z-index**: `<main>` に `isolate` を付け、ページ内の z-index（chat ヘッダー 50、分析テーブルの sticky セル 30/40/60）をシェルのクロームより下に閉じ込める。上部バー 40、サイドバー 30、Sheet/Dialog は body ポータルの 50。
- **折りたたみの参考**: muz.li の Dashboard Inspiration（2026-09-09 にユーザー指定）に多い「アイコンレール＋ツールチップ＋ヘッダーのトグル＋グループ見出し＋左アクセントのアクティブ表示」を、既存トークンと primitives（Tooltip / Avatar / Button）だけで再現。新しい色・フォントは入れない。
- **グループ分けは据え置き（2026-09-09 レビュー）**: 「メイン」は寄せ集めに近い名前、paid では「管理」が「設定」1 項目になるが、7 項目・3 グループは見出しが効く最小サイズで許容。事業者情報は本来「AI に読ませる設定」に近く、将来「管理」へ移す余地がある（今は初回導線として上に置く）。先頭グループを無見出しにする案は採らない。
- **文言**: `/chat` のセッション一覧は「チャット履歴」で統一（`ui-text.md` に追記。旧「サイドバーを開く／閉じる」はアプリ共通サイドバーと衝突）。`/google-ads-dashboard` の見出しを「Google Ads 分析」に揃え、ナビ・カード・見出しで同じ語にする。
- **chat ヘッダーは absolute**: `InputArea` が返す fragment の先頭にあり `MessageArea` の後に描画されるため、フローに戻すには構造変更が要る。`relative` なルート基準の `absolute` なら既存の `pt-16` 群がそのまま生きる。

## 8. 非機能・セキュリティ

- 認可はサーバー側（`proxy.ts`）が担う。ナビの非表示は補助であり、直接 URL を開いた場合の拒否は既存どおり。
- 新規依存なし。

## 9. 検証

- `npm run verify`（lint / test / build / knip）、`npm run verify:ui-text`
- 単体: `tests/unit/lib/app-nav.test.ts`（役割別の項目数・アクティブ判定・境界）
- 手動（実装時、admin）: 1440px で折りたたみ（64px、ツールチップ、遷移・リロード後の復元、`/chat` ヘッダー追従、`/analytics` 横スクロール無し）と展開復帰。1600px で `/` `/analytics` `/chat`、800px で `/chat`（上部バー・ドロワー開閉→遷移・Canvas 見出し位置）、`/admin` `/business-info` `/privacy`。
- 未検証: 768px 未満（chat の履歴ボタン `History` アイコン）、trial / paid での出し分けの実画面（単体テストのみ）、ログアウトの実クリック（セッションを切るため。コード経路は `logout()` 1 本に統一済み）。
- レビュー: growmate-ui-ux 観点と quality-gate 2 パスをサブエージェントで実施し、🔴🟡 を反映済み（2026-09-09）。

## 10. リスク・未決定事項

- 1024〜1279px で Canvas を開くと本文が狭い（既存の挙動。セッション一覧の既定折りたたみで緩和）。
- マイホームのカード・見出し・ログアウトとサイドバーの重複（Non-goal、次段）。
- 768px 未満の chat でセッション削除が Sheet（チャット履歴）→ Dialog（削除確認）のモーダル on モーダルになる（既存。`growmate-ui-ux` の禁止事項に抵触）。恒久策は削除確認前に `ui.sidebar.setOpen(false)` してから Dialog を開く。本仕様では既存挙動を踏襲し、次段で扱う。
