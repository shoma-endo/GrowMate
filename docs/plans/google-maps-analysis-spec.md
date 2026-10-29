# Googleマップ分析（自社プロフィール・競合診断） 仕様書

## メタデータ

- 文書名: Googleマップ分析（自社プロフィール・競合診断）
- ステータス: `draft`
- 作成日: 2026-10-26
- 最終更新日: 2026-10-29
- 作成者: 開発（Claude Code 起票）
- 承認者: 未定
- 対象リリース: 未定
- 関連する依頼・Issue・PR: 2026-10-26 開発依頼「Googleマップ分析機能（競合・自社）」（会話）。依頼文の戦略メモ（競合分析＝売るための道具 / 自社データ＝勝つための道具 / データをメディアに還元）を出典とする。**クライアント（カオルさん）の合意は未確認**（`docs/context/client-vision-from-lark.md` に Googleマップ・MEO・口コミの記述は無い。Q-001）

## 現在地と次の一手

- 現在の工程: 仕様書ドラフト作成（Grill Me 未実施。依頼文・既存コード・公式ドキュメントの事前調査から起票）
- 止まっている理由・待っている人: §12 の確認質問 Q-001〜Q-003・Q-005〜Q-008 が未回答（Q-004 は一部回答）（ユーザー／クライアント）。とくに Q-001（クライアント合意）と Q-002（「Pro の受付データ」の実体）が答えられないと対象範囲が決まらない
- 次の一手:
  1. Q-001・Q-002 に回答をもらい本書へ書き戻す → `takt -w grill-to-gherkin` で §6・§7 を確定
  2. GBP API 申請の扱いを決める（Q-008）。2026-10-29 のあおぞら養鶏の申請は新規プロジェクト `aozora-gbp` で、利用目的も「自社プロフィール1件の管理」のため、このままでは GrowMate の機能に使えない（R-005）。買取ジャパンの申請も同じ確認が要る（Q-007）
- 未確認事項: §12 確認質問のとおり
- 関連ブランチ・PR: `develop`（仕様書のみ）
- 更新日・更新した工程: 2026-10-29 あおぞら養鶏の申請内容を Q-004 に書き戻し、R-005・Q-008 追加

## 0. 事前調査の結論（Grill Me の入力）

依頼文の前提を、公式ドキュメントと既存コードで突き合わせた結果。仕様の各節はこの表を前提にする。

