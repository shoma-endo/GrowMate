# GA4コンテンツ評価機能 仕様書

## 1. 文書情報

| 項目 | 内容 |
|---|---|
| ステータス | **クライアント評価エンジン仕様（2026-08-17 受領）を反映済み・D1'（見積再合意）待ち**。フェーズ0・フェーズ1は実装完了（PR #496、2026-08-16）。評価エンジンの正本は `docs/context/ga4-evaluation-engine-spec-20260817.md`（受領原文 verbatim）で、**点数・診断はコードで決定的に算出し、LLM は文章化のみ**を担う（§6.2 / §6.4）。待っていたプロンプト出力契約は同仕様で確定（5フィールドJSON。§6.3.4）。旧ゲートの Q1（4分類）・Q-A（pagePath軸PV）は同仕様により失効（§18）。**D1'（再見積 231〜354h）は 2026-08-17 に合意済み**（Q-G＝activeUsers 互換も同日実測で決着）。同日、受領原文とのレビュー（網羅性・忠実性）を経て**「原文正本の原則」を決定**（§18）: 完読率15%未満の `R_TOP_EXIT` 上書き確定・用語言い換えの UI 全体適用等を原文どおりに戻し、見積は **235〜360h**（+4〜6h。D1' 合意値からの増分はクライアントへ共有する）。**フェーズ2は `spec-to-pr` 実行可**。実装中に消化する残件は Q-H / Q-I のみ（§4.1.2 後方互換は 2026-08-18 に「過去90日再取込＋全記事再同期」で決定済み。§15.2） |
| 作成日 | 2026-08-12 |
| 対象 | GA4評価機能の初期実装 |
| 承認者 | **承認済み（ユーザー、2026-08-16）**。本文（2026-08-15 の新ルート移設方針・認可再設計・RLS自己参照のみを含む）を承認。個別合意の記録: Q6 合意済み（2026-08-13）、Q-E / Q-F / D5 決着済み（2026-08-15）、Q1〜Q4 / Q7 / Q8 / Q-A / Q-B / Q-C / D3 決着済み（2026-08-16）。**D1（見積合意）は本承認とは別に確定待ち**（§15.3） |
| 最終更新 | 2026-08-17 |
| 作成者 | GrowMate 開発チーム |
| 対象リリース | 未定（D1 合意後に確定） |
| 関連 Issue / PR | 未起票 |
| 重要な前提 | 評価エンジン（計算式・アンカー・診断マトリクス・プロンプト・UI原則）の正本はクライアント提供の `docs/context/ga4-evaluation-engine-spec-20260817.md`。本書はそれを既存コード・DB・Google公式仕様と突き合わせて実装契約に落とす |

この文書は、会議内容・既存コード・Google公式仕様をもとにした実装前の仕様書である（2026-08-16 承認、2026-08-17 にクライアント評価エンジン仕様を反映）。**`spec-to-pr` の実行ゲート（§17）: フェーズ0・フェーズ1は実装完了（PR #496）。フェーズ2の実装着手に残るのは D1'（評価エンジン反映後の再見積のクライアント合意。§15.3）のみ。プロンプト出力契約は受領済みで確定（§6.3.4）、activeUsers 互換（Q-G）は実測で決着済み（§15.2）。**

## 2. 背景と目的

### 2.1 背景

GrowMateには、GA4とGSCのデータを使ってコンテンツの改善余地を評価する機能が必要である。既存のGA4取込では、ページ単位の日次データとイベントデータを一部取得できているが、評価結果を保存・履歴化し、改善提案として表示する機能は未完成である。

### 2.2 目的

記事ごとに、読了率・読み始め率を100点満点に正規化した**コンテンツ力スコア**と**診断コード**をコードで決定的に算出し、その判定結果を LLM が利用者向けの言葉（診断文と「次の一手」）に変換して提示する。

二層構造が価値の中核である（評価エンジン仕様 §01。2026-08-17 受領）: **判定はコード**（毎回同じ結果・監査可能・コストゼロ）、**文章化だけが LLM** の仕事。LLM に数値判定をさせると同じデータで前回と違う診断が出て PDCA ツールとして致命的なため、閾値判定は必ずコード側に置く。評価はすべて100点満点に統一し、アルファベットのランクは使わない。

### 2.3 成功条件

- 記事ごとに、評価状態・コンテンツ力スコア（読み始めスコア・読了スコアの内訳付き）・診断コード・サイト内順位・前回差分・LLM の診断文（headline / situation / cause / next_action / target）を確認できる。
- **同一の取込データと同一のスコアリング設定に対して、スコア・診断コードが毎回同一である**（決定性。LLM を経由しない）。
- GA4の数値が欠損している場合、0点や0件として誤評価しない。セッション30未満の記事は評価を出さず「データ蓄積中」と表示する。
- 評価に使用した期間・データ取得日時・プロンプトバージョン・スコアリング設定バージョンを追跡できる。
- GA4 APIの取得制約や再認証状態を、評価失敗と混同せず表示・記録できる。
- 未評価のコンテンツを一覧から発見できる（未評価フィルタによる絞り込み。並び替えは実装しない。Q-B 回答 2026-08-16）。`docs/context/client-vision-from-lark.md` §1.9.5 の第1優先要求に対応する。
- メディア全体の資産価値スコア・実効スコアと散布図で、サイト全体の改善が月次で追える（評価エンジン仕様 §06）。

### 2.4 成功指標（KPI）

`docs/templates/requirement-definition.md` §1 成功指標表に相当。点数の意味と算出はコード側で確定済み（評価エンジン仕様 §03〜§05）のため、KPI は「スコア算出の決定性」と「文章化の成功率」に分けて置く。

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
|---|---|---|---|---|
| スコア算出の決定性 | 機能なし | 同一入力・同一スコアリング設定での再算出の一致率 100%（LLM 非経由） | 単体テスト（純関数） | CI |
| 文章化の保存成功率 | 機能なし（0%） | 文章化リクエストのうち、5フィールドのスキーマ適合結果が保存される割合 ≥ 95%。**失敗時もスコア・診断コードは保存される（部分成功。§6.5）** | DB 集計 + E2E | ステージング実データ検証 |
| 欠損値の誤評価 | 未計測 | 0 件（欠損を 0 として LLM 投入しない） | AC-03 + 単体テスト | CI |
| 評価停止の即時性 | 未計測 | DB Kill Switch 変更後、次リクエストから評価 API が停止 | AC-06 + 手動検証 | リリース前 |
| 二重実行 | 未計測 | 同一 `(user_id, content_annotation_id)` の同時評価 0 件 | AC-07 + DB 制約テスト | CI |

### 2.5 利用者・関係者

| 区分 | 対象 | 期待すること・責任 |
|---|---|---|
| 利用者 | GrowMate `paid` / `admin` ユーザー | `/analytics` で対象記事を探し、記事詳細で評価実行・結果確認・再実行 |
| 評価エンジン仕様の提供者 | クライアント（繁田さん系統） | 計算式・アンカー値・診断マトリクス・システムプロンプト・出力 JSON 契約・UI原則の提供（`docs/context/ga4-evaluation-engine-spec-20260817.md` で受領済み）。残る確認は §15 の残存事項のみ |
| 開発・運用 | GrowMate 開発チーム | 実装、Kill Switch 運用、実データ検証 |
| 外部連携 | Google（GA4 Data API / GSC Search Analytics API） | 指標データの提供（読み取り専用 scope） |

### 2.6 業務フロー（As-Is / To-Be）

#### As-Is（現状）

```text
/analytics 一覧
  -> GA4/GSC 数値を目視確認
  -> 改善判断・優先順位付けは属人化
  -> 評価結果の履歴化・提案の体系的管理なし
```

#### To-Be（導入後）

```text
/analytics 一覧（get_filtered_content_annotations）
  -> 未評価フィルタ / 評価状態・スコア確認
  -> 記事詳細 /analytics/[annotationId] の評価UIへ遷移
  -> [コード] 取込済みGA4データ＋本文文字数から 読了率・読み始め率を算出
  -> [コード] アンカー線形補間 -> 読了スコア・読み始めスコア -> 幾何平均でコンテンツ力スコア
  -> [コード] マトリクスで診断コード確定（sessions<30 は「データ蓄積中」で打ち止め）
  -> スコア・診断を DB 保存（最新 + 履歴。前回差分・サイト内順位もここで確定）
  -> [LLM] 判定済みデータのみを渡し、診断文（headline/situation/cause/next_action/target）を生成・保存
  -> 記事詳細で結果確認・再実行 -> 改善アクション
/ga4-dashboard
  -> メディア全体の資産価値スコア・実効スコア・散布図（全記事の月次推移）
```

定期一括評価（Cron）はMVP対象外とし、手動の単記事評価のみを提供する（§3.2）。

### 2.7 業務ルール

`docs/templates/requirement-definition.md` §3「業務ルール」に相当する。本節は**新しい意思決定を導入しない**。本文各所に既出の不変条件へ ID を与え、受入条件・テストとの対応を追えるようにしたものである（本文が正本であり、齟齬がある場合は各ルールの「本文の定義箇所」を優先する）。

| ID | ルール | 例外 | 本文の定義箇所 | 対応する AC / テスト |
|---|---|---|---|---|
| BR-01 | terminal 状態になった評価履歴は不変とし、直接 UPDATE を許可しない。状態変更は専用 RPC 経由にする | なし。stale 実行を `evaluation_failed` + `evaluation_stale` として確定する操作は、terminal に到達させる操作であり本ルールに反しない | §7.1 / §7.4 / §3.3 削除行 | AC-07（stale）／§13 DBテスト |
| BR-02 | 欠損値を `0` に変換して評価を続行しない。欠損は欠損として明示する | **一覧の表示値としては** 0 フォールバックを維持する（`fetchGa4Summaries` は `analyticsContentService.ts:344-345` で `sessions = 0` のとき直帰率を `0` として返す。フェーズ0の特性テストで現状のまま固定する。§3.4）。**評価入力へ流用する際は 0 フォールバックを適用せず、欠損（例: `engagement_rate` 未取込期間、`active_users` 未取込期間）は欠損として扱う**（§5.1 / §5.4 / §6.3.2） | §6.5 / §5.1 | AC-03／§13 単体テスト（未取込期間の指標が評価入力で欠損になる） |
| BR-03 | 新しい評価に失敗しても、既存の正常な評価結果と履歴を上書きしない | なし | §6.5 / §11 AI観点 | AC-04 / AC-09／§13 サービステスト |
| BR-04 | 同一 `(user_id, content_annotation_id)` で実行中の評価は同時に1件までとする | `lease_expires_at`（開始から15分TTL）を過ぎた実行は stale とみなし、旧 run を失敗として確定したうえで新しい `evaluation_run_id` を発行する | §8.1 / §7.4 | AC-07／§13 DBテスト（同時実行・stale回復） |
| BR-05 | Kill Switch が明示的に有効（`enabled IS TRUE`）でない限り、評価 API を実行しない。行なし・DB読取失敗も停止として扱う | 実行中の run は強制キャンセルせず、完了結果の保存だけを許可する（§8.1） | §8.2 | AC-06／§13 DBテスト（デフォルトfalse・権限） |
| BR-06 | Service Role 経路のクエリで `.eq('user_id', userId)` と対象記事IDの明示指定を省略しない | なし（RLS は当該経路で評価されないため代替にならない） | §7.2 / §7.5 | §13 DBテスト（ユーザー間の参照遮断）／R-04 |
| BR-07 | `/analytics` 配下の記事詳細・評価機能に対するサーバー側入口（ページのデータ取得・Server Action・Route Handler）で認可を必ず検証する。**読み取り入口は `canAccessGa4`、書き込み入口は `canWriteGa4`** を使う（対象関数の一覧は §3.3「認可関数の使い分け」）。proxy のパス判定のみを認可の根拠にしない。未認可時の応答は §3.3「未認可時の応答契約」に従う | なし | §3.3 | AC-12／§13 認可テスト |
| BR-08 | 評価期間の合計 `sessions` が **30 未満**の記事は、スコア・診断を算出せず「データ蓄積中」（`R_LOWDATA`）と表示する（少数セッションによる優良記事の誤判定を防ぐ。評価エンジン仕様 §02）。**BR-02（欠損≠0）とは別ルール**: BR-02 は「データが無い」、BR-08 は「データはあるが統計的に足りない」。混同しない | なし | §6.2 / §6.5 | AC-03（データ蓄積中シナリオ）／§13 単体テスト（境界値 29/30） |
| BR-09 | スコア・診断コードは LLM の出力から取り込まない。LLM 出力はプロンプトで確定済みの点数・判定を**覆せない**（文章5フィールドのみを保存する） | なし | §6.2 / §6.3.4 | AC-01／§13 スキーマ検証テスト |

## 3. 対象範囲

### 3.1 MVPで対象とするもの

- フェーズ0（事前リファクタリング）完了後の手動評価MVP。フェーズ0は利用者向け挙動を変更しない。
- GA4日次ページ指標の評価用取得。
- GSCページ指標の評価用取得・GA4との組み合わせ。
- 記事単位の評価実行（スコア・診断のコード算出 → 保存 → LLM 文章化）、結果保存、履歴保存。
- 評価状態（未評価、評価可能、評価済み、データ蓄積中、データ不足、取得失敗、再認証必要、文章生成失敗）の表示。
- 読了スコア・読み始めスコア・コンテンツ力スコア（幾何平均）・診断コード（6値）・完読率併用診断・サイト内順位・前回差分・LLM 診断文（5フィールド）の表示。
- フェーズ1: 記事詳細画面（既存3タブ）の `/gsc-dashboard?annotationId=...` から `/analytics/[annotationId]` への**挙動保存移設**、旧URLからの恒久 redirect、サーバー側認可の多層化（§5.5）。
- フェーズ2: 移設後の記事詳細 `/analytics/[annotationId]` に評価UI（記事カード: 人数ファネル・点数バー・NEXT ACTION）を実装し、評価の実行・結果・履歴を表示する。配置はたたき台の統合レイアウトに従う（§10.1 / §10.3 表記の注記）。
- GA4取込拡張: 既存の `landingPage` 軸クエリへ **`engagementRate`（読み始め率）と `activeUsers`（読了率の分母。互換可否は着手前実測）** を追加する（§4.1.1）。旧方針の `pagePath` 軸追加取得（Q-A 由来）は評価エンジン仕様（2026-08-17）で失効。
- 期待読了時間の材料整備: 本文文字数（`wp_content_text` の正規化後文字数）と**画像点数**（WordPress 同期時に `content.rendered` から img タグ数を算出して保存）（§4.1.1）。
- メディア全体スコア（資産価値スコア・実効スコア）と散布図の `/ga4-dashboard` への追加（評価エンジン仕様 §06。§10.6）。
- UI 用語の言い換え（GA4 用語をツール内で使わない。評価エンジン仕様 §08 の対応表を `ui-text.md` へ転記）。
- 記事詳細の情報階層の再設計（2026-08-13 合意たたき台の統合レイアウト化）。**Q-C 回答（2026-08-16「まとめで全てやる」）によりフェーズ2に含める**（§10.1 / §10.5）。
- 文章化システムプロンプト（評価エンジン仕様 §07 verbatim）をDBのプロンプトテンプレートから読み込み、`system`ロールでLLMへ渡す処理。
- 評価結果の再実行（文章化のみの再試行を含む）。

### 3.2 MVPで対象外とするもの

- GA4取込時に全記事を自動評価する処理。2026-08-05 定例で「後回し」に合意済み（`docs/context/client-vision-from-lark.md` §1.9.5）。「実装難易度が最も高いと開発側が判断。評価が走っていないものをソートできれば手動運用で代替可能」という整理による。未評価コンテンツの発見は未評価フィルタで対応する（§10.2）。
- **一覧の並び替え（評価状態・点数・最終評価日時）。** Q-B 回答（2026-08-16）「未評価コンテンツはフィルタだけで足りる」により実装しない。§1.9.5 の「ソート」は未評価コンテンツの発見が目的であり、未評価フィルタ（新設。GSC未評価フィルタと同型）で満たす。
- **点数閾値による一覧化・フィルタUI（「70点以下の一覧化」）。** Q2 回答（2026-08-16）「なくていい」により実装しない（§6.4）。
- LLMによる記事本文の自動編集・公開。
- 改善提案の自動メール送信（**確定 Non-goal。Q4 回答 2026-08-16**）。
- ヒートマップの導入・独自イベント設計。データが既存の入力に含まれる場合だけ、将来拡張できる入力項目として扱う。
- **LLM による点数・診断の算出。** 点数・診断コードはコードで決定的に算出する（評価エンジン仕様 §01。2026-08-17 反転: 旧 Non-goal「固定ルールによる評価点数・パターン・提案文の算出」は、判定のコード化こそ要件となったため削除。LLM の役割は文章化のみで、文章の画一化禁止は BR-09・AC-02 で担保する）。
- `/ga4-dashboard` の**記事単位**評価UI化。同画面へはメディア全体スコア・散布図のみを追加し（§10.6。2026-08-17 に対象へ変更）、記事単位の評価・履歴・診断文は記事詳細に置く。
- 定期Cron・非同期ジョブによる一括評価。claim RPC、ジョブキュー、バッチ時間予算はMVPに含めない。MVPは手動の単記事評価のみとする。
- 一覧への戻り先クエリ（期間・フィルタ・ページ等）の引き継ぎ。現行導線は `AnalyticsTable.tsx` の詳細ボタンが `window.open(..., '_blank', 'noopener,noreferrer')` で別タブを開き、クエリを引き継いでいない（2026-08-15 実測）。一覧へ戻る導線もクエリなしの固定 `/analytics` リンクのみのため、挙動保存の対象に含めない。
- レスポンシブ・アクセシビリティの新規要件定義。**情報階層の再設計（統合レイアウト化）は 2026-08-16 の Q-C 回答によりスコープへ移動した（§3.1）。**フェーズ1の移設自体は引き続き挙動保存とし（AC-14）、統合レイアウトはフェーズ2で実装する。
- 費用・売上データの新規連携（Q3 回答 2026-08-16 のとおりデータ入力は追加しない）。なお 2026-08-17 受領の確定プロンプト（§6.3.1）に ROI の評価観点は含まれておらず、「プロンプト側で吸収」の実体は現時点では無い。クライアントが将来プロンプトを改版する場合も、出力契約（§6.3.4 の5フィールド）の範囲内で行う。
- 存在しない `annotationId` の 404 化（`notFound()` の導入）。現行の null detail 描画を踏襲する（§5.5 / §15.4）。

### 3.3 認可とアクセス制御

既存実装 `canAccessGa4`（`src/server/lib/ga4-permissions.ts:7` の `['admin','paid']`。2026-08-15 再確認）を正とする。許可ロールは `admin` と `paid` のみ。

**認可ポリシー（2026-08-15 に `CLAUDE.md:8-9`・コミット `5d80411e "Enforce paid access for new features"` で明文化。verbatim）:**

> 新規機能は原則として `admin` または `paid` ロールだけに提供する。`trial` と `unavailable` は対象外とし、例外は対象仕様書で明示する。
> 新規機能の認可はUIだけでなく、Server Action・Route Handler・APIなどのサーバー側でも検証する。

本機能は例外を設けない。多層防御の参照実装は Instagram 連携（`src/server/lib/instagram-permissions.ts` の `canAccessInstagram`。proxy・ページ・Server Action・Route Handler の各層で検証し、`tests/unit/server/lib/instagram-permissions.test.ts` で固定）とする。`canAccessGa4` には現状ユニットテストが存在しないため（2026-08-15 実測）、フェーズ1で追加する。

**経路ごとのガードの実測（2026-08-15）:**

- `/analytics` は `proxy.ts:11` の `PAID_FEATURE_REQUIRED_PATHS = ['/analytics']` に含まれ、`proxy.ts:177-179` の `requiresPaidFeatureAccess` 判定で `/unauthorized` へリダイレクトされる。判定は `proxy.ts:215-217` の `pathname.startsWith(path)`（プレフィックスマッチ）であるため、**`/analytics/[annotationId]` は `proxy.ts` を変更せず自動的に保護対象になる**。
- 現行の `/gsc-dashboard` は `PAID_FEATURE_REQUIRED_PATHS` に含まれず、`app/gsc-dashboard/page.tsx`（フェーズ1で廃止）にロール判定はなく、`src/server/actions/gscDashboard.actions.ts` は `getAuthUserId` で `role` を取得するものの `canAccessGa4` を呼んでいない（同ファイルに 0 ヒット。2026-08-15 再確認）。つまり現状は `trial` 等のロールでも直URLで記事詳細に到達できる。
- proxy の matcher は `api/` 配下を除外しているため、`app/api/gsc/dashboard/*` は proxy で保護されない（`authMiddleware` による認証のみで、ロール判定はない）。

**フェーズ1で行う変更:** 記事詳細を `/analytics/[annotationId]` へ移設することで、画面は proxy の自動保護下に入る（`proxy.ts` 自体は変更しない）。加えて上記ポリシーに従い、`gscDashboard.actions.ts` の全公開関数（6本）と `app/api/gsc/dashboard/*`（2本）の入口で認可を必須検証する。proxy のパス判定のみを認可の根拠にしない（BR-07。Next.js 公式も「Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone.」と明記する。§16「Next.js — redirects と Proxy」）。採用理由・却下案は §15.4、変更対象ファイルは §17、受入条件は AC-12 とする。

**認可関数の使い分け（2026-08-15 実測）:** `src/server/lib/ga4-permissions.ts` は `canAccessGa4`（`:9`）と `canWriteGa4`（`:14`）の2関数を公開する。`canWriteGa4` は現状 `canAccessGa4` へ委譲するだけだが、既存コードは読み取りと書き込みで呼び分けている（読み取り: `ga4Setup.actions.ts:102,126`、書き込み: `ga4Setup.actions.ts:212`・`app/api/ga4/sync/route.ts:21`）。**本仕様もこの既存パターンに揃える。**両者が同値のまま書き込み入口に `canAccessGa4` を置くと、将来書き込みロールを絞った時点で書き込み経路だけ防御が外れるためである。

| 入口 | 区分 | 使う関数 |
|---|---|---|
| `gscDashboard.actions.ts:106` `fetchGscDetail` / `:628` `fetchQueryAnalysis` | 読み取り | `canAccessGa4` |
| `gscDashboard.actions.ts:377` `registerEvaluation` / `:481` `updateEvaluation` / `:790` `runQueryImportForAnnotation` / `:877` `runEvaluationNow` | 書き込み | `canWriteGa4` |
| `app/api/gsc/dashboard/route.ts` / `app/api/gsc/dashboard/[annotationId]/route.ts`（いずれも `GET` のみ） | 読み取り | `canAccessGa4` |
| フェーズ2で新設する評価の実行・再実行の入口 | 書き込み | `canWriteGa4` |
| フェーズ2で新設する評価結果・履歴の取得入口 | 読み取り | `canAccessGa4` |
| フェーズ2で新設するメディア全体スコア・散布図データの取得入口（`/ga4-dashboard` 向け。§10.6） | 読み取り | `canAccessGa4` |

`ga4-permissions.ts` のユニットテストは現状0件のため（2026-08-15 実測）、フェーズ1で `canAccessGa4` と `canWriteGa4` の両方を対象に新設する（`instagram-permissions.test.ts` と同型。§3.4 / §13）。

**未認可時の応答契約:** 実装者が文言を直書きしたり意味の異なる既存定数を流用したりしないよう、応答形を次に固定する。

| 入口 | 応答 |
|---|---|
| Server Action（`gscDashboard.actions.ts` 公開6関数、およびフェーズ2で新設する評価用 Server Action） | 当該ファイルの既存の返り値形に合わせ `{ success: false, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED }` を返す（参照実装: `instagramSync.actions.ts:46` の `{ success: false, error: ERROR_MESSAGES.INSTAGRAM.ACCESS_DENIED }`）。`data` を含めない |
| Route Handler（`app/api/gsc/dashboard/*` 2本、およびフェーズ2で新設する評価用 Route Handler） | HTTP 403 と `{ success: false, error: ERROR_MESSAGES.GA4.FEATURE_ACCESS_DENIED }` を返す（既存の 401 応答と同じ JSON 形。参照実装の 403 は `app/api/instagram/oauth/start/route.ts:51`）。本文に記事詳細・評価結果・履歴のデータを含めない |

`FEATURE_ACCESS_DENIED` は `src/domain/errors/error-messages.ts` の `GA4` 群（`:575-605`）へ**新設**する。同ファイル `:666` の `GOOGLE_ADS.ACCOUNT_ACCESS_DENIED`（「指定されたアカウントIDにアクセス権限がありません」）は Google Ads のアカウントIDに対するアクセス権を指し、ロールによる機能提供範囲とは意味が異なるため流用しない。定数名・文言の最終形は実装時に `error-messages.ts` の既存命名へ合わせる（変更対象ファイルは §17）。

**既存挙動の意図的な変更:** 現在 `/gsc-dashboard` に直URLで到達できる `trial` は、移設後は記事詳細に到達できなくなる（旧URLは redirect 後に proxy が `/unauthorized` へ誘導する）。これは上記ポリシーと整合する意図的な変更であり、フェーズ1の明示的スコープとする（判断の記録は §15.4。アプリ内の記事詳細への導線は元々 paid 限定の `/analytics` 一覧の「詳細」ボタンのみ）。

| 操作 | admin | paid | その他（trial 等） | 実装根拠 |
|---|---|---|---|---|
| 評価一覧・結果の閲覧（`/analytics`） | 可 | 可 | 不可 | `proxy.ts:11,177-179,215-217` の有料機能パス判定 + `canAccessGa4` |
| 記事詳細の閲覧（`/analytics/[annotationId]`、既存3タブ含む） | 可 | 可 | 不可 | proxy の自動保護（プレフィックスマッチ）＋ページのデータ取得・`gscDashboard.actions.ts` の `canAccessGa4` / `canWriteGa4`（フェーズ1で追加。使い分けは上表） |
| `app/api/gsc/dashboard/*`（2本）への直アクセス | 可 | 可 | 不可 | `canAccessGa4`（フェーズ1で追加）。**`src/`・`app/` からの呼び出しは0件（2026-08-15 実測）で、画面の構成要素としては使われていない**。現状は `authMiddleware` の認証のみで `content_annotations` / `gsc_article_evaluations` / `gsc_page_metrics` を返すため、直URL到達点の遮断として認可を追加する。2本の削除可否は本仕様のスコープ外（§5.5「API Route」） |
| 旧URL `/gsc-dashboard` へのアクセス | redirect | redirect | redirect 後 `/unauthorized` | `next.config.ts` の恒久 redirect（§5.5） |
| 評価の手動実行 | 可 | 可 | 不可 | 評価用 Server Action / Route Handler の入口で `canWriteGa4`（書き込み入口。フェーズ2） |
| 評価の再実行 | 可 | 可 | 不可 | 同上 |
| 評価結果・履歴の削除 | 不可 | 不可 | 不可 | MVPでは利用者・管理者とも削除操作を提供しない。ユーザー削除時の `ON DELETE CASCADE` による追随のみ。terminal履歴の直接UPDATEも許可しない（§7.4） |

評価データは実行者本人のデータに限定する（RLSは自己参照のみ。§7.5）。**かつて存在したオーナー/スタッフ共有モデルは廃止済みである**（2026-08-15 実測: スタッフレコード（`users.owner_user_id` が非 null な行）は実在せず、`supabase/migrations/20260808000000_simplify_instagram_credentials_select_policy.sql` が「オーナー/スタッフ共有パターンは不要」と判断して Instagram 系テーブルを `user_id = (select auth.uid())` の自己参照へ単純化している。`gscDashboard.actions.ts:104` の `getUserScope` も `[userId]` を返すだけの残骸である）。したがって「共有閲覧を将来別仕様で設計する」という前提は置かない。共有要件が新たに発生した場合は本仕様の枠外で新規に要件定義する。

### 3.4 実装フェーズと概算工数

MVPはフェーズ0〜フェーズ2の3フェーズとする。概算は8時間を1人日とした開発工数であり、仕様確定・レビュー待ち時間は別途である。

> **改番の対応（2026-08-15）:** 本改訂でルート移設をフェーズ1として挿入し、旧フェーズ1（手動評価MVP）をフェーズ2へ改番した。§18 の 2026-08-14 以前の記録にある「フェーズ1」は現フェーズ2を指す。

| フェーズ | 目的 | 主な成果物 | 工数 |
|---|---|---|---:|
| 0. 事前リファクタリング | 既存挙動を維持したまま、評価実装の境界を整理する | データ集約境界、LLM構造化出力アダプター、状態/エラー型、回帰テスト | 30〜45h |
| 1. 記事詳細のルート移設 | 記事詳細を `/analytics/[annotationId]` へ挙動保存で移設し、認可を 2026-08-15 ポリシー（§3.3）へ揃える | `app/gsc-dashboard/` 一式の移設・route param 化、旧URLの恒久 redirect、参照箇所修正、サーバー側認可の多層化、`ga4-permissions` テスト、挙動保存テスト（§5.5） | 24〜40h |
| 2. 手動評価MVP（評価エンジン） | 1記事単位のスコア算出・診断・文章化・保存・表示と、メディア全体スコアを提供する | スコア算出エンジン（アンカー線形補間・幾何平均・診断マトリクス・足切り・完読率併用）、GA4取込拡張（`landingPage` 軸へ `engagementRate` / `activeUsers` 追加。§4.1.1）、本文文字数・画像点数の整備、現在状態projection・履歴・settingsのmigration/RLS、所有者検証trigger、`start_`/`finish_ga4_content_evaluation` RPCとDBテスト、一覧RPCへの成功履歴JOINと未評価フィルタ、サイト内順位・前回差分、文章化LLM（5フィールド契約）、手動API、DB Kill Switch、stale回復、打ち切り検知＋一覧の期間上限（D4: (b)＋(d)）、認可ガード、一覧の評価状態列、記事カードUI、情報階層の統合レイアウト再設計（Q-C）、メディア全体スコア＋散布図（/ga4-dashboard）、UI用語言い換え（UI全体）、実データ検証 | 181〜275h |

MVP合計は **235〜360時間（30〜45人日）**。**2026-08-17 受領の評価エンジン仕様の反映により、D1 合意値 197〜297h（D4 反映後 198〜299h）から +37〜61h 増**（うち +4〜6h は D1' 合意後の「原文正本の原則」決定＝用語言い換えの UI 全体適用によるもの。D1' 合意値 231〜354h からの増分としてクライアントへ共有する）。増分の主因はスコア算出エンジン、本文文字数・画像点数の整備、サイト内順位・前回差分、メディア全体スコア＋散布図、UI用語言い換え（いずれもクライアント仕様由来の新規要素）で、pagePath 軸取込の失効（−6〜10h）と LLM 簡素化（文章化のみ）で一部相殺している。**この再見積のクライアント合意が D1'（§15.3）であり、フェーズ2着手のゲートである。**取込拡張の見積は `landingPage × activeUsers / engagementRate` の Compatibility 未実測（§4.1.1）を前提に置いた概算で、実測で不可と判明した指標は代替設計で増減する（D1' 提示時に明示する）。フェーズ0では、GSC・GA4の全体的な共通化、無関係な既存サービスの再設計、画面仕様の変更を行わない。

#### フェーズ1（ルート移設）の内訳

設計の正本は §5.5。挙動保存の範囲と完了条件は下記および AC-14 / AC-15 とする。

| 区分 | 内容 | 工数 |
|---|---|---:|
| 移設 | `app/gsc-dashboard/` 一式（約2,993行）を `app/analytics/[annotationId]/` へ移動、`useGscDashboard` の `useSearchParams` 読み取りを route param へ変更、参照4ファイル修正、`revalidatePath` 5箇所更新（§5.5） | 8〜12h |
| redirect | `next.config.ts` に redirects 2ルール（`?annotationId=X` → `/analytics/:annotationId`、素URL → `/analytics`、いずれも `permanent: true`）＋検証 | 2〜4h |
| 認可 | `gscDashboard.actions.ts` 公開6関数（読み取り2本＝`canAccessGa4`／書き込み4本＝`canWriteGa4`）と `app/api/gsc/dashboard/*` 2本（`canAccessGa4`）への認可追加、`error-messages.ts` GA4 群への拒否文言定数の新設、`ga4-permissions.ts` のユニットテスト新設（`canAccessGa4` / `canWriteGa4` 両方。現状テスト0件。2026-08-15 実測） | 6〜10h |
| テスト | 既存3タブの挙動保存 E2E／特性テスト、redirect（308・クエリ有無・クエリ維持）、trial 遮断（AC-12） | 8〜14h |

#### フェーズ1の完了条件

- `/analytics/[annotationId]` で既存3タブ（概要・検索クエリ分析・評価履歴）の内容・操作が移設前と同一である（E2E で固定。AC-14）。
- `?annotationId=X` 付き旧URLが 308 で `/analytics/X` へ、素URLが `/analytics` へ redirect される（AC-15）。
- `app/gsc-dashboard/` が削除され、**旧ルートを指す「参照」が0件**である。判定の定義は次のとおり。
  - **判定対象**: リンク・遷移先・`revalidatePath` 等のパス指定・redirect の `source` / `destination`・ドキュメント内のパス参照として書かれた `/gsc-dashboard`（**先頭スラッシュ付き**）、および移設対象ディレクトリを指す `app/gsc-dashboard/`。
  - **探索範囲**: **git 管理下のファイル全体**（`.gitignore` を尊重する検索を用いる。`rg` は既定で尊重する。`grep -r` を使う場合は `node_modules/`・`.git/`・`.next/`・`docs/plans/_html/`・`.takt/`・`*.tsbuildinfo` を明示除外する）。**`src/`・`app/` 限定では §17 の同期対象（`.agents/skills/` 配下・`docs/` 配下）を捕捉できないため範囲を広げる。**ビルド生成物・TAKT 作業ファイルはいずれも `.gitignore` 対象であり成果物ではないため判定に含めない（2026-08-15 実測: `.gitignore:17,43,69` および `.takt/.gitignore:2`）。
  - **除外**: (1) `next.config.ts` の redirect 定義（`source: '/gsc-dashboard'`）。(2) **本仕様書（`docs/plans/ga4-content-evaluation-spec.md`）自身**。移設の設計正本として旧ルート名を必ず含むため、歴史記録（§18 / §19 / §15.4）だけでなく設計記述（§3.1 / §3.3 / §3.4 / §5.1 / §5.5 / §10.1 / §10.3 / §12 / §13 / §14 / §15.2 / §15.3 / R-09）も判定対象外とする。(3) `src/server/actions/gscDashboard.actions.ts` のログ接頭辞 `[gsc-dashboard]` 計7箇所（`:225` `:475` `:581` `:723` `:784` `:864` `:925`。2026-08-15 実測）。これはパス参照ではなくログ文言であり、**ログ文言の改称はフェーズ1のスコープ外**（§17 の同ファイル変更対象は `revalidatePath` 4箇所と公開6関数への認可追加のみ）。
  - **改称しないもの**: `gscDashboard.actions.ts` / `gscNotification.actions.ts` のファイル名、`GscDashboardClient` 等の識別子（camelCase・PascalCase であり本判定の文字列にはヒットしない）。改称はフェーズ1のスコープ外とし、必要になれば別チケットで扱う。
  - 更新が必要な他ドキュメントの一覧は §17（R-09）。
- `gscDashboard.actions.ts` の全公開関数と `app/api/gsc/dashboard/*` が、許可されないロールに §3.3「未認可時の応答契約」の応答を返す（AC-12）。
- `trial` ロールが `/analytics/[annotationId]` を開くと `/unauthorized` へ誘導される（proxy の既存動作。AC-12）。
- 既存テスト、型チェック、Lint、ビルドが通る。

#### フェーズ2の内訳

| 区分 | 内容 | 工数 |
|---|---|---:|
| DB | projectionと履歴の分離、settings、所有者検証trigger、開始/完了RPC 2本、同時実行DBテスト、一覧RPCへの成功履歴JOIN | 30〜42h |
| スコア算出エンジン | 本文文字数の正規化・期待読了時間（画像補正込み）・読了率/読み始め率・アンカー線形補間・幾何平均・診断マトリクス（6コード）・sessions<30 足切り・完読率併用診断。すべて純関数＋境界値網羅テスト（§6.2 / §13） | 10〜16h |
| 評価サービス | 評価Context組立、GA4突合、スコア保存、文章化LLM呼び出し（5フィールド Zod 検証）、部分成功（文章のみ失敗）処理、stale回復、Kill Switch判定、手動API | 36〜50h |
| サイト内順位・前回差分 | 全記事のコンテンツ力スコア順位の算出（一覧ページングと独立した集計経路）、直前成功履歴との点数差分（§6.4 / §7.3） | 6〜10h |
| 本文文字数・画像点数 | `wp_content_text` の空白・エンティティ正規化関数、`wordpressContentSync` での img タグ数算出と `wp_image_count` 列 migration、既存記事の再同期方針、テスト（§4.1.1） | 6〜10h |
| メディア全体スコア＋散布図 | `/ga4-dashboard` への資産価値スコア・実効スコア（セッション加重平均）と散布図（読み始め×読了×セッションサイズ。`QueryAnalysisTab.tsx` の4象限 ScatterChart 流用）、集計 Server Action、認可（§10.6） | 12〜20h |
| UI用語言い換え | 評価エンジン仕様 §08 の対応表を `ui-text.md` 用語辞書へ転記し、**ツール内 UI 全体**（新設評価UI＋既存画面の表示文言）へ適用。GA4用語の残存ゼロ検査（§10.7。原文正本の原則で既存画面も対象＝+4〜6h） | 10〜16h |
| 打ち切りへの対処 | **D4 決着（2026-08-17）: (b)＋(d) 併用。** (b)＝`count:'exact'` 突合・`data_quality_json` への伝播・一覧側の部分取得表示（原因と対処を含む文言。§10.2 / §11 / AC-13）で 2〜4h。(d)＝一覧の表示期間に上限 **100日** を追加（`app/analytics/page.tsx` の期間検証へ上限を実装。10記事/ページ × 100日 = 1,000行 ≦ `db-max-rows`。§6.1-4）で 1〜2h。(d) により通常経路では打ち切りが発生せず、(b) は上限をすり抜ける経路（ページサイズ変更等の将来の設定変化を含む）への安全弁となる | 3〜6h（(b) 2〜4h ＋ (d) 1〜2h） |
| 認可ガード | フェーズ2で新設する評価用・メディア全体集計用の Server Action / Route Handler 入口での認可検証（実行・再実行＝`canWriteGa4`、結果・履歴・全体スコア・散布図の取得＝`canAccessGa4`。§3.3 / BR-07 / AC-12。既存 `gscDashboard.actions.ts` への追加はフェーズ1で完了済み） | 2〜3h |
| GA4取込拡張 | 既存 `landingPage` 軸クエリへの `engagementRate` / `activeUsers` 追加（評価エンジン仕様 §09。2026-08-17 に pagePath 軸方針から転換）。内訳: `checkCompatibility` 経路新設＋`landingPage × activeUsers / engagementRate` の互換実測 3〜5h ＋ `ga4ImportService` の metrics 追加と集計・型・select 文字列の連鎖改修（取り出しがインデックス直参照のため）3〜5h ＋ 追加列 migration（`engagement_rate` / `active_users`。`page_views` は Q-D で実在確認済み・不使用）1〜2h ＋ §4.1.2 後方互換 1〜2h ＋ テスト 2〜4h | 8〜14h（互換は実測確認済み＝Q-G。§4.1.1） |
| UI | 一覧の評価状態列・未評価フィルタ、記事カードUI（コンテンツ力スコア＋点数バー、読み始め/読了の内訳、人数ファネル「訪問▶読み始め▶最後まで」、headline/situation、NEXT ACTION＋狙い、サイト内順位。§10.3） | 22〜32h |
| UI（統合レイアウト） | 記事詳細の情報階層を 2026-08-13 合意たたき台（タブ構成「概要（GA4/GSC統合）」「検索クエリ」「評価履歴」基本）へ再設計する（Q-C 回答 2026-08-16「まとめで全てやる」）。内訳: タブ構成再編 2〜3h ＋ 概要タブへの GA4指標・評価表示の統合（現行 `OverviewTab.tsx` 224行の再構成）6〜10h ＋ 評価履歴の統合表示（`EvaluationHistoryTab.tsx` 267行＋`evaluation-history/` 275行の再編）4〜8h ＋ `EvaluationSettings` / `SuggestionDataReadiness` の再配置 2〜4h ＋ E2E・特性テスト更新 4〜7h ＋ たたき台突合・文言調整 2〜4h | 20〜36h（2026-08-16 見積） |
| 実データ検証 | 実GA4/GSCデータで画面値・保存値・API応答を突合 | 16〜20h |

取込拡張の対象は 2026-08-17 の評価エンジン仕様で **`landingPage` 軸の `engagementRate` / `activeUsers`** に確定した（旧方針＝Q-A 由来の `pagePath` 軸 `screenPageViews` は失効。PV はスコアリングに使わない。§4.1.1 / §18）。フェーズ2 内訳の合計は 181〜275h（各行の下限・上限の和）。

#### フェーズ0の代替案（採否の記録）

フェーズ0は §5.4 のとおり「既存の公開メソッドの入出力は維持する」改修であり、利用者から見た変化がない作業にMVP全体の20〜30%を割く。次の代替案と比較した結果、フェーズ0を維持する。

| 案 | 内容 | 却下・採用理由 |
|---|---|---|
| A（採用） | 先に `analyticsContentService` の責務を分離し、評価用の入力境界を新設する | 評価固有ロジックが既存サービスへ滲み出すのを防ぐ。特性テストを先に置くことでフェーズ2の回帰を検知できる |
| B（却下） | 既存サービスを触らず、フェーズ2で評価専用の取得経路を新設する | 期間集計・URL正規化・欠損判定が一覧側と評価側で二重化し、値の食い違いが利用者に見える形で発生する |

なお着手前の特性テスト追加は案Bを採る場合も必要である（既存テストは `tests/unit/server/services/analyticsContentService.test.ts:26,46,60` のRPC引数検証3件のみで、GA4集計値を検証していない）。

#### フェーズ0の完了条件

- **リファクタリング着手前に、現状の挙動を固定する特性テストを追加してある。** 既存の `analyticsContentService` テストはRPCへ渡す引数の検証3件のみで、GA4集計値を検証するテストが存在しない。責務分離で集計ロジックを移動しても型チェック・Lint・ビルド・既存テストは通ってしまうため、着手前に次を固定する。
  - GA4集計値: 直帰率がセッション数による**重み付き平均**であること（単純平均でないこと）、**分母0のときの直帰率は `null` ではなく `0` にフォールバックする**こと、CTRが `impressions > 0` のときのみ算出され0件時は **`null`**（0ではない）であること、**保存済みの `ctr` 列は読まず `search_clicks / impressions` から再計算する**こと、`normalized_path` 単位の日次合算、`is_sampled` / `is_partial` の **OR集約**、`(user_id, property_id)` 組でのフィルタ。
  - 早期returnの境界: `startDate > endDate`、日付未指定、有効な `canonical_url` が0件、GA4プロパティ未設定のとき空の集計を返すこと。
  - ページングと既存フィルタ: カテゴリ、未分類、未読提案、GSC評価未開始の各条件とページ番号の組み合わせ。
- 上記の特性テストがリファクタリング前後で同一結果を返す。
- `/analytics` の既存レスポンス、ページング、GA4集計値、既存フィルタの挙動が変更されていない。
- データ取得・期間集計・評価入力組立の責務が分離され、フェーズ2から評価専用の入力境界を利用できる。
- LLM呼び出し、JSON抽出、Zod検証、再試行、機密情報のログ出力制御を共通アダプターとして利用できる。
- 評価状態・エラーコードの型と状態遷移テストが追加されている。
- 既存テスト、型チェック、Lint、ビルドが通る。

フェーズ0で既存コードに手を入れるのは `src/server/services/analyticsContentService.ts` のみである。同サービスの利用箇所は `app/analytics/page.tsx` の `getPage` と `getAvailableCategoryNames` だけで、`fetchGa4Summaries` は private のため外部参照がない。したがって影響範囲は `/analytics` 一覧に閉じるが、影響がないことは上記の特性テストで確認する。

## 4. 指標とデータソース

### 4.1 評価指標（評価エンジン仕様 2026-08-17 で確定）

スコアリングに使う指標は次の表のとおり。計算式の正本は `docs/context/ga4-evaluation-engine-spec-20260817.md` §02、転記は §6.2。**GSC 指標・PV・CV・直帰率はスコアリングに使わない**（表示・参考値としての既存機能は不変）。

| 指標 | 正本データソース | 既存取込の実態 | MVP方針 |
|---|---|---|---|
| 滞在時間（読了率の分子の材料） | GA4 `userEngagementDuration` → `ga4_page_metrics_daily.engagement_time_sec` | `landingPage` 軸で日次取得済み（期間合計秒） | 利用する。平均エンゲージメント時間 = `userEngagementDuration ÷ activeUsers`（評価エンジン仕様 §02。`averageSessionDuration` は使わない） |
| activeUsers（読了率の分母） | GA4 `activeUsers` | **未取得**。既存の `users` 列は `totalUsers` 非互換のため **sessions のコピー**（`ga4ImportService.ts:343-345` 実測） | **利用する（取込拡張で追加）**。`landingPage × activeUsers` の互換は **2026-08-17 に Query Explorer 実測で確認済み（Q-G 決着）**。分母は ÷activeUsers で確定（§4.1.1）|
| 読み始め率（エンゲージメント率） | GA4 `engagementRate` | **未取得**（DB列なし。リモートDB照会 2026-08-17 でも `engagement_rate` 列は不在 → migration で新設。§4.1.2） | **利用する（取込拡張で追加）**。**必ず `landingPage` 軸で取得する**（評価エンジン仕様 §02「pagePath だとセッション指標が歪む」。既存クエリと同軸なので追加クエリ不要） |
| 本文文字数（期待読了時間の材料） | `content_annotations.wp_content_text`（HTML除去済み平文） | 保存済み。ただし空白・HTMLエンティティの正規化は未実施（`stripHtml`＝`src/lib/utils.ts:8-10` はタグを空白置換するのみ） | **利用する**。正規化（連続空白の除去・エンティティのデコード）後の文字数を使う（§4.1.1） |
| 画像点数（期待読了時間の補正） | WordPress `content.rendered` の img タグ数 | **未保存**（HTML は DB に保存されない。2026-08-17 実測） | **利用する**。`wordpressContentSync` の同期時に算出し `content_annotations.wp_image_count` へ保存（§4.1.1） |
| 完読率（任意・精度向上用） | GA4 scroll イベント（90%到達） → `ga4_page_metrics_daily.scroll_90_event_count` | `landingPage` 軸で取得済み。ただしイベント名は **`scroll_90` ハードコード**（`src/lib/ga4-utils.ts:1`）で、拡張計測の標準 `scroll` イベントとは別名 | 利用する。実イベント名の確認が必要（§15.2） |
| セッション数（足切り・ファネル・加重平均） | GA4 `sessions` → `ga4_page_metrics_daily.sessions` | `landingPage` 軸で取得済み | 利用する。期間合計 30 未満は「データ蓄積中」（BR-08） |
| 表示回数 / CTR（GSC） | GSC `impressions` / `ctr` → `gsc_page_metrics` | 取得済み | **スコアリングに使わない**。既存の GSC 表示・検索順位評価は不変（参考表示） |
| PV数 | GA4 `screenPageViews` | 未取得（`page_views` 列はリモートに実在するが不使用。Q-D 照会 2026-08-17。§4.1.2） | **使わない**（2026-08-17 失効: 旧 Q-A 方針。評価エンジン仕様にPVは登場しない） |
| 直帰率 | GA4 `bounceRate` → `bounce_rate` | 取得済み | **スコアリングに使わない**（読み始め率の裏返し。UI でも表示しない方針＝評価エンジン仕様 §08） |
| CV数 | GA4 `eventCount` → `cv_event_count` | 取得済み | **スコアリングに使わない**（CTA検証は R_GOOD の「次の一手」の領域） |
| オーガニック検索 ROI | 費用・売上データ | 未連携 | 評価入力に含めない（Q3。§3.2） |
| ヒートマップ情報 | 外部サービス | なし | MVP対象外 |

#### 4.1.1 取得軸と新規材料（2026-08-17 確定: landingPage 軸で完結）

**旧方針（Q-A 由来の pagePath 軸追加クエリ）は 2026-08-17 の評価エンジン仕様で失効した。**新方針は既存の `landingPage` 軸クエリ（`ga4ImportService.ts:260-268` の `fetchBaseReport`）に metrics を追加するだけで完結し、第2クエリ・`normalized_path` 突合の新設は不要になる。

- **`engagementRate`**: セッションスコープ指標で、`landingPage`（セッションスコープ）と同軸。評価エンジン仕様 §02 が「必ず landingPage 次元で取得する（pagePath だとセッション指標が歪む）」と明記する。公式定義（Engaged sessions ÷ Sessions）は §16 の verbatim 引用を参照。
- **`activeUsers`**: 読了率の分母。ユーザースコープ指標だが、**`landingPage` との互換は 2026-08-17 に GA4 Query Explorer の `runReport` 実測で確認済み**（Q-G 決着＝§15.2。既存コードの `totalUsers` 非互換とは別物と判明）。分母は ÷activeUsers で確定し、÷sessions フォールバックは不要になった。残る確認は**数値レベルの画面突合**（Q-H。「ページとスクリーン」＝÷activeUsers と一致するのが有力仮説だが、landingPage 軸と pagePath 軸の母集団差によるズレの有無をデータのあるプロパティで確認する）。
- **本文文字数**: `wp_content_text` を正規化（タグ置換で入った連続空白の圧縮、`&nbsp;` 等のエンティティのデコード）してから `length` を取る。正規化関数は純関数として新設しテストで固定する。
- **画像点数**: `wordpressContentSync.ts` は同期時に `content.rendered`（HTML）をメモリ上に持つ（`:34-45`）。ここで `<img` タグ数を数え、`content_annotations.wp_image_count`（新設列）へ `wp_content_text` と同時に保存する。未取得の間は補正 0 として期待読了時間を算出し、`data_quality_json` に未取得を記録する。**既存記事を埋める導線は2つあり、どちらも本仕様のスコープに含む（2026-08-19 追加。当初「次回の同期で埋まる」と書いていたが、対応する導線が存在しなかった。§18）**: (a) `/wordpress-import` の一括インポートが WP REST 一覧の `content.rendered` から `wp_content_text` / `wp_image_count` を書く（`_fields` で絞っていないため追加の WP API 呼び出しは発生しない。差分判定にも `wp_image_count` を含め、NULL 行が「無変更」でスキップされないようにする）。(b) 記事単位の `fetchWpPostContentWithCache` は再取得条件に `wp_image_count IS NULL` を含める（本文・抜粋だけを条件にすると、本文キャッシュ済みの記事が永久に NULL のまま残る）。

**migration 前の必須実測:** ~~組み合わせ可否の実測~~ → **完了（2026-08-17、Query Explorer）**。`landingPage × activeUsers / engagementRate / sessions / userEngagementDuration` の4指標同時取得が受理されることを確認済み（Q-G）。`checkCompatibility` 経路の新設（§9.2）は、将来の取得指標変更時の再検証手段として取込拡張のスコープに残す。

#### 4.1.2 追加指標の後方互換（2026-08-18 決定済み）

取込追加（`engagement_rate` / `active_users`）と `wp_image_count` の後方互換方針は、次のとおり**過去分の再取込＋全記事再同期で決定した**（2026-08-18 開発側決定。§18）。

| 論点 | 現状 | 決定 |
|---|---|---|
| 既存レコードの値 | `engagement_rate` / `active_users` は新設列で、migration 後の既存行は NULL（**NULL 可で新設**し、欠損を 0 と区別できる形にする。BR-02） | **過去分を再取込する。** migration 適用後・Kill Switch 有効化前に、`/ga4-dashboard` ヘッダーの「**過去90日を再取込**」ボタン（`/api/ga4/sync` に `backfillDays` を送り、同期カーソルを無視して既定90日＝評価入力の期間上限を取り直す）で既存行の新列を upsert で埋める（§14 リリース手順）。**指標の欠けに気づくのは数値を見るダッシュボードなので、操作もそこに置く**（2026-08-19 決定。当初 `/setup/ga4` に置いていたが、設定画面は連携先の選択が責務で、数値を見ながら取り直す動線にならない）。**既存の「GA4日次同期を実行」は前回取込日以降しか取得しないため過去分は埋まらない。専用の導線を持つこと自体が要件である**（2026-08-19 追加。§18）。再取込は行数打ち切り（`MAX_TOTAL_ROWS`）を避けるため 30 日以下の窓に分割して実行し、打ち切り・サンプリングが起きた場合は成功トーストに加えて警告を出す（黙って欠損させない）。GA4 Data API は過去日付の `engagementRate` / `activeUsers` を返せるため取得可能。クォータは §9.2.1 の Core Tokens Per Property Per Day 200,000 に対し 90 日分の再取込で十分収まる。再取込前の 90 日超の過去日は NULL のまま（評価入力の上限が90日のため実害なし） |
| リリース直後の評価可否 | §9.2.1 が「レポート0回（DBキャッシュ利用）」のため、取込開始日以前は `engagement_rate` が欠損し読み始めスコアが算出できない。AC-03 により `insufficient_data` となり**ほぼ全記事が評価不能**になる（読了率側は既存の `engagement_time_sec` で過去分も算出可能） | **再取込により解消**（リリース初日から既定90日の評価が可能）。評価期間の下限クランプや欠損日除外の集計変更は**行わない**（BR-02・AC-03 の欠損セマンティクスを変えない）。再取込が未実施・失敗の間は仕様どおり `insufficient_data`（表示は §10.4）となる |
| `wp_image_count` の未取得期間 | 新設列。migration 後の既存行は NULL | NULL の間は補正 0 で期待読了時間を算出し `data_quality_json` に記録する（§4.1.1 で決定済み）。**`/wordpress-import` の一括インポートを1回実行して埋める**（§14。初日から画像補正が効く状態にする）。一括インポートが `wp_content_text` / `wp_image_count` を書くようにする改修と、差分判定に `wp_image_count` を含める改修が前提（§4.1.1。2026-08-19 追加。当初「次回の同期で埋まる」と書いたが、既存の一括インポートはこの2列を書かず、記事単位の再取得条件も本文・抜粋しか見ていなかったため成立していなかった。§18）。一括インポートは1回あたり**最大1000件**（`wordpressImport.actions.ts` の `maxItems`）で、これを超える記事数のサイトでは1回で埋まりきらない（既存の制限であり本仕様では変更しない） |
| `page_views` 列のドリフト | **決着（Q-D 照会 2026-08-17）**: リモートに `page_views integer NOT NULL DEFAULT 0` が実在し、生成型 `src/types/database.types.ts:241` と一致。migration にのみ定義がない。**2026-08-17 の評価エンジン仕様で PV 自体が不使用になったため、取込対象にもしない** | 列には触れない（migration 対象外。`ADD COLUMN IF NOT EXISTS` の保険も不要と確定） |

**生成型からリモートDBの実在を推論しない（2026-08-14 実測）。** 生成型と `supabase/migrations/` は双方向にずれている。逆方向のドリフトの実例として、`prompt_versions.change_summary` は migration（`20250701000000_create_prompt_templates.sql:22`）に存在するが `src/types/database.types.ts` の `prompt_versions` Row には**存在しない**。したがって「生成型にある＝リモートに実在する」は根拠にならない。Q-D は**リモートDB（本番／ステージング）の実スキーマ照会**で確認する。

**Q-D 照会結果（2026-08-17。リンク済みリモートDBの `information_schema.columns` を Supabase SQL エディターで照会）:** `ga4_page_metrics_daily` は全21列で、生成型 `src/types/database.types.ts:226-249` と**完全一致**する。migration（`20260207100000_add_ga4_daily_metrics.sql`）に存在しない列は `page_views` / `impressions` / `ctr`（NULL 可） / `search_clicks` の4本（いずれも migration 未管理のドリフト列、リモートには実在）。`engagement_rate` / `active_users` 列は**存在しない**ため、取込拡張の migration で新設する。

### 4.2 GA4/GSC データ契約（既存実装に固定）

#### 4.2.1 GA4 取込軸

既存 `ga4ImportService` は **`landingPage` ディメンション**（セッションスコープ）で日次指標を保存する。`pagePath` ではない。

- 保存先: `ga4_page_metrics_daily`（キー: `user_id`, `property_id`, `date`, `normalized_path`）
- 取得指標: `sessions`, `userEngagementDuration`, `bounceRate`, CV/scroll イベントの `eventCount`。**フェーズ2で `engagementRate` と `activeUsers`（互換実測後）を同一クエリへ追加する**（§4.1.1）
- CVR 分母: `totalUsers` は `landingPage` と非互換のため **`sessions` を充てる**（既存実装コメント通り）。`users` 列は sessions のコピーであり（`ga4ImportService.ts:343-345`）、読了率の分母には使えない

#### 4.2.2 使用しない列（死データ）

`ga4_page_metrics_daily` の `search_clicks`, `impressions`, `ctr` は、GA4 API 制約により **`landingPage` 軸では取得不可**のため取込時に **0 または NULL で保存**される。評価入力では **これらの GA4 列を使わない**。検索表示回数・CTR・クリック数の正本は GSC のみとする。

`landingPage` × 検索指標の非互換について、Google 公式 API スキーマ本文に明示的な記述は未確認である（§16「公式未確認」）。**Compatibility API による事前確認は現時点で未実装である**（`src/server/services/ga4Service.ts` の公開メソッドは `listProperties`（`:38` → `accountSummaries`）／`listKeyEvents`（`:82` → `keyEvents`）／`runReport`（`:114` → `:runReport`）の3本のみで、`:checkCompatibility` を呼ぶ経路がない。`src/` と `app/` に `checkCompatibility` は0ヒット。2026-08-14 実測）。

したがって現時点の根拠は `ga4ImportService.ts:257-259` のコードコメントのみであり、**公式正本ではない**（§16「公式未確認」の注記と同じ扱い）。Compatibility による確認は、**取込拡張（`engagementRate` / `activeUsers` の追加。§4.1.1）で取得指標を変更する前に新規実装して実施する**ものであり（§9.2 / §17）、既存の検証実績として扱わない。MVP の評価実行経路では呼ばない（§9.2.1）。

#### 4.2.3 GSC 正本

検索表示回数・クリック数・CTR・掲載順位は `gscImportService` → `gsc_page_metrics` の値を正本とする。URL 突合キーは `normalizeUrl`（GSC 側）と `normalizeToPath`（GA4 側）の **2 系統**であり、評価サービスは両方を明示的に使い分ける（§5.1）。

#### 4.2.4 データ鮮度

- GA4: 公式に処理遅延が定義されている。「Data processing can take 24-48 hours. During that time, data in your reports may change.」（確認日 2026-08-13、§16 参照）。Standard プロパティは Intraday 2〜6時間 / Daily 12時間。したがって**直近48時間の値は後から変動しうる**。評価結果の点数変動が「記事の変化」か「GA4の後追い確定」かを区別できるよう、`ga4_data_fetched_at` に加えて評価対象期間の終端が取得時刻から48時間以内かを `data_quality_json` に記録する。鮮度指標としては `ga4_page_metrics_daily.imported_at` と評価結果の `source_data_fetched_at` を併用する。
- GSC: Search Analytics API の `dataState`（`final`（既定） / `all` / `hourly_all`）は**現状リポジトリに実装がない**（`gscImportService.ts` は `rowLimit` / `startRow` のみ）。MVPでは既定の `final`（確定データのみ）で取り込み、`dataState` の明示指定と記録は行わない（§3.2）。GA4側との非対称は §4.2.4 の GA4 側記録で補う。

## 5. 現行実装との関係

### 5.1 既存の再利用（必須）

以下は新規実装せず、既存経路を拡張して再利用する。

| コンポーネント | パス | GA4評価での使い方 |
|---|---|---|
| GA4 日次取込 | `src/server/services/ga4ImportService.ts` | 評価前のデータ鮮度確認（再取込は行わない。§9.2.1）。取得軸は `landingPage` のまま、**既存 base クエリへ `engagementRate` / `activeUsers` を追加する（2026-08-17 確定。旧 pagePath 追加クエリ方針は失効。§4.1.1）** |
| GA4 一覧集計 | `src/server/services/analyticsContentService.ts` → `fetchGa4Summaries` | 記事 URL と `ga4_page_metrics_daily` の突合。評価入力の GA4 部分はこの集計ロジックを流用する。**流用するのは日次合算・セッション数による加重平均・`is_sampled`/`is_partial` の OR 集約であり、`sessions = 0` のときに直帰率を `0` とする欠損フォールバック（`analyticsContentService.ts:344-345`）は評価入力では適用しない**（BR-02 / AC-03）。この分岐がない実装は BR-02 違反とする |
| GSC 取込 | `src/server/services/gscImportService.ts` | 評価期間の GSC 指標取得 |
| 既存の記事詳細画面 | `app/analytics/[annotationId]/`（フェーズ1で `app/gsc-dashboard/` から移設。§5.5） + `gscDashboard.actions.ts` | 既存の3タブ（概要・検索クエリ分析・評価履歴）の内容・操作を変更せず（AC-14）、フェーズ2で「コンテンツ評価」タブを追加する |
| コンテンツ一覧 RPC | `get_filtered_content_annotations` | 次を追加して再作成する。**DROP FUNCTION → 再作成 → REVOKE/GRANT** の手順を踏む。<br>追加パラメータ: `p_has_unstarted_ga4_evaluation boolean`（並び替えパラメータは追加しない。Q-B で並び替え不実装のため）。<br>追加JOIN: `ga4_content_evaluations`（`user_id` + `content_annotation_id`）、およびその `last_success_history_id` 経由で `ga4_content_evaluation_history`。<br>追加返却フィールド（`items` jsonb 内）: `ga4_evaluation_status`、`ga4_content_score`、`ga4_diagnosis_code`、`ga4_last_evaluated_at`。<br>`eligible` の判定は行わない（§6.5） |
| 本文キャッシュ | `wordpressContentSync`（`src/server/services/wordpressContentSync.ts:34-45,195-216`） | `wp_content_text`（本文文字数の材料）は既存保存を利用。同期処理へ img タグ数の算出と `wp_image_count` 保存を追加（§4.1.1） |
| メディア全体集計 | `ga4Dashboard.actions.ts`（`fetchGa4DashboardSummary` / `fetchGa4DashboardRanking`） | `/ga4-dashboard` の既存サイト全体集計・記事別ランキング経路を拡張し、資産価値スコア・実効スコア・散布図データを返す（§10.6）。サイト内順位の算出もランキング経路の記事別集計を流用する |
| 散布図 | `app/analytics/[annotationId]/components/QueryAnalysisTab.tsx` の4象限 ScatterChart（recharts） | 実装パターン（象限色分け・カスタム Tooltip）を流用して `/ga4-dashboard` の散布図を実装する |
| 未評価フィルタ UI | `AnalyticsTable.tsx` / `CategoryFilter.tsx` | 既存 GSC 未評価フィルタ（`p_has_unstarted_gsc_evaluation`）と同パターンで GA4 版を追加 |
| URL 正規化（GA4） | `normalizeToPath`（`src/lib/ga4-utils.ts`） | `ga4_page_metrics_daily.normalized_path` との突合 |
| URL 正規化（GSC） | `normalizeUrl`（`src/lib/normalize-url.ts`） | `gsc_page_metrics` との突合 |
| Google トークン | `googleTokenService.ensureValidAccessToken` | 再認証検知 |
| プロンプト管理 | `PromptService` + `prompt_templates`。変数展開は `PromptService.replaceVariables`（`promptService.ts:522-535`。`{{key}}` 形式） | 文章化用テンプレート（評価エンジン仕様 §07 のシステム/ユーザープロンプト）を追加。変数は §6.3.3 の表 |
| LLM 呼び出し | `llmChat`（`src/server/services/llmService.ts`） | 文章化（5フィールドJSON）の JSON 抽出・Zod 検証は `contentAnnotationSummaryService` パターンを踏襲 |
| 権限チェック | `canAccessGa4` / `canWriteGa4`（`src/server/lib/ga4-permissions.ts:9,14`） | proxy の自動保護に加え、ページのデータ取得・Server Action・Route Handler の多層で検証（`instagram-permissions.ts` パターン。§3.3 / BR-07）。**読み取り入口は `canAccessGa4`、書き込み入口は `canWriteGa4`** と既存コードの使い分け（`ga4Setup.actions.ts:102,126,212`・`app/api/ga4/sync/route.ts:21`）に揃える。両関数とも新規実装せず現行実装を使う |

### 5.2 再利用しないもの

GSCの`gsc_article_evaluations`と`gsc_article_evaluation_history`は掲載順位の改善判定を中心とした設計であり、GA4評価の点数・診断・提案を保存する用途には流用しない。GA4評価専用テーブルを追加する。

### 5.3 共通点と差分

共通点は、外部データを取込し、記事単位に評価を実行し、結果と履歴を保存する流れである。

差分は、GSC評価が掲載順位の改善判定を中心に据えるのに対し、GA4評価は**読了率・読み始め率のスコアと診断コードをコードで決定的に算出し、LLM が記事ごとの言葉（診断文・次の一手）に変換する**点である（評価エンジン仕様 §01。2026-08-17 反転: 旧記述「評価点数やパターンを固定条件分岐で決めない」は失効し、点数・診断の固定分岐こそ要件となった。LLM の役割は文章化のみ）。

### 5.4 フェーズ0で行う事前リファクタリング

フェーズ0は既存機能の挙動を変えず、フェーズ2の実装に必要な境界だけを整理する。既存GSC評価のドメインロジックや、GA4/GSCのURL正規化仕様を無理に統合しない。

| 対象 | 方針 | 完了条件 |
|---|---|---|
| `analyticsContentService` | コンテンツ一覧ページングとGA4期間集計を責務分離する。既存の公開メソッドの入出力は維持する | 既存一覧、ページング、フィルタ、GA4表示値の回帰テストが通る |
| 評価入力 | GA4/記事情報を評価用Contextへ組み立てる境界を新設する。GA4は`normalizeToPath`で突合する。**一覧向けの欠損フォールバックを評価入力へ持ち込まない分岐をこの境界に置く**（BR-02。フェーズ2ではこの境界の下流に、スコア算出の純関数群＝正規化文字数・期待読了時間・アンカー補間・幾何平均・診断マトリクスを接続する。§6.2） | 欠損、期間、鮮度、データ品質がContextに明示される。欠損値が `0` ではなく欠損として Context に載ることが単体テストで固定されている（BR-02 / AC-03） |
| LLM呼び出し | `contentAnnotationSummaryService`等の実装を参考に、**既存サービスを変更せず**、GA4評価用の構造化LLMアダプターを新設する。JSON抽出、Zod検証、タイムアウト、再試行、ログ秘匿を呼出し境界に集約する。フェーズ2では出力スキーマを5フィールド契約（§6.3.4）で確定する | ドメイン固有の出力スキーマと評価結果保存は共通化せず、新規アダプターをフェーズ2から利用できる |
| 評価状態・エラー | `unassessed`等の状態、外部API/LLMエラーコード、既存結果保持の状態遷移を共通型・純関数として整理する | 状態遷移と異常系の単体テストがある |
| テスト基盤 | まず `analyticsContentService` の特性テスト（GA4集計値・早期return境界・ページング・既存フィルタ）を着手前に追加する。続いてGA4/GSC入力、欠損値、ユーザー分離、LLM不正出力、既存結果保持のfixtureを追加する | 特性テストがリファクタ前後で同一結果を返し、フェーズ2で同じfixtureを再利用できる |

フェーズ0では、GSC評価テーブルの流用、GSC評価ロジックの全面共通化、既存APIの変更、既存LLMサービスの変更、データベーススキーマ変更、UI変更を行わない。フェーズ0のfixtureは型・純関数レベルに限定し、評価テーブルを使うDB fixtureはフェーズ2で追加する。

### 5.5 フェーズ1で行うルート移設

記事詳細画面を `/gsc-dashboard?annotationId=...` から `/analytics/[annotationId]` へ**挙動保存**で移設する。本節が移設の設計正本である。認可の変更点は §3.3、受入条件は AC-12 / AC-14 / AC-15。

#### 移設対象（2026-08-15 実測）

- `app/gsc-dashboard/` 一式・約2,993行。内訳: `page.tsx`（30行）、`GscDashboardClient.tsx`（127行）、`hooks/useGscDashboard.ts`（318行）、`EvaluationSettings.tsx`（458行）、`types.ts`（171行）、`components/`（`OverviewTab.tsx` 224行・`QueryAnalysisTab.tsx` 603行・`EvaluationHistoryTab.tsx` 267行・`MetricsSummaryCards.tsx` 68行・`SuggestionDataReadiness.tsx` 333行・`TrendLineChart.tsx` 89行・`evaluation-history/` 一式）。
- `app/gsc-dashboard/` 配下を外部から import する箇所は0件（自己完結）。移設はディレクトリ移動＋パス参照修正で完結する。

#### 新配置と annotationId の受け渡し

- 新配置: `app/analytics/[annotationId]/` 配下へ一式を移す。動的セグメント名は既存 Route Handler `app/api/gsc/dashboard/[annotationId]/route.ts` の命名に揃える。
- `page.tsx` は `params`（`Promise<{ annotationId: string }>`）から ID を受け取り、props で下位へ渡す。`useGscDashboard.ts` の `useSearchParams()` による annotationId 読み取り（現行 `:4,75,90-97`）は廃止する。
- **page.tsx の動的セグメントは本リポジトリ初導入**である（既存の `[param]` ディレクトリは Route Handler 3件のみ。2026-08-15 実測）。リスクは R-10。
- 存在しない annotationId は現行と同じく null detail のまま描画を継続する（`notFound()` は導入しない。§3.2 / §15.4）。`/analytics/components` のような実在しないセグメント文字列も `[annotationId]` にマッチして同様に描画されるが、データ取得は `user_id` スコープのため情報漏えいはない。
- 既存3タブ（概要・検索クエリ分析・評価履歴）の内容・操作・タブ構成は変更しない（AC-14）。

#### 参照箇所の修正一覧（2026-08-15 実測）

| 場所 | 現状 | フェーズ1での変更 |
|---|---|---|
| `src/components/AnalyticsTable.tsx:1064-1077` | 詳細ボタンが `window.open('/gsc-dashboard?annotationId=…', '_blank', 'noopener,noreferrer')` | `/analytics/[annotationId]` の URL へ変更。別タブ遷移は維持する |
| `src/components/GlobalToastBridge.tsx:20,25` | `:20` `window.location.pathname.startsWith('/gsc-dashboard')` で詳細画面を判定し、`:21` で `gsc-dummy-open` を dispatch。else 側は `:24` で payload を localStorage へ保存して `:25` `window.location.href = '/gsc-dashboard'` へ遷移 | **D5 で確定する（下記「GlobalToastBridge の扱い」）。フェーズ1では実装方針を先取りしない** |
| `src/server/actions/gscDashboard.actions.ts:472,578,861,917`・`src/server/actions/gscNotification.actions.ts:79` | `revalidatePath('/gsc-dashboard')` 計5箇所 | `revalidatePath('/analytics/[annotationId]', 'page')` へ変更 |
| `GscDashboardClient.tsx:60`（移設対象内） | 「コンテンツ一覧に戻る」`href="/analytics"`（クエリなし固定） | 変更しない。戻り先クエリ引き継ぎは Non-goal（§3.2） |

#### GlobalToastBridge の扱い（D5 で確定）

**2026-08-15 実測。**`GlobalToastBridge.tsx` の遷移分岐は、現状**到達できない**。

- `:21` が dispatch する `gsc-dummy-open` の購読（`addEventListener('gsc-dummy-open', …)`）は `src/`・`app/`・`tests/` に**0件**。したがって「詳細画面にいる場合はダイアログを開く」側の分岐は効果を持たない。
- `:75` が購読する `gsc-dummy-update` の dispatch は `src/`・`app/`・`tests/` に**0件**。トーストを出す `showToast` の呼び出し口は、この購読（`:72`）と起動時の localStorage 復元（`:57-61`）の2つのみで、その localStorage への保存は `:24`（`openDialog` の else 側）と `:71`（同購読）でしか行われない。**両者が互いを前提とするため、トースト自体が表示されない。**
- 仮に表示されたとしても、`:24` で保存した payload を `:28` の `localStorage.removeItem(LS_KEY)` が**同じ同期ブロック内で削除する**（`:25` の `window.location.href` 代入はナビゲーションを予約するだけで、以降の同期処理は実行される）。遷移先で `:57` の復元が payload を見つけることはない。

したがって、**2026-08-15 改訂が §15.4 に記録していた「空詳細画面への遷移を一覧遷移へ置き換える」＝「挙動保存の唯一の意図的な逸脱」という評価は、前提（当該分岐が機能している）が成立していないため撤回する。**

フェーズ1での扱いは次の2案を比較し、**(b) を採用した（D5 確定。ユーザー決定 / 2026-08-15）**。

| 案 | 内容 | 影響 |
|---|---|---|
| (a) フェーズ1では判定・遷移とも変更せず、別チケットへ送る | `GlobalToastBridge.tsx` に `/gsc-dashboard` 文字列が残る。§3.4 フェーズ1完了条件の「0ヒット」に**明示的な例外**として追記が必要。旧URLは 308 redirect が受けるため、遷移自体は `/analytics` へ落ちる | 移設の差分が小さくなる。到達不能なコードの棚卸しは別チケットの判断に委ねる |
| (b) `:20` のパス判定のみ新ルート（例: `/^\/analytics\/[^/]+$/`）へ変え、`:22-26` の else 側の遷移分岐を削除する | 完了条件の例外が不要になる。到達不能とはいえ既存コードの削除であり、挙動保存の原則の外側の判断になる | `gsc-dummy-open` / `gsc-dummy-update` の死んだ配線を残したままにするか否かも同時に決める必要がある |

いずれを選んでも利用者から見える挙動は変わらない（現状が到達不能であるため）。**D5 は (b) で確定した**: `:20` のパス判定を新ルート（例: `/^\/analytics\/[^/]+$/`）へ変え、`:22-26` の else 側遷移分岐を削除する。あわせて `gsc-dummy-open` / `gsc-dummy-update` の死んだ配線（購読0件・dispatch 0件）も同スコープで削除する。これにより §3.4 フェーズ1完了条件の「`/gsc-dashboard` grep 0ヒット」に例外は不要となる。削除は挙動保存の原則の外側の判断だが、到達不能である実測（上記）を根拠に、死んだコードを移設先へ持ち込まないことを優先した。

#### 旧URLの恒久 redirect

`next.config.ts` に `redirects()` を新設する（現状 redirects 定義は存在しない。2026-08-15 実測）。ルールは2本、記載順もこのとおりとする。

```js
{
  source: '/gsc-dashboard',
  has: [{ type: 'query', key: 'annotationId', value: '(?<annotationId>[^&]+)' }],
  destination: '/analytics/:annotationId',
  permanent: true,
},
{
  source: '/gsc-dashboard',
  destination: '/analytics',
  permanent: true,
},
```

- `permanent: true` は 308 を返し、クライアント・検索エンジンに恒久キャッシュされる（§16「Next.js — redirects と Proxy」）。したがって**旧URLへ戻すロールバックは行わない**（§14）。
- `has` の `value` の named capture（`(?<annotationId>[^&]+)`）で destination の `:annotationId` に展開する（§16 同節）。
- **リクエストのクエリはすべて redirect 先へ引き継がれる。**同梱公式は "When a redirect is applied, any query values provided in the request will be passed through to the redirect destination."（`redirects.md:43`。§16 同節）と述べ、**`has` の named capture で消費したキーを除外する記述は置いていない**。したがって `annotationId` が destination のクエリにも残るかどうかは**公式に記載がなく未確認**である。`permanent: true`（308）はクライアント・検索エンジンに恒久キャッシュされ（§14 でロールバック不可）、この挙動を後から変えられないため、**2026-08-16 にビルド済みサーバーの 308 応答を実測した**。`/gsc-dashboard?annotationId=X&days=90` の `Location` は `/analytics/X?annotationId=X&days=90`、`/gsc-dashboard` の `Location` は `/analytics` だった（AC-15）。
- **新ルートは route param を正とし、残留クエリを読まない。**`useGscDashboard.ts` の `useSearchParams()` による annotationId 読み取りは廃止するため（上記「新配置と annotationId の受け渡し」）、`annotationId` がクエリに残っていても描画には影響しない。実測結果がどちらであっても設計を変えないよう、この点を先に固定する。
- `next.config.js` の redirects は Proxy（`proxy.ts`）より**先に**評価される（§16 同節の実行順序）。したがって trial が旧URLへアクセスした場合も、redirect → proxy の paid 判定 → `/unauthorized` の順に処理され、§3.3 の認可表と整合する。

#### API Route

`app/api/gsc/dashboard/route.ts` と `app/api/gsc/dashboard/[annotationId]/route.ts` の URL は変更しない（proxy matcher の対象外であり、URL に旧画面名を含まないため命名の齟齬もない）。フェーズ1では `canAccessGa4` の追加のみ行う（§3.3）。

**この2本は `src/`・`app/` から呼ばれていない（2026-08-15 実測。`api/gsc/dashboard` の参照は本仕様書の記述のみで、コード上の fetch は0件）。**記事詳細の構成要素としては使われておらず、認可追加は**直URL到達点の遮断**として行う。現状は `authMiddleware` の認証のみで `content_annotations` / `gsc_article_evaluations` / `gsc_page_metrics` を返すため、ロール検証がないまま残すとサーバー側多層検証（BR-07）の穴になる。**2本を削除するか否かは本仕様のスコープ外**とし、判断が必要になった時点で別チケットとする（§17）。

## 6. 機能仕様

### 6.1 評価対象の決定

1. ユーザーに紐づくコンテンツ一覧から評価対象記事を取得する。入口は `get_filtered_content_annotations` RPC（`analyticsContentService.getPage`）。
2. 記事 URL を正規化し、GA4 ページデータと GSC ページデータを同一記事へ紐づける。
   - GA4 突合: `normalizeToPath(canonical_url)` ↔ `ga4_page_metrics_daily.normalized_path`
   - GSC 突合: `normalizeUrl(canonical_url)` ↔ GSC ページ指標
3. GA4 または GSC のデータがない場合は、欠損理由を保持する。GA4 の `search_clicks` / `impressions` / `ctr` 列は欠損ではなく **使用禁止（死データ）** として扱う。
4. 打ち切りの警戒対象は `fetchGa4Summaries` の日次行取得とする。一覧RPC（`get_filtered_content_annotations`）は `RETURNS TABLE(items jsonb, total_count bigint)` で**常に1行を返す**構造であり、`p_per_page` もサーバ側で `GREATEST(1, LEAST(100, ...))` にクランプされるため、PostgRESTの1000行上限の問題は発生しない。一方 `fetchGa4Summaries`（`analyticsContentService.ts:239,286-291`）は `ga4_page_metrics_daily` から日次行を `.in('normalized_path', …)` の1クエリで取得するが、`.limit()`・`range` ページング・`count:'exact'` のいずれも使っておらず、`app/analytics/page.tsx` の期間検証も書式のみで**期間長に上限がない**。正本 `docs/context/db-row-limits-and-data-truncation.md` が「`items.length >= limit` での検知は不可。必ず `count:'exact'` の総件数と比較する」と定めるとおり、現状は打ち切りを検知する手段がない。<br>ただし現行のページサイズは `app/analytics/page.tsx:59` で**10件固定**であり、**100日までは 1,000行に到達しない**（10記事 × 100日 = 1,000行）。一方で一覧の期間には上限がないため、**101日以上を指定すれば到達しうる**（§11）。**対処方式は D4 で確定した（2026-08-17。(b)＋(d) 併用）**: 一覧の表示期間に**上限100日**を追加し（10記事 × 100日 = 1,000行 ≦ `db-max-rows`。上限超過の指定は AC-13 シナリオ4のとおり丸めるか明示する）、あわせて `count:'exact'` 突合による検知（(b)）を安全弁として実装する。
5. データ期間、最終取込日時、最小データ条件（**期間合計 `sessions ≥ 30`**。BR-08）を確認する。条件を満たす記事はスコア算出へ、満たさない記事は「データ蓄積中」（`R_LOWDATA`）で打ち止める。
6. 実行順序は **算出（コード）→ スコア・診断の保存 → 文章化（LLM）→ 文章の保存** とする。LLM はスコア確定後にのみ呼ばれ、判定に関与しない。

フェーズ2では、フェーズ0で分離した評価用Context組立境界を利用する。`analyticsContentService`の内部実装や具体的な新規ファイル名を評価サービスから直接参照しない。

### 6.2 評価エンジン（コード算出。正本: 評価エンジン仕様 §02〜§05）

**点数・診断コードはコードで決定的に算出する（2026-08-17 反転。旧「固定ルールで算出しない」方針は失効）。**すべて純関数として実装し、境界値テストで固定する（§13）。定数（アンカー値・500字/分・画像補正3秒・足切り30セッション）は受領仕様を正本としてコード定数化し、変更時は `scoring_config_version` を上げる（§7.3）。

#### 6.2.1 計算式

```text
期待読了時間（分） = 正規化後の本文文字数 ÷ 500          # 500字/分＝日本語の平均的な黙読速度
期待読了時間 += 画像点数 × 3秒                            # 原文「画像・表が多い記事は…で補正」。実装は無条件加算（画像0点なら補正0で同値。wp_image_count。§4.1.1）

平均エンゲージメント時間（秒） = userEngagementDuration ÷ activeUsers
    # GA4「ページとスクリーン」の平均エンゲージメント時間と同じ定義（§16）
    # averageSessionDuration は使わない（GA4画面と数値が合わなくなる）
    # 分母は ÷activeUsers で確定（Q-G 実測決着 2026-08-17。旧 ÷sessions フォールバックは廃止）

読了率 = 平均エンゲージメント時間 ÷ (期待読了時間 × 60)
読み始め率 = GA4 engagementRate（landingPage 軸の期間セッション加重平均）をそのまま使用
完読率（任意・精度向上用） = scroll_90_event_count ÷ sessions
```

#### 6.2.2 スコア（アンカー線形補間）

比率をそのまま100倍せず、基準値に点数を固定して間を線形補間する（「60点＝合格ライン」の意味を2指標で揃える）。点数帯の意味は全指標共通: **0-19 深刻 / 20-39 要改善 / 40-59 改善の余地あり / 60-79 合格ライン / 80-100 良好**。

```text
ANCHORS_READ   = [(0.00, 0), (0.06, 20), (0.12, 40), (0.20, 60), (0.30, 80), (0.50, 100)]
ANCHORS_ENGAGE = [(0.00, 0), (0.30, 20), (0.40, 40), (0.50, 60), (0.60, 80), (0.80, 100)]
# 下限以下は 0、上限以上は 100 で頭打ち。区間内は線形補間して round する（受領仕様の score() を移植）
```

#### 6.2.3 コンテンツ力スコア（幾何平均）

`コンテンツ力スコア = round(√(読了スコア × 読み始めスコア))`（round は開発側の追加。原文は √ のみだが、原文の例示値 100×20→45 は丸め後の値であり整合する）。算術平均ではなく**幾何平均**を使う（訪問→読み始め→読了は掛け算の連鎖であり、算術平均だと片肺型＝弱点を抱えたページがバランス型と同点に並ぶ。例: 100×20 は算術60・幾何45）。

#### 6.2.4 診断マトリクス（6コード）

診断コードは読み始めスコア×読了スコアの格子でコードが確定する。分岐は点数のみで行う。

| | 読み始め 0-59 | 読み始め 60-79 | 読み始め 80-100 |
|---|---|---|---|
| **読了 80-100** | `R_MISMATCH` ミスマッチ型 | `R_GOOD` 良好（次はCTA検証） | `R_GOOD` 良好（広告出稿・横展開のモデル） |
| **読了 60-79** | `R_MISMATCH` ミスマッチ型 | `R_GOOD` 良好（CTA検証へ） | `R_GOOD` 良好（CTA検証へ） |
| **読了 40-59** | `R_TOP_EXIT` 冒頭離脱型 | `R_SKIM` 拾い読み型 | `R_SKIM` 拾い読み型 |
| **読了 0-39** | `R_TOP_EXIT` 冒頭離脱型 | `R_MID_EXIT` 途中離脱型 | `R_MID_EXIT` 途中離脱型 |

両方60未満は書き出しから着手する（読み始めてもらえないページの本文を直しても効果が測定できない。既存アラートの「工数の小さい順」と一致）。診断コードと既存アラートの対応: `R_TOP_EXIT`＝2. 書き出し、`R_MISMATCH`＝1. タイトル・説明文、`R_MID_EXIT`＝3. 目次構成、`R_SKIM`＝3. 目次構成（軽度）、`R_GOOD`＝改善不要（CTAへ）、`R_LOWDATA`＝データ蓄積中（判定保留）。

**完読率（scroll）を併用する場合（原文正本の原則で 2026-08-17 改訂）:** (1) 完読率 15% 未満かつ読了スコア 40 未満は、診断コードを `R_TOP_EXIT`（冒頭離脱型）で**確定**する — マトリクス判定が `R_MID_EXIT` になるセル（読み始め60以上×読了0-39）でも**上書き**する（原文「冒頭離脱型で確定」に従う）。(2) 完読率 40% 以上かつ読了スコア 40 未満は、追加診断「**流し読み型**」（最後まで見たが読んでいない。求める情報が見つかっていない→結論の位置を前に出す）を付加する — こちらは診断コードを変えず、記事カード表示の補助ラベルとする（ユーザープロンプトは verbatim 登録で追加変数を設けないため LLM へは渡さない。scroll 実測値自体は既存変数 `scroll_users` / `scroll_rate` で渡っている）。どちらも `scroll_rate` を履歴に保存するため（§7.3）決定的に再導出できる。完読率が取得できない場合（Q-I）は本併用自体を行わず、マトリクス判定のみとする。

#### 6.2.5 足切り

期間合計 `sessions < 30` の記事はスコア・診断を算出せず「データ蓄積中」（`R_LOWDATA`）とする（BR-08。少数セッションで滞在10分と出て優良記事と誤判定する事故を防ぐ）。

#### 6.2.6 LLM の役割（文章化のみ）

実装側の責務:

- 指標と記事情報を正規化し、スコア・診断コードを算出・保存する（上記）。
- 欠損値とデータ期間を明示する。
- **算出済みの判定結果のみ**をユーザープロンプトへ渡す（§6.3.3）。システムプロンプトとユーザー入力を分離する。
- LLM の5フィールド出力をスキーマ検証する（§6.3.4）。LLM 出力から点数・判定を取り込まない（BR-09）。
- 不正な出力、タイムアウト、APIエラーは**文章化の失敗**として保存する。スコア・診断は保存済みのまま残す（部分成功。§6.5）。

### 6.3 LLM入力契約

#### 6.3.1 システムプロンプト

- 保存先: `prompt_templates` の GA4 評価用テンプレート。
- LLM へのロール: `system`。
- バージョン追跡: 評価履歴に `prompt_template_id`、既存 `prompt_versions(id)` への参照（`prompt_version_id`）、`version`、更新日時、プロンプト本文のSHA-256を保存する（§7.3）。`prompt_versions` は `supabase/migrations/20250701000000_create_prompt_templates.sql` で**既に存在する**ため新規テーブルを作らない。`prompt_templates` / `prompt_versions` 側への**ハッシュ列追加も行わず**、hashは評価履歴側で保持する。
- 内容: **確定済み（2026-08-17 受領）**。`docs/context/ga4-evaluation-engine-spec-20260817.md` §07「システムプロンプト」の本文を verbatim で登録する。役割は**文章化のみ**（読者前提: GA4 用語禁止・人数と時間で語る／書き方: 断定・次の一手は1つ・全体200字以内／点数帯と診断コードの意味／JSON のみ出力）。点数・診断の判定ルールはプロンプトに持たせない（コード側が正本。BR-09）。
- 登録経路: **既存の `/admin/prompts` 画面から admin が手動登録する**（migration の seed にはしない。プロンプト本文はクライアント著作物でありコードと別ライフサイクルで改版されるため）。既存画面は汎用一覧のため改修不要（§10.1）。登録タイミングは §14 手順（Kill Switch 有効化の前）。テンプレート未登録時の評価実行は、スコア算出は行い**文章化のみ失敗**として扱う（§6.5 部分成功）。

#### 6.3.2 Context Assembly Contract

LLM へ渡すのは**算出済みの判定結果と少量の記事情報のみ**（評価エンジン仕様 §07 のユーザープロンプト変数がそのまま契約）。記事本文の全文・GSC 集計・CV 定義・生の日次推移は渡さない（旧設計 2026-08-17 失効。入力が小さくなったため本文系 80,000 文字予算の議論も失効）。

| # | 入力要素 | 取得経路 | 注入条件 | ログ/禁止 |
|---|---|---|---|---|
| 1 | 記事情報（タイトル・URL・本文文字数・H2見出し最大10個・公開日・最終更新日） | `content_annotations`（`wp_post_title` / `canonical_url` / 正規化後文字数 / `extractBasicStructureFromHtml` 由来の見出し / 日付） | 常時 | 本文全文は注入しない |
| 2 | 計測期間（from / to / 日数） | 評価入力 Context | 常時 | — |
| 3 | 計測結果（訪問した人数・読み始めた人数と率・実際に読まれた平均時間・読み切りに必要な時間・読了率・最後までスクロールした人数と率） | スコア算出エンジンの中間値（§6.2.1） | 常時 | 生 API レスポンス全文は注入しない |
| 4 | 評価（コンテンツ力スコア・読み始めスコア・読了スコア・診断コード・サイト内順位・前回差分） | スコア算出エンジンの確定値＋順位・差分算出（§6.4） | 常時 | 「この点数と判定を覆さないこと」の指示を維持する |
| 5 | システムプロンプト | `prompt_templates.content`（§6.3.1） | テンプレート有効時 | アクセストークン・Service Role キーを注入しない |

#### 6.3.3 ユーザープロンプト変数（確定）

テンプレートは評価エンジン仕様 §07「ユーザープロンプト（変数埋め込み）」を verbatim で登録し、`PromptService.replaceVariables`（`{{key}}` 形式）で展開する。変数一覧:

| 変数 | 値の出所 |
|---|---|
| `title` / `url` / `char_count` / `headings` / `published_at` / `updated_at` | 記事情報（上表 #1。`headings` は H2 のみ最大10個の配列） |
| `date_from` / `date_to` / `days` | 計測期間 |
| `sessions` / `engaged_users` / `engagement_rate` / `avg_time_display` / `expected_time_display` / `read_rate` / `scroll_users` / `scroll_rate` | 計測結果（`engaged_users` = engagementRate × sessions の丸め、`scroll_users` = scroll_90_event_count 実測。**実測が取れない場合は人数を出さず率のみで表現する**＝評価エンジン仕様 §08 の禁則） |
| `content_score` / `engage_score` / `read_score` / `diagnosis_code` | スコア算出エンジンの確定値 |
| `rank_in_site` / `total_articles` | サイト内順位（§6.4） |
| `content_score_diff` / `engage_score_diff` / `read_score_diff` | 前回差分（直前の成功履歴との差。初回は「初回計測」を示す値を渡す。§7.3） |

LLM へアクセストークン、個人情報、不要な生ログ、記事本文の全文を渡さない。

#### 6.3.4 出力契約（確定。2026-08-17 受領）

```json
{
  "headline": "この記事の状態を一言で。20字以内。体言止め",
  "situation": "いま何が起きているか。人数と時間で説明する。80字以内",
  "cause": "なぜそうなっているか。記事の構成や見出しに触れて具体的に。80字以内",
  "next_action": "次にやること1つ。今日着手できる作業レベルまで具体化。60字以内",
  "target": "その作業で狙う変化。点数目標を1つ含める。40字以内"
}
```

**5フィールドすべて必須の文字列。**`score` / `pattern` に相当するフィールドは**存在しない**（点数・診断はコード側が正本で、LLM 出力からは取り込まない。BR-09。旧ドラフトの `score`/`pattern`/`evidence[]`/`recommendations[]` 契約は 2026-08-17 に失効）。実装では Zod で5フィールド＋文字数上限を検証し、検証失敗時は文章を保存せず「文章生成失敗」とする（スコアは保存済みのまま。§6.5）。

**出力形式の要件（原文正本の原則で 2026-08-17 改訂）:** システムプロンプトは verbatim 登録であり（§6.3.1）、原文は「出力は指定のJSON形式のみ」とだけ要求して ```json フェンスを要求していない。**プロンプト本文へフェンス要求を追記しない。**代わりに抽出実装側を両対応にする: `contentAnnotationSummaryService.ts` の `JSON_BLOCK_REGEX`（フェンス必須・フォールバックなし）はそのまま流用せず、評価用の抽出は (1) ```json フェンスブロックがあればそれを優先、(2) なければ応答文字列から最初の JSON オブジェクトを抽出してパースする。両経路とも Zod の5フィールド検証（上記）を通す。

### 6.4 点数の周辺算出（サイト内順位・前回差分・メディア全体スコア）

点数の算出根拠・上限下限・データ不足時の扱いは §6.2 でコード側に確定した（旧「プロンプトで確定する」は 2026-08-17 失効）。クライアント文脈 §1.9.2 の「70点以下の一覧化」は Q2 回答（2026-08-16「なくていい」）により実装しない。点数閾値による UI フィルタは持たない（順位・散布図が分布の把握を担う）。

- **サイト内順位**: 当該ユーザーの評価済み記事（`R_LOWDATA` 除く）をコンテンツ力スコア降順に並べた順位。`{{rank_in_site}} / {{total_articles}}` として LLM 入力と記事カードに使う。算出は一覧ページングと独立した集計経路（`fetchGa4DashboardRanking` の記事別集計を流用。§5.1）で行う。同点は同順位（DENSE_RANK 相当）とする。
- **前回差分**: 直前の成功履歴（`last_success_history_id` の1つ前ではなく、**今回実行の直前に成功していた履歴**）とのコンテンツ力・読み始め・読了スコアの差分。履歴から都度導出し、専用列は持たない（§7.3）。初回評価は差分なしとして扱う。
- **メディア全体スコア**（評価エンジン仕様 §06）: `資産価値スコア = 全記事のコンテンツ力スコアの単純平均`、`実効スコア = セッション数で重み付けした加重平均`。**実効 > 資産価値**＝良い記事に流入が集中（健全。打ち手: 低スコア記事の整理）、**実効 < 資産価値**＝悪い記事に流入が集中（危険。打ち手: 流入上位の低スコア記事を最優先で改善）。保存せず表示時に集計する（対象は評価済み記事。表示先は §10.6）。あわせて全記事の散布図（横軸=読み始めスコア、縦軸=読了スコア、点の大きさ=セッション数）を出す。

### 6.5 評価状態

最低限、次の状態を持つ。

| 状態 | 意味 |
|---|---|
| `unassessed` | 評価履歴がなく、評価可否をまだ判定していない表示上の状態。DBには永続化しない |
| `eligible` | 評価履歴がないが、表示時のデータ品質判定で必要データが揃っている表示上の状態。DBには永続化しない |
| `low_data` | 期間合計 `sessions < 30` で評価対象外（「データ蓄積中」。BR-08 / `R_LOWDATA`）。**DBには永続化せず**、取込済みデータから表示時に導出する（データが貯まれば自動解消する状態のため。評価開始はこの状態では拒否する） |
| `evaluated` | 最新評価（スコア・診断・文章）が利用可能 |
| `narrative_failed` | **スコア・診断は算出・保存済みだが、文章化（LLM）に失敗**（部分成功。文章のみ再試行できる） |
| `insufficient_data` | スコア算出に必要な指標が欠損（例: `engagement_rate` 未取込期間。`low_data` とは別＝BR-08） |
| `import_failed` | 外部API取込に失敗 |
| `needs_reauth` | Google連携の再確認が必要。**DBには永続化せず、既存実装（`ga4-status.ts` / `gsc-status.ts`）と同じく読み取り時に導出する**表示上の状態 |
| `evaluation_failed` | スコア算出・保存の過程で失敗（文章化以前の失敗） |
| `evaluating` | 評価処理中（手動実行中） |

欠損値を`0`に変換して評価を続行しない。新しい評価に失敗した場合、既存の正常な評価結果と履歴を上書きしない。

状態は永続と非永続に分ける。**`needs_reauth` を永続化してはならない。**既存実装では `needsReauth` は DB列ではなく読み取り時に導出される（`src/server/lib/ga4-status.ts`、`gsc-status.ts`）。永続化すると、再連携に成功しても `status` が `needs_reauth` のまま残り、§10.4 の操作制限（評価開始を無効化）により評価できず、評価しないと `status` が更新されないというデッドロックになる。

| 区分 | 状態 | 導出元 |
|---|---|---|
| 永続（`ga4_content_evaluations.status`） | `evaluated` / `narrative_failed` / `insufficient_data` / `import_failed` / `evaluation_failed` / `evaluating` | 評価実行の結果 |
| 非永続（表示時に導出） | `unassessed` / `eligible` / `low_data` | 評価履歴の有無とデータ品質判定（`low_data` は期間合計 sessions の判定。BR-08） |
| 非永続（表示時に導出） | `needs_reauth` | Google連携状態（`ga4-status.ts` / `gsc-status.ts`） |
| 非永続（表示時に被せる） | Kill Switch停止中 | `ga4_content_evaluation_settings.enabled` |

表示優先順位は 上から Kill Switch停止中 → `needs_reauth` → `evaluating` → 永続状態 →（履歴なしの場合）`low_data` → `eligible` / `unassessed` とする。再連携が成功すれば `needs_reauth` は次の描画で自動的に解消し、直前の永続状態（`evaluated` 等）が表示される。

`unassessed` / `eligible` の導出責任は次のとおり分ける。大量一覧で記事ごとの追加クエリを発生させない。

- 一覧（`/analytics`）: 一覧RPCが永続状態・最後の成功結果（コンテンツ力スコア・診断コード・最終評価日時）・`unassessed` の別を返す。**`eligible` / `low_data` は一覧では導出しない**（記事ごとのデータ品質判定・セッション集計をSQL内で行わないため）。評価履歴がなければ一律 `unassessed`（表示は「未評価」）とする。
- 記事詳細（評価UI）: 評価履歴がない記事について、その場でデータ品質とセッション数を判定し `unassessed` / `eligible` / `low_data` を区別する。**詳細画面の `unassessed` は「評価履歴がなく、かつ必要データが不足している」状態を指す**（データが揃っていれば `eligible`、揃っていてもセッション30未満なら `low_data` になるため）。

したがって同じ `unassessed` でも一覧と詳細で母集合が異なる。一覧で「未評価」と表示された記事を開くと、詳細では「評価可能」または「未評価（データが不足）」のどちらかに分かれる。**ユーザー向け表示を同一文言にしない**（§10.4）。

| 画面 | `unassessed` の意味 | ユーザー向け表示 |
|---|---|---|
| 一覧 `/analytics` | 評価履歴がない（データ品質は判定しない） | 未評価 |
| 記事詳細タブ | 評価履歴がなく、必要データも不足 | 未評価（データが不足） |

評価開始・stale回復・完了・失敗はDB RPCで原子的に行い、同じ `evaluation_run_id` を条件に古い実行が新しい評価を上書きできないようにする。

## 7. データ設計（案）

### 7.1 新規テーブルの役割

テーブル名は以下で固定する。`ga4_content_evaluations` は評価結果そのものではなく、記事ごとの現在状態を持つprojectionとする。

- `ga4_content_evaluations`: 記事ごとに1行。評価状態、実行中のrun、最後に成功した履歴への参照を持つ。評価本文・JSONの正本は持たない。
- `ga4_content_evaluation_history`: 評価実行1回につき1行。成功・失敗・staleを含む全runのスナップショットを保存する。terminal状態になった行は原則不変とする。
- `ga4_content_evaluation_settings`: Kill Switchを管理する単一行設定。`id smallint`（常に1）、`enabled boolean`（デフォルトfalse）、`updated_at`、`updated_by uuid nullable`を持つ。MVPでは設定画面を追加せず、許可された運用手順または管理者専用経路から更新する（運用手順は README の「GA4コンテンツ評価の運用」および §14。2026-08-19 に管理画面 `/admin/ga4-evaluation` を一度追加したが、既存の全体キルスイッチが env 方式であり `/admin` 配下がマスタデータ編集に統一されている設計と揃わないため撤回した。§18）。

GA4評価の改善提案はMVPでは既存のGSC未読通知・`unread_suggestion`フィルタへ統合しない。GA4評価用の既読管理・通知は別仕様とする。

### 7.2 現在状態テーブル `ga4_content_evaluations`

- `id` (`uuid`, PK)
- `user_id` (`uuid`, NOT NULL, FK → `public.users(id)` ON DELETE CASCADE)
- `content_annotation_id` (`uuid`, NOT NULL, FK → `public.content_annotations(id)` ON DELETE CASCADE)
- `status` (`text`, NOT NULL, CHECKで状態を限定)
- `active_run_id` (`uuid`, nullable。評価中のみ設定。`ga4_content_evaluation_history.evaluation_run_id`を参照)
- `last_success_history_id` (`uuid`, nullable。最後に成功した履歴を参照。履歴削除時はNULL化)
- `last_success_evaluated_at` (`timestamptz`, nullable)
- `evaluation_started_at` (`timestamptz`, nullable。stale判定の正本)
- `lease_expires_at` (`timestamptz`, nullable。DB時刻で15分TTLを管理)
- `last_error_code` (`text`, nullable)
- `last_error_message` (`text`, nullable。ユーザー表示可能なsanitized値のみ)
- `created_at`, `updated_at` (`timestamptz`)

スコア（読了・読み始め・コンテンツ力）、診断コード、文章5フィールド、期間、データ品質は `last_success_history_id` から履歴を取得する。一覧RPCでは最後の成功履歴をJOINして、コンテンツ力スコア・診断コード・最終評価日時を返す。現在の失敗状態と過去の成功結果を同じ列群へ混在させない。**前回差分（§6.4）は履歴の時系列から都度導出し、専用列を持たない。**

`content_annotations.user_id` は既存仕様上 `text`、新規テーブルの `user_id` は `uuid` FKとする。型をまたぐため、評価テーブルへのINSERT/UPDATE時に、DB triggerで `content_annotations.user_id = NEW.user_id::text` を検証する。

**所有者境界の一次防衛線はアプリケーション層の明示スコープである。** 本機能の実行経路は §7.5 のとおり `SupabaseService`（Service Role）経由であり、`.agents/skills/supabase/rls.md` が「`SupabaseService` 経由の Server Action / Route Handler は Service Role Client を使用するため、RLS は適用されません」と定めるとおり、§7.5 の RLS ポリシーはこの経路では評価されない。したがって次のように責任を分ける。

| 操作 | 一次防衛線 | 補助 |
|---|---|---|
| INSERT / UPDATE | DB trigger（`content_annotations.user_id = NEW.user_id::text`） | アプリ層の `.eq('user_id', userId)` |
| SELECT / DELETE | **アプリ層の `.eq('user_id', userId)` と対象記事IDの明示指定**（trigger は INSERT/UPDATE のみで発火せず、この経路を守らない） | RLS（anon / session 経路への多層防御としてのみ機能） |

**MVP では DELETE 経路をアプリケーションに実装しない**（§3.3）。行が消えるのはユーザー削除時の `ON DELETE CASCADE` のみである。上表と §7.5 の DELETE に関する記述は、将来 DELETE を提供する場合に備えた多層防御の設計であり、MVP に削除操作が存在することを意味しない。

`.eq('user_id', userId)` を省略してはならない（`.agents/skills/supabase/service-usage.md`「RLS が効かないため、アプリケーション層での明示的な ID チェックを省略してはなりません」）。SELECT / DELETE の所有者検証は §8.1 の評価サービスおよび一覧RPC呼び出し側の責務とする。

migration前に既存 `content_annotations.user_id` がUUID文字列表現であることを確認し、違反行がある場合は評価テーブルの適用を停止する（手順は §14 リリース順序、テストは §13 DBテスト）。

### 7.3 履歴テーブル `ga4_content_evaluation_history`

履歴は成功・失敗・staleを含む論理評価runごとに1行保存する。LLMの再試行は同じrun内の `attempt_count` で記録し、stale回復時は旧runを失敗履歴として確定して新しいrunを作成する。

- 識別・所有: `id uuid PK`、`evaluation_run_id uuid NOT NULL UNIQUE`、`user_id uuid NOT NULL FK → public.users(id) ON DELETE CASCADE`、`content_annotation_id uuid NOT NULL FK → public.content_annotations(id) ON DELETE CASCADE`
- 状態・時刻: `status NOT NULL`、`started_at`、`completed_at`、`attempt_count NOT NULL DEFAULT 0`
- 結果（コード算出。2026-08-17 全面再設計）: 生値 `read_rate numeric` / `engage_rate numeric` / `scroll_rate numeric nullable`、スコア `read_score integer` / `engage_score integer` / `content_score integer`（いずれも `CHECK (0 <= x AND x <= 100)`。**即時確定**）、`diagnosis_code text`（`CHECK IN ('R_TOP_EXIT','R_MISMATCH','R_MID_EXIT','R_SKIM','R_GOOD')`。`R_LOWDATA` は評価を開始しないため履歴に現れない）、`site_rank integer` / `total_articles integer`（評価時点のスナップショット）、算出材料のスナップショット `sessions integer` / `char_count integer` / `image_count integer nullable` / `expected_read_seconds integer` / `avg_engagement_seconds numeric`
- 結果（LLM 文章。5フィールド契約 §6.3.4）: `narrative_json`（`headline` / `situation` / `cause` / `next_action` / `target`。`narrative_failed` 時は NULL）
- データ品質: `data_quality_json`（サービス層が組み立てた**入力側**のデータ品質。完読率の追加診断・部分取得フラグ・`wp_image_count` 未取得などを含む）
- 対象: `period_start`、`period_end`、`canonical_url_snapshot`、`title_snapshot`
- データ追跡: `ga4_property_id`、`ga4_data_fetched_at`、`context_schema_version`、`input_fingerprint`、**`scoring_config_version integer NOT NULL`**（アンカー値・定数セットのバージョン。§6.2 の定数を変更したら上げる。点数の再現性はプロンプトではなくコード＋定数に依存するため、プロンプト追跡と並列に持つ）
- プロンプト追跡: `prompt_template_id uuid`、`prompt_version_id uuid`（いずれもnullable、`prompt_versions(id)`への参照は`ON DELETE SET NULL`）、`prompt_version integer`、`prompt_captured_at timestamptz`、`prompt_content_sha256 text`
- 失敗: `error_code`、`error_message`（APIキー、トークン、生レスポンス、プロンプト本文を含まないsanitized値）
- 監査: `created_at`、`updated_at`

`period_start <= period_end`、terminal状態では`completed_at IS NOT NULL`、`evaluated`ではスコア・診断・文章の全項目、`narrative_failed`ではスコア・診断項目が存在することを制約または保存処理で保証する。（2026-08-17 更新: 旧 `pattern` 4値 CHECK は評価エンジン仕様により `diagnosis_code` 5値 CHECK へ置換。スコアの 0〜100 CHECK は上記のとおり即時確定した。）

既存の `prompt_versions` を評価時点のバージョン識別に利用する。履歴はプロンプト削除で失われないよう、履歴側の参照は `ON DELETE SET NULL` とし、version・取得時刻・本文hashを別途保存する。

- `prompt_content_sha256` は **システム／ユーザー2本のテンプレート原文（変数展開前）を `system` → NUL(U+0000) → `user` の順に連結した UTF-8 バイト列に対する SHA-256 を小文字 hex** で保存する（2026-08-19 変更。片方だけを hash するともう片方の改版が履歴に残らず再現できないため。NUL は PostgreSQL の text に格納できず本文と衝突しない）。`prompt_template_id` / `prompt_version_id` / `prompt_version` はシステム側テンプレートを指す。変数展開後の実送信文字列は保存もハッシュもしない（記事ごとに変わりバージョン追跡にならないため）。
- `prompt_versions` の実列は `id, template_id, version, content, change_summary, created_by, created_at` であり **`updated_at` は存在しない**（`20250701000000_create_prompt_templates.sql:17-25`）。よって更新日時は保存せず、評価がそのテンプレートを読み出した時刻を `prompt_captured_at` として記録する。

### 7.4 制約・インデックス

- `(user_id, content_annotation_id)`に現在状態の一意制約を設ける。
- `(user_id, content_annotation_id, evaluation_run_id)`に履歴の一意制約を設ける。`evaluation_run_id`単体にも一意制約を設ける。
- 現在状態: `(user_id, status, updated_at DESC)`、`evaluating`用の部分インデックス、`content_annotation_id`参照用インデックス。
- 履歴: `(user_id, content_annotation_id, created_at DESC)`、`evaluation_run_id`検索用インデックス。
- `updated_at`は自動更新triggerで更新する。terminal履歴の直接UPDATEは許可せず、評価状態変更は専用RPC経由にする。
- JSONは表示用に保存し、一覧の検索・絞り込みに使う値は履歴の通常列または一覧RPCのJOIN結果として扱う。
- `ga4_content_evaluation_settings` は `id smallint PRIMARY KEY CHECK (id = 1)` とし、migration適用時に`id=1, enabled=false`を作成する。行がない場合も安全側で停止する。

### 7.5 RLS・アクセス制御

**本機能の実行経路では RLS はバイパスされる。** Server Action / Route Handler は `SupabaseService`（Service Role）経由でアクセスするため、下記の RLS ポリシーは評価されない（`.agents/skills/supabase/rls.md`）。RLS は anon / session 経路からの直接アクセスに対する多層防御として設定する。**所有者境界の一次防衛線は §7.2 のアプリケーション層の明示スコープと DB trigger である。**

- 評価結果・履歴テーブルはRLSを有効化し、SELECT/INSERT/UPDATE/DELETEすべてで `user_id = (SELECT auth.uid())` の**自己参照のみ**を許可する（Instagram 系テーブルと同型。`20260808000000_simplify_instagram_credentials_select_policy.sql`）。**MVP ではアプリケーションから DELETE を実行しないため、DELETE ポリシーは将来の多層防御として置くものである**（§3.3 / §7.2）。オーナー/スタッフ共有モデルは廃止済みのため（§3.3）、`get_accessible_user_ids` を評価機能へ持ち込まない（同関数は旧テーブルのRLSに残存するのみで、新規テーブルでは使わない）。
- 各評価テーブルで `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` を実行し、`PUBLIC`、`anon`、`authenticated`への不要なtable権限をREVOKEする。Server Action/Route Handlerは`SupabaseService`経由でアクセスし、必ず対象`user_id`と記事IDを明示する。
- `ga4_content_evaluation_settings` は直接のSELECT/INSERT/UPDATE/DELETEを`PUBLIC`、`anon`、`authenticated`に許可しない。Service Roleまたは明示的に認可された管理者経路だけが扱う。`updated_by`はService Roleの`auth.uid()`がNULLになり得るため、呼出し元で検証済みの管理者IDを明示的に保存する。
- `start_ga4_content_evaluation`、`finish_ga4_content_evaluation`等のRPCは`SECURITY DEFINER`またはService Role専用経路とし、`SET search_path = public`、テーブルのスキーマ修飾、`auth.role() = 'service_role'`検証、`PUBLIC`/`anon`/`authenticated`からのEXECUTE REVOKE、`service_role`へのGRANTを行う。
- migrationにはロールバック用の`DROP POLICY`、権限戻し、テーブル・インデックス・trigger・RPC削除手順をコメントで残す。

### 7.6 データの所有者・保持期間・削除条件

`docs/templates/requirement-definition.md` §8「データ」に相当する。

| 項目 | 内容 |
|---|---|
| 作成・更新・削除するデータ | `ga4_content_evaluations`（記事ごとの現在状態）、`ga4_content_evaluation_history`（run ごとの履歴）、`ga4_content_evaluation_settings`（Kill Switch 単一行） |
| データの所有者 | `user_id` の GrowMate ユーザー（自己参照のみ、§7.5）。設定行は運用者 |
| 保持期間 | **MVP では評価結果・履歴に保持期間の上限を設けない**（無期限保持）。ロールバック時も削除しない（§14）。件数増加時の削除・アーカイブ方針は別チケットとする |
| 削除条件 | ユーザー削除・記事削除に伴う `ON DELETE CASCADE` のみ。利用者・管理者向けの削除操作は提供しない（§3.3）。terminal 履歴の直接UPDATEも許可しない（§7.4） |
| 既存データとの互換性 | 評価テーブルは新規のみ。追加指標の取込（確定済み）は `ga4_page_metrics_daily` への列追加を伴い、既存行は §4.1.2 の決定（2026-08-18）どおり過去90日の再取込で埋める |
| ユーザー境界 | §7.2 のアプリ層明示スコープと DB trigger が一次、RLS が補助（§7.5） |

## 8. 評価実行フロー

```text
記事一覧（/analytics, get_filtered_content_annotations）
  -> 評価対象・データ期間を決定
  -> GA4データ（fetchGa4Summaries 相当）と記事情報（wp_content_text / wp_image_count）を狙い撃ち取得
  -> データ品質を検証（sessions >= 30 の足切りを含む。BR-08）
  -> [コード] 読了率・読み始め率 -> アンカー補間 -> 幾何平均 -> 診断マトリクス（§6.2）
  -> サイト内順位・前回差分を確定し、スコア・診断を履歴へ保存
  -> [LLM] システムプロンプト + 算出済み変数（§6.3.3）を送信し、5フィールドJSONを検証（Zod）
  -> 文章を保存（失敗時は narrative_failed。スコアは保存済みのまま）
  -> 画面へ表示
```

### 8.1 手動評価の実行設計

Server ActionまたはRoute Handlerから単記事評価を実行する。評価対象の決定、データ品質確認、LLM呼び出し、最新状態・履歴保存を1記事単位で行う。開始処理は複数のSupabase呼び出しで代用せず、`start_ga4_content_evaluation` RPCで原子的に行う。RPCは対象行を`FOR UPDATE`でロックし、`(user_id, content_annotation_id)`ごとに実行中runが1件だけになること、記事所有者が一致すること、Kill Switchが有効であることを同一トランザクション内で確認する。評価行がない場合の作成、履歴の`evaluating`行作成、`active_run_id`設定、`evaluation_run_id`生成もRPC内で行う。

`lease_expires_at` が現在時刻を過ぎている実行は stale とみなし、`start_ga4_content_evaluation` RPCが旧runを`evaluation_failed`・`error_code='evaluation_stale'`として履歴に確定してから、新しい`evaluation_run_id`を発行する。TTLは開始時刻から15分とする。`finish_ga4_content_evaluation` RPCは開始時の`evaluation_run_id`が現在の`active_run_id`と一致する場合だけ完了・失敗を保存する。これにより、プロセス異常終了後の固着と、古い実行による結果上書きを防ぐ。

手動評価の実行経路は `maxDuration=180秒`、LLM 1回あたりのタイムアウトは45秒、試行回数は初回を含めて最大3回、試行間隔は2秒とする（スコア算出はコードのみで完了するため、LLM 予算は文章化1回分。入力は §6.3.3 の変数のみで小さく、`maxTokens` は5フィールド200字強＋JSON構造分で足りる）。`llmChat` の既定は `timeoutMs ?? 300000`（5分）・`maxTokens ?? 3000` でいずれも呼出し側が上書き可能なため、**`timeoutMs: 45000` と `maxTokens` を明示的に渡す**。既定のままでは45秒制約が効かず `maxDuration` を超える。実装するRPCは単記事用の開始・完了2本のみで、定期Cron、複数記事用の`FOR UPDATE SKIP LOCKED` claim RPC、ジョブキューは対象外とする（§3.2）。Kill Switchを実行開始時に確認し、実行中のrunは強制キャンセルせず、完了結果の保存だけを許可する。

**部分成功の遷移:** スコア・診断の保存後に文章化が3回失敗した場合、`finish_ga4_content_evaluation` は `status='narrative_failed'` で確定する（スコアは成功履歴として `last_success_history_id` の対象になる）。文章のみの再試行は同一記事への通常の再評価として扱う（スコアは再算出されるが決定的なので同一入力なら同値になる）。

コスト上限は設けない（Q8 回答 2026-08-16「開発側既定」。文章化のみのため1評価あたりの消費は旧設計より小さい。§11）。

### 8.2 Kill Switch（外部依存停止）

既存の feature flag 基盤は存在しない（`src/lib/constants.ts` の「Feature Flags」は AI モデル設定用）。MVPでは専用の `ga4_content_evaluation_settings` テーブルを使用し、DBの`enabled`をKill Switchとする。環境変数は使わない。

| DB設定 | 意味 | 停止時 UI |
|---|---|---|
| 行なし / DB読取失敗 | **停止**（安全側。未設定 = 未有効化） | 記事詳細の「コンテンツ評価」タブに「評価機能は現在停止中です」を表示し、評価・再評価を無効化する。`/analytics` 一覧は評価状態を停止中として表示する（一覧に評価実行ボタンは置かない）。文言と操作制限は §10.4 を正本とする |
| `enabled=false` | **停止** | 同上 |
| `enabled=true` | 評価実行を許可（ロール `admin`/`paid` は別途必須） | 通常表示 |

**判定ロジック:** 各評価リクエストで `ga4_content_evaluation_settings.enabled IS TRUE` を確認した場合のみ許可する。設定変更は次のリクエストから反映し、アプリの再デプロイを必要としない。DB読取失敗時も評価APIは実行しない。

**表示の合成規則:** Kill Switch の判定はページ側のデータ取得で1回だけ読み、画面表示に被せる。**一覧RPCは `ga4_content_evaluation_settings` を参照しない。** 停止中は評価状態列のみ「停止中」に上書きし、スコア・診断・最終評価日時は保存値をそのまま表示する。`evaluating` と停止中が同時に成立する場合は §6.5 の優先順位に従い停止中を優先する。

**Kill Switch は評価処理だけを止め、既存の取込経路は止めない**（§14 ロールバックと整合）。既存取込の実態は次のとおり（2026-08-14 実測）。

| 取込 | 起動経路 | Kill Switch の影響 |
|---|---|---|
| GSC 取込 | `app/api/cron/gsc-evaluate`（`gscEvaluationService.ts:81` 経由で間接実行）。スケジューラは `.github/workflows/hourly-cron.yml`（`vercel.json` は存在しない） | 停止しない |
| GA4 取込 | **Cron は存在しない。** `ga4ImportService` の呼出は `app/api/ga4/sync/route.ts` のユーザー起動 POST のみ | 停止しない |

`app/api/cron/` に存在するのは `gsc-evaluate` / `gsc-suggestions` / `google-ads-negative-keywords-suggestion` の3本で、GA4 取込 Cron は含まれない。したがって「GA4 取込 Cron を止めない」という表現は使わない。

## 9. 外部API・エラー仕様

### 9.1 Google認証・OAuth スコープ

必要スコープ（既存正本: `src/lib/constants.ts`）:

| 用途 | スコープ |
|---|---|
| GA4 Data API | `https://www.googleapis.com/auth/analytics.readonly` |
| GSC Search Analytics API | `https://www.googleapis.com/auth/webmasters.readonly` |
| ユーザー識別 | `https://www.googleapis.com/auth/userinfo.email`、`openid` |

実装では上記4スコープが `GOOGLE_SEARCH_CONSOLE_SCOPES`（`src/lib/constants.ts`）にまとめられており、**GA4 スコープは GSC の同意に同梱された単一同意**である。§9.1.1 の scope 縮小シナリオはこの構成を前提とする。

- `googleTokenService.ensureValidAccessToken` を利用する。
- 再認証が必要な場合は、§6.5 の**非永続状態として表示時に導出**し、既存の Google 設定画面へ誘導する。**`ga4_content_evaluations.status` には `needs_reauth` を保存しない**（永続化すると再連携後も解消せずデッドロックになる。§6.5）。
- 評価機能内で独自のトークン更新処理を作らない。

#### 9.1.1 連携ライフサイクル

**`needs_reauth` は永続状態ではない**（§6.5）。下表の「表示」列は表示時に導出する状態、「永続」列は `ga4_content_evaluations.status` と履歴に残る値を指す。

| イベント | 評価への影響 | 表示（非永続） | 永続・既存結果の扱い |
|---|---|---|---|
| リフレッシュトークン失効（`invalid_grant`、6 ヶ月未使用、ユーザー revoke 等。公式条件は §16「Google OAuth 2.0」） | 新規評価不可 | `needs_reauth`（「Google連携を確認してください」） | 既存の成功結果と履歴は保持。評価実行中に発生した場合は下記の永続ルールに従う |
| OAuth scope 縮小（`analytics.readonly` 不足） | 新規評価不可 | `needs_reauth`（`.agents/skills/google-integrations/SKILL.md` の実文は「**発火条件**: (a) refresh 失敗（期限切れ・取り消し）、(b) 必要スコープの不足。いずれも `ERROR_MESSAGES` 由来の文言とセットで返す」。同節のコード例は `needsReauth: true` を返す。実装 `ga4-status.ts:14,26` も `scopeMissing` → `needsReauth`） | 同上。不足 scope 名はサーバーログのみに出し、UI文言は既存 `ERROR_MESSAGES` に揃える。`import_failed` にすると主操作が「データを再取得」となり再連携導線が出ないため使わない |
| OAuth scope 縮小（`webmasters.readonly` のみ不足） | GSC データ取得に影響 | **MVP では検知しない**（下記） | — |
| Google アカウント削除・GrowMate ユーザー削除 | 新規評価不可 | — | 評価履歴は `ON DELETE CASCADE` でユーザーに追随。削除前の監査要件は別途 |
| 再連携成功 | 以降の取込・評価が可能 | 次の描画で `needs_reauth` が自動解消し、直前の永続状態を表示 | **欠損期間の自動埋め戻しは MVP 対象外**。再連携後は次回評価から新データを使用 |
| プロパティ/サイト URL 変更 | URL 突合失敗の可能性 | — | `insufficient_data` + 正規化失敗理由 |

**再認証事由で評価が中断したときの永続 status:** `needs_reauth` は永続5値（§6.5）に含まれないため、`finish_ga4_content_evaluation` は **`status='evaluation_failed'` + `error_code='needs_reauth'`** で確定する。表示は §6.5 の優先順位により `needs_reauth`（「Google連携を確認してください」）が被さる。`import_failed` は使わない（主操作が「データを再取得」になり再連携導線が出ないため）。受入条件は AC-05。

**GSC 側 scope 縮小を MVP の検知対象にしない理由（2026-08-14 実測）:** `ga4-status.ts:14,26` は `scopeMissing` を見るが、`gsc-status.ts:20` は `needsReauth: !hasValidToken` のみで scope を判定しない（`:29` で `scope` をそのまま返すだけ）。したがって `webmasters.readonly` だけが剥奪された状態は現状の実装では検知できない。§9.1 のとおり4スコープは `GOOGLE_SEARCH_CONSOLE_SCOPES` の**単一同意**にまとめられており、GA4 スコープを保ったまま GSC スコープだけが失われる状況は通常発生しない。この状態での GSC 取込の挙動は未確認である。`gsc-status.ts` への scope 判定追加は本 MVP の変更対象に含めず、§17 の別チケットとする。

### 9.2 GA4 API

- **Compatibility API による組み合わせ確認は、取込拡張で `ga4ImportService` の取得指標（`landingPage` 軸の `engagementRate` / `activeUsers`）を追加する前に実施する（§4.1.1 の必須実測。2026-08-17 に対象を pagePath 軸から変更）。****評価実行経路では呼ばない。**公式定義（§16）のとおり Compatibility は「レポートリクエストに追加できるディメンション・指標」を列挙する API であり、レポートを発行しない評価経路（§9.2.1）には検証対象が存在しないためである。<br>この経路は現在未実装である（`ga4Service.ts` は `listProperties` / `listKeyEvents` / `runReport` の3メソッドのみ。`src/`・`app/` に `checkCompatibility` は0ヒット。§4.2.2 の実測）。新設は取込拡張の変更対象とし、工数は §3.4 の取込拡張（8〜14h）に含める（§17）。
- 非互換の指標は、その指標だけを欠損扱いにするか、評価を `insufficient_data` にする。別指標を勝手に代替しない。
- API のレート制限、タイムアウト、権限エラー、プロパティ未設定をエラーコード化する。
- レポート取得の行数上限は公式に「If unspecified, 10,000 rows are returned. The API returns a maximum of 250,000 rows per request, no matter how many you ask for.」（確認日 2026-08-13、§16 参照）。`landingPage × date` で90日分を取ると既定の 10,000 行を超えうるため、取込は `limit` / `offset` のページングで全行を回収し、レスポンスの `rowCount` と実取得件数を突合して不一致を記録する（既存 `ga4ImportService.fetchReportWithPagination` の前提を明文化したもの）。
- 既存の評価結果を、今回の取得失敗で消去しない。

#### 9.2.1 GA4 クォータ（Standard Property, 2026-08-12 公式）

| クォータ | 上限 |
|---|---|
| Core Tokens Per Property Per Day | 200,000 |
| Core Tokens Per Property Per Hour | 40,000 |
| Core Tokens Per Project Per Property Per Hour | 14,000 |
| Core Concurrent Requests Per Property | 10 |

MVPでは**評価実行時に GA4 レポート API を呼ばない**。既存の取込済みデータのみを使用し、鮮度が閾値を超える場合は `insufficient_data` として扱う。再取得はユーザーが既存の取込導線から明示的に行う。したがって1評価あたりの GA4 API 呼び出しは **レポート 0 回・Compatibility 0 回**（合計0回）となる。Compatibility は評価実行経路ではなく、取込拡張（確定済み）の取込指標変更時に実施する（§9.2）。

この方針により §5.1 の「評価前のデータ鮮度確認・再取込」は**鮮度の確認のみ**を指し、評価経路からの再取込は行わない。§10.4 の `import_failed` 時の主操作「データを再取得」も、評価経路ではなく既存の取込導線への誘導とする。大量評価時は `returnPropertyQuota: true` で消費をログ記録する。

### 9.3 GSC API

- ページ単位の `clicks`、`impressions`、`ctr`、`position` は GSC Search Analytics API から取り込んだ値を利用する。**用途は既存の GSC 表示・検索順位評価のみで、GA4 評価のスコアリング・LLM 入力には使わない**（2026-08-17。§4.1）。
- GSC 未連携、対象期間に行がない、URL 正規化で紐づかない場合を区別する。
- Search Analytics API は公式に「does not guarantee to return all data rows but rather top ones」（確認日 2026-08-13、§16 参照）と明記されている。評価対象記事の行が返らない場合を「データなし」と断定せず、上位行のみ返却された可能性として `data_quality_json` に記録する。§4.2.3 の「GSC を正本とする」はこの制約の上での正本という意味である。

#### 9.3.1 GSC クォータ・上限

| 項目 | 上限 |
|---|---|
| `rowLimit` | 1–25,000（デフォルト 1,000） |
| Per-site | 1,200 QPM |
| Per-user | 1,200 QPM |
| Per-project | 30,000,000 QPD / 40,000 QPM |

GrowMate は単一の GCP プロジェクトで全ユーザー分を呼び出すため、**per-project QPM が実効上限**になる。1ユーザーが複数サイトを持つ場合は per-user が先に効く。

1 ユーザー・1 評価バッチあたりの GSC 再取込は **`maxRows: 5000` 以下**（`gscEvaluationService` の既存値）を上限とする。

### 9.4 LLM

#### 9.4.1 再試行ポリシー

既存正本: `gscSuggestionJobService`（`suggestion_attempt_count >= 3` で terminal）。MVPは同期実行のみのため、間隔は固定2秒とし、`RETRY_DELAY_MINUTES` の15分は使わない。

| エラー種別 | 最大試行回数 | 再試行間隔 | 上限到達時 |
|---|---|---|---|
| 429 / 5xx / タイムアウト | **3 回**（初回含む） | **2 秒**固定（バックオフなし） | `narrative_failed`（スコア・診断は保存済み。§6.5 部分成功） |
| 5フィールド出力不正（Zod 検証失敗） | **3 回**（初回含む） | **2 秒**固定 | `narrative_failed`（同上） |

試行回数は評価履歴に保存し、UI で「再試行中（n/3）」を区別できるようにする。

#### 9.4.2 ログ

- ログにはプロンプト本文、トークン、記事本文、認証情報を無制限に出力しない。

## 10. 画面仕様

### 10.1 画面責務

2026-08-15 の決定（§15.4）に基づき、記事詳細を `/analytics/[annotationId]` へ移設する（フェーズ1。§5.5）。評価タブは移設後の新ルート上に実装する（フェーズ2）。

| 画面 | 責務 | MVPでの変更 |
|---|---|---|
| `/analytics` | コンテンツ一覧、カテゴリ/未評価フィルタ | GA4評価状態・コンテンツ力スコア・診断ラベル・最終評価日時の列と未評価フィルタを追加（フェーズ2）。並び替えは実装しない（Q-B） |
| `/analytics/[annotationId]` | 1記事の詳細。フェーズ1で `/gsc-dashboard?annotationId=...` から移設（既存は概要・検索クエリ分析・評価履歴の3タブ） | フェーズ1: 既存3タブを挙動保存で移設（§5.5 / AC-14）。フェーズ2: 評価UIを実装し、**情報階層を 2026-08-13 合意たたき台の統合レイアウトへ再設計する**（Q-C 回答 2026-08-16。§10.5）。**2026-08-19 に「コンテンツ評価」を独立タブへ切り出し、4タブ構成（概要／検索クエリ／検索順位評価／コンテンツ評価）とした（暫定・クライアント確認待ち。§10.3 / §18）。**既存3タブの機能・データは維持する |
| `/gsc-dashboard`（旧URL） | — | フェーズ1で恒久 redirect のみ（§5.5）。ページ実体は削除する |
| `/ga4-dashboard` | サイト全体のGA4集計、ランキング、時系列 | **メディア全体スコア（資産価値・実効）と散布図を追加する（§10.6。2026-08-17 に対象へ変更）**。あわせてヘッダーに**「過去90日を再取込」ボタンを置く**（2026-08-19。AC-18。取込後は表示中の期間のまま集計を取り直す）。記事単位の評価UI・履歴は置かない（§3.2） |
| `/setup/ga4` | GA4 連携設定・日次同期の実行 | **文言のみ**。日次同期が増分であることと、過去分は `/ga4-dashboard` の再取込導線で取り直す旨を注記する（§4.1.2） |
| `/wordpress-import` | WordPress 記事の一括インポート | **`wp_content_text` / `wp_image_count` も書くようにする（2026-08-19。AC-18）**。画面と操作手順は変えない（同じボタンの保存対象が増えるだけ）。§4.1.1 |
| `/admin/prompts` | プロンプトテンプレートの管理（admin 専用） | **カテゴリ追加のみ**。画面はテンプレートをプレフィックスで分類して表示する作り（`PromptsClient.tsx` の `PROMPT_CATEGORIES`）で、`ga4_` を拾う分類が無く受け皿の「AIチャット・生成」に紛れていたため、「GA4コンテンツ評価」カテゴリを追加した（2026-08-19）。編集・バージョン管理は既存機能をそのまま使う。登録の経路とタイミングは §6.3.1 / §14 手順 |

記事詳細の情報階層の再設計（統合レイアウト化）は、Q-C 回答（2026-08-16「まとめで全てやる」）により**フェーズ2で実施する**（§3.1 / §10.5）。フェーズ1の移設時点では挙動保存を維持し（AC-14）、再設計はフェーズ2の評価タブ実装と同時に行う。

### 10.2 一覧画面 `/analytics`

- 既存のコンテンツ分析一覧（`AnalyticsTable.tsx`）に、GA4評価状態、コンテンツ力スコア、診断ラベル（診断コードの日本語名。例「冒頭離脱型」）、最終評価日時を追加する。文言は §10.7 の用語言い換えに従う。
- `unassessed` / GA4未評価を**フィルタ**できるようにする（GSC未評価フィルタ `p_has_unstarted_gsc_evaluation` と同型）。
- **並び替えは実装しない（Q-B 回答 2026-08-16「未評価コンテンツはフィルタだけで足りる」）。**§1.9.5 の「ソート」は未評価コンテンツの発見が目的であり、上記の未評価フィルタで満たす。一覧RPCへ並び替えキー・昇降順パラメータは追加せず、行順は既存の `ORDER BY f.updated_at DESC NULLS LAST` を維持する。受入条件は AC-10（絞り込みのみ）。
- **`fetchGa4Summaries` の打ち切りを検知したときの一覧表示:** `count:'exact'` の総件数と取得件数が一致しない場合、その集計値は部分取得である。**表示単位は「そのページの GA4 集計全体」とする。**理由は、`fetchGa4Summaries`（`analyticsContentService.ts:239,286-291`）が `.in('normalized_path', normalizedPaths)` で**そのページの全記事の日次行を1クエリで一括取得**しており、`count:'exact'` の差分は「打ち切りが起きた事実」しか示さないためである。**どの記事の行が欠けたかは、記事ごとの件数を持たない限り判別できない**（打ち切り位置以降の記事は0行で返り、「GA4データなし」と区別できない）。記事単位で部分取得を示す場合は、記事ごとに件数を取得するか `range` ページングで全行を回収して照合する必要があり、D4 決着（(b)＋(d)）ではこれを行わない（§15.3）。<br>したがって一覧表示はページ単位の注記とし、数値を空欄にも0にもしない。**注記の文言は原因と対処を含める**（利用者が自力で復旧できるようにする。「一部取得できていません」だけの抽象表現にしない）。文言案: 「表示期間が長いため、GA4 の数値を集計しきれていません。期間を短くすると正確な数値が表示されます」（確定文言は実装時に `ui-text.md` 正本で調整）。なお D4 (d) の期間上限100日により通常経路では本注記は表示されず、表示されるのは上限をすり抜けた経路（将来の設定変化を含む）に限られる。評価実行時は入力側データ品質として `data_quality_json` に伝播する（§7.3）。`data_quality_json` は評価履歴の列であり評価履歴のない記事には存在しないため、一覧側の表示は一覧RPC の応答とは独立にページ側で判定する。受入条件は AC-13（受入対象。D4 決着 2026-08-17）。
- 一覧には診断・根拠・改善提案などの長文要約列を追加しない。既存テーブルの横幅とレイアウトを維持する。
- 記事詳細への遷移は既存の「詳細」ボタンを使い、フェーズ1以降は別タブで `/analytics/[annotationId]` を開く（§5.5）。別タブ遷移は維持する。
- `/analytics` は Instagram 連携リリース後、blog / instagram の2タブ構成である（`app/analytics/AnalyticsClient.tsx`。2026-08-15 実測）。本機能の評価状態列・未評価フィルタ・並び替えは blog タブの `AnalyticsTable` を対象とし、instagram タブには変更を加えない。
- 文言は `.agents/skills/growmate-ui-ux/ui-text.md` に準拠する。

### 10.3 記事詳細の「コンテンツ評価」タブ

フェーズ1で移設した記事詳細 `/analytics/[annotationId]` に評価UIを実装する。タブ構成は 2026-08-13 合意たたき台（「概要（GA4/GSC統合）」「検索クエリ」「評価履歴」の3タブ基本形。評価の結果・操作は概要へ統合表示）だったが、**2026-08-19 に「コンテンツ評価」を独立タブへ切り出した（暫定。D3 / Q-C の見直しにあたるためクライアント確認待ち。§18）**。理由は、統合表示の実装では評価カードが概要タブの最下部（メトリクスカード・時系列グラフ・データ準備状況・検索順位評価サイクル設定の後ろ）に置かれ、到達に大きなスクロールを要して主役として機能していなかったこと。現在のタブは「概要」「検索クエリ」「検索順位評価」「コンテンツ評価」の4本（既存3タブの並びは変えず、右端に追加）。**クライアントが統合表示を望む場合は概要へ戻す**（`ContentEvaluationTab` を概要の上部へ差し込むだけで戻せる形にしてある）。既存機能・GSC固有の操作（`OverviewTab` の「最新化」、`SuggestionDataReadiness`、`EvaluationSettings` の評価周期・評価時刻設定と評価開始導線）は統合レイアウト内でも維持する。

> **表記の注記（2026-08-16、2026-08-19 追記）:** 本書の「「コンテンツ評価」タブ」という表記は、もともとこの評価UI領域を指す略記であり、独立タブの実装を拘束しないものだった。2026-08-19 の暫定変更により**実際に独立タブとして実装されている**が、クライアント確認の結果しだいで概要への統合表示へ戻す。

評価UI（配置先がタブでも概要内セクションでも同じ）は**記事カード**（評価エンジン仕様 §08）を基本形とし、上から次の順に表示する。**率ではなく人数と点数で語り、GA4 用語を使わない**（§10.7）。

1. 評価状態と主操作（「評価を実行」または「再評価」）。GSC の「評価を開始」とは別の操作であることを文言で明示する。
2. 評価済みの場合のみ: **コンテンツ力スコア＋点数帯ラベル**（例「43点 ／ 改善の余地あり」）、**読み始めスコア・読了スコアの内訳（バー付き）**、**サイト内順位**（「N位 / M記事中」）、前回差分、評価対象期間、最終評価日時。数字だけでなくバーで大小を示す。未評価・評価不能時に点数を0として表示しない。
3. **人数ファネル**: 「N訪問 ▶ N読み始め ▶ N最後まで」。「最後まで」の人数は scroll 実測（`scroll_90_event_count`）がある場合のみ表示し、**読了率から人数を換算しない**（読了率は平均時間の比であり人数比ではない。実測がない場合は「1人あたり平均で全体のX%まで読まれています」と率で表現する。評価エンジン仕様 §08 の禁則） 。
4. **診断文**: `headline`（見出し）と `situation` / `cause`（何が起きているか・なぜか）。
5. **NEXT ACTION**: `next_action`（次の一手は1つ）と `target`（狙い。点数目標付き）。
6. 「データの品質」「データ取得日時」「評価対象期間」。プロンプトバージョン・スコアリング設定バージョンは「評価情報」の詳細欄で確認できるようにする。
7. この領域での評価履歴。実行日時、状態、スコア（3種）、診断コード、対象期間、データ品質、診断文、失敗理由を表示する。既存「評価履歴」タブのGSC評価履歴とは統合せず、それぞれの領域に置く。

生の数値（実際に読まれた時間＝平均エンゲージメント時間、読み始め率）は **GA4 の画面と一字一句一致させる**（評価エンジン仕様 §08。利用者は必ず一度は突き合わせる。突合先の画面は §4.1.1 の実測結果で確定し §15.2 で確認する）。

- ユーザー向けの表記は `.agents/skills/growmate-ui-ux/ui-text.md` の用語辞書に従う。
  - 引用（GA4 行の補足、verbatim）: 「フル表記は `Google Analytics 4`。初出はフル表記、以降 `GA4`（→「略語」）」。略語セクションの規定は「`GSC` のような略語は**その画面での初出でフル表記＋括弧書き**し、以降は略語を使う」で、例として `Google Search Console（以下、GSC）` が挙げられている。
  - 導出（本仕様での表記）: 上記2つを合わせ、画面初出は `Google Analytics 4（以下、GA4）`、以降は `GA4` とする。`Google Analytics 4（以下、GA4）` という文字列自体は辞書に記載がなく、略語ルールを適用した結果である。
  - 辞書にない「Google アナリティクス」は使わない。「Google Search Console」は辞書どおり。「再認証」はユーザー向けには使わず、「Google連携を確認」または「Googleを再連携」と表示する（辞書「再連携」行）。
- 同一画面に GSC 評価とコンテンツ評価の2種が並ぶ。
  - 引用（`ui-text.md`「評価」行の補足、verbatim）: 「Google Search Console 由来の評価。修飾を付けず「評価」と呼び、文脈は見出しで示す（`/gsc-dashboard` の「評価を開始」「評価基準日」に合わせる）。Google Ads 側の評価を UI に出す場合は両方に修飾を付けて揃える」。
  - 事実: 現行の辞書は **GSC × Google Ads の併存のみ**を規定しており、GA4 由来の評価は規定していない。既定は「修飾を付けず「評価」と呼び」であるため、既存側を「検索順位評価」へ改称する本仕様の方針は**現行の辞書のままでは根拠がない**。
  - 本仕様の方針: 併存時に両方へ修飾を付けるという辞書の趣旨を GA4 由来の評価へ広げ、既存側を「検索順位評価」、新規側を「コンテンツ評価」とする。あわせて `ui-text.md`「評価」行を「複数系統の評価を UI に出す場合は両方に修飾を付けて揃える」へ一般化する（§17 の変更対象）。既存タブ・ボタン文言の変更も対象範囲に含める。なお辞書の実文（上記引用）にある `/gsc-dashboard` はフェーズ1の移設（§5.5）で陳腐化するため、辞書更新時に URL 表記も `/analytics/[annotationId]` へ改める。
- 評価実行中（`evaluating`）、データ不足、Google連携の再確認、評価失敗、Kill Switch停止中を区別して表示する。評価中に進捗率を推測表示しない。
- 「評価対象期間」と、グラフを確認する「表示期間」は別物として表示する。表示期間を変更しても保存済みの評価点・診断は変わらず、再評価時にだけ評価対象期間が更新される。
- 点数の閾値による画面側のフィルタ・固定分岐は実装しない（Q2 回答 2026-08-16。§6.4）。点数は表示のみとする。
- 履歴詳細は画面内の展開領域または単一のダイアログで表示する。ダイアログ上に別のダイアログを重ねない。
- レスポンシブ・アクセシビリティは既存画面の作りに従う。状態は色だけで表現せず、ラベル・アイコン・文言を併用する。長い表は既存タブと同様に横スクロール可能にする。

### 10.4 状態別UIと操作

**この表は記事詳細の「コンテンツ評価」タブの状態表である。**一覧 `/analytics` には評価実行ボタンを置かないため（§8.2）、一覧では状態の表示のみを行い、`unassessed` は「未評価」と表示する（§6.5）。

| 内部状態 | ユーザー向け表示 | 主操作 | 既存の成功結果 | 操作制限 |
|---|---|---|---|---|
| `unassessed`（詳細＝履歴なし＋データ不足） | 未評価（データが不足） | 不足項目を確認 | なし | 「評価を実行」ボタンを表示しない |
| `low_data`（非永続・導出） | データ蓄積中（訪問した人が30人に達すると評価できます） | なし | ある場合は保持して表示 | 評価開始を無効化（BR-08。データが貯まれば自動解消） |
| `eligible` | 評価可能 | 評価を実行 | なし | 実行中はボタンを無効化 |
| `evaluating` | 評価中です。完了まで最大3分かかる場合があります。 | なし。再読み込み可能 | ある場合は「前回の評価結果」として表示 | 評価を実行・再評価するボタンを無効化 |
| `evaluated` | 評価済み | 再評価 | 最新の成功結果 | なし |
| `insufficient_data` | データが不足しています | 不足項目を確認 | ある場合は保持して表示 | 点数・提案を新規表示しない |
| `import_failed` | データを取得できませんでした | データを再取得 | ある場合は保持して表示 | 評価開始を無効化 |
| `needs_reauth`（非永続・導出） | Google連携を確認してください | Googleを再連携 | ある場合は保持して表示 | 評価開始を無効化。**再連携が成功すれば次の描画で自動解消する**（DBに残らない） |
| `narrative_failed` | 診断コメントを作成できませんでした（点数は算出済み） | 再評価（文章の再生成） | **今回のスコア・診断は表示する**（部分成功。§6.5） | 診断文の領域のみ失敗表示 |
| `evaluation_failed` | 評価に失敗しました | 再評価 | 前回の成功結果を明示して表示 | 失敗理由をsanitized値で表示 |
| Kill Switch停止 | 評価機能は現在停止中です | なし | 既存結果は閲覧可能 | 評価・再評価を無効化 |

状態行の文言は仮置きであり、確定は §10.7 の用語言い換えと `ui-text.md` 正本に従う。

画面を離れて再訪した場合も、DBの状態を正本として同じ表示を出す。Kill Switch停止は永続化状態ではなく、評価APIと画面での表示制御に使う。

### 10.5 UI合意ゲート

**合意ゲートは通過済み（D3 決着 2026-08-16）で、再オープンしない。**2026-08-13 にたたき台（新ルートの統合詳細画面）を合意済みで、Q-C 回答（2026-08-16「まとめで全てやる」）で統合レイアウトの再設計までフェーズ2に含めることが確定した。2026-08-17 に加わった記事カード・人数ファネル・散布図・用語言い換えは**クライアント自身の評価エンジン仕様 §08 由来**であり、たたき台の情報階層（3タブ基本形）と合成して実装する（評価UI領域の中身が記事カード形式になる）。フェーズ2のUI実装は、たたき台の情報階層＋評価エンジン仕様 §08＋§10.2〜§10.7 を正とする。文言・細部の調整は実装時に `growmate-ui-ux` 正本に従って行う。

### 10.6 メディア全体スコアと散布図（`/ga4-dashboard`。評価エンジン仕様 §06）

`/ga4-dashboard` に次を追加する（既存の `SummaryCards` / ranking / timeseries は不変）。認可は既存の `canAccessGa4`（§3.3）。

- **資産価値スコア**: 評価済み記事のコンテンツ力スコアの単純平均。**実効スコア**: セッション数で重み付けした加重平均。両方を並べて表示し、大小関係の意味（実効>資産価値＝良い記事に流入集中・健全／実効<資産価値＝悪い記事に流入集中・危険）と打ち手を短文で添える。
- **散布図**: 全評価済み記事をプロットする（横軸=読み始めスコア、縦軸=読了スコア、点の大きさ=セッション数）。右上が資産、左下が負債。実装は `QueryAnalysisTab.tsx` の4象限 ScatterChart（recharts）のパターンを流用する（§5.1）。
- 集計対象は当該ユーザーの評価済み記事（`R_LOWDATA`・未評価は含めない。対象件数を「M記事中N記事が評価済み」として明示する）。保存せず表示時に集計する（§6.4）。
- 月次で点群が右上へ移動していくことが改善の証明になる、という読み方を画面内の説明に含める（履歴スナップショットの保存・推移グラフ化は MVP 対象外の将来拡張）。

### 10.7 UI 用語の言い換え（評価エンジン仕様 §08。ツール内で GA4 用語を使わない）

評価機能まわりの UI では GA4 用語を使わず、次の対応表で言い換える。対応表は `ui-text.md` の用語辞書へ転記し（§17）、実装後に GA4 用語の残存をコード検索で 0 件にする（AC 対象。§13）。

| GA4 の用語 | ツール内の表記 |
|---|---|
| セッション / ユーザー | 訪問した人 |
| エンゲージメント率 | 読み始め率（スコア名は「読み始めスコア」） |
| エンゲージのあったセッション | 読み始めた人 |
| 平均エンゲージメント時間 | 実際に読まれた時間 |
| 直帰率 | 使わない。読み始め率の裏返しなので不要 |
| ランディングページ | 入口になった記事 |
| キーイベント / コンバージョン | 問い合わせ |
| 表示回数（impressions） | 検索結果に出た回数 |
| 掲載順位 | 検索順位 |

適用範囲は**ツール内の UI 全体**とする（原文正本の原則で 2026-08-17 改訂。評価エンジン仕様 §08「ツール内でGA4用語を全面禁止」・§09-13「用語言い換え表をUI全体に適用（GA4用語をコード検索して残存ゼロを確認）」に従う）。フェーズ2で新設・変更する評価UI・一覧の評価列・`/ga4-dashboard` の追加要素に加え、**既存画面（GSC タブ・既存 GA4 ダッシュボード等）の表示文言も残存ゼロ検査と置換の対象に含める**（旧「既存画面は別チケット」方針は失効）。増分は §3.4「UI用語言い換え」の見積へ算入済み（+4〜6h）。

## 11. 非機能要件

`docs/templates/requirement-definition.md` §7 の分類に従い、同テンプレートの「検証方法」「状態・根拠」列を保持する。該当しない項目も理由を記載する。

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
|---|---|---|---|
| 性能・レイテンシ | 手動評価の実行経路は `maxDuration=180秒`。LLM 1回45秒・最大3回・間隔2秒（§8.1）。**一覧のページサイズは現状 `app/analytics/page.tsx:59` の `const perPage = 10;`（1ページ10件固定）であり、本仕様では変更しない。**`analyticsContentService.ts:14` の `MAX_PER_PAGE = 100` と一覧RPCの `GREATEST(1, LEAST(100, …))`（`20260809100000_...sql:36`）はサーバ側のクランプ上限であってページサイズではない | §13 APIテスト（LLMタイムアウト）、AC-00（既存ページングの挙動不変）、実データ検証 | 確定。ページサイズを10から変更すると §3.2・§3.4 フェーズ0完了条件・AC-00 の「既存レスポンス・ページングの挙動が変更されていない」に反する |
| 可用性・信頼性 | 外部 API または LLM の一時障害で、既存の正常結果が失われない。評価機能の停止が既存の一覧・記事詳細（`/analytics/[annotationId]` の既存3タブ）・既存の取込経路（GSC は `gsc-evaluate` Cron、GA4 は `/api/ga4/sync` のユーザー起動）へ波及しない | AC-04、AC-06、§13 サービステスト | 確定。SLA 目標値は設定しない（MVPは手動実行のみで可用性が業務停止に直結しない）。取込経路の実態は §8.2 |
| セキュリティ・プライバシー | Google 認証情報・Service Role キー・個人情報を LLM 入力や通常ログへ出さない。所有者境界は §7.2 のアプリ層明示スコープと DB trigger。`error_message` は sanitized 値のみ。保持期間・削除条件は §7.6 | §13 サービステスト（ユーザーID分離・ログ秘匿）、DBテスト（ユーザー間の参照遮断） | 確定。§7.2 / §7.5 / §7.6 |
| 認証・認可 | 許可ロールは `admin` / `paid`（`ga4-permissions.ts:7`）。`/analytics` 配下は `proxy.ts:11,177-179,215-217` のプレフィックスマッチで保護され、記事詳細 `/analytics/[annotationId]` も自動対象（2026-08-15 実測）。**加えて CLAUDE.md ポリシー（2026-08-15）に従い、ページのデータ取得・Server Action・Route Handler の入口で認可を必須検証する（読み取り＝`canAccessGa4` / 書き込み＝`canWriteGa4`。§3.3 認可関数の使い分け）**（§3.3 / BR-07）。未認可時の応答形は §3.3「未認可時の応答契約」で固定する。RLS は §7.5 のとおり Service Role 経路ではバイパスされるため多層防御として扱う | AC-12、§13 E2E（`trial` ロールが `/unauthorized` へ誘導される）、§13 認可テスト（応答形・403）、DBテスト（RLS） | 確定。§3.3 に実測（2026-08-15）を記載 |
| 整合性・排他 | `start_ga4_content_evaluation` RPC の行ロックと `(user_id, content_annotation_id)` の一意制約により、同一ユーザー・同一記事の手動評価が同時に二重実行されない。`lease_expires_at` 15分TTLで固着を回復する | AC-07、§13 DBテスト（同時実行・stale回復） | 確定。§8.1 |
| データ量・打ち切り | **D4 確定（2026-08-17）: (b)＋(d) 併用**（§15.3）。(d)＝一覧の表示期間に上限100日を追加（`app/analytics/page.tsx` の期間検証。10記事 × 100日 = 1,000行 ≦ `db-max-rows`）。(b)＝`count:'exact'` の総件数と取得件数を比較し、不一致を一覧表示（原因・対処を含む注記）と `data_quality_json` の部分取得フラグへ伝播する（§10.2）。評価入力は期間上限（最大90日）と記事単位の狙い撃ちにより最大90行/記事に有界化する。一覧RPCは1行返却のため PostgREST の1000行上限に該当しない。**メディア全体スコア・サイト内順位（2026-08-17 追加）は全記事横断の集計であり、`fetchGa4Summaries` とは別の集計経路（`ga4Dashboard.actions.ts` 系の記事別集計＋評価テーブルの JOIN）で実装する。評価テーブル側は記事1行×最新成功のみで日次行を持たないため 1,000 行上限には セッション集計側（既存ランキング経路と同じ特性）だけが関わる。設計時に `db-max-rows` との突合を §13 テストへ含める** | AC-13（受入対象）、AC-16、§13 単体テスト | **想定行数**（`fetchGa4Summaries` は1ページ分の記事 × 選択期間の日数だけ `ga4_page_metrics_daily` の日次行を1クエリで取得する。1記事1日1行）。<br>・**現行のページサイズ10件**: **100日で 1,000行に到達する**（10記事 × 100日）。**一覧の表示期間には上限がない**（`app/analytics/page.tsx` の期間検証は書式のみ。§6.1-4）ため、**101日以上を指定すれば `db-max-rows = 1000` を超えうる**。なお §6.3.2 #2 の「最大90日」は**評価入力の上限であり一覧には適用されない**。<br>・**クランプ上限の100件までページサイズを広げた場合**: 100記事 × 10日 = 1,000行で到達、90日で 9,000行。<br>本仕様ではページサイズを変更しない（上記「性能・レイテンシ」行）が、**期間が長い場合は現行設定でも打ち切りが起こりうる**。対処は D4 で確定済み（(b)＋(d)。上限100日で通常経路の打ち切りを封じ、検知を安全弁に置く）。`docs/context/db-row-limits-and-data-truncation.md` は「`items.length >= limit` での検知は不可。必ず `count:'exact'` の総件数と比較する」と定める |
| 監査・ログ | 評価履歴に実行日時・状態・試行回数・エラーコード・プロンプトバージョン・入力データ識別情報を保存する（§7.3）。ログのマスキングは §9.4.2 | §13 サービステスト（履歴保存） | 確定。誰が実行したかの操作ログは別途持たない（RLSが自己参照のみで実行者＝所有者に限られるため） |
| 障害対応 | Kill Switch（§8.2）でDB設定変更のみ・デプロイなしに評価を停止できる。stale 実行は次回開始時に自動回復する | AC-06、AC-07（stale）、§13 DBテスト | 確定。RTO/RPO は設定しない（自動フェイルオーバー・多重化は行わず既存アプリの構成に従う） |
| バックアップ・復旧 | 評価履歴はロールバック時も削除しない（§14） | §13 DBテスト（ロールバック） | 確定。評価専用のバックアップ設計は持たない（Supabase 既存のバックアップ方針に従う） |
| 運用・監視 | 評価失敗率・stale 回復件数はDBから集計可能な形で履歴に残す | §7.3 の列定義、実データ検証 | 確定。専用の監視ダッシュボード・アラートはMVP対象外（定期Cronを持たないため常時監視の必要性が低い） |
| 拡張性・互換性 | スコアリング定数の改版（`scoring_config_version`）・定期Cronは本書の構造を壊さず後から足せるよう、状態は §6.5 の永続/非永続の区分で分離し、履歴を正本とする | §13 単体テスト（状態遷移） | 確定。対応ブラウザ・端末は既存画面の前提に従う |
| アクセシビリティ | 状態は色だけで表現せずラベル・文言を併用する。それ以外は既存画面の作りに従う（並び替えは実装しないため `aria-sort` は対象外。Q-B） | AC-09、AC-10 | 確定。記事詳細の情報階層はフェーズ2で統合レイアウトへ再設計する（Q-C。§10.1）。レスポンシブの新規要件定義は §3.2 で対象外 |
| コスト | LLM 呼び出しは1評価あたり最大3回（文章化のみ。判定はコードでコストゼロ＝評価エンジン仕様 §01）。GA4 レポート API は評価実行時に呼ばない（§9.2.1）。**コスト上限は設けない（Q8 決着 2026-08-16。開発側既定）**: 手動トリガーのみで暴走経路がなく、入力は §6.3.3 の算出済み変数のみ・出力は200字強で、1評価あたりのコストは旧設計（本文80,000字予算）より大幅に小さい。月間件数は運用実測とし、上限が必要になれば Kill Switch（§8.2）で停止したうえで後付けする | 履歴テーブルの実行記録から運用実測 | 確定（クライアントは回答不能と回答。開発側既定で確定） |

### AI 機能の観点

`docs/templates/requirement-definition.md` §7「AI機能の追加観点」に対応する。

| 観点 | 要件・目標値 | 検証方法 | 状態・根拠 |
|---|---|---|---|
| 出力品質・評価基準 | 5フィールド契約（§6.3.4）を Zod でスキーマ検証（フィールド存在＋文字数上限）。検証失敗は `narrative_failed` とし、文章を公開状態にしない（スコア・診断は有効。§6.5 部分成功） | AC-01、§13 単体テスト（5フィールド検証） | 確定（2026-08-17 受領で出力契約確定） |
| 入力制御 | §6.3.2 / §6.3.3 の算出済み変数のみを注入する。記事本文の全文・GSC集計・生の日次推移は渡さない | §13 単体テスト（変数組立） | 確定 |
| 禁止事項・安全性 | プロンプト本文・記事全文・トークン・認証情報を通常ログへ出さない（§9.4.2）。アクセストークン・Service Role キーを LLM へ注入しない（§6.3.2 #5）。LLM 出力から点数・判定を取り込まない（BR-09） | §13 フェーズ0単体テスト（ログ秘匿）、スキーマ検証テスト | 確定 |
| 人間の確認・上書き | 診断文はLLM生成であり、改善提案の実施判断は利用者が行う。自動的に記事を編集・公開しない（§3.2） | AC-02、E2E | 確定 |
| モデル・プロバイダ障害時 | 既存の成功結果を上書きしない（AC-04）。429/5xx/タイムアウトは3回まで再試行し、上限到達で `narrative_failed`（スコアは保存済み。§9.4.1） | AC-04、§13 APIテスト | 確定 |
| トークン・コスト上限 | `maxTokens` を明示的に渡す（§8.1）。入力は §6.3.3 の変数のみで有界（本文全文を渡さないため旧 80,000 字予算は失効） | §13 単体テスト | 確定（Q8 開発側既定） |
| レイテンシ・タイムアウト | LLM 1回 45秒（`timeoutMs: 45000` を明示）・最大3回・実行経路 `maxDuration=180秒`（§8.1） | §13 APIテスト（LLMタイムアウト） | 確定 |
| 再現性 | スコア・診断は同一入力・同一 `scoring_config_version` で常に同値（決定性。§6.2）。プロンプトの `version` と本文 SHA-256、`scoring_config_version` を評価履歴に保存する（§7.3） | §13 単体テスト（決定性）、サービステスト | 確定 |

## 12. 受入条件（Gherkin）

### AC-00 フェーズ0のリファクタリングで既存挙動を維持する

```gherkin
Feature: GA4コンテンツ評価の実装基盤

  Scenario: リファクタリング着手前に現状の挙動を特性テストで固定する
    Given `analyticsContentService` のGA4集計値を検証するテストが存在しない
    When フェーズ0のリファクタリングに着手する前に特性テストを追加する
    Then 直帰率がセッション数による重み付き平均であることが固定される
    And CTRが impressions 0 件のとき null であることが固定される
    And is_sampled / is_partial が OR 集約されることが固定される
    And 日付逆転・URL0件・GA4プロパティ未設定時に空の集計を返すことが固定される

  Scenario: 事前リファクタリング後も既存の分析一覧が同じ結果を返す
    Given リファクタリング前の既存GA4/GSCデータと同じ入力がある
    When フェーズ0のリファクタリング後に /analytics 一覧を表示する
    Then 追加した特性テストが前後で同一結果を返す
    And ページング、既存フィルタ、GA4集計値、既存エラー表示の挙動が変わらない
    And 既存テスト、型チェック、Lint、ビルドが成功する
```

### AC-01 評価可能な記事を評価できる（算出＋文章化）

```gherkin
Feature: GA4コンテンツ評価

  Scenario: データが揃った記事のスコアと診断がコードで確定する
    Given 対象記事に評価対象期間のGA4データ（sessions >= 30）と本文文字数がある
    When 記事の評価を実行する
    Then 読了率・読み始め率からアンカー線形補間で読了スコア・読み始めスコアが算出される
    And コンテンツ力スコアが幾何平均で算出され、診断コードがマトリクスで確定する
    And スコア・診断コード・サイト内順位・scoring_config_version が履歴に保存される
    And LLM はこの確定より前に呼ばれない

  Scenario: 同一入力からは常に同一のスコアが出る（決定性）
    Given 同一の取込データ・本文文字数・scoring_config_version がある
    When 評価を2回実行する
    Then 2回のスコア・診断コードは完全に一致する

  Scenario: 確定した判定を文章化する
    Given スコア・診断コードが保存済みである
    And 文章化用システムプロンプトが有効である
    When 文章化が実行される
    Then LLMへシステムプロンプトと §6.3.3 の算出済み変数のみが渡される
    And 5フィールド（headline/situation/cause/next_action/target）の出力が検証・保存される
    And 評価状態が evaluated になる
    And LLM 出力の内容によってスコア・診断コードは変化しない
```

### AC-02 診断文が記事ごとに具体化される（画一化しない）

判定はコードで固定される（AC-01）。本 AC は**文章**が画一化しないことを見る。

```gherkin
  Scenario: 同じ診断コードの記事でも文章は記事に即して変わる
    Given 2つの記事が同じ診断コードを持つが、タイトル・見出し・人数が異なる
    When 2つの記事を文章化する
    Then situation / cause は各記事の人数・時間・見出しに言及する
    And next_action は当該記事で今日着手できる具体的な作業である
    And 2記事に同一文面のテンプレート文章が返らない
```

### AC-03 データ不足・データ蓄積中を誤評価しない

```gherkin
  Scenario: 必須データが不足している記事を評価する
    Given 対象期間の engagement_rate 等のスコア算出に必要な指標が欠損している
    When 記事の評価を実行する
    Then 欠損値を0として評価しない
    And 状態が insufficient_data になる
    And 不足している指標と期間が確認できる

  Scenario: セッションが30未満の記事は評価しない（BR-08）
    Given 対象期間の合計 sessions が 30 未満である
    When 記事詳細の評価UIを表示する
    Then 「データ蓄積中」と表示され、評価開始が無効化される
    And スコア・診断は算出も保存もされない
    And 境界値: sessions = 30 では評価できる
```

### AC-04 取得失敗時に既存結果を保持する

```gherkin
  Scenario: 最新データの取得に失敗する
    Given 記事に正常な過去の評価結果がある
    When GA4、GSC、またはLLMの処理が失敗する
    Then 過去の正常な評価結果と履歴は変更されない
    And 最新実行は失敗状態とエラーコードを持つ
```

### AC-05 再認証を誘導する

```gherkin
  Scenario: Googleアクセストークンの再認証が必要である
    Given Google APIが再認証を要求する
    When 評価を実行する
    Then 表示上の評価状態が「Google連携を確認してください」になる
    And 永続状態は evaluation_failed、error_code は needs_reauth として履歴に記録される
    And ga4_content_evaluations.status に needs_reauth は保存されない
    And 既存のGoogle再連携導線が表示される

  Scenario: 再連携に成功すると表示が自動で戻る
    Given 直前の評価が error_code needs_reauth で失敗している
    And 利用者がGoogle連携をやり直して成功している
    When 「コンテンツ評価」タブを再表示する
    Then 「Google連携を確認してください」の表示は出ない
    And 評価を実行する操作が可能になる
```

### AC-06 Kill Switch で評価を停止できる

```gherkin
  Scenario: 評価機能が Kill Switch で停止されている
    Given `ga4_content_evaluation_settings.enabled` が false、行なし、またはDB読取失敗である
    When 記事の評価を実行しようとする
    Then 評価 API は実行されない
    And 記事詳細の「コンテンツ評価」タブに停止中の表示が出る
    And 評価実行ボタンは非活性である
    And /analytics 一覧の評価状態が停止中として表示される
```

### AC-07 同一記事の二重実行を防ぐ

```gherkin
  Scenario: 同一記事への同時評価要求
    Given 記事 A の評価が evaluating 状態である
    When 同じ記事 A に対して別の評価を開始しようとする
    Then 2 件目の評価は開始されない
    And 既存の `evaluating` 状態が保持される
```

`start_ga4_content_evaluation` RPC の `FOR UPDATE` と一意制約で防止する。

```gherkin
  Scenario: 異常終了した評価をTTL経過後に再実行する
    Given 記事 A の評価が `evaluating` 状態で、`lease_expires_at` が現在時刻より前である
    When 記事 A の評価を再実行する
    Then staleな実行は `evaluation_failed` と `evaluation_stale` として記録される
    And 新しい `evaluation_run_id` で評価が開始される
    And staleな実行が新しい評価結果を上書きできない
```

### AC-08 評価実行中状態を表示する

```gherkin
  Scenario: 評価実行中の記事を一覧で確認する
    Given 記事の評価が手動実行中である
    When /analytics 一覧を表示する
    Then 該当記事の評価状態が evaluating である
    And 評価完了まで evaluated 結果は上書き表示されない
```

### AC-09 状態別UIと既存結果保持

```gherkin
  Scenario: 評価失敗時に前回の成功結果を保持する
    Given 記事Aに最後の成功評価結果がある
    When 新しい評価が `evaluation_failed` になる
    Then 前回の成功評価結果は「前回の評価結果」として表示される
    And 今回の失敗理由と「再評価」操作が表示される
    And 前回の成功履歴は変更されない

  Scenario: 評価可能な記事を初めて開く
    Given 記事Aに必要なGA4/GSCデータが揃っている
    And 評価履歴が存在しない
    When 記事Aの「コンテンツ評価」タブを開く
    Then 「評価可能」と表示される
    And 点数や診断を表示しない
    And 「評価を実行」ボタンが表示される
    And 状態が色だけでなくラベル・文言でも判別できる

  Scenario: GSCの既存操作と混同しない
    Given 記事Aの記事詳細を開いている
    When 「コンテンツ評価」タブと既存タブを見比べる
    Then コンテンツ評価の「評価を実行」とGSCの「評価を開始」が別操作として文言で区別される
    And 既存3タブの内容と操作が変更されていない
```

### AC-10 未評価コンテンツを絞り込める

クライアント文脈 §1.9.5 の第1優先要求（未評価コンテンツの発見）に対応する。**並び替えは Q-B 回答（2026-08-16「フィルタだけで足りる」）により実装しない**（§3.2 / §10.2）。

```gherkin
  Scenario: 未評価コンテンツだけを絞り込む
    Given 評価履歴のある記事とない記事が混在している
    When 未評価フィルタを適用する
    Then 評価履歴のない記事だけが表示される
    And 件数表示とページングが絞り込み後の結果と整合する

  Scenario: 並び替えUIが存在しない
    Given /analytics の一覧が表示されている
    Then 評価状態・点数・最終評価日時の見出しは非対話的であり、行順は既存の更新日時降順のまま変わらない
```

### AC-11 追加指標を取込・評価入力に含める

2026-08-17 の評価エンジン仕様により対象を `landingPage` 軸の `engagementRate` / `activeUsers` へ変更（旧 pagePath 軸 `screenPageViews` は失効。§4.1.1）。

```gherkin
  Scenario: 読み始め率と activeUsers を取込・評価入力に含める
    Given GA4連携済みの記事Aに取込拡張後の対象期間データがある
    When 評価を実行する
    Then 評価入力に landingPage 軸の engagementRate 由来の読み始め率が含まれる
    And 平均エンゲージメント時間の分母に activeUsers が使われる（互換は Q-G で実測確認済み）
    And いずれかが未取得の期間は欠損として明示され、0として扱われない

  Scenario: 本文文字数と画像点数から期待読了時間を算出する
    Given 記事Aの wp_content_text が保存されている
    When 評価を実行する
    Then 正規化後の本文文字数から期待読了時間が算出される
    And wp_image_count がある場合は画像補正（×3秒）が加算される
    And wp_image_count が未取得の場合は補正0で算出され data_quality_json に記録される
```

### AC-12 許可されないロールが記事詳細・評価機能へ到達できない

`/analytics/[annotationId]` は `proxy.ts` のプレフィックスマッチで自動的に paid ゲート対象になる。加えてサーバー側入口で認可を検証する（読み取り＝`canAccessGa4` / 書き込み＝`canWriteGa4`。§3.3 認可関数の使い分け / BR-07）。未認可時の応答形は §3.3「未認可時の応答契約」に従う。

```gherkin
  Scenario: trial ロールで記事詳細を開こうとする
    Given ロールが trial のユーザーでログインしている
    When /analytics/[annotationId] を開く
    Then /unauthorized へリダイレクトされる

  Scenario: trial ロールで旧URLを開こうとする
    Given ロールが trial のユーザーでログインしている
    When /gsc-dashboard?annotationId=... を開く
    Then /analytics/[annotationId] へ redirect された後、/unauthorized へリダイレクトされる

  Scenario: trial ロールが記事詳細の Server Action を直接呼ぶ
    Given ロールが trial のユーザーでログインしている
    When 記事詳細の Server Action（読み取り2本・書き込み4本のいずれか）を直接呼び出す
    Then success が false で error に GA4 群の機能アクセス拒否文言（§3.3 未認可時の応答契約）が入った結果が返る
    And 記事詳細・評価結果・履歴のデータが応答に含まれない

  Scenario: trial ロールが /api/gsc/dashboard 配下の Route Handler を直接呼ぶ
    Given ロールが trial のユーザーでログインしている
    When /api/gsc/dashboard または /api/gsc/dashboard/[annotationId] を直接リクエストする
    Then ステータス 403 が返る
    And 応答ボディは success が false で error に GA4 群の機能アクセス拒否文言が入る
    And 記事詳細・評価結果・履歴のデータが応答に含まれない

  Scenario: paid ロールで記事詳細を利用する
    Given ロールが paid のユーザーでログインしている
    When /analytics/[annotationId] を開く
    Then 既存機能（概要・検索クエリ・評価履歴）と評価UI（コンテンツ評価）が表示される
```

### AC-13 データの打ち切りを防ぎ、起きた場合は検知して表示する（D4 決着済み・受入対象）

**D4 は 2026-08-17 に (b)＋(d) 併用で確定し、本 AC は受入対象である（§15.3）。**(d) の期間上限100日（10記事/ページ × 100日 = 1,000行 ≦ `db-max-rows`）が通常経路の打ち切りを防ぎ、(b) の `count:'exact'` 突合が上限をすり抜けた場合の安全弁となる。

```gherkin
  Scenario: 期間上限を超える指定を受け取る（D4 (d)）
    Given 一覧の表示期間が上限の100日を超えている
    When /analytics 一覧を表示する
    Then 期間が上限まで丸められる、または上限超過が利用者に示される
    And GA4 集計は上限内の期間で取得される

  Scenario: GA4 日次行の取得が打ち切られる（D4 (b)・安全弁）
    Given 対象ページの記事数と期間の組み合わせで、GA4 日次行が db-max-rows を超える
    When /analytics 一覧を表示する
    Then count:'exact' の総件数と取得件数の不一致が検知される
    And そのページのGA4集計が部分取得である旨が、原因と対処（期間を短くする）を含む文言で一覧に表示される
    And 不足分を0や空欄として表示しない

  Scenario: 打ち切りが起きたデータで評価を実行する（D4 (b)）
    Given GA4 日次行の取得が部分取得である
    When 記事の評価を実行する
    Then data_quality_json に部分取得フラグが記録される
    And 評価入力にその旨が明示される
```

記事単位で部分取得を示す要件は置かない（§10.2 のとおり、現在の一括取得では欠けた記事を判別できない）。記事単位の表示が必要になった場合は、`range` ページングでの全行回収（D4 の不採用案 (c)）と記事ごとの件数照合を別チケットで要件化する。

### AC-14 ルート移設で既存3タブの挙動を保存する（フェーズ1）

```gherkin
  Scenario: 移設後も既存3タブが同じ内容と操作を提供する
    Given ロールが paid のユーザーでログインしている
    And 移設前の記事詳細の挙動を固定した E2E テストがある
    When /analytics/[annotationId] を開く
    Then 概要・検索クエリ分析・評価履歴の3タブの内容と操作（最新化、評価周期・評価時刻設定、評価開始 等）が移設前と同一である

  Scenario: 存在しない annotationId を開く
    Given ロールが paid のユーザーでログインしている
    When 存在しない annotationId の /analytics/[annotationId] を開く
    Then 移設前と同じく null detail の表示で描画が継続する
    And エラーページや 404 にならない
```

### AC-15 旧URLから恒久リダイレクトされる（フェーズ1）

```gherkin
  Scenario: annotationId 付きの旧URLを開く
    Given /gsc-dashboard?annotationId=X&days=90 をリクエストする
    When redirect が適用される
    Then ステータス 308 で /analytics/X へリダイレクトされる
    And annotationId 以外のクエリ（days=90）が失われない
    And 残留クエリの有無にかかわらず route param の X で記事詳細が描画される

  Scenario: annotationId なしの旧URLを開く
    Given /gsc-dashboard をリクエストする
    When redirect が適用される
    Then ステータス 308 で /analytics へリダイレクトされる
```

`annotationId` 自体が destination のクエリに残るかは公式に記載がなく未確認である（§5.5 / §16 解釈(2)）。**本 AC は「残るか否か」を期待挙動として固定しない。**フェーズ1の実装時に 308 応答の `Location` ヘッダを実測し、結果を §5.5 に追記する。新ルートは route param を正とし残留クエリを読まないため、どちらの実測結果でも上記シナリオは成立する。

### AC-16 メディア全体スコアと散布図を表示する（フェーズ2）

```gherkin
  Scenario: メディア全体スコアを確認する
    Given 評価済みの記事が2件以上ある
    When /ga4-dashboard を表示する
    Then 資産価値スコア（単純平均）と実効スコア（セッション加重平均）が表示される
    And 両者の大小関係に応じた読み方（健全／危険）と打ち手が表示される
    And 集計対象の件数（M記事中N記事が評価済み）が明示される

  Scenario: 散布図で記事の分布を確認する
    Given 評価済みの記事がある
    When /ga4-dashboard の散布図を表示する
    Then 各記事が読み始めスコア×読了スコアの位置にセッション数の大きさでプロットされる
    And 未評価・データ蓄積中の記事はプロットされない

  Scenario: 許可されないロールが全体スコアを取得できない
    Given trial ロールでログインしている
    When メディア全体スコアの取得入口を直接呼び出す
    Then §3.3 の未認可時の応答契約に従い拒否される
```

### AC-17 UI に GA4 用語が残存しない（フェーズ2）

```gherkin
  Scenario: ツール内 UI 全体の用語言い換え（原文正本の原則。2026-08-17 改訂）
    Given ツール内の UI（新設の評価UI・一覧の評価列・/ga4-dashboard に加え、既存画面の表示文言を含む）が表示されている
    Then 「セッション」「エンゲージメント率」「直帰率」等の GA4 用語が表示文言に含まれない（§10.7 の対応表で言い換えられている）
    And コード検索（リポジトリ全体の表示文言）で GA4 用語の残存が0件である
```

### AC-18 既存レコードの追加指標を埋める導線が UI に存在する（フェーズ2。2026-08-19 追加）

§4.1.2 の後方互換方針は「過去分の再取込」と「一括インポート」という**運用手順**として書かれていたため、対応する導線の実装が AC で担保されておらず、リリース手順が実行不能な状態のまま実装完了と判定された（§18）。運用手順が依存する導線は AC 化する。

```gherkin
  Scenario: GA4 の過去分を再取込する
    Given /ga4-dashboard を開いていて、engagement_rate / active_users が NULL の既存行がある
    When ヘッダーの「過去90日を再取込」を実行する
    Then /api/ga4/sync へ backfillDays=90 が送られ、同期カーソルを無視して前日から90日分が取得される
    And 取得は30日以下の窓に分割され、1レポートあたりの行数が日数で有界化される
    And 既存行の engagement_rate / active_users が upsert で埋まる
    And 打ち切り（isPartial）またはサンプリング（isSampled）が起きた場合は成功表示に加えて警告が出る
    And 取込後に表示中の期間のまま集計が取り直される（期間選択・ソートの状態は変わらない）

  Scenario: 画像点数を既存記事に埋める
    Given content_annotations.wp_image_count が NULL の既存記事がある
    When /wordpress-import の一括インポートを実行する
    Then WP REST 一覧の content.rendered から wp_content_text と wp_image_count が保存される
    And 他の列に差分がない記事も wp_image_count が NULL であれば更新対象になる

  Scenario: 本文キャッシュ済みの記事でも画像点数を取り直す
    Given wp_content_text と wp_excerpt は保存済みだが wp_image_count が NULL の記事がある
    When 記事単位の本文取得（fetchWpPostContentWithCache）が走る
    Then キャッシュ済みでも WordPress から取得し直し、wp_image_count が保存される
    And wp_image_count が 0 で保存済みの記事は「未取得」と区別され、再取得されない
```

### AC と成功条件・要求出典の対応

`docs/templates/requirement-definition.md` §5「機能要件」の FR-ID 表と §6「シナリオ対応表」は導入していない（理由は §19 の残置記録）。代替として、各 AC が本書のどの成功条件・どの要求出典に対応するかを次に示す。

| AC | 対応する成功条件（§2.3 / §2.4） | 要求出典 |
|---|---|---|
| AC-00 | （成功条件の前提となる挙動維持） | §3.4 フェーズ0の完了条件（開発側の品質要件） |
| AC-01 | スコア・診断のコード算出（決定性）と5フィールド文章の保存／KPI「スコア算出の決定性」「文章化の保存成功率」 | 評価エンジン仕様 §01〜§05・§07／`client-vision-from-lark.md` §1.9.2 |
| AC-02 | 診断文が記事ごとに具体化される（画一化しない） | 評価エンジン仕様 §07（記事の内容に触れる・具体的な作業）／§2.2 |
| AC-03 | GA4の数値欠損で誤評価しない／KPI「欠損値の誤評価」 | §2.3（開発側の品質要件） |
| AC-04 | GA4 APIの取得制約や再認証状態を評価失敗と混同せず表示・記録できる | §2.3 |
| AC-05 | 同上（再認証状態） | §2.3 / §9.1.1 |
| AC-06 | KPI「評価停止の即時性」 | 運用要件（§8.2） |
| AC-07 | KPI「二重実行」 | 運用要件（§8.1） |
| AC-08 | 記事ごとに評価状態を確認できる | §2.3 |
| AC-09 | 記事ごとに評価状態・点数・根拠・提案を確認できる | §1.9.2 / §2.3 |
| AC-10 | 未評価のコンテンツを一覧から発見できる | §1.9.5「優先: ①未評価コンテンツのソート」／§1.9.3 |
| AC-11 | 読了率・読み始め率の材料（engagementRate / activeUsers / 文字数 / 画像点数）の取込と評価入力 | 評価エンジン仕様 §02・§09 |
| AC-12 | 認可（成功条件ではなく非機能要件 §11「認証・認可」） | §3.3 / `ga4-permissions.ts` / `CLAUDE.md:8-9`（2026-08-15 ポリシー） |
| AC-13（受入対象。D4 決着 2026-08-17） | GA4の数値が欠損・不完全な場合に誤評価しない | §2.3 ／ `db-row-limits-and-data-truncation.md` |
| AC-14（フェーズ1） | （成功条件の前提となる画面配置の整備。既存3タブの挙動保存） | §15.4 の 2026-08-15 決定（命名の齟齬解消・長期メンテナンス性） |
| AC-15（フェーズ1） | （同上。旧URL導線の救済） | §15.4 の 2026-08-15 決定 |
| AC-16（フェーズ2） | メディア全体の資産価値・実効スコアと散布図で改善が追える | 評価エンジン仕様 §06 |
| AC-17（フェーズ2） | UI に GA4 用語を出さない | 評価エンジン仕様 §08 |
| AC-18（フェーズ2。2026-08-19 追加） | （成功条件の前提となるデータ充足。既存レコードの追加指標を埋める導線） | §4.1.2 後方互換方針（2026-08-18 決定）／§14 リリース手順 |
| （AC なし） | 評価に使用した期間・データ取得日時・プロンプトバージョン・スコアリング設定バージョンを追跡できる | §7.3 の列定義と §13 サービステストで担保。UI からの追跡は §10.3-5 |

## 13. テスト計画

- フェーズ0特性テスト（**リファクタリング着手前に追加**）: `analyticsContentService` のGA4集計値（重み付き直帰率、impressions 0件時のCTR null、日次合算、is_sampled/is_partial の OR集約、`(user_id, property_id)` フィルタ）、早期returnの境界（日付逆転・日付未指定・有効URL 0件・GA4プロパティ未設定）、ページングと既存フィルタの組み合わせを固定する。既存テストはRPC引数検証3件のみでGA4集計値を検証していないため、これがないと責務分離の回帰を検知できない。
- フェーズ0回帰テスト: 上記の特性テストをリファクタリング前後で実行し、同一結果になることを確認する。`/analytics` の既存一覧、ページング、フィルタ、GA4集計値、GSC表示、既存エラー表示を比較する。
- フェーズ0単体テスト: 評価Context組立、欠損判定、状態遷移、エラーコード変換、構造化LLMアダプターのJSON抽出・再試行・ログ秘匿を検証する。DB fixtureは作成しない。
- 単体テスト: URL正規化、期間集計、欠損判定、状態遷移、5フィールド出力のスキーマ検証（文字数上限含む）。
- **スコア算出エンジンの純関数テスト（2026-08-17 追加。網羅必須）**: 本文文字数の正規化（連続空白・エンティティ）、期待読了時間（画像補正あり/なし/未取得）、アンカー線形補間（各アンカー点ちょうど・区間中間・下限以下0・上限以上100・丸め）、幾何平均（片肺型 100×20→45、バランス型 60×60→60）、診断マトリクス（4×3 の全12セル＋境界値 59/60・79/80・39/40）、足切り（sessions 29/30）、完読率併用診断（40%/15% 境界 × 読了スコア40境界）、決定性（同一入力2回で同値）。
- 欠損フォールバックの分離テスト: 未取込期間の指標（`engagement_rate` / `active_users`）について、**一覧の表示値では既存フォールバック挙動のまま**、**評価入力では欠損**として Context に載ることを固定する（BR-02 / AC-03）。
- サイト内順位・前回差分テスト: 同点の順位（DENSE_RANK 相当）、初回評価の差分なし、直前成功履歴との差分計算。
- メディア全体スコアテスト: 単純平均・セッション加重平均の計算、評価済み記事のみが対象になること、対象0件時の表示（AC-16）。
- サービステスト: GA4/GSCデータのユーザーID分離、プロンプトのsystem/user分離、履歴保存、失敗時の既存結果保持。
- APIテスト: GA4互換性エラー、GSC未連携、Google再認証（永続は `evaluation_failed` + `error_code='needs_reauth'`、表示は導出）、429/5xx、LLMタイムアウト。
- 認可テスト: `trial` 等の許可されないロールで、`/analytics/[annotationId]` が `/unauthorized` へ誘導されること、記事詳細・評価の Server Action が `{ success:false, error: <GA4 群の拒否文言> }` を返すこと、`app/api/gsc/dashboard/*` が 403 と同じ error を返すこと、いずれも評価データが応答に含まれないこと（AC-12 / BR-07 / §3.3 未認可時の応答契約）。`canAccessGa4` **と `canWriteGa4` の両方**のユニットテスト（`instagram-permissions.test.ts` と同型）を含み、書き込み4関数が `canWriteGa4` を経由することを固定する（§3.3 認可関数の使い分け）。
- フェーズ1移設テスト: 既存3タブの挙動保存 E2E／特性テスト（AC-14）、redirect のステータス（308）・遷移先・`annotationId` 以外のクエリが失われないこと（AC-15。`annotationId` 自体の残留有無は期待値に含めず、実測結果を §5.5 に記録する）、`revalidatePath('/analytics/[annotationId]', 'page')` 更新後の再検証動作。**`GlobalToastBridge` のテストは D5 (b) に従う**: 新パス判定が記事詳細 `/analytics/[annotationId]` で機能すること、削除した else 側遷移分岐と死んだ配線（`gsc-dummy-open` / `gsc-dummy-update`）が復活していないこと（§5.5「GlobalToastBridge の扱い」）。
- 打ち切り対処テスト（**D4 決着 2026-08-17: (b)＋(d) 併用**）: (d) では一覧の期間指定が上限100日へ丸められる（または上限超過が明示される）こと、上限ちょうど・上限未満で挙動が変わらないこと。(b) では `fetchGa4Summaries` で `count:'exact'` の総件数と取得件数が不一致のとき、そのページのGA4集計全体を部分取得として一覧表示（原因・対処を含む文言）と `data_quality_json` に伝播すること、件数一致時に誤検知しないこと（AC-13）。
- DBテスト: RLS、インデックス、ユニーク制約、記事所有者trigger、`start_ga4_content_evaluation` / `finish_ga4_content_evaluation` RPCの同時実行、`evaluation_run_id` 条件付き更新、stale回復、履歴の成功/失敗/stale保存、Kill Switch設定のデフォルトfalse・権限、ロールバック、ユーザー間の参照遮断。評価テーブルのDB fixtureはフェーズ2で追加する。
- E2E: 未評価フィルタ、記事詳細の「コンテンツ評価」タブ表示、評価実行、評価中表示、評価結果と根拠表示、前回結果保持、データ不足・失敗・Google連携確認表示、Kill Switch停止表示、移設後の `/analytics/[annotationId]` で既存3タブが変わらないことの確認（AC-14）。
- 実データ検証: 少なくとも1ユーザーの実GA4/GSCデータを使い、画面値・保存値・API応答を突合する。モックの結果だけで完了判定しない。
- GA4取込拡張テスト（2026-08-17 に対象変更）: `landingPage` 軸への `engagementRate`・`activeUsers` 追加の Compatibility API 確認（migration 前の必須実測。§4.1.1）、metrics 追加後の取り出しインデックス・集計（engagementRate のセッション加重平均）・保存の整合、既存レコードNULLのままの期間の扱い、`wp_image_count` の同期時算出を検証する。
- UI用語検査: ツール内 UI 全体（新設・変更ファイルおよび既存画面）の表示文言に GA4 用語が残存しないこと（AC-17。§10.7 の対応表をコード検索で機械確認。原文正本の原則で既存画面も対象）。

## 14. リリース・ロールバック

### リリース順序

1. フェーズ0の特性テストを追加し、リファクタリング前の挙動を固定する。
2. フェーズ0のリファクタリングを適用する。利用者向け挙動を変えず、特性テストが前後で同一結果を返すことと、型チェック・Lint・ビルドが通ることを確認する。
3. **フェーズ1（ルート移設）を単独でリリースする。** 旧URLからの redirect（AC-15。308 応答の `Location` を実測し、`annotationId` の残留有無を §5.5 へ追記する）、既存3タブの挙動保存（AC-14）、`trial` の遮断（AC-12）を確認する。`trial` の到達遮断は §15.4 の決定に基づく意図的変更のため、リリース時の告知対象とする（R-11。**Q-E で合意済み: 事前告知のみで実施可・経過措置不要（§15.1）**。告知では旧タブの再読み込みを促す）。
4. UIたたき台の合意ゲートは通過済み（D3 / Q-C 決着 2026-08-16。§10.5）。
5. **事前確認:** `content_annotations.user_id` が UUID 文字列表現でない行が0件であることを確認する（判定 SQL: `SELECT count(*) FROM content_annotations WHERE user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`）。0件でなければ評価テーブルの適用を中止し、是正してから再開する（判断者: 開発チーム）。
6. フェーズ2のDB マイグレーションを適用する。Kill Switch設定行は `enabled=false` で作成する。
7. 生成型を更新する。未適用環境では pending 型を使用し、適用後に削除する。
8. スコア算出エンジン・評価サービス・手動API・一覧の評価列と未評価フィルタ・記事詳細の評価UI（記事カード・統合レイアウト含む）・`/ga4-dashboard` のメディア全体スコア＋散布図を Kill Switch 無効状態でデプロイする。評価UI・全体スコアの Server Action / Route Handler で認可が検証されていること（読み取り＝`canAccessGa4` / 書き込み＝`canWriteGa4`。AC-12 / §3.3）を確認する（既存3タブの挙動保存はフェーズ1で確認済み。AC-14）。
9. **確定した文章化プロンプト（評価エンジン仕様 §07 の verbatim。§6.3.4 の5フィールド契約と一致）を `/admin/prompts` から GA4 評価用テンプレートとして登録する**（§6.3.1。画面改修は不要）。
10. 許可された運用手順でステージングのDB設定を `enabled=true` に変更し、実データでスコア・診断・文章・エラー状態を検証する（**生値が GA4 画面と一致することの突合を含む**。§10.3 / §15.2）。
11. 一般ユーザーへ段階展開する。

手順5（事前確認）の前に次を実施する: 既存 `landingPage` 軸クエリへ `engagementRate` / `activeUsers` を追加する（評価エンジン仕様 §09。2026-08-17 に pagePath 軸方針から転換）。Compatibility を実測し（§4.1.1。`activeUsers` 不可なら ÷sessions フォールバックを確定）、`ga4_page_metrics_daily` へ `engagement_rate` / `active_users` を新設する migration（`page_views` は実在確認済み・不使用。Q-D 決着 2026-08-17）と `content_annotations.wp_image_count` の migration を適用し、§4.1.2 の決定（2026-08-18）に従って**過去90日の再取込**で既存行の新列を埋めてから取込を有効化する。再取込は `/ga4-dashboard` ヘッダーの「**過去90日を再取込**」ボタンから実行する（Kill Switch 有効化前に実施。**`/setup/ga4` の「GA4日次同期を実行」では過去分は埋まらない**）。あわせて WordPress 同期の `wp_image_count` 算出を有効化し、**`/wordpress-import` の一括インポートを1回実行**して本文と画像点数を埋める（§4.1.2）。両方とも**実行後に埋まったことを確認する**: `ga4_page_metrics_daily` の `engagement_rate` / `active_users` が NULL でない行が存在すること、`content_annotations.wp_image_count` が NULL でない行が存在すること。0件のままなら導線が機能していないので、Kill Switch を有効化しない（この確認を省くと、評価が全件「データ蓄積中」で止まる原因が切り分けられない）。

### ロールバック

- `ga4_content_evaluation_settings.enabled=false` に変更して LLM 評価実行を次リクエストから停止する（§8.2）。DB設定の変更手段が利用できない場合は、評価APIを安全側で停止する。
- フェーズ1の redirect は `permanent: true`（308）でクライアント・検索エンジンにキャッシュされるため、**旧URL `/gsc-dashboard` へ戻すロールバックは行わない**。移設後の画面に問題が出た場合は新ルート `/analytics/[annotationId]` 上で前方修正する（§5.5）。
- フェーズ2のUIで問題が発生した場合は、「コンテンツ評価」タブの表示のみを取り下げる。移設済みの既存3タブには影響しない。
- 既存の取込経路（GSC は `gsc-evaluate` Cron 経由、GA4 は `/api/ga4/sync` のユーザー起動。§8.2）は停止せず、評価処理だけを停止できる構成にする。GA4取込へ追加した `engagementRate` / `activeUsers`（landingPage 軸）は、問題時に取得対象から外しても既存指標の取込が継続できるようにする。
- DB ロールバックが必要な場合は、評価専用テーブル・インデックス・ポリシー・`ga4_content_evaluation_settings` を対象に限定する。既存 GA4/GSC テーブルは削除しない。
- 評価履歴は削除せず、再デプロイ後の再評価に利用できるよう保持する（保持期間は §7.6）。
- **ロールバック判断者: 開発チーム。** Kill Switch の無効化はDB設定の変更手順を持つ運用担当が実施する。DB ロールバック（テーブル・ポリシー・RPC の削除）は開発チームの判断とし、実施前に §7.6 の保持方針に反しないことを確認する。

## 15. クライアント確認事項

### 15.1 確定事項（回答済み・実装契約に反映済み）

以下は回答を得たため、**本文が正本**である。再度の解釈変更を行わず、変更が必要な場合は §18 変更履歴に追記してから本文を直す。

| ID | 質問 | 回答 | 確定日 | 反映先 |
|---|---|---|---|---|
| Q5 | UIたたき台をフェーズ2のUI実装前、かつ `spec-to-pr` 前の必須ゲートとする方針でよいか | **合意（ゲート自体は有効）**。ただし2026-08-13に合意したたたき台は統合詳細画面（新ルート）を前提としており、MVPを既存画面へのタブ追加に絞ったため、たたき台の再合意が必要（D3）。**2026-08-15 改訂で新ルートへ回帰し前提が再整合した。現行の合意論点は D3 / Q-C を参照** | 2026-08-13 | §10.5 UI合意ゲート |
| Q6 | GA4評価結果の共有ユーザー閲覧をMVPに含めるか | **MVP対象外。owner-onlyで実装し、共有閲覧はactorとownerを分けた別仕様・別migrationで設計する**。**2026-08-15 補記: オーナー/スタッフ共有モデル自体が廃止済み（スタッフレコード0件、`20260808000000` migration が共有パターン不要と判断）と実測されたため、「共有閲覧を別仕様で設計する」という将来対応の前提は消滅した。本仕様のRLSは自己参照のみ（§3.3 / §7.5）** | 2026-08-13 | §3.3 / §7.5 RLS |
| Q-E | `trial` の記事詳細到達遮断を事前告知のみで実施してよいか。経過措置は必要か | **合意済み。遮断は事前告知のみで実施してよく、経過措置（一定期間の到達維持等）は不要**。フェーズ1のリリース判断のブロッカーは解消 | 2026-08-15 | §3.3 / §14 手順3 / §15.4 trial 行 / R-11 |
| Q-F | `trial` ロールの `/gsc-dashboard` 利用実績はあるか | **Q-E の合意成立により確認不要としてクローズ**（Q-E の判断材料としての役割を失った。告知は §14 手順3 のとおり実施する） | 2026-08-15 | §14 手順3 |
| Q1 | 評価パターンの分類数・条件を確定してよいか | ~~4分類で確定~~ → **失効（2026-08-17）**: クライアント自身の評価エンジン仕様により、読み始め×読了マトリクスの**6診断コード**（`R_TOP_EXIT` / `R_MISMATCH` / `R_MID_EXIT` / `R_SKIM` / `R_GOOD` / `R_LOWDATA`）へ置換。旧4分類の GSC・PV・CV 条件はスコアリングに使わない。旧回答の改善方向の思想（タイトル/説明文・書き出し・CTA・横展開）は診断コードの既存アラート対応として引き継がれている（§6.2.4） | 2026-08-16 → 2026-08-17 置換 | §6.2 / §6.3.4 / §7.3 / §18 |
| Q2 | 「70点以下の一覧化」は Must の UI フィルタか、任意か | **「なくていい」。点数閾値のフィルタ・一覧化 UI は実装しない** | 2026-08-16 | §3.2 / §6.4 / §10.3 |
| Q3 | ROI は今回スコープか。費用・売上データの所在はどこか | **スコープに含めるが、データ連携は追加せずシステムプロンプト側の評価観点で吸収する** | 2026-08-16 | §3.2 / §4.1 |
| Q4 | 改善提案のメール配信を Non-goal にしてよいか | **合意（Non-goal 確定）**。あわせて「この類型（スコープ縮小の確認）は今後質問しない」という standing 方針が示された | 2026-08-16 | §3.2 |
| Q7 | 追加指標の取込（12〜20h）を MVP に含めてよいか | **MVP に含める**（有効）。取得軸は 2026-08-17 の評価エンジン仕様で `landingPage` に確定（対象は `engagementRate` / `activeUsers`。旧 pagePath 軸は失効。§4.1.1） | 2026-08-16（軸は 2026-08-17 更新） | §3.1 / §3.4 / §4.1 / AC-11 |
| Q8 | 1評価あたりのコスト上限と月あたりの想定評価件数 | **クライアントは回答不能（「わからない」）。開発側既定で確定: 上限は設けず運用実測**。手動トリガーのみ・入力有界のため暴走経路がない。必要になれば Kill Switch で停止して後付けする | 2026-08-16 | §11 コスト行 |
| Q-A | パターン条件の「PV」は記事自体のPVか、着地セッション基準でよいか | ~~記事自体のPV → pagePath 軸の追加取得~~ → **失効（2026-08-17）**: 評価エンジン仕様に PV は登場せず、スコアリングに使わない。engagementRate は `landingPage` 軸必須（pagePath 禁止）と明記されたため、pagePath 軸の追加取得は丸ごと不要になった（§4.1 / §4.1.1 / §18） | 2026-08-16 → 2026-08-17 失効 | §4.1.1 / §4.2 / AC-11 / §18 |
| Q-B | 未評価コンテンツはフィルタだけで足りるか、並び替えも必要か | **フィルタだけで足りる**。並び替え（評価状態・点数・最終評価日時）は実装しない | 2026-08-16 | §3.2 / §10.2 / AC-10 |
| Q-C | 段階的な進め方（移設 → 評価タブ → 情報階層再設計は別チケット）でよいか | **「まとめで全てやる」**。情報階層再設計（統合レイアウト化）をフェーズ2に含める。あわせて「この類型（段階分割 vs まとめて実装の確認）は今後質問しない」という standing 方針が示された | 2026-08-16 | §3.1 / §10.1 / §10.5 / D3 |

### 15.2 未確定事項（クライアント確認中）

以下は **実装契約に確定値を書かない**。回答後に本書を更新し、`spec-to-pr` を再実行する。

**2026-08-17 更新（評価エンジン仕様の受領後）:** Q-D は決着済み。評価エンジン仕様の反映に伴い、**実測・確認が必要な事項が新たに3件**開いた（Q-G〜Q-I）。いずれも「回答が実装契約を変える」たぐいのもので、フェーズ2の取込 migration・UI 突合の着手前に閉じる。

| ID | 質問 | 背景 | ブロッカー | 回答者 | 期限 | 状態 |
|---|---|---|---|---|---|---|
| Q-D | 本番／ステージングの `ga4_page_metrics_daily` に **`page_views` 列は実在するか**。実在する場合の型・NULL可否・既存値 | 生成型 `src/types/database.types.ts:241` に non-nullable `number` として存在する一方、`supabase/migrations/` に定義が0件。生成型と migration は双方向にドリフトしており（§4.1.2 の反例）、生成型から実在を推論できない。**リモートDBの実スキーマ照会で確認する** | migration 安全性 | 開発チーム（DB管理者） | 取込拡張の migration 着手前 | **回答済み（2026-08-17）**: `page_views integer NOT NULL DEFAULT 0` が実在。全21列が生成型と一致し、`engagement_rate` は不在（新設が必要）。照会結果の全文は §4.1.2。なお同日の評価エンジン仕様により PV 自体が不使用となった |
| Q-G | `landingPage × activeUsers` は GA4 Data API で取得可能か（Compatibility 実測） | 既存コードは `totalUsers` 非互換を理由に `users`=sessions で代替している（`ga4ImportService.ts:343-345`）。`activeUsers` の互換は未確認。不可の場合は平均エンゲージメント時間を `÷ sessions` で算出する（§4.1.1） | 読了率の分母の確定、取込 migration | 開発チーム（Compatibility API 実測） | 取込拡張の migration 着手前 | **回答済み（2026-08-17、GA4 Query Explorer 実測）: 互換**。`dimensions=[landingPage]` × `metrics=[activeUsers, engagementRate, sessions, userEngagementDuration]` の `runReport` がエラーなく受理され、`metricHeaders` に4指標が返った（非互換なら 400 INVALID_ARGUMENT になる）。読了率の分母は **÷activeUsers で確定**（÷sessions フォールバックは不要）。なお実測プロパティは対象期間の `rows` が0件だったため、**数値レベルの突合（Q-H）はデータのあるプロパティ・期間で別途行う** |
| Q-H | 「GA4 画面と一字一句一致」の突合先はどの画面か（「ページとスクリーン」＝÷activeUsers か「ランディングページ」レポート＝÷sessions か） | GA4 公式 predefined-reports（2026-08-17 取得。§16）では、Pages and screens が `userEngagementDuration/activeUsers`、Landing page レポートが `userEngagementDuration/sessions` と**画面によって定義が異なる**。landingPage 軸で取得する本実装の生値がどちらの画面と一致すべきかを数値で確定する必要がある。**Q-G は互換で決着（÷activeUsers）したため、有力仮説は「ページとスクリーン」一致だが、数値での確認が未了**（2026-08-17 の実測プロパティはデータ0行で突合不能だった） | §10.3 の突合要件（評価エンジン仕様 §08「GA4の画面と一字一句一致させる」）の検証方法 | 開発チーム実測（データのあるプロパティ・期間で） → クライアント確認 | フェーズ2の実データ検証前 | 未確認（数値突合待ち） |
| Q-I | クライアントサイトの scroll 90% イベントの実名は何か（拡張計測の標準 `scroll` か、カスタム `scroll_90` か） | 既存取込はカスタムイベント名 `scroll_90` をハードコードしている（`src/lib/ga4-utils.ts:1`）。評価エンジン仕様 §02 は拡張計測の標準 `scroll` イベント（90%到達で発火・追加設定不要）を前提にしており、**両者は別のイベント**。実プロパティにどちらが存在するかで完読率の取得可否が決まる | 完読率（任意指標）の取得。取れない場合は完読率なしで評価が成立する設計のため致命ではない | クライアント（GA4 プロパティの設定確認）または実データ実測 | フェーズ2の実データ検証前 | 未確認 |

### 15.3 開発側で確定が必要な事項

クライアント確認ではなく、開発チーム内で決めて本文へ反映する。

| ID | 事項 | 背景 | ブロッカー | 担当 | 期限 | 状態 |
|---|---|---|---|---|---|---|
| D1 | MVP見積（フェーズ0 30〜45h + フェーズ1 24〜40h + フェーズ2 143〜212h = **197〜297h（25〜38人日）**）を着手前に合意する | §3.4 の各フェーズ内訳（2026-08-16 に精査済み: 取込拡張 14〜24h・統合レイアウト 20〜36h を算入、並び替え 4〜6h を削除）。**提示時に明示する条件が2つ**: (1) 取込拡張の見積は Compatibility API 未実測が前提で、`pagePath × engagementRate` が取得不可なら代替設計で再見積（§4.1.1）。(2) **フェーズ0＋1 の 54〜85h（MVP の2〜3割）は利用者に見える変化を伴わない先行作業**（挙動保存移設・redirect・認可多層化・リファクタ）であり、クライアント第1優先要求（`client-vision-from-lark.md` §1.9.5「**優先**: ①未評価コンテンツのソート ②評価機能の追加。」）の価値提供より前に置かれる。この配分を隠さず合意する | 着手判断 | 開発チーム → クライアント | — | **合意済み（2026-08-16）**。197〜297h（25〜38人日）と提示条件2点（Compatibility 未実測前提・先行作業 54〜85h）を含めて合意。`着手承認` 取得済み。**その後 D4 決着（2026-08-17。(d) 期間上限の追加 +1〜2h）により 198〜299h となり、さらに同日の評価エンジン仕様の反映で 231〜354h へ増加した（下記 D1'）** |
| D1' | **評価エンジン仕様（2026-08-17 受領）反映後の再見積 **231〜354h（29〜44人日）**をクライアントへ再提示し合意を得る** | D1 合意（198〜299h）後にクライアント自身の評価エンジン仕様でスコープが実質拡大した（スコアエンジン・文字数/画像整備・順位/差分・メディア全体スコア＋散布図・用語言い換えの追加。pagePath 取込の失効と LLM 簡素化で一部相殺。差分 +33〜55h。§3.4）。**提示時に明示する条件**: (1) ~~Compatibility 未実測~~ → **Q-G は実測済み・互換（÷activeUsers 確定）**、(2) GA4 画面突合先の数値確認（Q-H。実データ検証で実施）、(3) scroll イベント名（Q-I。取れなくても完読率なしで成立） | フェーズ2の着手判断 | 開発チーム → クライアント | フェーズ2着手前 | **合意済み（2026-08-17）**。231〜354h（29〜44人日）と提示条件（Q-G 実測済み・Q-H/Q-I は実データ検証で消化）を含めて合意。フェーズ2の着手承認取得済み。**合意後の同日、「原文正本の原則」決定（§18）で用語言い換えを UI 全体へ拡大し 235〜360h（+4〜6h）となった。この増分は合意済みレンジ外のためクライアントへ共有する（合意の再取得を要するほどの規模ではないが、黙って超えない）** |
| D3 | 新ルート `/analytics/[annotationId]` 上の評価タブUI（§10.2〜§10.4）と情報階層の扱いを合意する | 2026-08-15 の新ルート回帰で 2026-08-13 合意たたき台の前提（新ルート）と再整合し、Q-C 回答で残差分（情報階層）も解消した | フェーズ2のUI実装 | 開発チーム → クライアント | — | **確定（2026-08-16）: Q-C 回答「まとめで全てやる」により、たたき台の統合レイアウトまでフェーズ2に含める形で合意（§10.5）** |
| D5 | `GlobalToastBridge.tsx` の `/gsc-dashboard` 参照（`:20` パス判定・`:25` 遷移先）のフェーズ1での扱いを **(a) 変更せず別チケットへ送る** / **(b) パス判定のみ新ルートへ変え else 側の遷移分岐を削除する** から決める | 当該分岐は現状**到達不能**である（`gsc-dummy-open` 購読0件・`gsc-dummy-update` dispatch 0件・`:28` が payload を同期削除。実測根拠は §5.5「GlobalToastBridge の扱い」）。**2026-08-15 改訂が「挙動保存の唯一の意図的な逸脱」としていた前提は成立しないため撤回した。**利用者から見える挙動はどちらを選んでも変わらない。判断が分かれるのは「到達不能な既存コードをこの移設のスコープで削除してよいか」であり、挙動保存の原則の外側にある | §3.4 フェーズ1完了条件の grep 0件に例外を設けるか否か（(a) なら必要）、§13 フェーズ1移設テストの対象 | 開発チーム | フェーズ1着手前 | **確定（2026-08-15、ユーザー決定）: (b) を採用。死んだ配線も削除する。完了条件の例外は不要（§5.5）** |
| D4 | `fetchGa4Summaries` の打ち切りへの対処方式を次から決める。**(a) 現状維持（検知を入れない）** / **(b) 現状維持＋安全弁として `count:'exact'` 検知のみ実装** / **(c) `range` ページングで全行回収** / **(d) 期間上限を設ける** | 現行のページサイズは10件固定（`app/analytics/page.tsx:59`）で、**100日までは `db-max-rows = 1000` に到達しない**（10記事 × 100日 = 1,000行）。ただし `app/analytics/page.tsx` の期間検証は書式のみで上限がないため（§6.1-4）、**101日以上の指定では到達しうる**。ページサイズを100（クランプ上限）へ広げると 10日で到達する。実データの記事件数と実際に使われる期間は未確認 | **対処方式の選択（(a)〜(d)）**と、それに応じた工数・**AC-13 の対象化**（AC-13 は本決定に従属する。逆方向の依存はない） | 開発チーム | フェーズ2のDB着手前 | **確定（2026-08-17、ユーザー決定）: (b)＋(d) 併用。**(d)＝一覧の表示期間に上限100日を追加（通常経路の打ち切りを封じる。+1〜2h）、(b)＝`count:'exact'` 突合の検知＋原因・対処を含む注記文言（すり抜け経路への安全弁。2〜4h 計上済み）。AC-13 は受入対象化。決定の経緯: 「一部取得できていません」だけの注記は利用者に原因・対処が伝わらないという指摘を受け、文言改善に加えて打ち切り状態自体を発生させない (d) を併用する判断 |

`/gsc-dashboard` からの移設・redirect（旧D2）は 2026-08-15 に決定済みである（`?annotationId=X` → `/analytics/X`、素URLは `/analytics`、恒久 redirect。§5.5 / §15.4）。開いた論点としては復活させない。

#### 制約条件

- 納期・予算・人員: 期日の指定はない。見積は D1 で合意する。実装は開発チームのみで、外部委託の予定はない。
- 法令・契約・審査: 本機能は外部審査（Meta App Review 等）の対象ではない。Google API は既存の読み取り専用スコープの範囲内で使う（§9.1）。
- 変更できない既存仕様: 記事詳細の既存3タブの**内容と操作**（フェーズ1の移設後も挙動保存。AC-14。ルート・URLはフェーズ1で変更する）、`ga4ImportService` の `landingPage` 軸（§4.2.1）、`proxy.ts` の既存パス設定（変更不要。プレフィックスマッチで新ルートが自動的に保護対象になる。§3.3）。

#### 依存関係

| 依存対象 | 前提条件 | 完了確認 | 未完了時の影響 |
|---|---|---|---|
| 評価エンジン仕様（旧: 繁田さんのシステムプロンプト） | 計算式・アンカー・診断マトリクス・プロンプト・出力JSON契約が確定していること | **満了（2026-08-17）**: `docs/context/ga4-evaluation-engine-spec-20260817.md` として受領。出力契約は5フィールドで確定（§6.3.4）。テンプレート登録は §14 手順9 | —（解消済み。R-01 も解消） |
| Q-A の回答 | PVの定義が確定していること | **失効（2026-08-17）**: PV はスコアリング非使用。pagePath 取得は不要（§15.1 Q-A 行） | — |
| D1'（再見積の合意） | 評価エンジン反映後の 231〜354h にクライアントが合意していること | **満了（2026-08-17）**: 合意済み（§15.3 D1' 行）。その後の原文正本決定で 235〜360h（+4〜6h）となり、増分はクライアント共有事項（合意ゲートは再オープンしない） | —（解消済み） |
| Q-G（activeUsers 互換） | `landingPage × activeUsers` の互換が確定していること | **満了（2026-08-17）**: Query Explorer 実測で互換を確認。分母は ÷activeUsers で確定（§15.2 / §4.1.1） | —（解消済み） |
| Q-H / Q-I（実データ確認） | GA4 画面突合先の数値確認・scroll イベント名が確定していること | §15.2 の各行に確認結果を記録し、§10.3 へ反映 | 実データ検証（§14 手順10）の突合が確定しない（着手ブロッカーではない） |
| Q-D（リモートDBの実スキーマ照会） | `ga4_page_metrics_daily.page_views` の実在・型・NULL可否が判明していること | **満了（2026-08-17）**: `page_views integer NOT NULL DEFAULT 0` 実在・生成型と全21列一致・`engagement_rate` 不在を §4.1.2 に反映 | —（解消済み。migration は `engagement_rate` 新設のみ） |
| D3（UIたたき台の合意。Q-C と同時） | §10.2〜§10.4 の案と情報階層の扱いに合意していること | **満了（2026-08-16）**: Q-C 回答により統合レイアウト込みで合意（§10.5） | —（解消済み） |
| D5（`GlobalToastBridge` の扱い） | (a) / (b) のいずれかが選択されていること | §5.5「GlobalToastBridge の扱い」に選択結果を反映し、§3.4 完了条件・§13 の対象を確定する | フェーズ1完了条件の grep 0件に例外を設けるか決まらず、移設テストの対象も定まらない |
| Q-E / Q-F（trial の到達遮断の事前合意） | `trial` の記事詳細到達を遮断してよいこと、経過措置の要否が確定していること | **満了（2026-08-15）**: Q-E 合意済み（事前告知のみで実施可・経過措置不要）、Q-F はクローズ（§15.1）。フェーズ1のリリース判断のブロッカーは解消 | —（解消済み） |
| フェーズ1（ルート移設）の完了 | `/analytics/[annotationId]` が §3.4 フェーズ1の完了条件を満たしていること | AC-12 / AC-14 / AC-15 のテスト通過 | フェーズ2の「コンテンツ評価」タブを実装する画面が存在しない |
| D4（打ち切りへの対処方式） | (a)〜(d) のいずれかが選択されていること | **満了（2026-08-17）**: (b)＋(d) 併用で確定し、§11 データ量行・§10.2・AC-13・§3.4（+1〜2h）へ反映済み | —（解消済み） |
| フェーズ0の特性テスト | リファクタリング前の挙動が固定されていること | §3.4 フェーズ0の完了条件を満たす | フェーズ2で既存 `/analytics` の回帰を検知できない |

### 繁田さんへの確認事項（プロンプト関連）— 2026-08-17 にほぼ全件決着

評価エンジン仕様の受領により、旧 #1〜#5 は次のとおり決着した。

1. ~~システムプロンプトの最終版・出力 JSON~~ → **確定**（評価エンジン仕様 §07 verbatim。出力は5フィールド。§6.3.1 / §6.3.4）。
2. ~~評価点数の意味と算出方法~~ → **質問自体が消滅**（点数はコード算出。アンカー・点数帯は仕様で確定。§6.2）。
3. 評価に必要な記事情報の範囲 → **確定**（ユーザープロンプト変数: タイトル・URL・本文文字数・H2見出し最大10個・公開日・最終更新日。本文全文は渡さない。§6.3.3）。
4. ~~評価期間の初期値と最低条件~~ → 最低条件は **sessions ≥ 30 で確定**（BR-08）。期間の既定値（`{{days}}` の初期値）のみ実装時に既定90日で置き、変更要望があれば追従する。
5. ~~CV の定義~~ → **質問自体が消滅**（CV はスコアリングに使わない。§4.1）。

新たに開いた確認は §15.2 の Q-H（GA4 画面突合先）・Q-I（scroll イベント名）のみ。

### 15.4 トレードオフ判断

`docs/templates/requirement-definition.md` §10 に相当する。

| 判断 | 比較した案 | 採用理由 | 却下理由 | 影響 | 将来変更する条件 | 判断者 / 日 |
|---|---|---|---|---|---|---|
| GSC 評価テーブルを流用せず専用テーブルを新設（§5.2） | (a) `gsc_article_evaluations` を拡張 / (b) 専用テーブル新設 | GSC評価は順位変化の判定中心で、点数・診断・提案・履歴正本という構造が異なる | (a) は列の意味が混在し、どちらの評価か判別できない列群になる | migration・RLS・サービス層が増える | 両評価の出力契約が実質同一になった場合 | 開発チーム / 2026-08-12 |
| 記事詳細を `/analytics/[annotationId]` へ移設し、評価タブは新ルート上に実装する（§5.5 / §10.1） | (a) `/analytics/[annotationId]` 新設+移設 / (b) 既存 `/gsc-dashboard` へタブ追加 | (a) を採用。`/gsc-dashboard` という URL に GA4 由来の評価が乗る命名の齟齬（旧判断が既知トレードオフとして許容していたもの）を解消し、2026-08-13 合意たたき台（新ルート前提）と整合する。proxy のプレフィックスマッチで画面認可が単純化し、長期メンテナンス性を優先する。工数増（フェーズ1 24〜40h）は許容する | (b) は命名の齟齬が恒久化し、画面単位の proxy 保護もできない。**2026-08-13〜14 は (b) を採用していたが、2026-08-15 のユーザー決定で反転** | 移設フェーズの挿入で MVP 合計が増加（判断時点 167〜243h。2026-08-16 の回答反映後は §3.4 を正とする）。trial の到達遮断（下記行） | フェーズ2の統合レイアウト再設計（Q-C 決着によりスコープ内。§10.1） | 開発チーム＋ユーザー決定 / 2026-08-15（旧判断: 開発チーム / 2026-08-13） |
| フェーズ0（挙動不変リファクタ）を先に置く（§3.4） | (a) 先に責務分離 / (b) 既存を触らずフェーズ2で新設 | 評価固有ロジックの滲み出しを防ぎ、特性テストで回帰を検知できる | (b) は期間集計・URL正規化・欠損判定が二重化し値の食い違いが表面化する | 利用者に見えない作業へ 30〜45h を先払いする | 二重化のコストが分離のコストを下回ると判明したとき | 開発チーム / 2026-08-12 |
| 追加指標の取込を Q-A 回答まで確定しなかった（§4.1.1） | (a) MVP必須として確定 / (b) Q-A 回答待ち | (b) を採っていたことが**二重に正解**だった: 2026-08-16 に Q-A 回答で pagePath 軸へ設計変更し、さらに **2026-08-17 の評価エンジン仕様で pagePath 軸自体が失効**（PV 不使用・engagementRate は landingPage 必須）して landingPage 軸へ再反転した。いずれの時点でも先行実装していれば取込軸からやり直しだった | — | 最終形は landingPage 軸への `engagementRate` / `activeUsers` 追加（§4.1.1）。Compatibility 実測（Q-G）が migration 前の必須手順 | —（決着済み） | 開発チーム / 2026-08-14 → 2026-08-16 pagePath → 2026-08-17 landingPage で最終決着 |
| 認可は proxy の自動保護＋サーバー側多層検証とする（§3.3 / BR-07） | (a) proxy のパス保護のみ / (b) proxy 自動保護＋ページ・Server Action・Route Handler での `canAccessGa4` 検証（Instagram パターン） | (b) を採用。CLAUDE.md ポリシー（2026-08-15。「新規機能の認可はUIだけでなく、Server Action・Route Handler・APIなどのサーバー側でも検証する」）と Next.js 公式（「Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone.」§16）に従う。**旧判断（2026-08-14 の「タブ側で限定担保」）の却下理由だった「trial の既存機能締め出し」は、同ポリシーの明文化により許容へ変わった**（下記 trial 行） | (a) は proxy matcher の変更や Server Action 直叩きで認可が破れる | 既存 `gscDashboard.actions.ts`・`app/api/gsc/dashboard/*` への認可追加が必要（フェーズ1。6〜10h）。**2026-08-15 追記: 検証関数は読み取り＝`canAccessGa4` / 書き込み＝`canWriteGa4` と既存コードの使い分けに揃え、未認可時の応答形も固定した（§3.3）** | — | 開発チーム / 2026-08-15（旧判断: 開発チーム / 2026-08-14） |
| trial の記事詳細到達を遮断する（§3.3） | (a) trial の到達を維持する例外措置（proxy 除外・旧ルート維持等） / (b) 遮断を許容する | (b) を採用。CLAUDE.md「新規機能は原則 admin/paid のみ。例外は対象仕様書で明示」に対し、本件は例外を設けない。アプリ内の記事詳細への導線は元々 paid 限定の `/analytics` のみで、実害は直URLアクセスに限られる | (a) は旧ルートの二重メンテまたは認可分岐の複雑化を招く | 現在直URLで到達できる trial が redirect 後 `/unauthorized` へ落ちる（R-11）。既存利用者から見える挙動の変更だが、**クライアントの事前合意を取得済み（Q-E、2026-08-15。事前告知のみで実施可・経過措置不要。§15.1）** | trial 向けの提供方針が別途決まったとき | ユーザー決定＋クライアント合意（Q-E） / 2026-08-15 |
| 旧URLの redirect は `next.config.ts` の `redirects()` で行う（§5.5） | (a) `next.config.ts` redirects / (b) 旧 `page.tsx` を残し `redirect()` を書く / (c) proxy 内で redirect | (a) を採用。旧ページ実体の削除と両立し、`has` の named capture でクエリ→パス変換が宣言的に書け、Proxy より先に評価される（§16） | (b) は旧実体が残り削除の決定に反する。(c) は proxy の責務が肥大する | `permanent: true`（308）はクライアントにキャッシュされ、旧URLへ戻すロールバックができない（§14） | — | 開発チーム / 2026-08-15 |
| 存在しない annotationId は null detail 描画を踏襲する（§5.5） | (a) `notFound()` を導入し 404 化 / (b) 現行踏襲（null detail で描画継続） | (b) を採用。フェーズ1は挙動保存が原則であり、`notFound()`・`not-found.tsx` はリポジトリに前例0件（2026-08-15 実測）で新規UI導入になる | (a) は挙動保存の範囲を超え、404 画面の設計・文言の新規決定が必要になる | 実在しない ID でも空の詳細画面が表示される（現行同等） | フェーズ2の統合レイアウト再設計時に 404 設計を扱うと決めた場合（現時点では `notFound()` 導入は引き続き Non-goal。§3.2） | 開発チーム / 2026-08-15 |
| 未評価ソートを分離して先行リリースしない（§3.4） | (a) フェーズ0 → フェーズ2 を一括でリリース / (b) 一覧の並び替え・未評価フィルタだけを先行リリース | クライアント第1優先（§1.9.5「①未評価コンテンツのソート」）は「評価が走っていない記事を見つけて評価する」ための手段である。評価機能が無い状態では全記事が未評価となり、先行リリースしても優先要求を満たさない | (b) は DB migration と一覧RPC 再作成を2回に分けることになる | **2026-08-16 の Q-B 回答（並び替え自体を実装しない）により、本判断の対象は「未評価フィルタの先行リリース可否」に縮小した。**結論（先行リリースしない）は維持。利用者に見える変化を伴わない先行作業がフェーズ0＋フェーズ1＝54〜85h ある点は D1 提示時に論点として提示する | クライアントが「評価機能より先に一覧のフィルタだけ欲しい」と明示した場合 | 開発チーム / 2026-08-14（2026-08-16 に Q-B 反映） |
| GSC 側の scope 縮小検知をMVP対象外とする（§9.1.1） | (a) `gsc-status.ts` に `webmasters.readonly` 欠落判定を追加 / (b) MVPでは検知対象外 | 4スコープは単一同意にまとめられており（§9.1）、GA4 スコープを保ったまま GSC スコープだけが失われる状況は通常発生しない。(a) は既存の GSC 連携ステータス表示の挙動を変える | (a) は本機能の要件に根拠がなく、既存画面の連携ステータス表示へ影響が及ぶ | `webmasters.readonly` のみ剥奪時に `needs_reauth` を出せない。発生時の GSC 取込の挙動は未確認 | GSC と GA4 の同意を分離した場合、または片方剥奪の事例が観測された場合 | 開発チーム / 2026-08-14 |
| ~~並び替えは永続状態を基準とし、表示上の上書きを反映しない（§10.2）~~ | (a) 表示値で並べる / (b) 永続状態で並べる | — | — | **失効（2026-08-16）: Q-B 回答により並び替え自体を実装しないため、本判断は対象を失った。**行順は既存の `ORDER BY f.updated_at DESC NULLS LAST` のまま | 並び替えを将来実装する場合は本行の (b) を再検討の起点にする | 開発チーム / 2026-08-14 → 失効 2026-08-16 |

### 15.5 リスク

| ID | リスク | 発生条件・影響 | 可能性 | 対策 | 担当 | 状態 |
|---|---|---|---|---|---|---|
| R-01 | ~~プロンプト最終契約が未受領のまま実装着手~~ | ~~出力JSON契約が固定できない~~ | — | **解消（2026-08-17）**: 評価エンジン仕様の受領により出力契約（5フィールド）・点数の意味・診断コードがすべて確定した（§6.3.4）。スコア CHECK・Zod スキーマは即時固定可能 | — | 解消 |
| R-02 | ~~Q-A が「記事単位PVが必要」で確定~~ | ~~GA4取込軸の再設計が必要~~ | — | **二重決着（2026-08-17）**: pagePath 軸への設計変更（2026-08-16）自体が評価エンジン仕様で失効し、landingPage 軸で最終確定。MVPから隔離し続けたため、どちらの反転でも実装の手戻りは発生していない（§15.4） | 開発チーム | 決着（設計反映済み） |
| R-03 | リリース直後に評価可能な記事がほぼ無い | `engagement_rate` の取込開始日以前は欠損で `insufficient_data` になる（読了率側は既存 `engagement_time_sec` で算出可能）。**加えて sessions<30 の足切り（BR-08）により小規模記事が「データ蓄積中」になる**。両者が重なるとリリース直後の評価可能記事が想定より少ない | 高 | **§4.1.2 で決定済み（2026-08-18）: 過去90日の再取込で `engagement_rate` / `active_users` を埋め、リリース初日から既定90日の評価を可能にする**。足切りは仕様どおり（誤判定防止が目的）で緩めない。実データで評価可能記事数を事前に見積もる（§14 手順10） | 開発チーム | 解消（残るは sessions<30 の足切りによる「データ蓄積中」のみで、これは仕様どおりの挙動） |
| R-12 | GA4 画面と生値が数値レベルで一致しない | ~~取得不可で÷sessionsフォールバック~~ → **Q-G 決着（2026-08-17）で取得可・÷activeUsers 確定**。残るのは landingPage 軸×÷activeUsers の値が「ページとスクリーン」（pagePath 軸）と母集団差でずれる可能性のみ | 低〜中 | Q-H の数値突合（データのあるプロパティで実施）で突合先を確定し、UI の説明文言に突合先画面を明示する。§10.3 の突合検証を §14 手順10 に含める | 開発チーム | 可能性低減（Q-H の数値突合待ち） |
| R-13 | scroll 90% イベントが実プロパティに存在せず完読率が取れない | 完読率併用診断（流し読み型等）と人数ファネルの「最後まで」が出せない。設計上は完読率なしで評価が成立する（任意指標） | 中 | Q-I で実名を確認。取れない場合は §10.3 の率表現フォールバックで表示し、`data_quality_json` に記録 | 開発チーム | 未解消（Q-I 待ち） |
| R-14 | スコアリング定数（アンカー・500字/分・30セッション）の改版で過去の点数と比較不能になる | 定数変更後の再評価で点数が変わり、前回差分・月次推移の解釈が壊れる | 低〜中 | `scoring_config_version` を履歴に保存し（§7.3）、差分表示は同一バージョン間のみで行うか、バージョン跨ぎを明示する | 開発チーム | 対応方針決定済み |
| R-04 | Service Role 経路で `.eq('user_id', …)` を省略 | 他ユーザーの評価履歴・診断本文が漏れる | 中 | §7.2 で一次防衛線を明記。§13 DBテストでユーザー間の参照遮断を検証 | 開発チーム | 対応方針決定済み（実装時に検証） |
| R-05 | GA4 の後追い確定（24〜48時間）を記事の変化と誤読 | 改善提案の効果測定を誤る | 中 | §4.2.4 で直近48時間を `data_quality_json` に記録 | 開発チーム | 対応方針決定済み |
| R-06 | MVP対象外を実装に混ぜ込む | 要件にない作業でリリースが遅れる | 中 | §3.2 に Non-goal と理由を明記。§17 に「別チケットへ送るもの」を列挙 | 開発チーム | 対応方針決定済み |
| R-07 | 実装者が proxy の自動保護だけで十分と誤認し、Server Action / Route Handler の `canAccessGa4` を省略する | proxy matcher の変更や Server Action の直叩きで、許可されないロールが記事詳細・評価データに到達する（CLAUDE.md ポリシー違反） | 中 | BR-07・AC-12・§13 認可テストで担保。§3.3 に Next.js 公式引用（Proxy だけに頼らない）を明記 | 開発チーム | 対応方針決定済み（実装時に検証） |
| R-08 | `fetchGa4Summaries` の打ち切りに気づかず、欠けた集計で評価する | 記事の実績を過小評価した診断・提案が出る。現行のページサイズ10件では 100日までは `db-max-rows` に到達しないが、一覧の期間に上限がないため 101日以上の指定で到達しうる（§11） | 低（D4 決着後は上限すり抜け経路のみ） | D4 決着（2026-08-17。(b)＋(d) 併用）: 期間上限100日で通常経路の打ち切りを封じ、`count:'exact'` 検知＋原因・対処を含む注記を安全弁に置く（AC-13）。ページサイズは変更しない（§11 性能行） | 開発チーム | 対策確定（フェーズ2実装で解消） |
| R-09 | コード・ドキュメント・外部ブックマークに `/gsc-dashboard` 参照が残存する | 旧参照経由の遷移が redirect 頼みになり、redirect 定義の誤りが全導線へ波及する | 中 | §3.4 フェーズ1完了条件の 0件確認（**判定対象は先頭スラッシュ付きの `/gsc-dashboard` と `app/gsc-dashboard/`＝旧ルートを指すパス参照**。探索範囲は `src/`・`app/` ではなくリポジトリ全体。除外は redirect 定義・本仕様書自身・ログ接頭辞 `[gsc-dashboard]` の3つ。判定定義の正本は §3.4）、§17 の他ドキュメント同期一覧（2026-08-15 に5件へ拡充）、redirect の恒久維持（§14） | 開発チーム | 未解消（フェーズ1で対応） |
| R-10 | page.tsx の動的セグメントがリポジトリ初導入で、実装パターンの前例がない | `params`（Promise）の await 漏れや、`/analytics/components` 等の擬似セグメントの想定漏れで表示不具合が出る | 低〜中 | §5.5 で設計を固定（既存 Route Handler の `[annotationId]` パターンを参照）。AC-14 の null detail シナリオと E2E で担保 | 開発チーム | 対応方針決定済み |
| R-11 | 移設リリース後も、開きっぱなしの旧タブ・保存済みブックマークから旧URLへのアクセスが続く | paid は redirect で救済されるが、trial は `/unauthorized` に落ち問い合わせが発生しうる | 中（リリース直後） | §14 手順3でリリース時に告知する。redirect は恒久維持（§5.5 / §14）。**救済されるのは GET ナビゲーションに限る**: 同梱公式は 308 について "Next.js uses the 307 temporary redirect, and 308 permanent redirect status codes to explicitly preserve the request method used."（`redirects.md:32`）、Server Function について "they are handled as POST requests to the route where they are used"（`proxy.md`「Execution order」の Good to know）と述べる。**旧タブ内に残った画面から Server Action を実行した場合はメソッドを保ったまま新ルートへ転送されるため、救済されるとは限らない。告知では旧タブの再読み込みを促す。**`trial` の遮断は事前合意済み・経過措置不要（Q-E、§15.1） | 開発チーム | 対応方針決定済み（Q-E 合意済み） |

## 16. 外部仕様の根拠

外部仕様は 2026-08-12 に Google 公式ドキュメントを確認した。以下、公式ページ本文の verbatim 引用と解釈を分離する。

### GA4 Data API — `engagementRate`

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- 確認日: 2026-08-12
- 公式記載（引用）:

> The percentage of engaged sessions (Engaged sessions divided by Sessions). This metric is returned as a fraction; for example, 0.7239 means 72.39% of sessions were engaged sessions.

- 解釈: エンゲージメント率は GA4 指標として定義されている。MVP で使うことは Q7 回答（2026-08-16）で確定。**取得軸は 2026-08-17 の評価エンジン仕様で `landingPage` に確定した（旧 pagePath 方針は失効）。**engagementRate・landingPage はともにセッションスコープで同軸だが、互換の最終確認は Compatibility API で実測してから取込に追加する（§4.1.1 / Q-G）。読み始め率として評価エンジンの2大入力の1つになる。

### GA4 Data API — `screenPageViews`

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- 確認日: 2026-08-12
- 公式記載（引用）:

> The number of app screens or web pages your users viewed. Repeated views of a single page or screen are counted. (screen_view + page_view events).

- 解釈: PV 指標は GA4 で定義されている。既存取込には含まれない。~~MVP 対象（Q-A / Q7、pagePath 軸）~~ → **失効（2026-08-17）**: 評価エンジン仕様に PV は登場せず、スコアリング・取込ともに対象外となった（§4.1）。引用は歴史記録として残す。

### GA4 Data API — `userEngagementDuration`

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- 確認日: 2026-08-12
- 公式記載（引用）:

> The total amount of time (in seconds) your website or app was in the foreground of users' devices.

- 解釈: 滞在時間指標。既存 `ga4_page_metrics_daily.engagement_time_sec` に対応。

### GA4 Data API Compatibility

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/checkCompatibility
- 確認日: 2026-08-12
- 公式記載（引用）:

> This compatibility method lists dimensions and metrics that can be added to a report request and maintain compatibility.

- 解釈: 指標追加前に互換性を検証する設計とする。

### GA4 Data API Quotas

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/quotas
- 確認日: 2026-08-12
- 公式記載（引用）:

> Core Tokens Per Property Per Day | 200,000
> Core Tokens Per Property Per Hour | 40,000
> Core Tokens Per Project Per Property Per Hour | 14,000
> Core Concurrent Requests Per Property | 10

- 再確認日: 2026-08-14（4行すべてを同 URL で確認）
- 解釈: §9.2.1 の上限値。Standard Property 前提。

### Search Console Search Analytics API — レスポンス行

- URL: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- 確認日: 2026-08-12
- 公式記載（引用）:

> `rows[].clicks` | Click count for the row.
> `rows[].impressions` | Impression count for the row.
> `rows[].ctr` | Click Through Rate (CTR) for the row. Values range from 0 to 1.0, inclusive.
> `rows[].position` | Average position in search results.

- 解釈: GSC 正本指標。`page` ディメンション指定でページ単位取得可能（同ページ Request body 定義参照）。

### Search Console — `rowLimit` / `dataState`

- URL: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- 確認日: 2026-08-12
- 公式記載（引用）:

> `rowLimit` | [Optional; Valid range is 1–25,000; Default is 1,000] The maximum number of rows to return.
> `dataState` | [Optional] If "all" (case-insensitive), data will include fresh data. If "final" (case-insensitive) or if this parameter is omitted, the returned data will include only finalized data. If "hourly_all" (case-insensitive), data will include hourly breakdown.

- 再確認日: 2026-08-14（`dataState` の3文目を追加取得し、引用を公式本文と同一にした）
- 解釈: §9.3.1 / §4.2.4 の根拠。`dataState` は3値であり、MVPは既定の `final` を使う（§4.2.4）。

### GA4 — `landingPage` ディメンションの定義

- URL: https://support.google.com/analytics/answer/9143382 （ページ名: "Analytics dimensions and metrics"）
- 確認日: 2026-08-14
- 公式記載（引用）:

> Landing page: "The page path associated with the first page view in a session."

- 解釈: `landingPage` はセッションの最初のページビューに紐づくページパスであり、スコープはセッションである。**2026-08-17 以降の役割**: 評価エンジン仕様が「読み始め率は必ず landingPage 次元で取得する（pagePath だとセッション指標が歪む）」と定める根拠がこのセッションスコープ性である。旧論点（`landingPage × screenPageViews` が記事単位PVと一致するか）は PV 不使用により消滅した。

### GA4 Data API — 平均エンゲージメント時間の定義（predefined-reports）

- 参照: https://developers.google.com/analytics/devguides/reporting/data/v1/predefined-reports（確認日 2026-08-17）
- 引用（verbatim）: Pages and screens レポートの指標式 `"averageEngagementTime", "expression": "userEngagementDuration/activeUsers"`（dimension: `unifiedPagePathScreen`）。Landing page レポートの指標式 `"averageEngagementTimePerSession", "expression": "userEngagementDuration/sessions"`。
- 解釈: 評価エンジン仕様 §02 の「平均エンゲージメント時間 = userEngagementDuration ÷ activeUsers（GA4「ページとスクリーン」と同じ定義）」は公式のレポート定義と一致する。ただし **GA4 のランディングページ標準レポートは ÷sessions を表示する**ため、landingPage 軸で取得する本実装の生値がどちらの画面と一致すべきかは Q-G（activeUsers の互換実測）と Q-H（突合先の確認）で確定する（§4.1.1 / §15.2）。`activeUsers` 単体の API スキーマ定義の verbatim は未取得（下記「公式未確認」）。

### Google OAuth 2.0 — リフレッシュトークンの失効条件

- URL: https://developers.google.com/identity/protocols/oauth2
- 確認日: 2026-08-14
- 公式記載（引用）:

> The user has revoked your app's access
> The refresh token has not been used for six months
> The user changed passwords and the refresh token contains Gmail scopes
> The user account has exceeded a maximum number of granted (live) refresh tokens

- 解釈: §9.1.1 の「6 ヶ月未使用」の出典。本アプリの scope 構成（§9.1 の4スコープ）に Gmail は含まれないため、「パスワード変更＋Gmail scope」の条件は該当しない。

### GA4 Data API — レポート行数上限

- URL: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
- 確認日: 2026-08-13
- 公式記載（引用）:

> `limit`: "The number of rows to return. If unspecified, 10,000 rows are returned. The API returns a maximum of 250,000 rows per request, no matter how many you ask for."

- 解釈: §9.2 のページング要件の根拠。

### GA4 — データ処理遅延

- URL: https://support.google.com/analytics/answer/11198161
- 確認日: 2026-08-13
- 公式記載（引用）:

> "Data processing can take 24-48 hours. During that time, data in your reports may change."

> Standard intraday: "2-6 hours"

> Daily: "12 hours"

- 再確認日: 2026-08-14（データ鮮度の2行を追加取得）
- 解釈: §4.2.4 の根拠。直近48時間の値は後から変動しうる。本アプリの対象は Standard プロパティであり、その反映間隔は intraday 2〜6時間 / daily 12時間である。

### Search Console — 全行返却の非保証と `dataState` の値

- URL: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- 確認日: 2026-08-13
- 公式記載（引用）:

> `startRow`: "Zero-based index of the first row in the response. Must be a non-negative number. If `startRow` exceeds the number of results for the query, the response will be a successful response with zero rows."

> "The API is bounded by internal limitations of Search Console and does not guarantee to return all data rows but rather top ones."

- 再確認日: 2026-08-14（`startRow` の後段を追加取得）
- 解釈: §9.3 の根拠。`dataState` の3値の引用は「Search Console — `rowLimit` / `dataState`」節に置き、同節で `hourly_all` を含む公式本文全文に揃えた。本書 §4.2.4 の2値記載はこれに合わせて訂正済み。

### Search Console — クォータ

- URL: https://developers.google.com/webmaster-tools/limits
- 確認日: 2026-08-13
- 公式記載（引用）:

Search Analytics の QPS quota として、公式は次の区分と値を示す（区分名は公式表記、値は verbatim）。

> Per-site quota（calls querying the same site）: "1,200 QPM"

> Per-user quota（calls made by the same user）: "1,200 QPM"

> Per-project quota（calls made using the same Developer Console key）: "30,000,000 QPD" / "40,000 QPM"

- 再確認日: 2026-08-14（3区分の値と区分の説明を再取得。値はいずれも公式と一致）
- 解釈: §9.3.1 の根拠。単一 GCP プロジェクトで全ユーザー分を呼ぶため per-project QPM が実効上限。1ユーザーが複数サイトを持つ場合は per-user が先に効く。

### Next.js — redirects と Proxy

- 出典: 本リポジトリにインストール済みの Next.js（16.2.9）同梱ドキュメント。CLAUDE.md の指示（`node_modules/next/dist/docs/` を正本とする）に従い、nextjs.org ではなく同梱版を引用する。
- 参照ファイル: `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md`、`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
- 確認日: 2026-08-15
- 公式記載（引用、redirects.md）:

> `permanent` `true` or `false` - if `true` will use the 308 status code which instructs clients/search engines to cache the redirect forever, if `false` will use the 307 status code which is temporary and is not cached.

> When a redirect is applied, any query values provided in the request will be passed through to the redirect destination.

> `value`: `String` or `undefined` - the value to check for, if undefined any value will match. A regex like string can be used to capture a specific part of the value, e.g. if the value `first-(?<paramName>.*)` is used for `first-second` then `second` will be usable in the destination with `:paramName`.

- 公式記載（引用、redirects.md「Why does Next.js use 307 and 308?」の末尾）:

> Next.js uses the 307 temporary redirect, and 308 permanent redirect status codes to explicitly preserve the request method used.

- 公式記載（引用、proxy.md「Execution order」）:

> 1. `headers` from `next.config.js`
> 2. `redirects` from `next.config.js`
> 3. Proxy (`rewrites`, `redirects`, etc.)

- 公式記載（引用、proxy.md「Execution order」の Good to know）:

> Server Functions are not separate routes in this chain. They are handled as POST requests to the route where they are used, so a Proxy matcher that excludes a path will also skip Server Function calls on that path.

> Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone.

- 解釈: §5.5 の redirect 設計の根拠。(1) `permanent: true` は 308 で恒久キャッシュされるため旧URLへ戻すロールバックは不可（§14）。(2) **リクエストのクエリはすべて（"any query values"）redirect 先へ引き継がれる。**公式は `has` の named capture で消費したキーを destination のクエリから除外するとは述べておらず、**`annotationId` が残るか否かは公式未記載＝未確認**である。§5.5 / AC-15 はこの点を期待挙動として固定せず、フェーズ1で 308 応答の `Location` を実測して確定する（新ルートは route param を正とし残留クエリを読まない）。(3) `has` の named capture でクエリ値を destination のパスパラメータへ展開できる。(4) redirects は Proxy（`proxy.ts`）より先に評価されるため、旧URLアクセスは redirect → proxy の paid 判定の順に処理される（§3.3）。(5) Server Function 内での認可検証は公式推奨であり BR-07 の根拠となる。(6) 308 はリクエストメソッドを保ち、Server Function は使用ルートへの POST として扱われるため、**旧URLの redirect が救済するのは GET ナビゲーションであって、旧タブ内の Server Action 実行が救済されるとは限らない**（R-11）。

### 公式未確認（アプリ定義とする）

| 項目 | 理由 |
|---|---|
| `landingPage` × 検索指標の非互換 | 公式 API スキーマ本文に明示記述なし（2026-08-13 再確認）。既存 `ga4ImportService` のコード内コメントを正とする（コメントであり公式正本ではない点に注意） |
| `landingPage` × `activeUsers` の可否 | 公式ドキュメントに明示記述は無いが、**2026-08-17 に GA4 Query Explorer の `runReport` 実測で互換を確認**（エラーなく受理・`metricHeaders` に返却。Q-G 決着＝§15.2）。公式記述ではなく実測を根拠とする点に注意 |
| GA4 公式レポート（"Landing page" / "Pages and screens"）の構成 | ~~特定できていない~~ → **2026-08-17 に Data API predefined-reports で確認**（上記「平均エンゲージメント時間の定義」節）。Pages and screens は `÷activeUsers`、Landing page は `÷sessions` の指標式を持つ |
| `engagementRate` / `activeUsers` / `userEngagementDuration` の API スキーマ本文 | 引用元 `.../data/v1/api-schema` の Metrics セクションが取得時に truncate され、本文へ到達できていない（2026-08-13・2026-08-14・2026-08-17 の3回）。`activeUsers` の定義 verbatim は未取得 |
| 拡張計測 scroll イベント（90%発火）の仕様と実プロパティのイベント名 | 評価エンジン仕様は標準 `scroll` を前提とするが、既存取込は `scroll_90` ハードコード（`ga4-utils.ts:1`）。実プロパティの実名は Q-I で確認する |

## 17. 変更影響とドキュメント

- フェーズ0の変更対象候補: `src/server/services/analyticsContentService.ts` の内部分離、新規の評価Context・状態・エラー型、新規の構造化LLMアダプター、単体/回帰テスト。`contentAnnotationSummaryService.ts` と `llmService.ts` は既存挙動不変のため変更しない。
- フェーズ1（ルート移設）の変更対象: `app/analytics/[annotationId]/` の新設一式（`app/gsc-dashboard/` からの移設。§5.5）、`app/gsc-dashboard/` の削除、`next.config.ts`（redirects 新設）、`src/components/AnalyticsTable.tsx`（詳細ボタンの遷移先URL）、`src/components/GlobalToastBridge.tsx`（**D5 の確定後に対象化。(a) を選ぶ場合は変更対象から外れる**。§5.5）、`src/server/actions/gscDashboard.actions.ts`（`revalidatePath` 4箇所＋公開6関数への認可追加。読み取り2本＝`canAccessGa4` / 書き込み4本＝`canWriteGa4`）、`src/server/actions/gscNotification.actions.ts`（`revalidatePath` 1箇所）、`app/api/gsc/dashboard/route.ts`・`app/api/gsc/dashboard/[annotationId]/route.ts`（`canAccessGa4` 追加・403 応答）、`src/domain/errors/error-messages.ts`（**GA4 群へ機能アクセス拒否の文言定数を新設。§3.3 未認可時の応答契約**）、`tests/unit/server/lib/`（`ga4-permissions` テスト新設。`canAccessGa4` / `canWriteGa4` 両方）、移設テスト・E2E。
- フェーズ2の変更対象候補（2026-08-17 更新）: **スコア算出エンジン（新設純関数群: 文字数正規化・期待読了時間・アンカー補間・幾何平均・診断マトリクス・足切り。§6.2）**、`src/server/services/`（評価サービス・順位/差分算出・メディア全体集計）、`src/server/actions/` または Route Handler、`src/types/`、`supabase/migrations/`（評価テーブル・settings・trigger・開始/完了RPC・`wp_image_count`）、`src/components/AnalyticsTable.tsx`（評価状態列・未評価フィルタ。並び替えは実装しない＝Q-B）、`app/analytics/[annotationId]/`（記事カード評価UI＋**情報階層のたたき台統合レイアウトへの再設計**＝Q-C。既存3タブの機能・データは維持する）、`app/ga4-dashboard/`＋`ga4Dashboard.actions.ts`（メディア全体スコア・散布図。§10.6）、`src/server/services/wordpressContentSync.ts`（img タグ数算出）、評価用・全体集計用入口での認可検証（§3.3 / BR-07 / AC-12）、`get_filtered_content_annotations` の再作成（未評価フィルタ・評価テーブルJOIN・返却フィールド追加。並び替えパラメータは追加しない）、`.agents/skills/growmate-ui-ux/ui-text.md`（「評価」行の修飾ルール更新・`/gsc-dashboard` 表記の差し替え・**§10.7 用語言い換え表の転記**）、既存画面の表示文言（用語言い換えの UI 全体適用＝§10.7。GSC タブ・既存 GA4 ダッシュボード等の GA4 用語置換）。
- GA4取込拡張の変更対象（2026-08-17 に対象変更）: `src/server/services/ga4ImportService.ts`（既存 `landingPage` 軸クエリへの `engagementRate` / `activeUsers` 追加。取り出しインデックス・`mergeReports` 集計・`rowsToSave` の連鎖改修）、`src/server/lib/ga4-metrics-aggregation.ts`（型・集計）、`src/server/services/supabaseService.ts`（upsert）、select 文字列3箇所（`analyticsContentService.ts:278`・`ga4Dashboard.actions.ts:226,382,639`）、`src/server/services/ga4Service.ts`（`checkCompatibility` 経路の新設。§4.2.2 / §9.2）、`ga4_page_metrics_daily` の追加列 migration（`engagement_rate` / `active_users`）、§4.1.2 の後方互換対応。いずれも取込拡張（8〜14h）に含む。
- §4.1.2 後方互換の導線（2026-08-19 追加。AC-18）: `src/components/Ga4BackfillButton.tsx`（新規。`backfillDays` 送信・打ち切り/サンプリング警告・完了後の再読込コールバック）、`app/ga4-dashboard/Ga4DashboardClient.tsx`（ヘッダーへの設置と表示中期間の再取得）、`src/components/Ga4SetupClient.tsx`（注記の追記）、`src/server/lib/ga4-sync-range.ts`（`splitGa4SyncRange`）、`src/server/services/ga4ImportService.ts`（窓ごとの取込＝`importWindow` 抽出）、`src/server/services/wordpressService.ts`（REST 一覧 normalizer で `content_text` / `image_count` を抽出）、`src/types/wordpress.ts`、`src/server/actions/wordpressImport.actions.ts`（2列の保存と差分判定）、`src/server/services/wordpressContentSync.ts`（再取得条件へ `wp_image_count IS NULL` を追加）、`src/server/services/gscSuggestionService.ts`（`cachedImageCount` の受け渡し）。
- 変更しないもの: 既存3タブの**内容と操作**（移設後も挙動保存。AC-14）、`proxy.ts`（プレフィックスマッチにより新ルートが自動的に保護対象になるため変更不要。§3.3）、`app/ga4-dashboard/` の**既存**集計ロジック・SummaryCards・ranking・timeseries（追加はメディア全体スコア＋散布図のみ。§10.6）。
- 別チケットへ送るもの: 一覧への戻り先クエリ引き継ぎ（§3.2）、存在しない annotationId の `notFound()` 導入（§15.4）、レスポンシブ・アクセシビリティの新規要件、定期Cron・非同期ジョブ、GSC `dataState` の明示指定と記録、インポート直後の自動評価、`src/server/lib/gsc-status.ts` への `webmasters.readonly` 欠落判定の追加（§9.1.1 / §15.4）。**情報階層の再設計（統合レイアウト化）は 2026-08-16 の Q-C 回答によりフェーズ2のスコープへ移動した。**
- 既知の別課題: `app/ga4-dashboard/components/RankingTab.tsx` の `/analytics?annotationId=...` は `/analytics` 側が `annotationId` を読まないため現状無効。フェーズ1後は `/analytics/[annotationId]` 形式へ更新すれば有効化できる（フェーズ1のスコープに含めるかは実装時に判断し、含めない場合は別チケット）。`app/ga4-dashboard/page.tsx` の `annotationId` / `path` searchParams 型も未使用。
- 他ドキュメントへの波及（フェーズ1実装時に同期更新する）。**2026-08-15 にリポジトリ全体を grep した結果、更新が必要な他ドキュメントは次の5件である**（R-09）。**判定範囲と更新対象は別物である**: 0ヒット判定の定義（判定対象の文字列・探索範囲・除外）は §3.4 フェーズ1の完了条件を正本とし、本表はその判定で検出された「更新すべきファイル」の一覧である。

| ファイル | 現状の記述 | 対応 |
|---|---|---|
| `docs/plans/instagram-integration-design.md:1033` | `app/analytics/[annotationId]/components/OverviewTab.tsx:111-186` を単一トースト実装の正本として参照 | 移設後パスへ更新 |
| `docs/specs/ga4-data-api-daily-cache-mvp.md:369` | 見出し「GA4 設定（/app/gsc-dashboard に統合）」 | 移設後の配置へ更新 |
| `.agents/skills/growmate-ui-ux/ui-text.md:35` | 「評価」行が「`/gsc-dashboard` の「評価を開始」「評価基準日」に合わせる」と規定 | 移設後パスへ更新。修飾ルールの一般化（§10.3）と同時に行う |
| `.agents/skills/quality-gate/manual-testing.md:52` | 「- `/gsc-dashboard` で Search Console から取得したデータが表示されるか確認する。」 | **リリース前の必須ゲート手順が旧URLを指したままになる。**移設後パスへ更新する。2026-08-15 追加（従来の同期一覧から漏れていた） |
| `docs/plans/content-annotation-ai-summary-design.md:48,349` | `app/analytics/[annotationId]/components/SuggestionDataReadiness.tsx` をスコープ外／影響なしの対象として参照（2箇所） | 移設後パスへ更新。2026-08-15 追加（従来の同期一覧から漏れていた） |

- 仕様書HTML束: `docs/plans/_html/ga4-content-evaluation-spec/` は本文改訂のたびに追従させる（直近の大改訂は 2026-08-17 の評価エンジン仕様反映）。**本文をさらに改訂した場合は、`core.yaml` の `source_label` / 行数参照と `source_refs` のアンカー行番号がずれるため、spec-to-html の手順で貼り直して `npm run spec-html:refresh` で再生成する。**なお `docs/plans/_html/` は `.gitignore:69` で除外されており、リポジトリの成果物には含まれない。
- `README.md`: Kill SwitchのDB設定変更手順、手動評価経路、設定変更時の安全側挙動、GA4取込に追加した指標の追記に加え、移設に伴う `/gsc-dashboard` 記載の更新が発生しそうなセクションとして 🚀主な機能・📁プロジェクト構成が候補。READMEの更新要否・対象セクションは実装時の `readme_sync` で最終確認する。
- 実装前の確定状況（2026-08-17 評価エンジン仕様反映後）: 旧確認事項はすべて決着または失効（§15.1 / §15.2）。プロンプト出力契約は受領で確定（§6.3.4）。フェーズ0・フェーズ1は実装完了（PR #496）。**`spec-to-pr` の実行ゲート（フェーズ2）: 全ゲート解消（2026-08-17）。D1'（再見積 231〜354h、原文正本決定後 235〜360h）は合意済み、Q-G は実測決着済みで、フェーズ2は実行できる。**Q-H（GA4 画面突合先の数値確認）・Q-I（scroll イベント名）・§4.1.2 後方互換方針は実装中〜実データ検証（§14 手順10）までに確定する。

## 18. 変更履歴

| 日付 | 内容 | 状態 |
|---|---|---|
| 2026-08-12 | 会議内容、既存実装、Google公式仕様をもとに初版作成 | ドラフト |
| 2026-08-12 | spec-review audit 指摘（SPEC-AUTHZ-001 〜 SPEC-CLIENT-001）を反映 | ドラフト・レビュー待ち |
| 2026-08-12 | spec-review audit 第2回（SPEC-OPS-002 〜 SPEC-AC-001）を反映 | ドラフト・レビュー待ち |
| 2026-08-12 | 事前リファクタリング（フェーズ0）と手動MVP・Cron・追加指標の段階実装、概算工数を追加 | ドラフト・レビュー待ち |
| 2026-08-12 | サブエージェントレビュー指摘（挙動不変範囲、評価固着、UIゲート、Kill Switch、手動時間予算、状態定義、フェーズ3契約）を反映 | ドラフト・レビュー待ち |
| 2026-08-12 | `/analytics`一覧・`/analytics/[annotationId]`統合詳細・`/ga4-dashboard`集計の3層構成、GSC詳細移設、旧URL redirect、戻りクエリ復元を追加 | ドラフト・レビュー待ち |
| 2026-08-13 | `/analytics/[annotationId]` の評価結果中心UI、状態別操作、レスポンシブ/a11y、履歴統合表示、原子評価RPC、履歴正本・owner-only DB設計を反映 | UI方針・owner-only MVP合意済み、プロンプト契約レビュー待ち |
| 2026-08-13 | レビュー指摘を反映。§6.3.1 のプロンプトバージョン追跡を既存 `prompt_versions` 参照へ修正、AC-09の掲載順を是正、§8.2 の停止文言を §10.4 に統一 | ドラフト・レビュー待ち |
| 2026-08-13 | §7/§10 の確定を受けてフェーズ1を106〜146h・1aを+30〜50hへ改訂。§15 を確定事項/未確定事項/開発側確定事項に分離 | 差し替え済み |
| 2026-08-13 | フェーズ0の完了条件に着手前の特性テスト（重み付き直帰率・impressions 0件時のCTR null・OR集約・早期return境界・ページング/フィルタ）を追加。影響範囲が `analyticsContentService` と `/analytics` 一覧に閉じることを明記 | ドラフト・レビュー待ち |
| 2026-08-14 | spec-review audit（🔴10 / 🟡20 / 🟢6）を反映。PV・エンゲージメント率の取込追加をQ-A回答待ちへ差し戻し、`needs_reauth` の永続化を撤回、所有者境界をアプリ層明示スコープへ訂正、1000行上限の論点を `fetchGa4Summaries` へ付け替え、一覧の並び替えを対象化、§11をテンプレート表形式へ、§15.4 トレードオフ・§15.5 リスクを新設。MVPは 140〜197h | 確認質問（Q-A〜Q-D）回答待ち |
| 2026-08-13 | MVP以外を仕様から除外。フェーズ1a（記事詳細の新ルート化・移設）とフェーズ2（定期Cron）を対象外にし、記事詳細は既存画面への「コンテンツ評価」タブ追加へ変更。旧フェーズ3（`engagementRate`/`screenPageViews` 取込）はパターン1〜3の条件に必要なためMVPへ繰り上げ。MVPは 148〜211h | 見積合意（D1）とUIたたき台再合意（D3）待ち |
| 2026-08-14 | spec-review audit 第2回（🔴4 / 🟡15 / 🟢7 + 継続7）を反映。`needs_reauth` の非永続化を §9.1 / §9.1.1 / AC-05 へ波及、`/gsc-dashboard` が `proxy.ts` で保護されていない実測を §3.3 に反映して AC-12 を新設、追加指標のMVP残置記述（§5.1 / §14）を Q-A 従属へ訂正、§16 の未確認引用ブロックを削除して「公式未確認」へ移動、GA4取込 Cron 不在を §8.2 / §11 / §14 に反映、§11 に「認証・認可」行と検証方法列を追加、打ち切り検知を工数・AC-13・D4 として要件化、§7.6 データ保持・§15.3 制約条件/依存関係表を新設。MVPは 143〜203h（打ち切り検知 2〜4h・認可ガード 1〜2h を追加） | 確認質問（Q-A〜Q-D・Q1〜Q4・Q7・Q8）回答待ち |
| 2026-08-14 | spec-review audit 第3回（🟡4 / 🟢3）を反映。一覧のページサイズが10件固定である実測に基づき §11 性能行・想定行数・§6.1-4 を訂正、Compatibility API が未実装である実測を §4.2.2 / §9.2 / §17 に反映、打ち切りの表示単位をページ単位に改め AC-13 を D4 従属の条件付き AC 化（D4 の循環参照も解消）、§2.7「業務ルール」（BR-01〜06）を新設。§16 の引用ラベル・GSC クォータ引用を公式表記へ | 確認質問（Q-A〜Q-D・Q1〜Q4・Q7・Q8）と D1 / D3 / D4 の確定待ち |
| 2026-08-14 | spec-review audit 第4回（🟡2 / 🟢2）を反映。Compatibility 経路を MVP 無条件から **Q-A 条件付き**へ限定し（評価経路はレポート0回のため検証対象が存在しない）工数を取込拡張12〜20hへ帰属、BR-02 の例外を実測（0 フォールバックは `fetchGa4Summaries` の集計処理内）に合わせて訂正し評価入力での無効化を §5.1 / §5.4 / §6.3.2 / §13 へ波及、打ち切りの想定行数を「10件/ページでも101日以上で到達しうる」へ訂正、D4 の (c)(d) が未見積もりである旨を明記 | 確認質問（Q-A〜Q-D・Q1〜Q4・Q7・Q8）と D1 / D3 / D4 の確定待ち |
| 2026-08-15 | **ユーザー決定により記事詳細の画面配置を反転。** `/analytics/[annotationId]` を新設し既存3タブを挙動保存で移設するフェーズ1を挿入（旧フェーズ1はフェーズ2へ改番。設計正本は §5.5 新設）。旧URL `/gsc-dashboard` は `next.config.ts` の恒久 redirect（308）とし旧ページ実体は削除、旧URLへ戻すロールバックは行わない。認可を「proxy のプレフィックスマッチによる自動保護＋サーバー側多層検証（Instagram パターン）」へ全面改訂し、`gscDashboard.actions.ts` 公開6関数・`app/api/gsc/dashboard/*` への `canAccessGa4` 追加と trial の到達遮断を許容（CLAUDE.md 2026-08-15 ポリシー・コミット 5d80411e と整合）。AC-12 書き換え、AC-14/AC-15・BR-07・R-09〜R-11 新設、R-07 書き換え、D3/Q-C を挙動保存移設の合意へ再定義、旧D2 は決定済みとして記録。§16 に Next.js（同梱 docs 16.2.9）の verbatim 引用を新設。Instagram リリース後の実測更新（`proxy.ts:11,177-179,215-217`、`app/analytics/page.tsx:59`、`/analytics` の blog/instagram 2タブ構成）。MVPは 167〜243h | 確認質問（Q-A〜Q-D・Q1〜Q4・Q7・Q8）と D1 / D3 / D4 の確定待ち |
| 2026-08-15 | ユーザー指摘により「owner-only／共有閲覧を将来別仕様で」の前提を撤去。オーナー/スタッフ共有モデルは廃止済み（スタッフレコード0件、`20260808000000_simplify_instagram_credentials_select_policy.sql` が共有パターン不要と判断し Instagram 系を自己参照へ単純化、`getUserScope` は `[userId]` を返すだけの残骸）である実測を §3.3 / §7.5 に記録し、RLS の表現を「自己参照のみ」へ統一。§11 拡張性行・§17 別チケットから共有閲覧を削除。Q6 は歴史記録として §15.1 に補記 | 同上 |
| 2026-08-16 | **ユーザーが本書を承認**（§1 のステータス・承認者を「承認済み」へ更新）。確認質問（Q-A〜Q-D・Q1〜Q4・Q7・Q8）と D1 / D3 / D4 は承認とは別に確定待ちのまま。未確定のまま `spec-to-pr` へ進まない条件（§17）は維持 | 承認済み。D1 / D3 / D4 と確認質問の確定待ち |
| 2026-08-15 | **Q-E / Q-F / D5 を決着。** Q-E はクライアント合意済み（trial の到達遮断は事前告知のみで実施可・経過措置不要）とし §15.1 へ移動、Q-F は Q-E の合意によりクローズ。D5 は (b)（`GlobalToastBridge` のパス判定を新ルートへ変え else 側遷移分岐と死んだ配線を削除）で確定し §5.5 / §13 / §15.3 へ反映。§15.4 trial 行・R-11・§14 手順3 の「合意未確認」注記を解消。フェーズ1の着手・リリース判断のブロッカーは D1（見積合意）のみに | Q-A〜Q-D・Q1〜Q4・Q7・Q8 と D1 / D3 / D4 の確定待ち |
| 2026-08-15 | spec-review audit 第5回（🟡6 / 🟢4）を反映。§3.3 に「認可関数の使い分け」（読み取り＝`canAccessGa4` / 書き込み＝`canWriteGa4`）と「未認可時の応答契約」（Server Action は `{ success:false, error: ERROR_MESSAGES.GA4.<新設定数> }`、Route Handler は 403）を新設し BR-07・§5.1・§3.4・AC-12・§13・§17 へ波及。§5.5 の `GlobalToastBridge` 行を実測（遷移分岐が到達不能）に基づき書き換え、扱いを D5 として隔離。redirect のクエリ引き継ぎを公式引用どおり「すべて引き継がれる／`annotationId` の残留は公式未記載＝未確認」に訂正し AC-15・§16 解釈(2) を同期。§17 の他ドキュメント同期一覧を3件→5件へ拡充し、§3.4 完了条件の grep 範囲をリポジトリ全体へ。§15.3 D1 背景に「利用者不可視の先行作業 54〜85h」を、§15.4 先行リリース行の影響欄にフェーズ1加算を反映。trial 遮断のクライアント事前合意を Q-E / Q-F として §15.2 へ隔離。R-11 に GET 限定である旨と公式引用を追記。§17 の HTML 束の記述を「反映済み」へ訂正 | 確認質問（Q-A〜Q-F・Q1〜Q4・Q7・Q8）と D1 / D3 / D4 / D5 の確定待ち |
| 2026-08-16 | **確認質問への回答を一括反映（ユーザー回答）。** Q1=評価パターン4分類確定（条件・改善方向を §6.2 に転記。`pattern` CHECK 4値）、Q2=70点以下の一覧化は実装しない、Q3=ROIはプロンプト側で吸収（データ連携なし）、Q4=メール配信 Non-goal 確定、Q7=取込拡張をMVP算入、Q8=コスト上限なし（開発側既定）、Q-A=**記事自体のPV**（`landingPage` 軸では不可 → `pagePath` 軸の追加取得へ設計確定。R-02 顕在化・決着）、Q-B=並び替え不実装（フィルタのみ。AC-10 書き換え・§15.4 の並び替え行失効）、Q-C=**「まとめで全てやる」**（情報階層の統合レイアウト再設計をフェーズ2へ移動。D3 決着・§10.5 合意ゲート通過）。MVP合計は **175〜257h ＋ 統合レイアウト（未見積）** へ更新。`spec-to-pr` ゲートを「D1 未合意の間は実行しない。フェーズ2着手には D4・Q-D・プロンプト最終契約が追加で必要」へ再定義 | 承認済み。D1（見積合意）待ち。フェーズ2は D4 / Q-D / プロンプト出力契約待ち |
| 2026-08-16 | **D1 見積合意（クライアント承認）。** MVP 197〜297h（25〜38人日）を提示条件2点（Compatibility 未実測前提・利用者不可視の先行作業 54〜85h）込みで合意。`spec-to-pr` ゲート解除（フェーズ0・フェーズ1実行可）。フェーズ2は D4 / Q-D / プロンプト出力契約の確定待ちを維持 | D1 合意済み。フェーズ0/1 実装可 |
| 2026-08-16 | **D1 提示準備（開発側見積の精査）。** 統合レイアウト再設計を 20〜36h で見積（たたき台3タブ基本形。タブ再編 2〜3 / 概要統合 6〜10 / 履歴統合 4〜8 / 再配置 2〜4 / テスト 4〜7 / 突合 2〜4）、取込拡張を `pagePath` 軸前提で 14〜24h に積み直し（Compatibility 新設 2〜3 / 実測 2〜4 / 第2クエリ 4〜6 / migration 1〜2 / 後方互換 2〜4 / テスト 3〜5）。MVP合計 **197〜297h（25〜38人日）**。§10.1 / §10.3 にたたき台の3タブ基本形（評価は概要へ統合表示）と「コンテンツ評価タブ＝評価UI領域の略記」の注記を追加し、AC-12 の表示条件をレイアウト非依存に修正。D1 の提示条件2点（Compatibility 未実測前提・先行作業 54〜85h の明示）を §15.3 に記録 | 承認済み。D1（見積合意）待ち。フェーズ2は D4 / Q-D / プロンプト出力契約待ち |
| 2026-08-15 | spec-review audit 第6回（🟡1 / 🟢1）を反映。第5回の修正で過大化していた §3.4 フェーズ1完了条件の 0ヒット判定を、**判定対象（先頭スラッシュ付き `/gsc-dashboard` と `app/gsc-dashboard/`＝旧ルートを指すパス参照）・探索範囲・除外（redirect 定義／本仕様書自身／ログ接頭辞 `[gsc-dashboard]` 7箇所）**の3要素に分けて定義し直し、実測で満たせる条件へ是正。あわせて改称対象外（ファイル名・識別子）も明記。§17 の「この範囲で行う」を判定範囲と更新対象の分離へ書き換え、R-09 の対策欄も同期。§18 変更履歴の表を分断していた空行を削除 | 確認質問（Q-A〜Q-F・Q1〜Q4・Q7・Q8）と D1 / D3 / D4 / D5 の確定待ち |
| 2026-08-16 | フェーズ1の 308 redirect をビルド済みサーバーで実測。`/gsc-dashboard?annotationId=X&days=90` は `Location: /analytics/X?annotationId=X&days=90`、`/gsc-dashboard` は `Location: /analytics` となることを確認し、§5.5 へ反映 | 実測済み |
| 2026-08-17 | **Q-D 決着（リモートDBの実スキーマ照会）。** リンク済みリモートDBの `information_schema.columns` を Supabase SQL エディターで照会し、`ga4_page_metrics_daily` の全21列が生成型と完全一致することを確認。`page_views integer NOT NULL DEFAULT 0` は実在（migration 未管理のドリフト列は `page_views` / `impressions` / `ctr` / `search_clicks` の4本）、`engagement_rate` は不在。取込拡張の migration は `engagement_rate` 新設のみと確定し、§4.1.2 後方互換表へ「既存行の `page_views`=0 は実測0と区別不能（境界は取込開始日）」を追記。§1 / §3.4 / §4.1 / §14 / §15.2 / §15.3 依存関係 / R-03 / §17 ゲートを同期 | フェーズ2は D4 / プロンプト出力契約待ちのみに |
| 2026-08-17 | **D4 決着（ユーザー決定）: (b)＋(d) 併用。** (d)＝一覧の表示期間に上限100日を追加（10記事/ページ × 100日 = 1,000行 ≦ `db-max-rows`。通常経路の打ち切りを封じる。+1〜2h）、(b)＝`count:'exact'` 突合の検知を安全弁として実装（2〜4h 計上済み）。「一部取得できていません」だけの注記は利用者に伝わらないという指摘を受け、注記文言は**原因と対処を含める**方針へ改訂（文言案を §10.2 に記載。確定は `ui-text.md` 正本）。AC-13 を受入対象化し (b)/(d) 前提の3シナリオへ書き換え、(c) シナリオは別チケット送りに。§3.4（打ち切り行 3〜6h・フェーズ2 144〜214h・MVP **198〜299h**）・§6.1-4・§10.2・§11・§13・§15.3 D4 行・依存関係・R-08 を同期 | フェーズ2の残ゲートは繁田さんのプロンプト出力契約のみ |
| 2026-08-17 | **プロンプト管理の画面・登録経路を明文化。** §10.1 に `/admin/prompts` 行を追加（既存画面は `prompt_templates` 全件の汎用表示＝`app/admin/prompts/page.tsx:11` のため**改修不要**）、§6.3.1 に登録経路（admin が `/admin/prompts` から手動登録。migration seed にしない＝プロンプト本文はクライアント著作物でコードと別ライフサイクル）とテンプレート未登録時の扱い（§10.4 の停止系と同じ）を追記、§14 リリース手順に手順9（確定プロンプトの登録。Kill Switch 有効化の前）を挿入し以降を繰り下げ | 記載差の解消のみ。実装スコープ・工数の変更なし |
| 2026-08-17 | **クライアント評価エンジン仕様を受領・全面反映。** 受領原文は `docs/context/ga4-evaluation-engine-spec-20260817.md`（verbatim 保存）。評価アーキテクチャを「LLM が点数・パターン・提案を生成」から「**点数・診断はコードで決定的に算出し、LLM は文章化のみ**」へ反転（§2.2 / §3.2 / §5.3 / §6 全面）。主な置換: Q1 の4分類 → **6診断コード**（読み始め×読了マトリクス。§6.2.4）、Q-A の pagePath 軸 PV 取込 → **失効**（PV・GSC・CV・直帰率はスコアリング非使用。取込拡張は landingPage 軸の `engagementRate` / `activeUsers` へ。§4.1.1）、§6.3.4 出力契約ドラフト → **5フィールド確定**（headline/situation/cause/next_action/target。score/pattern は LLM 出力から排除＝BR-09）。新規要素: 期待読了時間（文字数÷500・画像補正。`wp_image_count` 新設）、アンカー線形補間・幾何平均・`scoring_config_version`、sessions<30 足切り（BR-08 / `low_data`）、完読率併用診断、サイト内順位・前回差分、部分成功（`narrative_failed`）、記事カードUI（人数ファネル・点数バー）、メディア全体スコア＋散布図（`/ga4-dashboard` へ追加＝§10.6。旧「変更しない」を撤回）、UI用語言い換え（§10.7 / AC-17）。AC-01〜03 / AC-11 書き換え、AC-16 / AC-17 新設。§7.3 列を全面再設計（diagnosis_code 5値 CHECK・score 0-100 CHECK 即時確定）。§16 に predefined-reports の平均エンゲージメント時間定義（2026-08-17 verbatim）を追加。新規確認事項 Q-G（activeUsers 互換実測）/ Q-H（GA4 画面突合先）/ Q-I（scroll イベント名）を §15.2 に起票、リスク R-12〜R-14 新設、R-01 / R-02 解消。**見積を 198〜299h → 231〜354h（29〜44人日）へ再算定し、D1'（クライアント再提示・合意）を新設**。フェーズ2の実行ゲートは D1' ＋ Q-G（§17） | 評価エンジン反映済み。D1'（再見積合意）と Q-G（Compatibility 実測）待ち |
| 2026-08-17 | **Q-G 決着（GA4 Query Explorer 実測）。** `dimensions=[landingPage]` × `metrics=[activeUsers, engagementRate, sessions, userEngagementDuration]` の `runReport` がエラーなく受理され `metricHeaders` に4指標が返ることを確認（非互換なら 400）。読了率の分母は **÷activeUsers で確定**し、÷sessions フォールバック記述を §4.1 / §4.1.1 / §3.4 / AC-11 から解消。実測プロパティは対象期間の `rows` 0件だったため、数値レベルの画面突合は Q-H としてデータのあるプロパティで実施（実データ検証時）。R-12 は「取得不可」から「母集団差による数値ズレの可能性」へ縮小。**フェーズ2の実行ゲートは D1'（再見積合意）のみに**（§1 / §17） | 残ゲートは D1' のみ。Q-H / Q-I は実データ検証までに確定 |
| 2026-08-17 | **D1' 合意（クライアント承認）。** 評価エンジン仕様反映後の再見積 **231〜354h（29〜44人日）** を提示条件（Q-G 実測済み＝÷activeUsers 確定、Q-H/Q-I は実データ検証で消化）込みで合意。**フェーズ2の `spec-to-pr` 実行ゲートは全て解消**（§1 / §17）。§15.3 D1' 行・依存関係を満了へ更新 | フェーズ2実行可。実装中の残件は Q-H / Q-I / §4.1.2 後方互換のみ |
| 2026-08-17 | **「原文正本の原則」を決定し、受領原文との差分レビュー（網羅性・忠実性の2系統）の指摘を反映。** 解釈が割れる箇所は開発側解釈ではなく受領原文（`docs/context/ga4-evaluation-engine-spec-20260817.md`）を正とする。反映内容: (1) §6.2.4 完読率 15% 未満×読了スコア 40 未満は診断コードを **`R_TOP_EXIT` へ上書き確定**（旧「診断コードを変えない」解釈を撤回）。完読率 40% 以上×40 未満の「流し読み型」は表示のみの補助ラベル（ユーザープロンプト verbatim のため LLM へは渡さない）。(2) §6.3.4 の ```json フェンス要求を撤回し、**抽出実装をフェンス有無両対応**に変更（プロンプト本文は verbatim を維持）。(3) §10.7 / AC-17 / §13 の用語言い換えを**ツール内 UI 全体**（既存画面含む・残存ゼロ）へ拡大し、見積 +4〜6h → **MVP 235〜360h（30〜45人日）**（D1' 合意値 231〜354h からの増分としてクライアント共有）。(4) §6.2.1 の ÷sessions フォールバック残骸を削除（Q-G 決着済み）。(5) 転記欠落の復元: マトリクス「広告出稿」・`R_SKIM`「（軽度）」・直帰率行の原文文言・画像補正の条件節・round() が開発側追加である旨の注記 | 原文正本の原則を §6.2.4 / §6.3.4 / §10.7 に適用済み。見積増分のクライアント共有が未了 |
| 2026-08-18 | **§4.1.2 後方互換方針を決定（開発側決定。spec-to-pr の plan ステップが「実装前に決める」未決3件を検出して ABORT したため）。** (1) `engagement_rate` / `active_users` の既存行は **過去90日の再取込**（既存 `/api/ga4/sync` 経路。migration 適用後・Kill Switch 有効化前）で埋め、リリース初日から既定90日の評価を可能にする。評価期間の下限クランプ・欠損日除外の集計変更は行わない（BR-02 / AC-03 のセマンティクス維持）。(2) `wp_image_count` は **全記事再同期を初回リリース手順に含める**。§1 / §4.1.2 / §7.6 / §14 / §15.5 R-03 を同期（R-03 解消） | 実装中の残件は Q-H / Q-I のみ |
| 2026-08-19 | **文章化プロンプトを1本へ統合し、同日中に2本構成へ差し戻した（開発側決定）。** 統合の動機は (1) 既存の `gsc_insight_*` が1テンプレート＝1メッセージで構成が不揃いだったこと、(2) 評価履歴のプロンプト追跡がシステム側しか記録せずユーザー側の改版を追えなかったこと。**差し戻しの理由**: `llmService` は先頭の `role='system'` を messages から分離し Anthropic の top-level `system` パラメータとして送る（`llmService.ts:36-41`, `:145`）。1本へ統合すると `system` が消え、出力契約（前置きなしの5フィールドJSON）の指示位置と `cache_control: ephemeral` の経路を失う。受領仕様 §07 の2本立てにも反する。**(2) の追跡の穴は分割のまま解消**し、`prompt_content_sha256` を2本の原文を NUL 区切りで連結した hash に変更した（§7.3）。migration は `20260819000000`（統合）→ `20260819000100`（差し戻し）の2本で、いずれも本文未登録のもののみ入れ替える。あわせて §10.1 の「`/admin/prompts` は改修不要」を、カテゴリ追加が必要だった実態へ訂正 | プロンプト構成は2本のまま。追跡の穴は解消済み |
| 2026-08-19 | **Kill Switch の管理画面 `/admin/ga4-evaluation` を追加し、同日撤回（開発側決定）。** 追加の動機は「`ga4_content_evaluation_settings` に書き込む経路がコード上に無く、有効化に本番DBへの直接SQLが必要」だったこと。**撤回の理由**: 既存リポジトリの全体キルスイッチは `INSTAGRAM_SYNC_ENABLED` のような env 方式で（`instagram-integration-design.md:359` が明示的に「キルスイッチ」と呼ぶ）、`/admin` 配下は `prompts` / `users` ともマスタデータ編集に統一されており、「機能のON/OFF画面」は既存に前例が無い。既存設計と揃わない新概念を持ち込まない判断で削除し、§7.2 の当初方針（運用手順または管理者専用経路から更新）へ戻した。運用手順は README「GA4コンテンツ評価の運用」と §14 に記載済み | BR-05 / AC-06 の要件は不変。操作は運用手順で行う |
| 2026-08-19 | **§4.1.2 の後方互換方針が実装されていなかったことを検出し、導線を実装して AC-18 を新設（開発側決定）。** 本番DBの実測で `ga4_page_metrics_daily.engagement_rate` / `active_users` が 27,085 行すべて NULL、`content_annotations.wp_image_count` が 5,038 行すべて NULL であることを確認した。原因は**方針を「§14 リリース手順」＝運用手順としてのみ書き、実装スコープにも AC にも入れなかった**こと。AC が無いためテストも self-review も判定基準を持たず、実装完了と判定された。実態は (1) GA4 側＝`backfillDays` はスキーマ・ルート・範囲決定まで実装済みだが、`/setup/ga4` の同期ボタンが body を送らないため画面から過去分を取り直せない（`Ga4SetupClient.tsx:143`）。なお再取込ボタンの設置先は同日中に `/setup/ga4` から `/ga4-dashboard` へ移した（指標を見る画面に操作を置く）。(2) WordPress 側＝`wp_image_count` を書くのは `wordpressContentSync.ts:215` の1箇所のみで、`/wordpress-import` の一括インポートはこの列を書かず、記事単位の再取得条件（`:239-243`）も本文・抜粋しか見ないため本文キャッシュ済みの記事は永久に NULL のまま。仕様書の「既存記事は次回の同期で埋まる」は**実在しない導線を前提にしていた**。**対応**: `/ga4-dashboard` に「過去90日を再取込」を追加（`backfillDays` 送信・30日窓分割・打ち切り/サンプリングの警告表示）、一括インポートが `wp_content_text` / `wp_image_count` を書くよう normalizer と差分判定を拡張、`fetchWpPostContentWithCache` の再取得条件に `wp_image_count IS NULL` を追加。§4.1.1 / §4.1.2 / §14 を実導線名で書き直し、AC-18 を新設 | 運用手順が依存する導線は AC 化する（同じ抜けを繰り返さないため） |
| 2026-08-19 | **記事詳細の「コンテンツ評価」を独立タブへ切り出した（暫定。D3 / Q-C の見直しにあたるためクライアント確認待ち）。** 統合レイアウト（概要への統合表示）は 2026-08-16 の Q-C 回答「まとめで全てやる」に基づく合意だが、実装では評価カードが概要タブの最下部（メトリクスカード → 時系列グラフ → データ準備状況 → 検索順位評価サイクル設定 → コンテンツ評価）に置かれ、到達に大きなスクロールを要していた。合意の趣旨（GSC と GA4 を1画面で見る）は満たしていても、主役が末尾という配置は実装側の裁量で是正できる範囲を超えていたため、タブ化して確認にかけることにした。タブ構成は「概要」「検索クエリ」「検索順位評価」「コンテンツ評価」の4本で、既存3タブの並びは変えず右端に追加した。`ContentEvaluationTab` として切り出してあるので、統合表示へ戻す場合は概要の上部へ差し込むだけで済む。§10.1 / §10.3 を暫定である旨つきで更新 | クライアント確認で決着。統合表示に戻す可能性を残す |

## 19. レビュー記録

| finding_id | 対応 | 備考 |
|---|---|---|
| SPEC-AUTHZ-001 | 修正 | §3.3 認可表を追加 |
| SPEC-RLS-001 | 修正 | §7.2 uuid FK、§7.5 owner-only RLS、共有閲覧は別仕様へ分離 |
| SPEC-REUSE-001 | 修正 | §5.1 再利用必須リスト、§6.1 RPC/正規化 |
| SPEC-DATA-001 | 修正 | §4.2 データ契約（landingPage、死列、GSC 正本） |
| SPEC-LLM-001 | 修正 | §6.3.2 Context Assembly Contract 表。プロンプト依存項目はブロッカー明記 |
| SPEC-LLM-002 | 修正 | 既存 `prompt_versions` を参照し、hashは評価履歴側に保存。`prompt_templates`/`prompt_versions` への列追加はしない（§6.3.1 / §7.3） |
| SPEC-OPS-001 | 修正 | §8.1 手動評価の実行設計、§8.2 DB Kill Switch、§14。Cron/claim はMVP対象外へ |
| SPEC-EXT-001 | 修正 | §9 OAuth scope、§9.2.1/§9.3.1 クォータ |
| SPEC-EXT-002 | 修正 | §16 verbatim 引用に置換 |
| SPEC-EXT-003 | 修正 | §9.1.1 連携ライフサイクル |
| SPEC-SCOPE-001 | 修正 | §3.2/§17 で `ga4-dashboard` Non-goal 明示 |
| SPEC-CLIENT-001 | 修正 | §15.2 の未確定Qに隔離し本文で断定しない。回答済みのQ5/Q6は §15.1 へ分離 |
| SPEC-OPS-002 | 修正 | §8.2 未設定/false→停止、明示 `true` のみ許可 |
| SPEC-XREF-001 | 修正 | §4.1 CV 参照を §15 繁田確認 #5 に修正 |
| SPEC-LLM-003 | 修正 | §9.4.1 再試行回数 3・間隔固定 |
| SPEC-TMPL-001 | 修正 | §2.4 KPI 表、§2.5 関係者、§2.6 As-Is/To-Be |
| SPEC-AC-001 | 修正 | §12 AC-06〜08 追加 |
| SPEC-UI-001 | 差し替え | 3層構成・移設・旧URL互換は SPEC-SCOPE-002 でMVP対象外へ。MVPは §10.1 の画面責務表（一覧＋既存記事詳細へのタブ追加）を正とする |
| SPEC-PROMPT-001 | 修正 | §6.3.1 が実在する `prompt_versions` を「将来必要になれば」と記述し §7.3 と矛盾していた。既存テーブル参照に統一（§6.3.1 / §7.3） |
| SPEC-AC-002 | 修正 | AC-09 が AC-11 の後に置かれていた掲載順を是正（§12） |
| SPEC-UITEXT-001 | 修正 | §8.2 の停止文言「GA4コンテンツ評価は…」を §10.4 の「評価機能は現在停止中です」に統一し、§10.4 を正本と明記 |
| SPEC-EST-001 | 修正 | §3.4 をMVP（フェーズ0+1 = 148〜211h）に再構成し、フェーズ1の内訳表を追加。合意はD1 |
| SPEC-SCOPE-002 | 修正 | 要件（`docs/context/client-vision-from-lark.md` §1.9.2/§1.9.3）に画面配置の指定がないため、記事詳細の新ルート化・移設と定期CronをMVP対象外にした（§3.2）。記事詳細は既存画面への「コンテンツ評価」タブ追加（§10.3） |
| SPEC-TEST-001 | 修正 | フェーズ0完了条件が「GA4集計値の挙動不変」を要求する一方、それを検証するテストが0件（既存はRPC引数検証3件のみ）で検証不能だった。着手前の特性テストを完了条件・§5.4・§13・§14・AC-00 に追加 |
| SPEC-SCOPE-003 | 修正 | パターン1はPV、パターン2・3はPVとエンゲージメント率を条件に使うため、`screenPageViews`/`engagementRate` の取込追加を任意扱いからMVP必須へ変更（§3.1 / §4.1 / AC-10） |
| SPEC-XREF-002 | 修正 | 回答済みQ5/Q6が「未確定事項・実装契約に確定値を書かない」表に混在。§15.1/§15.2/§15.3 に分離 |

### 2026-08-14 audit 第1回（対応37行）

前ラン audit レポートは冒頭サマリーで「🔴10 / 🟡20 / 🟢6」（計36）と記載する一方、判定欄では「`new` が 38 件」としており、レポート自身の内訳が一致していない。したがってここでは内訳を再掲せず、**本節の実表行数（37行）を正**とする。

| finding_id | 対応 | 備考 |
|---|---|---|
| ARCH-NEW-spec-L167 | 修正 | `landingPage` × `screenPageViews` の意味論を §4.1.1 に明記し、MVP必須化を撤回して Q-A へ隔離 |
| ARCH-NEW-spec-L845 | 修正 | §3.1 / §4.1 / §3.4 / AC を Q-A 待ちへ統一。旧AC-10 は AC-11（条件付き）へ移動。**§5.1 と §14 は未反映だったため 2026-08-14 第2回で再修正（`ARCH-NEW-spec-L241`）** |
| ARCH-NEW-spec-L378 | 修正 | §7.2 に防衛線の責任分担表を追加。§7.5 冒頭に「実行経路ではRLSがバイパスされる」を明記 |
| ARCH-NEW-spec-L595 | 修正 | §6.1-4 / §11 の打ち切り論点を `fetchGa4Summaries` へ付け替え。`count:'exact'` 検知を要件化 |
| ARCH-NEW-spec-L10 | 修正 | §1 承認欄を分離し「未承認。owner-only のみ合意済み、UI方針は再合意待ち」へ |
| ARCH-NEW-spec-L194 | 修正 | §4.2.4 を公式引用（24-48時間）に差し替え、§16 に引用を追加、公式未確認表から削除 |
| ARCH-NEW-spec-L472 | 修正 | §9.1.1 の scope 不足を `needs_reauth` へ訂正 |
| ARCH-NEW-spec-L578 | 修正 | §6.5 に永続/非永続の区分表と表示優先順位を追加。`needs_reauth` の永続化を撤回。**§9.1 / §9.1.1 / AC-05 は未反映だったため 2026-08-14 第2回で再修正（`ARCH-NEW-spec-L539` / `L771`）** |
| ARCH-NEW-spec-L543 | 修正 | §10.2 に並び替えを追加し AC-10 を新設。§3.4 に 4〜6h を計上 |
| ARCH-NEW-spec-L775 | 修正 | §4.1.2 に後方互換の未決事項表を新設。Q-D を §15.2 へ |
| ARCH-NEW-spec-L561 / L554 | 修正 | §10.3 の表記を `ui-text.md` 準拠へ。両方の評価に修飾を付ける方針を採用し §17 に辞書更新を追加。**引用文が辞書の実文と異なっていたため 2026-08-14 第2回で verbatim へ差し替え（`ARCH-NEW-spec-L646` / `L645`）** |
| ARCH-NEW-spec-L195 | 修正 | `dataState` は MVP 対象外として §4.2.4 に明記し §17 の別チケットへ |
| ARCH-NEW-spec-L389 | 修正 | §7.3 に hash 対象（`prompt_versions.content` 原文）と `prompt_captured_at` を定義。`updated_at` 不在を反映 |
| ARCH-NEW-spec-L434 | 修正 | §8.1 に `timeoutMs: 45000` と `maxTokens` の明示上書きを追加 |
| ARCH-NEW-spec-L322 | 修正 | §6.3.4 に ```json フェンス要件を追加 |
| ARCH-NEW-spec-L347 | 修正 | §5.1 に一覧RPCの追加パラメータ・JOIN・返却フィールドを列挙。§6.5 で `eligible` は詳細のみ導出と確定 |
| ARCH-NEW-spec-L444 | 修正 | §8.2 に表示の合成規則を追加（一覧RPCは settings を参照しない） |
| ARCH-NEW-spec-L318 | 修正 | LLM出力側を `llm_data_quality` へ改名し、`data_quality_json` との関係を §7.3 に明記 |
| ARCH-NEW-spec-L504 | 修正 | §9.3.1 に per-user / per-project を追加し §16 に引用を記録 |
| ARCH-NEW-spec-L493 | 修正 | §9.2.1 を「評価実行時にレポートAPIを呼ばない」で統一 |
| ARCH-NEW-spec-L479 | 修正 | §9.2 に行数上限の引用とページング要件を追加 |
| ARCH-NEW-spec-L497 | 修正 | §9.3 に全行返却非保証の引用と `data_quality_json` 記録を追加 |
| ARCH-NEW-spec-L873 | 修正 | §16 の checkCompatibility 引用を公式本文の verbatim へ差し替え |
| ARCH-NEW-spec-L378b | 修正 | §14 手順4 に判定SQL付きの事前確認を挿入 |
| ARCH-NEW-spec-L588 | 修正 | §11 をテンプレート §7 の表形式へ置換し、対象外項目に理由を記載。**「認証・認可」分類と「検証方法」「状態・根拠」列が欠落していたため 2026-08-14 第2回で補完（`ARCH-NEW-spec-L677`）** |
| ARCH-NEW-spec-L110 | 修正 | §3.3 に削除の認可行を追加 |
| ARCH-NEW-spec-L790 | 修正 | §15.4 トレードオフ判断・§15.5 リスクを新設。§1 にメタデータ4行を追加 |
| ARCH-NEW-spec-L83 | 修正 | §3.4 にフェーズ0の代替案比較表を追加 |
| ARCH-NEW-spec-L167b | 修正 | §4.1.2 に `page_views` 列のドリフト論点を追加し Q-D へ |
| ARCH-NEW-spec-L98 | 修正 | §3.2 に自動評価 Non-goal の出典（§1.9.5）を明記 |
| ARCH-NEW-spec-L535 | 修正 | §10.1 / §17 を「内容と操作を変更しない（グリッド定義は変更する）」へ |
| ARCH-NEW-spec-L608 | 修正 | 特性テストの固定対象に直帰率0フォールバックと `ctr` 再計算を追加 |
| ARCH-NEW-spec-L908 | 修正 | `dataState` の列挙に `hourly_all` を追加 |
| ARCH-NEW-spec-L456 | 修正 | §9.1 のスコープ表に4スコープと単一同意である旨を反映 |
| ARCH-NEW-spec-L947 | 修正 | §19 の集計を実表に合わせて訂正。**訂正後の「計62件」も実表と一致していなかったため 2026-08-14 第2回で再訂正（`ARCH-NEW-spec-L1240`）** |
| ARCH-NEW-spec-L283 | 修正 | §6.3.2 #1 に既存定数のセマンティクス差（拒否閾値 vs 削減予算）を注記 |
| ARCH-NEW-spec-L242（テンプレ FR-ID表・シナリオ対応表） | 残置 | FR-ID 体系の導入はプロンプト契約（Q1）確定後に一括で行う方が手戻りが少ないため、確定まで残置する。**当初の残置理由（「§12 の AC が §2.3 と §1.9.2/§1.9.3 の要求に1対1で対応する」）は成立していなかったため、2026-08-14 第2回で §12 末尾に AC ↔ 成功条件・要求出典の対応表を追加し、§2.3 に未評価コンテンツの発見を成功条件として追加した（`ARCH-PERSIST-spec-L242`）。**`ARCH-NEW-spec-L790` はこの行に併記されていたが、同 ID は上表で「修正」済みのため併記を解消した |

### 2026-08-14 audit 第2回（new 24件 / persists 7件）

| finding_id | 対応 | 備考 |
|---|---|---|
| ARCH-NEW-spec-L539 | 修正 | §9.1 の「`needs_reauth` として保存し」を、§6.5 の非永続状態として表示時に導出する記述へ置換。§9.1.1 の列を「表示（非永続）／永続・既存結果の扱い」に分離 |
| ARCH-NEW-spec-L112 | 修正 | §3.3 に `proxy.ts:10`・`app/gsc-dashboard/page.tsx`（フェーズ1で廃止）・`gscDashboard.actions.ts` の実測を明記。評価タブ側で `canAccessGa4` を検証する方針を §15.4 の判断として記録し、AC-12・§11「認証・認可」・§13 認可テスト・§17 変更対象を追加 |
| ARCH-NEW-spec-L1077 | 修正 | 引用元 URL に存在しないレポート構成の引用2ブロックを §16 から削除。`landingPage` の定義引用を公式実文（"first page view"）へ差し替え、レポート構成は「公式未確認」表へ移動。§4.1.1 の断定を削り、Q-A の根拠を「公式未記載であること自体」に置換 |
| ARCH-NEW-spec-L241 | 修正 | §5.1 の「MVPで取得を追加する」を Q-A 回答後の対象化へ、§14 ロールバックの該当文を条件節付きへ変更 |
| ARCH-NEW-spec-L771 | 修正 | §9.1.1 に「永続は `evaluation_failed` + `error_code='needs_reauth'`」を定義。AC-05 を表示・永続・再連携後の自動解消の3観点へ分割 |
| ARCH-NEW-spec-L941 | 修正 | Q7 を Q-A 従属の質問へ書き換え。§16 の `engagementRate` / `screenPageViews` 節の参照先を Q-A へ更新 |
| ARCH-NEW-spec-L677 | 修正 | §11 に「認証・認可」行を追加し、テンプレートの「検証方法」「状態・根拠」列を復活。AI観点表は `requirement-definition.md:147-154` の6項目を網羅したうえで、入力制御・再現性を加えた8行とした |
| ARCH-NEW-spec-L627 | 修正 | §10.2 に「並び替えは永続状態を基準とし、表示上の上書きは反映しない」を明記。AC-10 にシナリオを追加し、§13・§15.4 に反映 |
| ARCH-NEW-spec-L682 | 修正 | §3.4 に打ち切り検知（2〜4h）を計上、§10.2 に一覧側の挙動、§12 に AC-13、§11 に想定行数（100記事×10日で1,000行到達）と D4 を追加 |
| ARCH-NEW-spec-L304 | 修正 | §6.2 にクライアント提示表が4行（4分類目「全指標良好」）である実測を記載し、Q1 に分類数と表記揺れの確認を含めた |
| ARCH-NEW-spec-L1240 | 修正 | 第1回の見出しから内訳（前ランレポート自身が不整合）を外し実表行数へ。`L790` の二重記載を解消。集計を下記「残置（理由付き）」で行数ベースに訂正 |
| ARCH-NEW-spec-L522 | 修正 | §8.2 に取込経路の実測表（GA4 取込 Cron は不在、`/api/ga4/sync` のユーザー起動）を追加。§11 可用性行・§14 ロールバックも同様に訂正 |
| ARCH-NEW-spec-L547 | 修正 | §9.1.1 に `gsc-status.ts:20` の実測と、GSC scope 縮小をMVP検知対象外とする理由を記載。§15.4 に判断、§17 に別チケットとして記録 |
| ARCH-NEW-spec-L646 | 修正 | §10.3 で `ui-text.md`「評価」行の実文を verbatim 引用し、GA4 由来の評価が辞書未規定であることと本仕様の方針（辞書の一般化）を分けて記載 |
| ARCH-NEW-spec-L971 | 修正 | §15.4 に「未評価ソートの分離先行リリース」判断を追加（採用: 一括リリース）。D1 の背景に提示時の論点化を明記 |
| ARCH-NEW-spec-L657 | 修正 | §6.5 に一覧／詳細での `unassessed` の意味の違いを表で定義。§10.4 の該当行を「未評価（データが不足）／不足項目を確認／評価を実行ボタンを表示しない」へ修正し、表が詳細画面用であることを明記 |
| ARCH-NEW-spec-L931 | 修正（一部未確定） | §7.6 データ保持・削除、§15.3 制約条件・依存関係表、§15.2 の回答者・期限・状態列、§15.5 の ID・担当・状態列、§14 ロールバック判断者を追加。**個別の回答期限日は未設定であり、D1 提示時に確定する旨を明記した（未確定であることを可視化した状態で残置）** |
| ARCH-NEW-spec-L206 | 修正 | §4.1.2 に生成型ドリフトの反例（`prompt_versions.change_summary`）を追記し、Q-D をリモート実スキーマ照会に限定 |
| ARCH-NEW-spec-L645 | 修正 | §10.3 の GA4 表記を、辞書の実文引用と略語ルール適用による導出に分離 |
| ARCH-NEW-spec-L1039 | 修正 | §16 GA4 クォータに Per Project Per Property Per Hour / Concurrent Requests の2行を追記（2026-08-14 再取得） |
| ARCH-NEW-spec-L1101 | 修正 | §16 GA4 データ処理遅延に Standard intraday / daily の引用を追加し、解釈欄から分離 |
| ARCH-NEW-spec-L1064 | 修正 | §16 に `dataState` の3値を含む完全な引用と `startRow` の後段を追記 |
| ARCH-NEW-spec-L546 | 修正 | §16 に「Google OAuth 2.0 — リフレッシュトークンの失効条件」節を新設（6ヶ月未使用ほか） |
| ARCH-NEW-spec-L479b | 修正 | §7.2 / §7.5 に「MVP では DELETE 経路を提供しない。ポリシーは将来の多層防御」を明記 |
| ARCH-PERSIST-spec-L845 | 修正 | new `ARCH-NEW-spec-L241` と同一。第1回の記録に未反映箇所を追記済み |
| ARCH-PERSIST-spec-L578 | 修正 | new `ARCH-NEW-spec-L539` / `L771` と同一。第1回の記録に未反映箇所を追記済み |
| ARCH-PERSIST-spec-L588 | 修正 | new `ARCH-NEW-spec-L677` と同一 |
| ARCH-PERSIST-spec-L561 | 修正 | new `ARCH-NEW-spec-L646` / `L645` と同一 |
| ARCH-PERSIST-spec-L947 | 修正 | new `ARCH-NEW-spec-L1240` と同一 |
| ARCH-PERSIST-spec-L242 | 修正 | §12 末尾に AC ↔ 成功条件・要求出典の対応表を追加し、§2.3 に「未評価のコンテンツを一覧から発見できる」を追加。FR-ID 体系自体の導入は Q1 確定後として残置（上表の残置行を参照） |
| ARCH-PERSIST-spec-L908 | 修正 | new `ARCH-NEW-spec-L1064` と同一 |

### 2026-08-14 audit 第3回（new 3件 / persists 1件 / 🟢 3件）

| finding_id | 対応 | 備考 |
|---|---|---|
| ARCH-NEW-spec-L741 | 修正 | §11 性能行の「ページング100件/ページを維持する」を実測（`app/analytics/page.tsx:59` の `const perPage = 10;`）に基づき「10件固定・本仕様では変更しない」へ訂正。`MAX_PER_PAGE = 100` と RPC の `LEAST(100, …)` はクランプ上限であってページサイズではない旨を明記。§11 想定行数を「現行10件: 10記事×90日=900行で未到達／100件へ拡張時: 10日で1,000行到達・90日で9,000行」の2段に分割し、§6.1-4 にも同事実を追記 |
| ARCH-NEW-spec-L236 | 修正 | §4.2.2 の「Compatibility API による事前確認を根拠とする」を削除。`ga4Service.ts` の公開メソッドが `listProperties`(:38)／`listKeyEvents`(:82)／`runReport`(:114) の3本のみで `src/`・`app/` に `checkCompatibility` が0ヒットである実測（2026-08-14）を記載し、根拠を `ga4ImportService.ts:257-259` のコードコメントのみに限定。Compatibility 確認は §9.2 で新規実装する旨と §17 の変更対象を明記 |
| ARCH-NEW-spec-L983 | 修正 | (a) §10.2 の一覧表示単位を「そのページの GA4 集計全体」へ変更。`fetchGa4Summaries` が `.in('normalized_path', …)` の一括取得であり `count:'exact'` の差分では欠けた記事を判別できない実測根拠を併記し、記事単位の表示要件を撤回。(b) AC-13 を「D4 確定後に対象化する条件付き AC」とし、D4 の選択肢 (a)〜(d) ごとに期待挙動を書き分け。D4 のブロッカー欄から AC-13 への循環参照を外し「D4 → AC-13」の一方向に修正。§3.4 内訳・§13・§15.3 依存関係表・R-08 も同方針へ更新 |
| ARCH-PERSIST-spec-L931 | 修正 | §2.7「業務ルール」を新設（BR-01〜BR-06）。terminal 履歴の不変性／欠損値を0にしない／失敗で既存結果を上書きしない／同時評価1件／Kill Switch 停止時は評価APIを実行しない／`.eq('user_id', …)` 省略禁止に ID を与え、例外・本文の定義箇所・対応する AC / テストを対応付けた。いずれも本文既出の不変条件であり新しい意思決定を含まない |
| （🟢）ARCH-NEW-spec-L1284 | 修正 | §16 GA4 データ処理遅延の引用ラベルを公式表記に合わせ `Standard daily` → `Daily` へ訂正（2026-08-14 再確認） |
| （🟢）ARCH-NEW-spec-L1435 | 修正 | §19 第2回表の備考「テンプレート §7 の8項目へ揃えた」の誤記を「`requirement-definition.md:147-154` の6項目を網羅したうえで入力制御・再現性を加えた8行」へ訂正 |
| （🟢）ARCH-NEW-spec-L1308 | 修正 | §16 GSC クォータ引用を1行への再構成から、公式の3区分（Per-site / Per-user / Per-project）ごとの引用へ分割。区分の説明も公式表記で併記し、2026-08-14 に値の一致を再確認 |

### 2026-08-14 audit 第4回（new 2件 / persists 0件 / 🟢 2件）

| finding_id | 対応 | 備考 |
|---|---|---|
| ARCH-NEW-spec-L621 | 修正 | Compatibility 経路を **Q-A 条件付きへ限定**した。§9.2 を「Q-A で取込追加が確定した場合に限り、取得指標を変更する前に実施。評価実行経路では呼ばない」へ、§9.2.1 の呼び出し回数を「レポート 0 回・Compatibility 0 回」へ訂正。§17 の無条件側から外して「Q-A 確定後に追加される変更対象」へ移し、§3.4 の取込拡張（12〜20h）に含む旨を明記。§4.2.2 の時制も同方針へ揃えた。**採用理由**: §16 の公式引用が「レポートリクエストに追加できるディメンション・指標を列挙する」API と定義しており、レポートを発行しない評価経路（§9.2.1）には検証対象が存在しないため。MVP 無条件で残す案は、この目的不在を解消できないため却下した |
| ARCH-NEW-spec-L91 | 修正 | BR-02 の例外欄を「一覧の表示値としては 0 フォールバックを維持し、**評価入力へ流用する際は適用せず `sessions = 0` の直帰率を欠損として渡す**」へ改めた。実測（`analyticsContentService.ts:344-345` の `agg.bounceRateSessions > 0 ? … : 0`）に基づき、0 フォールバックが表示層ではなく `fetchGa4Summaries` の集計処理そのものにあることを明記。§5.1 の流用方針に「流用するのは日次合算・加重平均・OR集約であり 0 フォールバックは評価入力に適用しない」を追加、§5.4 フェーズ0「評価入力」境界の方針・完了条件に分岐の設置を追加、§6.3.2 #2 にも注記、§13 に「`sessions = 0` の直帰率が評価入力で欠損になる」テストを新設（AC-03 / BR-02 に紐付け） |
| （🟢）ARCH-NEW-spec-L761 | 修正 | 「10記事 × 90日 = 900行で到達しない」の 90日が §6.3.2 #2 の**評価入力の上限**であり一覧に適用されない点を訂正。§11・§6.1-4・AC-13・R-08 を「現行10件では 100日で 1,000行に到達。一覧の期間に上限がないため 101日以上で到達しうる」へ書き換え、D4 の (d)（期間上限）の検討材料として明示。R-08 の可能性も期間依存の表現へ改めた |
| （🟢）ARCH-NEW-spec-L162 | 修正 | §3.4 の「打ち切り検知 2〜4h」を「D4 の (b) を選んだ場合の見積」と明示し、(c) `range` ページング・(d) 期間上限は未見積もり（D4 確定時に再見積もり）と記載。D4 のブロッカー欄と §15.3 依存関係表の「実装有無」を「対処方式の選択（(a)〜(d)）」へ改めた |

### 2026-08-15 audit 第5回（new 10件: 🟡6 / 🟢4 / persists 0 / reopened 0）

対象は 2026-08-15 改訂（フェーズ1挿入・認可全面改訂・308 redirect・trial 遮断・RLS 自己参照）。**audit レポート冒頭は「公式ドキュメント照合: 実施」であり、9 URL 中8件の verbatim 一致を WebFetch で再確認、1件（`.../data/v1/api-schema`）は公式ページ側の truncate で未確認（§16「公式未確認」表の自己申告と一致）。**本節の対応にあたり、Next.js 同梱 `redirects.md:30,32,43,142` / `proxy.md`「Execution order」は改めて原文を参照して引用の一致を確認した。

| finding_id | 対応 | 備考 |
|---|---|---|
| ARCH-NEW-spec-L367（🟡 behavior-regression） | **一部修正 + D5 へ隔離** | 「`/analytics` 一覧への遷移へ変更。**挙動保存の唯一の意図的な逸脱**」という記述の前提が成立しないことを実測で確認し、当該評価を撤回。§5.5 に「GlobalToastBridge の扱い」を新設し、`gsc-dummy-open` 購読0件・`gsc-dummy-update` dispatch 0件・`:28` の同期削除により当該分岐が**到達不能**である根拠を記載した。**(a)(b) いずれを選ぶかは設計判断であり、本書の根拠だけでは一意に決まらないため revise では選ばず D5（§15.3）として隔離した。**§13 のテスト対象も D5 従属へ変更 |
| ARCH-NEW-spec-L96（🟡 contract-undefined） | 修正 | §3.3 に「未認可時の応答契約」表を新設。Server Action は当該ファイルの既存返り値形に合わせ `{ success:false, error: ERROR_MESSAGES.GA4.<新設定数> }`、Route Handler は 403 + 同形 JSON と定義し、いずれも本文にデータを含めないことを明記。定数は `error-messages.ts` の GA4 群（`:575-605`）へ新設し `GOOGLE_ADS.ACCOUNT_ACCESS_DENIED`（`:666`）と区別する旨を記載。§17 フェーズ1変更対象へ `error-messages.ts` を追加、AC-12 第3シナリオを Server Action / Route Handler の2本へ分割して応答形・ステータスを記載。**なお `ServerActionResult` 型（`@/lib/async-handler`）は `gscDashboard.actions.ts` では使われておらず（2026-08-15 実測。使用は `ga4Dashboard.actions.ts`）、audit の修正案の文言をそのまま採らず既存の返り値形に合わせた** |
| ARCH-NEW-spec-L1547（🟡 scope-gap） | 修正 | §17 の同期一覧を表形式にし、`.agents/skills/quality-gate/manual-testing.md:52`（リリース前必須ゲートの手順）と `docs/plans/content-annotation-ai-summary-design.md:48,349` を追加（3件→5件）。§3.4 フェーズ1完了条件の grep 範囲を `src/`・`app/` からリポジトリ全体（`node_modules/`・`.git/`・`.next/`・`docs/plans/_html/` を除く）へ広げ、除外対象を redirect 定義と歴史記録に限定。R-09 の対策欄も同期 |
| ARCH-NEW-spec-L391（🟡 external-doc-mismatch） | 修正 | 「annotationId 以外のクエリは引き継がれる（Next.js の既定動作）」を公式引用（"any query values provided in the request will be passed through"）どおり「リクエストのクエリはすべて引き継がれる」へ訂正。`has` の named capture で消費したキーが destination のクエリから除去されるかは**公式未記載＝未確認**であることを明記し、フェーズ1で 308 応答の `Location` を実測して確定すると隔離。「新ルートは route param を正とし残留クエリを読まない」を設計として固定。AC-15 を「`annotationId` 以外のクエリが失われない」「残留クエリの有無にかかわらず route param で描画される」の2条件へ書き換え、§16 解釈(2) も同期 |
| ARCH-NEW-spec-L1277（🟡 client-alignment） | 修正 | §15.3 D1 背景欄に「フェーズ1（24〜40h）は利用者に見える変化を伴わない。フェーズ0と合わせ 54〜85h（MVP の約1/3）が §1.9.5 の第1優先要求より前に置かれることを見積提示時に明示して合意する」を追加。§15.4「未評価ソートを分離して先行リリースしない」行の影響欄を 167〜243h 前提へ更新し、判断日の右に影響欄の更新日を併記 |
| ARCH-NEW-spec-L144（🟡 existing-pattern-deviation） | 修正 | §3.3 に「認可関数の使い分け」表を新設し、読み取り2本（`fetchGscDetail` / `fetchQueryAnalysis`）＝`canAccessGa4`、書き込み4本（`registerEvaluation` / `updateEvaluation` / `runQueryImportForAnnotation` / `runEvaluationNow`）＝`canWriteGa4` と固定。既存の使い分け（`ga4Setup.actions.ts:102,126,212`・`app/api/ga4/sync/route.ts:21`）を根拠として明記し、BR-07・§5.1・§3.4 認可内訳・§13・§17 へ波及。`ga4-permissions.ts` のユニットテスト対象に `canWriteGa4` を追加 |
| ARCH-NEW-spec-L151（🟢 fact-accuracy） | 修正 | §3.3 認可表に `app/api/gsc/dashboard/*` の行を分離し、§5.5「API Route」と併せて「アプリ内からの呼び出しは0件（2026-08-15 実測）。直URL到達点として認可を追加する。削除可否は本仕様のスコープ外」を明記 |
| ARCH-NEW-spec-L1341（🟢 risk-scoping） | 修正 | R-11 の対策欄に「救済されるのは GET ナビゲーション。旧タブ内の Server Action 実行は救済されるとは限らず、再読み込みを促す」を追記。根拠として `redirects.md`（308 はメソッドを保つ）と `proxy.md`（Server Function は使用ルートへの POST として扱われる）の verbatim 引用を §16 に追加し、解釈(6) を新設 |
| ARCH-NEW-spec-L1548（🟢 doc-staleness） | 修正 | §17 の「HTML 束は本改訂で陳腐化した」を実状（`core.yaml` と `diagrams/ui-layers-compare.json` は 2026-08-15 改訂を反映済み）に合わせて訂正。本文をさらに改訂した場合に `source_label` の行数と `source_refs` のアンカーを貼り直す条件へ改め、`docs/plans/_html/` が `.gitignore:69` で除外されている事実も併記 |
| ARCH-NEW-spec-L188（🟢 condition-inconsistency） | 修正 | `ARCH-NEW-spec-L1547` の grep 範囲拡大に合わせ、空振りしていた除外句（`next.config.ts` は `src/`・`app/` に含まれない）を実効化。除外対象を「redirect 定義」と「§18 / §19 / §15.4 の歴史記録」の2つに整理した |

### 2026-08-15 audit 第6回（new 2件: 🟡1 / 🟢1 / persists 0 / reopened 0）

第5回の対応結果に対する再監査。**🟡6件のうち5件と 🟢4件は解消と判定され、`ARCH-NEW-spec-L367` は「残置合意（D5 へ隔離）」として判定基準を満たすと確認された。**新規2件はいずれも第5回の修正過程で生じた副作用である。**audit レポート冒頭は「公式ドキュメント照合: 実施」**（本ラン内で 9 URL を再取得し8件が verbatim 一致、1件（`.../data/v1/api-schema`）は公式ページ側の truncate で未確認。同梱 Next.js docs の引用7件も原文再読で一致）。

| finding_id | 対応 | 備考 |
|---|---|---|
| ARCH-NEW-spec-L210（🟡 acceptance-condition-unsatisfiable） | 修正 | 第5回の `ARCH-NEW-spec-L1547` 対応で grep 範囲をリポジトリ全体へ広げた際、判定文字列から先頭スラッシュが落ち（`/gsc-dashboard` → `gsc-dashboard`）、実測で満たせない完了条件になっていた。§3.4 フェーズ1完了条件を **判定対象・探索範囲・除外**の3要素に分けて再定義。判定対象を「旧ルートを指すパス参照」（先頭スラッシュ付き `/gsc-dashboard` と `app/gsc-dashboard/`）に限定し、除外に (2) 本仕様書自身（設計正本として旧ルート名を必ず含むため、歴史記録だけでなく §3.1 / §3.3 / §5.5 / §10.1 / §12 / §13 等の設計記述も対象外）と (3) `gscDashboard.actions.ts` のログ接頭辞 `[gsc-dashboard]` 7箇所（`:225` `:475` `:581` `:723` `:784` `:864` `:925`。2026-08-15 実測。パス参照ではなくログ文言であり §17 の同ファイル変更対象に含まれない）を追加。ファイル名・識別子の改称がスコープ外である旨も明記。§17`:1611` の「（§3.4 完了条件の 0ヒット判定はこの範囲で行う）」は「リポジトリ全体を grep した結果、更新が必要な他ドキュメントは次の5件である」へ改め、**判定範囲と更新対象を分離**（判定定義の正本は §3.4）。R-09 の対策欄も同期 |
| ARCH-NEW-spec-L1646（🟢 doc-formatting） | 修正 | §18 変更履歴で、第5回の追記行の直前に空行が入りテーブルが分断されていた（Markdown は空行で表を終端するため、最新行が別テーブルとして描画される）。空行を削除して同一テーブルに収めた。spec-to-html の全文ビューは原本 Markdown から生成されるため、図解 HTML 束への波及も解消する |

### 公式ドキュメント照合

- **実施**（確認日: 2026-08-12 初回、2026-08-13 追加、2026-08-14 audit で9本、第2回改訂で5本、第3回改訂で1本を WebFetch により再取得）。§16 に URL・確認日・verbatim 引用を記録している。
- 第2回改訂で再取得し公式本文との一致を確認したもの: `support.google.com/analytics/answer/9143382`（`landingPage` 定義。ページ名は "Analytics dimensions and metrics"）、GA4 Quotas 4行、GA4 Data freshness（24-48時間・Standard intraday 2-6 hours・Daily 12 hours）、GSC `dataState`（3値）・`startRow`・全行返却非保証、Google OAuth 2.0 のリフレッシュトークン失効条件。
- 第3回改訂で再取得したもの: GSC `webmaster-tools/limits` の Search Analytics クォータ3区分（Per-site / Per-user / Per-project）。値は公式と一致し、引用を区分ごとに分割した。あわせて GA4 Data freshness のラベルを公式表記 `Daily` へ訂正した。
- **不一致を検出し削除したもの**: 「Landing page レポート／Pages and screens レポートの構成」引用2ブロック。引用元 URL に当該記述も `unifiedPagePathScreen` も存在しないことを 2026-08-14 に実測したため §16 から削除し、「公式未確認」表へ移した。
- **公式未確認（§16 表参照）**: `landingPage` × 検索指標の非互換、`landingPage` × `screenPageViews` / `engagementRate` の可否、GA4 公式レポートの構成、`.../data/v1/api-schema` の Metrics セクション（ページが truncate され再取得できず、`engagementRate` / `screenPageViews` / `userEngagementDuration` の引用は 2026-08-12 取得時のまま）。

### 2026-08-15 改訂の注記

2026-08-15 の改訂はユーザー決定起点であり audit 対応ではないため、finding 行は追加しない。上表の `SPEC-UI-001` / `SPEC-SCOPE-002` / `ARCH-NEW-spec-L112` の備考（新ルート化のMVP対象外化・タブ側での認可担保）は当時の歴史記録としてそのまま残すが、**これらの判断は 2026-08-15 改訂で反転された**。経緯は §15.4 と §18 を参照。

### 残置（理由付き）

§19 の記録は **計117行**（第1表 26行・第1回 audit 対応表 37行・第2回 audit 対応表 31行・第3回 audit 対応表 7行・第4回 audit 対応表 4行・第5回 audit 対応表 10行・第6回 audit 対応表 2行）。`finding_id` は行単位で一意に管理し、同一 ID を複数行に併記しない。

残置は次の3件。それ以外はすべて修正、または §15.2 の確認質問・§15.3 の開発側確定事項へ隔離した。**第3回 audit（new 3・persists 1・🟢 3）および第4回 audit（new 2・🟢 2）はいずれも修正済みで、残置に追加はない。第5回 audit（🟡6・🟢4）は 9件を修正し、`ARCH-NEW-spec-L367` のみ下表の残置（部分対応）とした。第6回 audit（🟡1・🟢1）は2件とも修正済みで、残置に追加はない。**

| 残置項目 | finding_id | 理由 |
|---|---|---|
| `GlobalToastBridge.tsx` の扱いを (a)(b) のいずれかに確定しない | `ARCH-NEW-spec-L367` | audit の修正案は「(a) フェーズ1では変更せず別チケットへ送る」「(b) パス判定のみ新ルートへ変え遷移分岐を削除する」のいずれかに固定することを求めるが、**両案は利用者から見える挙動が同一**（当該分岐は到達不能）で、分かれるのは「到達不能な既存コードを移設のスコープで削除してよいか」という設計判断である。本書・実コード・適用ポリシーのいずれからも一意に導けないため、revise で任意に選ばず D5（§15.3）として隔離した。**指摘の事実誤りの部分（「挙動保存の唯一の意図的な逸脱」という前提評価）は §5.5 で撤回し、実測根拠を記載済みである。**D5 はフェーズ1着手のブロッカー |
| テンプレート §5 の FR-ID 表と §6 のシナリオ対応表を導入しない | `ARCH-NEW-spec-L242` / `ARCH-PERSIST-spec-L242` | FR-ID 体系はプロンプト契約（Q1）確定後に一括導入する方が手戻りが少ない。代替として §12 末尾に AC ↔ 成功条件・要求出典の対応表を置き、追跡可能性を確保した |
| §15.2 の各質問に具体的な回答期限日を入れない | `ARCH-NEW-spec-L931` | 期限日は開発チーム単独では決められず、D1（見積合意）の提示時にクライアントと同時に確定する。無期限に開いたままにしないため、「D1 提示時に確定」という期限の決め方自体を表に明記し、§17 で未回答のまま `spec-to-pr` へ進まないことを条件化した |