| # | 依頼文の前提 | 事実 | 仕様への影響 |
| --- | --- | --- | --- |
| F-01 | 自社プロフィールで「全ての口コミ」が分かる | 正しい。My Business API v4 `accounts.locations.reviews`（list / batchGetReviews）で全件と返信を取得できる（要 `business.manage`） | 自社分析の対象にできる |
| F-02 | 「どんな検索語で表示されたか」が分かる | 正しいが粗い。Performance API `searchkeywords.impressions.monthly` は**月単位**・**ユニークユーザー数**で、少ない語は値ではなく `threshold`（「◯未満」）で返る。件数の少ない小規模事業者では大半が閾値表示になる可能性がある | 「検索語ランキング」は値と閾値を区別して表示する。精密な数値分析を約束しない |
| F-03 | 「電話やルート検索が何件あったか」が分かる | 一部正しい。`CALL_CLICKS`（電話ボタンのクリック数）・`BUSINESS_DIRECTION_REQUESTS`・`WEBSITE_CLICKS`・Maps/検索 × PC/モバイルの表示回数が**日次**で取れる。**通話が繋がった数・通話時間は取れない** | UI では「電話ボタンのタップ数」と表記し、「電話件数」と書かない |
| F-04 | 「問い合わせや成約につながったか」を Pro の受付データと組み合わせられる | **GrowMate に問い合わせ受付・成約を記録する機能もデータも無い**。あるのは GA4 キーイベント（`ga4_cv_count`、UI 表記「問い合わせ数」。`src/lib/constants.ts:425`）だけで、これは Web フォーム等のサイト内 CV であり、マップ経由の電話や成約は含まない | 依頼文の差別化の核がまだ存在しない。Q-002。MVP では「GBP の Web サイトクリック → GA4 の CV」までを接続範囲とする案を §11 ALT-002 に置く |
| F-05 | 競合分析は誰でもできる（公開データ） | Places API（New）で取れるが制約が強い。**レビューは1施設あたり最大5件・関連度順**（Place リソース `reviews` の定義）。順位は Text Search の返却順であり、実際のマップアプリの表示順（端末位置・個人化）とは一致しない | 「競合の口コミ分析」は5件しか見られない前提で設計する。「マップ順位」は出さない（§4 Non-goals） |
| F-06 | 競合データを溜めて推移を見る | **Google Maps Platform 規約で保存できない**。`3.2.3(a)(iii)`「business names, addresses, or user reviews をコピー・保存しない」、`3.2.3(b)` キャッシュ禁止。保存してよいのは `place_id`（無期限）と緯度経度（30日）のみ（Service Specific Terms §14.3、Places API Policies） | 競合診断は**毎回 API を叩いて画面に出すだけ**。競合の評価・件数の履歴は持たない |
| F-07 | 複数業者のデータを横断してメディアに還元する | **GBP API ポリシー上、高リスク**。「Content を Business Profile project 外での利用のために保存してはならない。限定量のみ、30日以内、操作・集計（aggregated）しない」（Business Profile APIs Policies「Content storage」、2026-08-28 更新）。横断集計してメディア記事に使うのは文言に正面から抵触し得る。利用規約・プライバシーポリシーでの同意取得も別途必要 | MVP の Non-goal。やるなら法務・規約確認を先に行う別仕様（§4） |
| F-08 | 自社データは契約後すぐ使える | GBP API は**利用申請と承認が必要**。承認前はクォータ 0 QPM（承認後 300 QPM）。申請者は「60日以上アクティブな確認済み GBP」と「GBP に載った Web サイト」が必要（Prerequisites）。加えて OAuth 同意画面に `business.manage` スコープを追加する（既存の GSC/GA4 用 OAuth クライアントの審査範囲が変わる可能性） | 実装より前にリードタイムのある外部依存。§10 D-001・D-002 |
| F-09 | — | GBP 内容を自社の UI で見せる際、Business Profile の UI の見た目を複製してはならない、帰属表示を消さない等のポリシーがある。Places 内容を Google 地図なしで出すときは Google ロゴの帰属表示、口コミは投稿者名・アバター・Google マップへのリンクを表示する | §6 画面設計の必須表示要件 |

## 1. 背景・目的・成功指標

### 背景・解決したい課題

- 現在、誰が、どの業務で困っているか:
  - GrowMate の対象顧客（生活の困りごと系の事業者。`client-vision-from-lark.md` §1.11.3）は、集客の入口として Googleマップ（Business Profile）の比重が大きいが、GrowMate は GSC / GA4 / Google Ads / Instagram / WordPress しか扱っておらず、マップ経由の集客を評価・提案できない。
  - 営業時に「契約前に価値を感じてもらう」材料が無い（依頼文。クライアント側の課題として確認が必要: Q-001）。
- 放置した場合の影響: 「作るではなく管理・提案」（§1.9.1）の対象からマップ集客が抜けたままになる。

### 目的

- この開発で実現する状態（MVP 案。Q-001〜Q-003 の回答で確定）:
  1. 管理者が、契約前の事業者について、エリアの競合と比べた弱点を画面で示せる（競合診断）。
  2. 契約済みの事業者が、自分の Business Profile の表示回数・検索語・電話/ルート/Web クリック・口コミを GrowMate 上で見られ、改善提案を受け取れる（自社分析）。
- 利用者・事業にとっての価値: マップ集客を「管理・提案」の対象に入れる。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 競合診断を使った商談の成約率 | 計測手段なし | 未確定（Q-003。誰が何件商談しているかが分からないと置けない） | 未確定 | 未確定 |
| GBP 連携済みの paid ユーザー数 | 0 | 未確定 | `gbp` 連携 credential の件数（SQL） | リリース後1か月 |

## 2. 利用者・関係者・利用シナリオ

| 区分 | 対象 | 期待すること・責任 |
| --- | --- | --- |
| 利用者（競合診断） | `admin`（営業する人。Q-003） | 商談前にエリア × 業種と見込み客を指定し、診断画面を見せる |
| 利用者（自社分析） | `admin` / `paid`。自分の GBP のオーナーまたは管理者 | Google アカウントで GBP を連携し、指標・口コミ・提案を見る |
| 管理者・承認者 | クライアント（カオルさん・繁田さん） | Q-001〜Q-003 の回答、診断項目の合意 |
| 外部サービス・連携先 | Google Business Profile APIs（Performance API / Account Management API / Business Information API / My Business API v4 reviews）、Google Maps Platform Places API（New）、Anthropic（提案生成） | — |

### 主な利用シナリオ

1. **管理者が**、**見込み客の業者と商談する前に**、**「◯◯市 ハウスクリーニング」で競合上位と見込み客を並べ、評価・口コミ件数・写真枚数・営業時間・Web サイト有無・カテゴリの差と、改善すべき点を画面で見せたい**。
2. **契約済みの事業者が**、**月初に**、**先月マップで何回表示され、どんな検索語で見つかり、電話ボタンが何回押され、未返信の口コミが何件あるかを確認し、次にやること（提案）を知りたい**。

## 3. 業務要件と業務フロー

### 現状（As-Is）

```text
[営業] 口頭・手作業で競合の Google マップを見せる（推定。Q-003）
[契約後] 事業者が Business Profile 管理画面（Google 側）で個別に確認。GrowMate では見られない
```

### 導入後（To-Be）

```text
[競合診断（admin）]
  エリア・業種のキーワードと見込み客（店名 or Google マップ URL）を入力
  → Places API Text Search で上位候補を取得 → 見込み客を特定（place_id）
  → 上位 N 件 + 見込み客の詳細を取得（毎回取得。保存は place_id のみ）
  → 比較表と弱点（LLM 生成 or ルールベース。ALT-003）を画面表示

[自社分析（admin / paid）]
  /setup で Google Business Profile を連携（business.manage）→ ロケーション選択
  → 画面を開いたときに Performance API・reviews API から取得（保存方針は ALT-001）
  → 指標の推移・検索語・口コミ（未返信の強調）・GA4 CV との並記（ALT-002）
  → 改善提案（LLM）
```

### 業務ルール

- BR-01: 競合診断で Places API から得た内容（名称・住所・評価・口コミ・写真）は DB に保存しない。保存してよいのは `place_id` のみ（F-06）。
- BR-02: 口コミを表示するときは投稿者名・アバター・Google マップへのリンクと、「Google の関連度順・最大5件」である旨を表示する（F-09）。
- BR-03: 自社分析は、GBP のオーナー／管理者権限を持つ Google アカウントで本人が OAuth 連携した場合だけ使える（GBP API ポリシー「End users … need to manually sign in」）。
- BR-04: 口コミへの返信・プロフィール編集を GrowMate から自動実行しない（MVP は読み取りのみ。§4 Non-goals）。

## 4. 対象範囲と Non-goals

> 判断軸: MVP 優先（`AGENTS.md` Core Rules）。以下の対象範囲は**案**であり、Q-001〜Q-003 の回答で確定する。

### 対象範囲（案）

- 画面・操作:
  - 競合診断画面（admin のみ）
  - `/setup` に Google Business Profile 連携を追加（既存 `/setup/gsc` 等と同じ並び）
  - 自社分析画面（admin / paid）
- API・外部連携: GBP APIs（読み取りのみ）、Places API（New）Text Search / Place Details、Anthropic（提案文）
- データ・DB: GBP 用 OAuth credential、選択したロケーション ID。競合は `place_id` のみ（保存するかも ALT-003 で判断）
- 権限・ロール: 競合診断 `admin`、自社分析 `admin` / `paid`
- 運用・監視: 既存の `console.error` ログのみ

### Non-goals（今回の対象外）

| 対象外 | 理由 | 将来検討する条件 |
| --- | --- | --- |
| 問い合わせ・成約の記録機能（受付台帳・CRM 連携・コールトラッキング） | GrowMate に存在せず（F-04）、記録方法（手入力 / 外部 CRM / 計測番号）の要件が無い。マップ機能より大きい別機能 | Q-002 の回答で「作る」となったら別仕様として起こす |
| 複数業者データの横断集計・メディアへの還元 | GBP API ポリシーの保存・集計制限に抵触し得る（F-07）。同意取得の設計も無い | 法務・規約確認（Google への問い合わせを含む）が済み、クライアントが必要と判断したとき |
| 競合の評価・口コミ件数の履歴（推移グラフ） | Maps Platform 規約で保存不可（F-06） | なし（規約が変わらない限り作らない） |
| マップ検索順位の計測（ローカル順位・グリッド順位） | Places API の返却順は実際の表示順ではなく（F-05）、規約 3.2.3(g) の検索結果の改変禁止にも配慮が必要 | 正規の取得手段が見つかったとき |
| 口コミへの返信・投稿・プロフィール編集の実行 | 依頼文は「分かること」（分析）のみ。自動実行は事前の明示同意と48時間以内の通知が必要（GBP API ポリシー） | PDCA 半自動実行（`docs/plans/content-pdca-semi-auto-execution-spec.md`）の対象に GBP を加えると決まったとき |
| 競合診断の PDF・画像書き出し | Places 内容を Services 外へ持ち出す行為（規約 3.2.3(a)）に当たり得る。画面共有で足りる | クライアントが書き出しを必須とし、規約上の可否を確認できたとき |
| trial / unavailable ロールへの提供 | `AGENTS.md` 既定 | — |

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `仮置き`（2026-10-26。対象範囲が案のため）
- 含めるもの: 実装・単体テスト・UI・Server Action・migration
- 含めないもの: GBP API 申請・OAuth 審査の待ち時間、クライアント確認

### 工数サマリー

| フェーズ | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| P1 競合診断（admin） | Places API 呼び出し、比較画面、弱点の提示 | 16〜32 | 2〜4 |
| P2 GBP 連携 | OAuth（`business.manage`）、ロケーション選択、setup 画面、needsReauth | 16〜24 | 2〜3 |
| P3 自社分析 | 指標・検索語・口コミ表示、GA4 CV 並記、LLM 提案 | 24〜48 | 3〜6 |
| **合計** |  | **56〜104** | **7〜13** |

幅の理由: 弱点提示をルールベースにするか LLM にするか（ALT-003）、GBP 内容をキャッシュするか（ALT-001）。

### カレンダー上の前提（工数外）

- GBP API 利用申請の承認: Google FAQ 上は14日以内のレビュー。フォーラムでは数週間〜返答なしの報告もある（D-001）
- P1 は GBP 承認を待たずに着手・リリースできる（Places API は申請不要）

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-001 | admin がエリア・業種キーワードで競合上位を検索し、見込み客を1件特定できる | Must（案） | 依頼文「使い分け1」 | キーワード入力で候補一覧が出て、見込み客を選べる |
| FR-002 | 見込み客と競合上位 N 件（N は Q-005）の比較表を表示する。項目: 評価、口コミ件数、写真枚数、営業時間の有無、Web サイトの有無、カテゴリ | Must（案） | 同上 | 比較表に Google ロゴ帰属表示がある。DB に Places 内容が残らない |
| FR-003 | 比較から見込み客の弱点を3点以内で提示する | Must（案） | 同上 | ALT-003 で方式確定 |
| FR-004 | admin / paid が `/setup` から GBP を連携し、管理するロケーションを1つ選べる | Must（案） | 依頼文「自社運用」 | 連携済み / 要再連携 / 未連携を区別して表示する（`google-integrations` skill §3） |
| FR-005 | 選択ロケーションの日次指標（表示回数 Maps/検索、電話ボタンタップ、ルート、Web クリック）を期間指定で表示する | Must（案） | 依頼文「電話やルート検索が何件」 | 「電話ボタンのタップ数」と表記する（F-03） |
| FR-006 | 月別の検索語を表示する。閾値のみの語は「◯未満」と表示する | Must（案） | 依頼文「どんな検索語で」 | value と threshold を混同しない |
| FR-007 | 口コミを一覧表示し、未返信件数と評価分布を出す | Must（案） | 依頼文「全ての口コミ」 | 返信は GBP 側で行う（リンクのみ） |
| FR-008 | GBP の Web サイトクリックと、同期間の GA4 CV（既存の `ga4_cv_count`）を並べて表示する | Should（案） | 依頼文「問い合わせにつながったか」の、現在のデータで取れる範囲 | GA4 未連携なら並記欄を出さず連携導線を出す。「成約」とは表記しない |
| FR-009 | FR-005〜FR-008 から改善提案（次にやること）を生成する | Should（案） | `client-vision-from-lark.md` §1.9.1（管理・提案） | 提案の根拠になった数値を併記する |

### 画面設計

Grill Me 後に記載する（UI 既存パターン対照表は `.agents/skills/growmate-ui-ux/SKILL.md` に従い実装前に作る）。現時点の想定:

| 画面 | パス | 新規/既存 | 概要・変更点 |
| --- | --- | --- | --- |
| 連携一覧 | `/setup` | 既存 | Google Business Profile の行を追加 |
| GBP 連携 | `/setup/google-business-profile`（命名は `project-naming` で確定） | 新規 | OAuth 開始・ロケーション選択 |
| 自社分析 | 未確定（既存 `/ga4-dashboard` と同列のダッシュボードか、`/home` への統合か。OPEN-001） | 新規 | FR-005〜FR-009 |
| 競合診断 | `/admin/...` 配下（未確定） | 新規 | FR-001〜FR-003 |

### 権限

| ロール | 閲覧 | 作成・実行 | 更新 | 削除・解除 |
| --- | --- | --- | --- | --- |
| admin | 競合診断・自社分析 | 競合診断の実行、GBP 連携 | ロケーション変更 | 連携解除 |
| paid | 自社分析 | GBP 連携 | ロケーション変更 | 連携解除 |
| trial / unavailable | 不可 | 不可 | 不可 | 不可 |

サーバー側: 競合診断の Server Action / Route Handler は admin を、自社分析系は admin / paid を検証する（既存 `src/server/lib/instagram-permissions.ts` と同じ形）。

## 7. Gherkin受け入れ条件

Grill Me 後に `02-gherkin.md` から反映する。

## 8. 非機能要件

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 競合診断は1回あたり Text Search 1回 + Place Details 最大 N+1 回 | 単体テストで呼び出し回数を固定 | 未確定（N は Q-005） |
| セキュリティ・プライバシー | GBP の refresh token は既存の OAuth credential と同じ暗号化方針（`docs/plans/oauth-credential-encryption-design.md`） | レビュー | 案 |
| 規約順守 | Places 内容を保存しない（BR-01）。GBP 内容の保存は ALT-001 の範囲に限る | DB スキーマレビュー | 案 |
| コスト | 競合診断1回 ≒ Text Search Enterprise $0.035 + Place Details Enterprise + Atmosphere $0.025 × (N+1)。N=10 で約 $0.31。各 SKU 月1,000回まで無料枠（2026-10-23 更新の公式価格表） | — | 案 |
| 可用性・障害対応 | GBP / Places API 失敗時は該当画面にエラーと再試行導線を出す。新規の停止機構は作らない | — | `AGENTS.md`（既存手段で足りる） |
| アクセシビリティ | 既存ダッシュボードに準じる | — | 案 |

### AI機能の追加観点（FR-003 を LLM にする場合・FR-009）

| 項目 | 要件・目標値 | 状態・根拠 |
| --- | --- | --- |
| 出力品質 | 数値根拠のない断定をしない。根拠の指標を併記 | 案 |
| 禁止事項 | Places の口コミ本文を LLM に渡すかは未確定（規約 3.2.3(c)(vii) は学習・評価への利用を禁じる。推論入力としての利用可否を確認: Q-006） | Q-006 |
| モデル障害時 | 提案欄だけエラー表示し、指標表示は出す | 案 |

## 9. データ・外部連携

### データ

- 作成・更新・削除するデータ（案）: GBP 用 OAuth credential、選択ロケーション（account / location ID）。競合診断は保存なし、または `place_id` のみ
- 保持期間・削除条件: 連携解除・ユーザー削除で削除（既存 `delete_user_fully` に含める）
- RLS: 既存の credential テーブルと同じ（本人のみ）

### 外部連携

| 連携先 | 用途 | API・権限 | 失敗時の挙動 | 公式根拠 |
| --- | --- | --- | --- | --- |
| Business Profile Performance API | 日次指標・月別検索語 | `business.manage`。`locations.fetchMultiDailyMetricsTimeSeries`、`locations.searchkeywords.impressions.monthly.list` | 再連携導線 / エラー表示 | [DailyMetric](https://developers.google.com/my-business/reference/performance/rest/v1/DailyMetric)、[searchkeywords](https://developers.google.com/my-business/reference/performance/rest/v1/locations.searchkeywords.impressions.monthly/list) |
| Account Management / Business Information API | アカウント・ロケーション一覧 | `business.manage` | 同上 | 未照合（Grill 後） |
| My Business API v4 reviews | 口コミ全件 | `business.manage` | 同上 | [Work with review data](https://developers.google.com/my-business/content/review-data) |
| Places API（New） | 競合診断 | API キー（サーバー側のみ） | エラー表示 | [Place リソース](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places)、[Places API Policies](https://developers.google.com/maps/documentation/places/web-service/policies)、[Maps Platform 規約 3.2.3](https://cloud.google.com/maps-platform/terms)、[Service Specific Terms §14](https://cloud.google.com/maps-platform/terms/maps-service-terms)、[価格表](https://developers.google.com/maps/billing-and-pricing/pricing) |

## 10. 制約・前提・依存関係

### 技術前提

- 再利用する既存実装: `src/server/services/googleTokenService.ts`（token 有効性確認・refresh）、`/setup/*` の連携パターン、`src/server/lib/*-permissions.ts` のロール判定、GA4 の `ga4_cv_count`
- OAuth: 既存の GSC/GA4 credential にスコープを足すか、Google Ads のように別 credential にするかは ALT-004

### 制約条件

- 法令・契約・審査: GBP API 利用申請、OAuth 同意画面のスコープ追加、プライバシーポリシー（`app/privacy/page.tsx`）へのスコープ追記

### 依存関係

| ID | 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
| --- | --- | --- | --- | --- |
| D-001 | GBP API 利用申請（Application for Basic API Access） | 申請者が「60日以上アクティブな確認済み GBP」のオーナー/管理者で、GBP に Web サイトが載っている。申請メールアドレスが GBP のオーナー/管理者 | Cloud Console のクォータが 300 QPM | P2・P3 を実データで検証できない |
| D-002 | OAuth 同意画面への `business.manage` 追加と審査 | D-001 と同じ GCP プロジェクト | 外部ユーザーで同意できる | paid ユーザーが連携できない |
| D-003 | Places API の有効化と API キー | 課金アカウント | 呼び出し成功 | P1 不可 |

## 11. トレードオフ判断

### ALT-001: GBP 内容を保存するか

- 比較した案:
  - 案A: 保存しない。画面を開くたびに API から取得（Performance API は期間指定で過去分を取れる）
  - 案B: 30日以内の一時キャッシュのみ（ポリシーの「限定量・30日・集計しない」に収める）
  - 案C: 日次で取り込んで永続保存（既存 GSC/GA4 と同じ）
- 暫定推奨: 案A。ポリシー（F-07）に最も安全で、実装も最小。表示が遅い・クォータが足りないと分かったら案B
- 却下: 案C はポリシー「Content storage」の文言に抵触し得る。既存の他社ツールが永続保存しているかは確認できておらず、根拠にしない
- 判断者・判断日: 未定（Grill Me）

### ALT-002: 「問い合わせにつながったか」をどこまで作るか

- 案A: GBP の Web サイトクリックと GA4 CV の並記まで（FR-008）。新規データ入力なし
- 案B: 問い合わせ・成約を手入力する台帳を新規に作る
- 案C: 外部 CRM / コールトラッキング連携
- 暫定推奨: MVP は案A。案B・C は Q-002 の回答次第で別仕様
- 懸念: 案A では電話経由（小規模事業者の主経路の可能性が高い）の問い合わせは一切追えない。依頼文の「成約まで」には届かない

### ALT-003: 競合診断の弱点提示の方式

- 案A: ルールベース（評価が競合中央値より低い、口コミ件数が少ない、写真が少ない、営業時間・Web サイト未設定 等）
- 案B: LLM に比較表を渡して文章化
- 暫定推奨: 案A。項目が少なく判定が明快で、規約上の懸念（Q-006）も避けられる。文章の説得力が足りないと分かったら、比較表の数値だけを LLM に渡す案Bへ

### ALT-004: OAuth credential を既存と共有するか

- 案A: 既存 GSC/GA4 credential にスコープを追加（GA4 と同じ方式）
- 案B: Google Ads と同じく別 credential
- 暫定推奨: 未定。GBP を管理する Google アカウントが GSC/GA4 と同じとは限らない（代理店・社員のアカウントで管理している事業者が多い想定）ため案Bが安全側。Grill Me で確認

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 発生条件・影響 | 対策 | 担当 | 状態 |
| --- | --- | --- | --- | --- | --- |
| R-001 | GBP API の承認が下りない・遅れる | 申請要件を満たす GBP が手元に無い、Web サイト不一致で却下（フォーラム報告あり） | 仕様確定前に申請（Q-004）。P1 を先に出す | 開発 | 未着手 |
| R-002 | 検索語データの大半が閾値表示 | 表示回数の少ない小規模事業者 | FR-006 で「◯未満」を正しく表示。提案の根拠にしない | 開発 | 案 |
| R-003 | 規約解釈の誤り | ALT-001・F-07・Q-006 の解釈が Google の運用と違う | 保存しない側で設計。疑義は Google に問い合わせる | 開発 | 案 |
| R-004 | 対象顧客が GBP を持っていない・オーナー権限が無い | 業者が GBP 未作成、制作会社が権限を握っている | 連携画面で「オーナーか管理者の Google アカウントで連携」と案内 | 開発 | 案 |
| R-005 | 申請した利用目的と実際の用途が違う | あおぞら養鶏の申請は「自社プロフィール1件の管理」だが、GrowMate では複数の事業者が各自の GBP を連携する SaaS として使う。申請と違う使い方は審査・監査で問題になり、アクセス停止の根拠になり得る（GBP API ポリシーは虚偽・隠蔽を違反としている） | Q-008 で、GrowMate の用途（SaaS・複数事業者・各自が OAuth で本人連携）を正しく書いて申請し直すか訂正する | ユーザー | 未対応 |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態 | 回答 | 回答日 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q-001 | この機能（とくに「使い分け1〜3」の戦略）はクライアント（カオルさん）と合意済みか。現在の優先順位（コンテンツ立案・PDCA 半自動実行）より前に来るか | `client-vision-from-lark.md` に記述が無く、要件のトレース元が依頼文だけ。クライアントは「事前許可なく仕様を決めない」ことを強く求めている（§1.6） | ユーザー（→ クライアント） | 未定 | 未回答 |  |  |
| Q-002 | 「Pro の受付データ」とは何を指すか。GrowMate Pro 内には問い合わせ受付・成約の記録が無い（F-04）。別システム（受付フォーム・CRM・スプレッドシート・LINE 等）が既にあるのか、これから作る前提か | 依頼文の差別化の核。存在しないなら MVP の価値の説明が変わる（ALT-002） | ユーザー | 未定 | 未回答 |  |  |
| Q-003 | 競合診断を使うのは誰か（カオルさん本人 / サポート講師 / 営業担当）。月に何件の商談で使う想定か。見込み客は GrowMate のユーザーではない前提でよいか | ロール（admin で足りるか）、成功指標、無料枠の見込み | ユーザー（→ クライアント） | 未定 | 未回答 |  |  |
| Q-004 | GBP API の利用申請を仕様確定前に出してよいか。申請要件（60日以上アクティブな確認済み GBP のオーナー/管理者で、Web サイト掲載あり）を満たすアカウントは誰のものを使うか | 承認待ちがクリティカルパス（D-001） | ユーザー | 未定 | 一部回答（Q-007 待ち） | あおぞら養鶏・買取ジャパンとも申請要件（60日以上）を満たす。買取ジャパンで申請中。2026-10-29 にあおぞら養鶏でも申請（GCP プロジェクト `aozora-gbp`・番号 936972101339・新規作成・請求先は GrowMate、Web サイト https://aozora-farm.jp/、利用目的「自社プロフィール1件の管理。クチコミの取得・返信、投稿の自動化、インサイト集計、営業時間などの更新」）。承認は GCP プロジェクト単位のため、GrowMate の機能に使えるかは Q-007・Q-008 で決まる | 2026-10-27, 2026-10-29 |
| Q-005 | 競合診断で比較する競合の件数 N（例: 上位5件 / 10件）と、比較項目は FR-002 で足りるか | コスト・画面設計 | ユーザー（→ クライアント） | 未定 | 未回答 |  |  |
| Q-006 | 競合の口コミ本文（最大5件）を LLM の入力に使ってよいと判断するか（規約 3.2.3(c)(vii) は学習・テスト・評価・ファインチューニングへの利用を禁止。推論入力は明記なし） | ALT-003・FR-009 の方式 | ユーザー | 未定 | 未回答 |  |  |
| Q-007 | 買取ジャパンの GBP API 申請フォームに書いた GCP プロジェクト番号は、GrowMate の Google OAuth クライアント（GSC/GA4 連携で使っているもの）と同じプロジェクトか | API アクセスは GCP プロジェクト単位で付与される（GBP API FAQ）。別プロジェクトなら承認されても GrowMate からは呼べない | ユーザー | 未定 | 未回答 |  |  |
| Q-008 | GrowMate で使う GBP API の GCP プロジェクトをどれにするか。案A: GrowMate 本番の OAuth クライアントがあるプロジェクトで、SaaS の用途を書いて申請し直す / 案B: `aozora-gbp` に GBP 連携専用の OAuth クライアントを作り（ALT-004 案B）、利用目的を SaaS に訂正する | 2026-10-29 の申請は新規プロジェクト `aozora-gbp` で、GrowMate の OAuth クライアントとは別（R-005）。案B は同意画面のブランド・ドメイン確認・審査を `aozora-gbp` 側で一からやり直すことになる | ユーザー | 未定 | 未回答 |  |  |

### 未決定事項（今は決めない）

| ID | 未決定事項 | 今決めない理由 | 決めるタイミング | 決める人 |
| --- | --- | --- | --- | --- |
| OPEN-001 | 自社分析画面の置き場所（独立ダッシュボード / `/home` 統合） | 対象範囲（Q-001）が決まってから UI 既存パターン対照表で決める | Grill Me 後・UI たたき台作成時 | 開発（たたき台をクライアントへ） |
| OPEN-002 | 複数ロケーションを持つ事業者の扱い | 対象顧客の大半は1拠点の想定。複数事業者登録（§1.5）と合わせて決める | 複数事業者登録の仕様化時 | クライアント |

## 13. テスト・リリース・ロールバック

- テスト: Places / GBP API はモックで単体テスト。Places 内容が DB に書かれないことをテストで固定（BR-01）。権限は admin / paid / trial / unavailable の4ロールでサーバー側を検証
- リリース: P1（競合診断・admin のみ）を先行。P2・P3 は D-001・D-002 完了後
- ロールバック: デプロイ巻き戻し。新規の停止機構は作らない

## 14. 実装手順・チェックポイント

1. Q-001〜Q-006 回答 → 本書へ書き戻し
2. `takt -w grill-to-gherkin`（ローカル。対話必須）
3. `takt -w spec-review`
4. P1 → P2 → P3 の順に `takt -w spec-to-pr`

| チェックポイント | 確認内容 | 確認者 | 状態 |
| --- | --- | --- | --- |
| UI たたき台 | 競合診断・自社分析の画面をクライアントと合意（§1.8 の運用） | クライアント | 未確認 |

## 15. 完了条件

Grill Me 後に記載する。

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 回 | 日付 | 指摘件数（🔴 / 🟡 / 🟢） | 反映状況 | 残置合意した論点と理由 |
| --- | --- | --- | --- | --- |
| — | — | — | 未実施 | — |

#### 公式ドキュメント照合

- 実施（起票時の事前調査。spec-review で再照合する）
- 参照 URL と確認日（2026-10-26）:
  - Business Profile APIs Policies（2026-08-28 更新）: https://developers.google.com/my-business/content/policies
  - Prerequisites: https://developers.google.com/my-business/content/prereqs
  - FAQ（レビュー期間・アクセス単位）: https://developers.google.com/my-business/content/faq
  - Performance API DailyMetric: https://developers.google.com/my-business/reference/performance/rest/v1/DailyMetric
  - Performance API searchkeywords: https://developers.google.com/my-business/reference/performance/rest/v1/locations.searchkeywords.impressions.monthly/list
  - Review data: https://developers.google.com/my-business/content/review-data
  - Places API Place リソース: https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places
  - Places API Policies: https://developers.google.com/maps/documentation/places/web-service/policies
  - Google Maps Platform Terms of Service 3.2.3: https://cloud.google.com/maps-platform/terms
  - Service Specific Terms §14 Places API: https://cloud.google.com/maps-platform/terms/maps-service-terms
  - 価格表（2026-10-23 更新）: https://developers.google.com/maps/billing-and-pricing/pricing

### 変更履歴

| 日付 | 変更内容 | 変更者 |
| --- | --- | --- |
| 2026-10-26 | 起票（依頼文・既存コード・公式ドキュメントの事前調査から。Grill Me 未実施） | 開発（Claude Code） |
| 2026-10-27 | Q-004 に一部回答（買取ジャパン申請中・あおぞら養鶏未申請）を書き戻し、Q-007（申請の GCP プロジェクト）を追加 | 開発（Claude Code） |
| 2026-10-29 | あおぞら養鶏の申請内容（`aozora-gbp`・利用目的「自社1件」）を Q-004 に書き戻し、R-005（利用目的の不一致）と Q-008（使う GCP プロジェクト）を追加 | 開発（Claude Code） |
