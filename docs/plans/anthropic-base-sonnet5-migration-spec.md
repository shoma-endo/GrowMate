# 要件定義: 共有定数 `ANTHROPIC_BASE` の Claude Sonnet 5 移行

## メタデータ

- 文書名: 共有定数 `ANTHROPIC_BASE` の Claude Sonnet 5 移行
- ステータス: `approved`
- 作成日: 2026-09-07
- 最終更新日: 2026-09-08
- 作成者: Claude（ローカルセッション。下書き）
- 承認者: プロジェクトオーナー（2026-09-08 承認。Q-M01〜Q-M05 の回答は §12 確認質問、承認の記録は §16 承認表）
- 対象リリース: 未定（理由: 承認は得たが着手日を置いていない。実装着手時に決める。確認者: プロジェクトオーナー）
- 関連する依頼・Issue・PR:
  - 発端: `docs/plans/content-annotation-bulk-summary-background-spec.md` §12 **OPEN-B01**（「要約以外の18エントリの Claude Sonnet 5 移行」として登録されていた未決定事項）
  - 判断の前提: 同仕様 §11 **ALT-005 案B**（一斉移行を却下した理由）／§8「AI機能の追加観点」／§10 制約条件／§16「公式ドキュメント照合」
  - 先行実装: 要約1機能の移行（`MODEL_CONFIGS.content_annotation_ai_summary`）。本仕様はその残り

## 1. 背景・目的・成功指標

### 背景・解決したい課題

`src/lib/constants.ts:60` の共有定数 `ANTHROPIC_BASE` は `actualModel: 'claude-sonnet-4-6'` を持ち、`MODEL_CONFIGS` の **18 エントリ**へ展開されている。Claude Sonnet 5 への移行はクライアント合意済み（2026-09-04）だが、先行仕様では**要約1機能だけ**を共有定数から切り出して移行し、残る18エントリは据え置いた。

据え置いた理由は「一斉移行は先行仕様のレビュー範囲外の機能を巻き込み、そのテストでは回帰を検知できない」であって、移行そのものの否定ではない（ALT-005 案B）。結果として**要約だけが他機能と異なるモデルで動く状態**が残っており、先行仕様 §11 は「他機能の移行が終われば要約の切り出しを `ANTHROPIC_BASE` へ戻してよい」と将来条件を明記している。

本仕様はその残りを閉じる。

### 目的

`ANTHROPIC_BASE` を `claude-sonnet-5` へ移行し、Anthropic を使う全機能のモデルを一本化する。あわせて `thinking: { type: 'disabled' }` を共有定数に置き、アダプティブ思考の暗黙有効化による課金増を防ぐ。

### 成功指標

| 指標 | 現状 | 目標 | 測定方法 | 測定時期 |
| --- | --- | --- | --- | --- |
| 出力形式の回帰が出ないグループ数 | 7/7（移行前が基準） | 7/7 | §13 の手動確認。判定条件は §8「出力品質・評価基準」の機械判定（手順0 で採取したベースラインとの突き合わせ） | §14 手順6 完了時 |
| モデル ID の一本化 | `ANTHROPIC_BASE` = `claude-sonnet-4-6` ／ 要約のみ `claude-sonnet-5` | 両者が `claude-sonnet-5` で一致（切り出しの解消自体は OPEN-M01） | `src/lib/constants.ts` のコード確認（AC-M01） | §14 手順1 完了時 |
| Anthropic 経路の LLM 単価 | 入力 $3.00 / 出力 $15.00 per 1M | 入力 $2.00 / 出力 $10.00 per 1M（トークン数増を織り込んだ実効削減率の見込みは約13%。§8） | 公式単価（§16 の verbatim 引用）と §8 の試算。実測値の採取は本仕様の対象外 | 移行後 |
| 思考トークンの混入がないこと | 該当なし（`claude-sonnet-4-6` は明示指定しない限り思考しない） | 18エントリすべてで `thinking` がリクエストに載っている | **AC-M02b**（AC-M02 は共有定数の記述しか検証しないため、この指標は測れない）。`[LLMService] output truncated at max_tokens` / `[Ga4EvaluationLlm] structured output validation failed` が移行前より増えないこと（§13） | §14 手順6 完了時 |

## 2. 利用者・関係者・利用シナリオ

### 利用者・関係者

| 区分 | 誰 | 本件との関わり |
| --- | --- | --- |
| エンドユーザー | `admin` / `paid` ロールの利用者 | チャット・ブログ生成・GSC 提案・Google Ads 分析・GA4 評価の出力品質が変わりうる |
| 実装者 | 開発者 | モデル設定の変更と、7グループの動作確認 |
| PO / クライアント | — | 移行の可否と、品質低下時の巻き戻し判断 |

### 主な利用シナリオ

利用者の操作は一切変わらない。本仕様は**内部のモデル差し替えのみ**で、画面・入力・出力スキーマ・プロンプトは変更しない。利用者から見えるのは、生成文の文体・粒度・レイテンシの変化に限られる。

## 3. 業務要件と業務フロー

### 現状（As-Is）

- `ANTHROPIC_BASE`（`src/lib/constants.ts:60`）が `actualModel: 'claude-sonnet-4-6'` を持ち、18エントリへ展開される
- `thinking` は `ANTHROPIC_BASE` に無い。`claude-sonnet-4-6` は明示指定しない限り思考しないため、現状これで意図どおり動いている
- 要約（`content_annotation_ai_summary`）だけが共有定数から切り出され、`claude-sonnet-5` + `thinking: { type: 'disabled' }` で動いている

### 導入後（To-Be）

- `ANTHROPIC_BASE` が `actualModel: 'claude-sonnet-5'` と `thinking: { type: 'disabled' }` を持つ
- 18エントリすべてが Sonnet 5 の思考無効で動く
- 要約の切り出しは**本仕様では解消しない**（理由は §4 Non-goals）

### 業務ルール

| ID | 業務ルール | 根拠 |
| --- | --- | --- |
| BR-M01 | **`MODEL_CONFIGS` 内で**変えるのは `actualModel` と `thinking` の2項目だけ。プロンプト・出力スキーマ・`maxTokens`・`stream` は変更しない。**呼び出し元への `thinking` の詰め替え追加（FR-M02 / §14 手順2）はこの契約の対象外**で、設定値ではなく既存の設定を API へ届けるための配線である | 変数を1つに絞らないと回帰の原因を切り分けられない（先行仕様 §11 ALT-005 案B の却下理由と同じ）。詰め替えを除外するのは、それが無いと `thinking` がリクエストに載らず BR-M02 が成立しないため（§5 前提） |
| BR-M02 | `thinking` は `{ type: 'disabled' }` を共有定数に置き、**18エントリすべての呼び出し元が Anthropic リクエストへ渡す**。`display` は併記しない | `claude-sonnet-5` は `thinking` を省略すると**アダプティブ思考が既定で有効**になり、思考トークンが出力料金で課金される。`display` の既定が `"omitted"` で思考テキストは返らないため、指定漏れは請求額でしか気づけない。`display` と `type: 'disabled'` の併用は公式表現で **invalid**（「`display` is invalid with `thinking.type: "disabled"`」。§16 の verbatim 引用）。共有定数に置くだけでは API に載らないことは §5 前提を参照 |
| BR-M03 | 移行は7つの機能グループ単位で確認する。1グループでも回帰が出たら、原因を特定するまで次へ進まない | 18エントリを機能ごとにまとめた単位（§6 の対象表） |
| BR-M04 | 品質低下時の対処は `ANTHROPIC_BASE` の2行を `claude-sonnet-4-6` へ戻すこと。`adaptive` + `effort` への切り替えは採らない | 先行仕様 OPEN-B05 と同じ判断。`output_config` を渡す口が別途必要になり、思考トークンが `max_tokens` に算入されて出力枠を圧迫する |

## 4. 対象範囲と Non-goals

### 対象範囲

- `src/lib/constants.ts` の `ANTHROPIC_BASE` に対する `actualModel` の変更と `thinking` の追加
- **18エントリの呼び出し元（8ファイル・11箇所）で、`MODEL_CONFIGS` の `thinking` を Anthropic リクエストへ詰め替える配線の追加**（現状この詰め替えは要約1経路にしか存在しない。詳細は §5 前提・§14 手順2）
- 18エントリを使う7機能グループの動作確認（§13）と、その前提となる移行前ベースラインの採取（§14 手順0）
- `app/api/chat/anthropic/stream/route.ts` の Web検索ツール型が Sonnet 5 で通ることの確認（§12 RISK-M01）

**README 更新は該当なしの見込み。** 変更するのは共有定数と呼び出し元の配線のみで、`update-docs` の README 対象行（🚀主な機能・🏗️アーキテクチャ図・📋環境変数・📁プロジェクト構成・🛠️技術スタック）のいずれにも当たらない。最終判断は `spec-to-pr` の `readme_sync` が全差分を見て行う。

### Non-goals（今回の対象外）

- **要約の切り出しの解消**: `content_annotation_ai_summary` を `ANTHROPIC_BASE` へ戻す作業は本仕様では行わない。移行後の実運用で回帰が出ないことを確認してから別途行う。**先に戻すと、回帰が出たときに「要約の巻き戻し2行」という先行仕様のロールバック手段を失う**（先行仕様 §13 ロールバック方針）。→ OPEN-M01
- **`output_config: { effort: ... }` を渡す口の追加**: `thinking` の口だけで足りる。追加すると `LLMOptions` / `ModelConfig` / `callAnthropic` の3箇所に**新しい設定項目**が増え、BR-M01（`MODEL_CONFIGS` 内で変えるのは `actualModel` と `thinking` の2項目だけ）から外れる。本仕様が追加する詰め替え配線は既存の設定値を届けるだけで、新しい設定項目を増やさない点が異なる。→ OPEN-M02
- **プロンプトの Sonnet 5 向け書き直し**: モデル差し替えだけで品質が保てるかをまず測る。書き直しが要ると判明してから着手する。→ OPEN-M03
- **OpenAI 経路（`OPENAI_BASE`）の変更**: 本仕様は Anthropic 経路のみ。`OPENAI_BASE` は `temperature` / `top_p` を明示指定しており前提が異なる
- **Web検索ツール型の新バリアントへの更新**: `web_search_20250305` が Sonnet 5 で通るなら据え置く。通らない場合のみ最小限の変更を行う（§12 RISK-M01）。先回りで `web_search_20260209` へ上げることはしない（`CLAUDE.md` Core Rules / MVP 最優先）
- **停止機構（feature flag / 環境変数によるモデル切り替え）**: 作らない。巻き戻しは共有定数の2行を戻してデプロイするだけで足り、既存手段で止められる（`CLAUDE.md` Core Rules）
- **コスト監視ダッシュボード**: 作らない。単価と実効削減率の見込みは §8 に記録するが、継続監視の仕組みは要件になっていない

## 5. 開発工数（概算）

### 前提

- 換算: 8時間 = 1人日
- 見積の状態: `合意済み`（Q-M01 / Q-M02 に 2026-09-08 回答を受領し、承認された。合意者: プロジェクトオーナー、合意日: 2026-09-08）
- 含めるもの: 共有定数の変更、`thinking` の詰め替え配線、7グループの手動確認、ベースライン採取、回帰の切り分け
- 含めないもの: 仕様レビュー往復、クライアント確認待ち、プロンプトの書き直し（Non-goals / OPEN-M03）
- **`thinking` の受け口は先行仕様で実装済み**（`ModelConfig` → `LLMOptions` → `llmChat` → `callAnthropic`。`src/server/services/llmService.ts:171` が `opts.thinking !== undefined` のときだけ `params` に載せる）。**ただし `MODEL_CONFIGS` の `thinking` を `llmChat` の options へ詰め替えている箇所は、全リポジトリで要約1経路（`src/server/services/contentAnnotationSummaryService.ts:229`）にしかない。**移行対象18エントリの呼び出し元 **8ファイル・11箇所**はいずれも `thinking` を渡しておらず、**本仕様で詰め替えを追加する**（§14 手順2）。型定義 `src/lib/constants.ts:53` のコメント自体が「呼び出し側が `llmChat` の options へ明示的に詰め替えること」と明記している
- 7グループの確認は実データ（本番または検証用アカウント）で行う。新しい計測基盤は作らない
- プロンプト・出力スキーマの書き直しは工数に含めない（Non-goals / OPEN-M03）

### 工数サマリー

| フェーズまたは区分 | 目的・主な成果物 | 工数（時間） | 人日 |
| --- | --- | ---: | ---: |
| 準備 | 移行前ベースラインの採取（§14 手順0） | 1〜2 | 0.1〜0.3 |
| 実装 | 共有定数の変更と、呼び出し元 8ファイル・11箇所への `thinking` 詰め替え。`npm run verify` | 2〜3 | 0.3〜0.4 |
| 確認 | 7グループの動作確認と Web検索ツール型の確認 | 4.5〜9 | 0.6〜1.1 |
| 予備 | 回帰の切り分けと修正バッファ | 4〜8 | 0.5〜1.0 |
| **合計** | | **11.5〜22** | **1.5〜2.8** |

幅の理由: RISK-M01（Web検索ツール型が Sonnet 5 で通るか未確認）と、回帰が何グループで出るかが実行するまで分からないため。

### 内訳

| 項目 | 内容 | 時間 |
| --- | --- | --- |
| ベースライン採取 | G1〜G7 を移行前に各1回実行し、出力を保存する（§14 手順0） | 1〜2 |
| モデル設定の変更 | `ANTHROPIC_BASE` の `actualModel` 変更と `thinking` 追加。`src/lib/constants.ts:131` のコメント訂正 | 0.5 |
| `thinking` 詰め替えの追加 | 呼び出し元 8ファイル・11箇所で `MODEL_CONFIGS` の `thinking` を Anthropic リクエストへ渡す（うち `chatService.ts` はインラインリテラル型2つの拡張を伴う）。`npm run verify` | 1.5〜2.5 |
| 7グループの動作確認 | §13 のテスト方針に沿って各グループ1回以上実行し、手順0 のベースラインと突き合わせる | 4〜7 |
| 回帰の修正バッファ | 出力形式のズレ（末尾 JSON ブロックの欠落、長文の途中切れ等）への対応 | 4〜8 |
| Web検索ツール型の確認 | RISK-M01。通らなければ +1〜2 | 0.5〜2 |

### カレンダー上の前提（工数外）

- GA4 コンテンツ評価は cron 経由の経路があり、確認に起動待ちが入る可能性がある
- 本番の実データで確認する場合、LLM 呼び出しの実費が発生する

## 6. 機能要件

| ID | 機能要件 | 優先度 | 根拠・出典 | 受け入れ条件 |
| --- | --- | --- | --- | --- |
| FR-M01 | `ANTHROPIC_BASE.actualModel` を `claude-sonnet-5` にする | Must | クライアント合意 2026-09-04 ／ BR-M01 | AC-M01 |
| FR-M02 | `ANTHROPIC_BASE` に `thinking: { type: 'disabled' }` を追加し、**かつ18エントリすべての呼び出し元がその値を Anthropic リクエストへ渡す**（対象は 8ファイル・11箇所。§14 手順2） | Must | BR-M02 | AC-M02 / AC-M02b |
| FR-M03 | 18エントリを使う7グループが移行後も従来どおりの出力形式を返す | Must | BR-M03 | AC-M03〜AC-M09 |
| FR-M04 | 品質低下時に共有定数の2行を戻すだけで元に戻せる | Must | BR-M04 | AC-M10 |

### 移行対象（18エントリ / 7グループ）

`src/lib/constants.ts` の行番号は本仕様作成時点のもの。

| # | グループ | エントリ | `maxTokens` | 特記 | 主な呼び出し元 |
| --- | --- | --- | --- | --- | --- |
| G1 | ブログ生成 | `blog_creation_step1`〜`step6` | 5000〜6000 | — | `app/api/chat/anthropic/stream/route.ts` ／ `src/server/actions/chat/modelHandlers.ts` |
| G1 | ブログ生成 | `blog_creation_step7` | **64000** | 長文生成。SDK のタイムアウト回避にストリーミング必須の帯 | 同上 ／ `src/server/services/headingFlowService.ts` |
| G1 | ブログ生成 | `blog_creation_step7_heading` | 7000 | 見出し単位モード | `app/api/chat/canvas/stream/route.ts` |
| G1 | ブログ生成 | `blog_title_meta_generation` | 10000 | — | `src/hooks/useBlogTitleMetaGeneration.ts` |
| G2 | 広告コピー | `ad_copy_creation` | 4000 | — | `src/server/actions/chat/modelHandlers.ts:117,189` |
| G3 | LP草案 | `lp_draft_creation` | 32000 | 長文生成 | `src/server/actions/chat/modelHandlers.ts:119,208` |
| G4 | GSC 改善提案 | `gsc_insight_ctr_boost` | 4000 | — | `src/server/services/gscSuggestionService.ts:74` |
| G4 | GSC 改善提案 | `gsc_insight_intro_refresh` | 5000 | — | 同上 |
| G4 | GSC 改善提案 | `gsc_insight_body_rewrite` | 16000 | **`stream: true`** | `src/server/services/gscSuggestionService.ts:131` |
| G4 | GSC 改善提案 | `gsc_insight_persona_rebuild` | 5000 | — | 同上 |
| G5 | Google Ads 戦略提案 | `google_ads_ai_evaluation` | 20000 | **`stream: true`**・末尾 JSON ブロック | `src/server/services/googleAdsAiAnalysisService.ts:245` |
| G6 | Google Ads 除外KW提案 | `google_ads_negative_keywords_suggestion` | 16000 | — | `src/server/services/googleAdsNegativeKeywordsSuggestionService.ts:297` |
| G7 | GA4 コンテンツ評価 | `ga4_content_evaluation` | 700 | 出力が最も短い | `src/server/services/ga4ContentEvaluationService.ts:841` |

### 入力・出力・状態遷移

変更なし。モデル ID とリクエストパラメータ `thinking` のみが変わる。

### 画面設計

変更なし。

### 権限

変更なし。既存の `admin` / `paid` ロール制限と各機能のサーバー側検証をそのまま使う。本仕様は新規機能を追加しないため、認可の追加実装は無い。

## 7. Gherkin受け入れ条件

```gherkin
シナリオ: AC-M01 共有定数のモデル ID が Sonnet 5 になっている
  前提 src/lib/constants.ts の ANTHROPIC_BASE を開いている
  ならば actualModel が 'claude-sonnet-5' である

シナリオ: AC-M02 共有定数で思考が明示的に無効化されている
  前提 src/lib/constants.ts の ANTHROPIC_BASE を開いている
  ならば thinking が { type: 'disabled' } である
  かつ display を併記していない

シナリオ: AC-M02b 共有定数の thinking が実際に Anthropic リクエストへ届いている
  前提 ANTHROPIC_BASE に thinking: { type: 'disabled' } が入っている
  もし 18エントリの呼び出し元 8ファイル・11箇所（§14 手順2）を確認する
  ならば 11箇所いずれも MODEL_CONFIGS の thinking をリクエストへ渡している
  かつ G1 step7 と G5 と G7 を実行したとき、移行前のベースライン（§14 手順0）と比べて
       [LLMService] output truncated at max_tokens と
       [Ga4EvaluationLlm] structured output validation failed が増えていない

シナリオ: AC-M03 ブログ生成が従来どおり完結する（G1）
  前提 管理者または有料ロールでログインしている
  かつ ANTHROPIC_BASE が claude-sonnet-5 に移行済みである
  もし /chat でブログ生成の step1 から step7 まで実行する
  ならば 各ステップが応答を返し、step7 の本文が途中で切れずに終わる
  かつ 見出し単位モードで1見出しだけが編集される

シナリオ: AC-M04 広告コピー生成が従来どおり動く（G2）
  前提 手順0 で移行前の出力を採取済みである
  もし /chat で広告コピー生成を実行する
  ならば 応答が返り、出力形式が手順0 で採取したベースラインと同じ構造である

シナリオ: AC-M05 LP草案生成が途中で切れない（G3）
  もし /chat で LP 草案生成を実行する
  ならば maxTokens 32000 の枠内で出力が完結する

シナリオ: AC-M06 GSC 改善提案の4種が従来どおり動く（G4）
  もし GSC 改善提案でタイトル・書き出し・本文・ペルソナの4種を実行する
  ならば いずれも応答が返る
  かつ 本文の提案がストリーミングで途切れずに完了する

シナリオ: AC-M07 Google Ads 戦略提案の末尾 JSON がパースできる（G5）
  もし /google-ads-dashboard で AI 戦略提案を実行する
  ならば ストリーミングが完了する
  かつ 末尾の JSON ブロックがパースでき、提案が画面に表示される

シナリオ: AC-M08 Google Ads 除外キーワード提案が従来どおり動く（G6）
  もし 除外キーワード提案を実行する
  ならば 応答が返り、キーワードが画面に表示される

シナリオ: AC-M09 GA4 コンテンツ評価が従来どおり動く（G7）
  前提 呼び出し元が thinking を渡している（AC-M02b。渡さないと思考が 700 トークンを食い潰す。RISK-M05）
  もし GA4 コンテンツ評価を実行する
  ならば maxTokens 700 の枠内で評価が返り、「未評価（データが不足）」にならない
  かつ [Ga4EvaluationLlm] structured output validation failed が出ない

シナリオ: AC-M10 巻き戻しが2行で足りる
  前提 移行後に出力品質の低下が確認されている
  もし ANTHROPIC_BASE の actualModel を claude-sonnet-4-6 に戻し thinking を削除する
  ならば 18エントリすべてが移行前の挙動に戻る
```

**AC-M10 が詰め替え追加後も成立する根拠**: 詰め替えを `thinking: modelConfig.thinking` の形で書けば、共有定数から `thinking` を消した時点で値は `undefined` になり、`src/server/services/llmService.ts:171` の `opts.thinking !== undefined` ガードによって `params` に載らない。したがって呼び出し元 8ファイル・11箇所を戻す必要はなく、巻き戻しは共有定数の2行のままで足りる。**詰め替えをリテラル（`thinking: { type: 'disabled' }` の直書き）で書いてはならない**。書くと巻き戻し面が共有定数1ファイルから 9ファイル（共有定数 + 呼び出し元8ファイル）へ広がり AC-M10 が壊れる。

### シナリオ対応表

| 受け入れ条件 | 機能要件 | 確認方法 |
| --- | --- | --- |
| AC-M01 / AC-M02 | FR-M01 / FR-M02 | コード確認 |
| AC-M02b | FR-M02 | コード確認（呼び出し元 8ファイル・11箇所を1つずつ）＋ 外形確認（`stop_reason === 'max_tokens'` 警告と GA4 の構造化出力エラーがベースラインから増えないこと） |
| AC-M03〜AC-M09 | FR-M03 | 画面での手動確認（§13）。判定条件は §8「出力品質・評価基準」 |
| AC-M10 | FR-M04 | コード確認（`ANTHROPIC_BASE` の差分が2行に収まり、詰め替えが `modelConfig.thinking` 参照で書かれていること） |

## 8. 非機能要件

**該当しない項目も `対象外` と理由を記載する**（テンプレート §8 の規約）。本仕様は共有定数のモデル ID / `thinking` と、その値を API へ届ける配線だけを変更するため、多くの分類が対象外になる。

| 分類 | 要件・目標値 | 検証方法 | 状態・根拠 |
| --- | --- | --- | --- |
| 性能・レイテンシ | 移行前と同等のレイテンシ | §13 の手動確認で体感差と各グループのタイムアウト発生有無を見る | 思考を無効化するため、アダプティブ有効時のような遅延増は起きない見込み（BR-M02 / AC-M02b） |
| 可用性・信頼性 | 変更なし | 既存のエラー分類が働くことを §13 の各グループで確認 | 既存の `ChatError.fromApiError` とリトライ挙動をそのまま使う。新しい判定・待機・再試行は書かない（§9） |
| セキュリティ・プライバシー | 対象外 | — | プロンプト・入力構成・保存先を一切変更しないため。LLM へ渡す内容は移行前と同一（§6「入力・出力・状態遷移」） |
| 認証・認可 | 対象外 | — | 共有定数のモデル ID と配線のみを変更し、既存の `admin` / `paid` 制限と各機能のサーバー側検証に手を入れないため（§6 権限）。新規機能・新規サーバー入口を追加しない |
| 監査・ログ | 対象外（既存ログを流用） | §13 でログ文言を検知手段として使う | 記録対象・保持期間・マスキングを変更しない。既存の `[LLMService] output truncated at max_tokens` / `[Ga4EvaluationLlm] structured output validation failed` を回帰の検知に使うだけ |
| 障害対応 | 対象外（既存手段で足りる） | §13 ロールバック方針 | 検知は既存のエラーログ、復旧は共有定数2行を戻すデプロイ。専用の停止機構は作らない（§4 Non-goals / `CLAUDE.md` Core Rules） |
| バックアップ・復旧 | 対象外 | — | DB スキーマ変更・データ移行が無く、巻き戻すべきデータが存在しないため（§9 データ） |
| 運用・監視 | 新規の監視は作らない | — | 既存のエラーログで足りる。コスト監視ダッシュボードは要件になっていない（§4 Non-goals） |
| 拡張性・互換性 | Sonnet 5 の出力上限 128K に対し、最大の `blog_creation_step7` が 64000 で収まること | 公式 models overview の「Max output: 128K tokens」（§16 verbatim）とコード上の `maxTokens` の突き合わせ | 18エントリの最大が 64000 のため上限に抵触しない。ブラウザ・API 互換に影響する変更は無い |
| アクセシビリティ | 対象外 | — | 画面・DOM 構造・操作導線を変更しないため（§6 画面設計「変更なし」） |
| コスト | Anthropic 経路の実効コストが移行前を上回らないこと（見込みは約13%減） | 下の「コスト影響」の試算。実測値の採取は本仕様の対象外（OPEN-M03 と同様、まず測るのは出力形式） | 単価は下がるが新トークナイザでトークン数が増えるため相殺される。`thinking` の詰め替え漏れがあるとこの試算は崩れる（AC-M02b / RISK-M05） |

### コスト影響

- 単価: `claude-sonnet-4-6` が入力 $3.00 / 出力 $15.00 per 1M、`claude-sonnet-5` が入力 $2.00 / 出力 $10.00 per 1M。**単価だけ見れば 2/3**
- ただし **Sonnet 5 は新しいトークナイザで、同じテキストのトークン数が約30%増える**。掛け合わせると**実効の削減率は約13%**にとどまる
- この前提は先行仕様 §16「公式ドキュメント照合」（確認日 2026-09-04）で公式一次情報と突き合わせて確定したもの。**「一律 2/3・約33%減」は誤り**で、先行仕様の cycle 8 レビューで一度訂正されている
- `thinking` を無効化しない場合、アダプティブ思考の思考トークンが**出力料金**で上乗せされ、この試算は崩れる（BR-M02）

### AI機能の追加観点

| 観点 | 本仕様での扱い |
| --- | --- |
| **出力品質・評価基準** | **グループごとに機械判定できる合否条件を置く**（移行前ベースラインは §14 手順0 で採取）。**G1**: step7 の応答で `stop_reason` が `max_tokens` にならない（`[LLMService] output truncated at max_tokens` が出ない）。**G2 / G6**: 出力の見出し・箇条書き構造がベースラインと同じで、画面に項目が表示される。**G3**: 32000 トークン枠内で完結し、上記の切り詰め警告が出ない。**G4**: 4種とも応答が返り、本文提案のストリーミングが完了する。**G5**: 末尾 JSON ブロックが `JSON.parse` に通る。**G7**: `[Ga4EvaluationLlm] structured output validation failed` が出ず、`llm_output_invalid` にならない。**新しい計測基盤・スコアリングは作らない**（既存ログと画面表示で判定する） |
| モデル ID | `claude-sonnet-5`。日付サフィックスは付けない（公式 models overview の「Claude API ID: `claude-sonnet-5`」。§16） |
| 思考 | `thinking: { type: 'disabled' }` を共有定数に置き、呼び出し元 8ファイル・11箇所から渡す（FR-M02 / AC-M02b）。`display` は併記しない（公式表現で invalid。§16） |
| プロンプト | 変更しない。Sonnet 5 向けの書き直しは Non-goals（OPEN-M03） |
| 出力スキーマ | 変更しない |
| `maxTokens` | 変更しない。ただし G1 の `step7`（64000）と G3（32000）は長文生成のため、移行後に途中切れが出ないかを AC-M03 / AC-M05 で確認する |
| プロンプトキャッシュ | `llmService` は system ブロックに `cache_control: ephemeral` を付けている。**キャッシュはモデル単位**なので、移行直後は一度キャッシュが効かなくなる。これは一時的なもので、継続的なコスト増ではない |

## 9. データ・外部連携

### データ

DB スキーマの変更は無い。マイグレーションも不要。

### 外部連携

| 連携先 | 用途 | 本仕様での変更 | 失敗時の扱い |
| --- | --- | --- | --- |
| Anthropic API | 18エントリすべての生成 | モデル ID を `claude-sonnet-5` へ、`thinking: { type: 'disabled' }` を追加 | 既存の `ChatError.fromApiError` による分類をそのまま使う。新しい判定・待機・再試行は書かない |
| Anthropic Web検索ツール | ブログ生成の一部経路（`app/api/chat/anthropic/stream/route.ts`） | **変更しない**が、現行の `web_search_20250305` が Sonnet 5 で通るかを確認する（RISK-M01） | 通らない場合は §12 の対応方針に従う |

## 10. 制約・前提・依存関係

### 技術前提

- `thinking` の受け口は実装済み（`src/server/services/llmService.ts:171`。`opts.thinking !== undefined` のときだけ `params` に載せる）。**受け口があることと、値がそこへ届くことは別**である。詰め替え側は要約1経路にしかなく、本仕様で 8ファイル・11箇所へ追加する（§5 前提 / §14 手順2）
- モデル ID の解決は `MODEL_CONFIGS[key].actualModel` に一元化されている。**直接モデル ID を書いている呼び出し元は無い**（`app/api/chat/anthropic/stream/route.ts:239` と `app/api/chat/canvas/stream/route.ts:360` も `MODEL_CONFIGS` 経由）
- **入力トークン推定器はモデル非依存で、旧トークナイザ前提のまま残る**。`src/lib/knowledgeBudget.ts:2` の `TOKEN_ESTIMATE_CHARS_PER_TOKEN = 1.5`（コメントは「実測と ±15% 程度ズレうる」）が `estimateTextTokens` を通じてナレッジ注入予算（15,000 / 7,500）と step7 の入力ガード（40,000 で予算縮小・60,000 で L1 注入スキップ）を決めている。Sonnet 5 の新トークナイザでは同じ本文の実トークンが推定を約30%上回るため、**ガードは設計より約30%外側で発火する**。**本仕様ではこの係数を変えない**（MVP 最優先。まず測る）。影響は §13 G1 の確認で見る（RISK-M06 / OPEN-M05）

### 制約条件

| ID | 制約 | 現行コードへの影響 |
| --- | --- | --- |
| C-M01 | `temperature` / `top_p` / `top_k` は Sonnet 5 では**非既定値なら 400**。`thinking` の有無に関係なく適用される | **改修不要**。`ANTHROPIC_BASE` に `temperature` が無く、18エントリのいずれも上書きしていない。`callAnthropic`（`llmService.ts:169`）・`anthropic/stream/route.ts:277`・`canvas/stream/route.ts:725` はいずれも `!== undefined` でガードしている。**`ANTHROPIC_BASE` に `temperature` / `top_p` を足さないことだけを守る** |
| C-M02 | 手動の拡張思考（`thinking.type: 'enabled'` + `budget_tokens`）は Sonnet 5 では拒否される（400）。Sonnet 5 が受け付ける `thinking.type` は `adaptive` と `disabled` で、既定は思考オン | 現行コードで不使用。追加もしない。本仕様が置く `{ type: 'disabled' }` は**公式の対応表で Sonnet 5 が受け付ける値**（§16 verbatim「Models marked `On` default to thinking but accept `thinking: {type: "disabled"}`」） |
| C-M03 | **思考が有効なとき**、アシスタントメッセージのプレフィル（messages 末尾が `assistant`）はできない | **改修不要**。本仕様は `thinking: { type: 'disabled' }` を置くため前提条件自体が外れるうえ、チャット経路・Canvas 経路とも messages の末尾に必ず `user` を積んでおり（`canvas/stream/route.ts:729-737`）、どちらの状態でも抵触しない。公式は無条件の 400 とは書いていない（§16 verbatim「You can't prefill the assistant response while thinking is on.」） |
| C-M04 | `output_format` は非推奨（正は `output_config.format`） | 現行コードで不使用 |
| C-M05 | ミッドカンバセーション system メッセージは **Sonnet 5 では非対応**（**本仕様のレビューでは未照合**。§16「未確認として残す項目」） | 現行コードで不使用。`system` はトップレベルで渡しているため、可否が確定しても本仕様の実装は変わらない |

### 依存関係

- 先行仕様（AI要約一括のバックグラウンド化）の実装が develop にマージ済みであること。`thinking` の受け口はそこで入っている

## 11. トレードオフ判断

### ALT-M01: `thinking` を無効化するか、アダプティブのままにするか

- 選んだ案: **`ANTHROPIC_BASE` に `thinking: { type: 'disabled' }` を置く**
- 却下した案:
  - **案B（`thinking` を省略してアダプティブ既定に任せる）**: 変わる変数がモデル ID と思考モードの2つになり、回帰が出たときにどちらが原因か切り分けられない。加えて思考トークンが出力料金で課金され、`display` の既定が `"omitted"` で思考テキストが返らないため、**指定漏れは請求額でしか気づけない**。§8 のコスト試算も崩れる
  - **案C（`thinking: { type: 'adaptive' }` + `output_config: { effort: 'low' }`）**: `output_config` という**新しい設定項目**を渡す口が別途必要になり、BR-M01（`MODEL_CONFIGS` 内では `actualModel` と `thinking` の2項目だけ）から外れる。また思考トークンは `max_tokens` に算入されるため、`maxTokens` 据え置きのまま adaptive にすると本文用の枠が減り、G1 の `step7`（64000）や G5 の末尾 JSON で途中切れを**かえって増やしうる**
- 影響: 18エントリすべてが思考無効で動く。品質が現行より落ちる可能性は残るが、そのときの対処は BR-M04（モデル ID を戻す）
- 将来変更する条件: 特定グループで品質低下が観測され、かつモデル ID を戻す以外の手を検討するとき（→ OPEN-M02）
- 判断者・判断日: ユーザー（2026-09-07）

### ALT-M02: 一斉移行するか、グループごとに段階移行するか

- 選んだ案: **共有定数を1回で書き換え、確認をグループ単位で行う**
- 却下した案:
  - **案B（グループごとに `ANTHROPIC_BASE` から切り出して1つずつ移行する）**: 移行途中は7つの重複したモデル設定が併存し、`MODEL_CONFIGS` が読みにくくなる。最終的に全部を戻す作業も要る。先行仕様が要約1件だけ切り出したのは「レビュー範囲の責任を持てる単位」に限るためであって、切り出しそのものが望ましい形ではない（同仕様 §11 は「他機能の移行が終われば切り出しを戻してよい」と書いている）
- 影響: 回帰が出たとき、どのグループで出たかは確認手順（§13）で分かるが、共有定数を戻すと全グループが戻る。グループ単位の巻き戻しはできない
- 将来変更する条件: 特定グループだけ Sonnet 5 に耐えられないと判明したとき。そのグループだけを `ANTHROPIC_BASE` から切り出す
- 判断者・判断日: **プロジェクトオーナー（2026-09-08）**。Q-M05 の回答として確定した（§12 確認質問 / §16 承認表）

## 12. リスク・確認質問・未決定事項

### リスク

| ID | リスク | 影響 | 対応 |
| --- | --- | --- | --- |
| RISK-M01 | `app/api/chat/anthropic/stream/route.ts:281` の Web検索ツールが旧バリアント `web_search_20250305` を使っている。**旧バリアントが Sonnet 5 で通るかは未確認**（公式にモデル対応表が無く、Web検索ツールのページと Tool reference が相互参照で終わる。§16） | ブログ生成の Web検索経路が 400 で落ちる可能性 | **移行時に実際に1回叩いて確認する**（§14 手順4）。通らなければ、その1箇所を `web_search_20260209` へ上げ、**あわせて `allowed_callers: ['direct']` を明示する**。20260209 以降は既定が `['code_execution_20260120']` に変わり検索がコード実行サンドボックス経由（動的フィルタリング）になるため、型文字列だけ差し替えると 400 になるか、通ってもレスポンスのブロック構造が変わる（§16 verbatim・確認日 2026-09-07）。この差分を含めて +1〜2時間 |
| RISK-M02 | G1 の `step7`（`maxTokens: 64000`）と G3（32000）で、Sonnet 5 の新トークナイザにより同じ内容の出力が約30%多いトークンを消費し、**従来収まっていた長文が途中で切れる** | 生成が尻切れになる | AC-M03 / AC-M05 で確認する。切れた場合は**まず既存の続き生成導線**（`anthropic/stream/route.ts:359-365` の `isContinuation` / `truncatedContent` による上書き保存）で運用上どこまで吸収できるかを見る。`maxTokens` の引き上げは、それでも通常運用で途中切れが残る場合の選択肢とし、**クライアントへの事前共有を経てから行う**（`docs/context/client-vision-from-lark.md:67-69`: 途中切れは通常運用で発生させないことが前提であり、解決方針は単純な上限引き上げだけでなく続き生成へ誘導する導線を優先。トークン上限による制御は事前共有が必須）。**新規 UI は作らない**（Q-M04） |
| RISK-M03 | G5 の末尾 JSON ブロックが、文体変化により従来のパーサで読めなくなる | Google Ads 戦略提案が表示されない | AC-M07 で確認する。回帰が出たらパーサではなくモデルを戻す（BR-M04） |
| RISK-M04 | 移行直後はプロンプトキャッシュが効かず、一時的に入力コストが上がる | 一時的なコスト増 | 対応不要。継続的な増加ではない（§8） |
| RISK-M05 | **G7 `ga4_content_evaluation` は `maxTokens: 700` と最も狭い。**`thinking` の詰め替えが漏れると思考が既定オンのまま動き、思考トークンが `max_tokens` に算入されるため（公式 verbatim「Current-turn thinking always counts toward `max_tokens`」、Sonnet 5 の既定 effort は `high`）、700 が思考で埋まり本文が返らない | `parseStructuredResponse` が null を返し、3回リトライ後 `llm_output_invalid`。AC-M09 の「未評価（データが不足）にならない」が満たせない | **AC-M02b（詰め替えの追加）で解消する。**§13 G7 で `[Ga4EvaluationLlm] structured output validation failed` が出ないことを確認する。詰め替えを採らない判断をする場合は、G7 を移行対象から外す判断が別途必要になる |
| RISK-M06 | 入力トークン推定器（`src/lib/knowledgeBudget.ts:2`）が旧トークナイザで校正されており、Sonnet 5 では実トークンを約30%過小に見積もる。推定器自身が宣言する許容幅 ±15% を超える | step7 のナレッジ注入ガード（40,000 で予算縮小・60,000 でスキップ）が設計より約30%外側で発火し、設計意図より多い入力が 64000 の出力枠へ進む。RISK-M02 の発生確率が想定より高くなる | **係数は本仕様で変えない**（§10 技術前提）。§13 G1 で `[KnowledgeBudget] L1 injection skipped` / `L1 budget reduced` が移行前と同じ条件で出るかを見る。係数の変更可否は OPEN-M05 |

### 確認質問

| ID | 確認質問 | 回答が必要な理由 | 回答者 | 期限 | 状態・回答（2026-09-08 受領） |
| --- | --- | --- | --- | --- | --- |
| Q-M01 | 18機能を一斉に移行してよいか（ALT-M02） | 既存の合意記録は「Sonnet 5 へ移行する」までで、**一斉移行の範囲・時期までは追跡できない**（親仕様 `content-annotation-bulk-summary-background-spec.md:1146`「合意は『Sonnet 5 へ移行する』であって『全機能を一斉に移す』ではない」）。移行単位が決まらないと §14 の手順そのものが確定しない | プロジェクトオーナー | 実装着手前 | **回答済み: 一斉移行でよい（ALT-M02 の採用案どおり）。**段階移行への切り替えは、特定グループが Sonnet 5 に耐えられないと判明した場合に限る |
| Q-M02 | 確認は本番の実データで行ってよいか。LLM 呼び出しの実費が発生する | §13 の確認は7グループ分の実行を伴い課金が発生する。実施可否と実施環境が決まらないと AC-M03〜AC-M09 を検証できない | プロジェクトオーナー | 実装着手前 | **回答済み: 本番の実データで確認してよい。**7グループ分の LLM 実費が発生することを承知のうえで承認 |
| Q-M03 | 移行により同じ本文の出力トークンが約30%増える。**移行前に共有すべき内容と範囲を確認したい**（あわせて §2 が自認する「生成文の文体・粒度・レイテンシの変化」は許容されるか） | `client-vision-from-lark.md:69`「実装上の制約やトレードオフ（例: トークン上限による制御）は事前共有が必須」に該当する。同 :56「事前許可なく挙動を変えない」・:59「これまで通りのステップ感を維持する」とも衝突しうるため、共有せずに移行すると既存合意違反になる | プロジェクトオーナー | 実装着手前 | **回答済み: 挙動変更は許容される。**共有内容は本仕様書の §2（文体・粒度・レイテンシが変わりうること）と §8（出力トークン約30%増と実効削減率 約13%）を正本とする |
| Q-M04 | step7 で途中切れが観測された場合、(a) 既存の続き生成導線で吸収 / (b) `maxTokens` 引き上げ のどちらを優先するか | 2026-04-22 定例で (a) を優先する方針が示されている（`client-vision-from-lark.md:67-68`）一方、RISK-M02 の対処として (b) も選択肢に残る。**BR-M01 の「`maxTokens` を変更しない」契約の例外可否に直結する**ため、実装者が独断で選べない | プロジェクトオーナー | 実装着手前（顕在化時に即判断できるよう事前に） | **回答済み: (a) 既存の続き生成導線で吸収を優先する。**2026-04-22 定例の既存方針（`client-vision-from-lark.md:67-68`）を踏襲する判断。(b) `maxTokens` 引き上げは (a) で吸収できないと実測で示された場合にのみ、理由を §16 変更履歴に残して行う |
| Q-M05 | ALT-M02（一斉移行するか段階移行するか）の**判断者と判断日を確定したい** | ALT-M02 は本仕様の中核方針だが判断者が未確定で、トレードオフが未合意のまま実装へ進むことになる（`.agents/agents/client-alignment-auditor.md` の「トレードオフ未合意」に該当） | プロジェクトオーナー | 実装着手前 | **回答済み: 判断者はプロジェクトオーナー、判断日は 2026-09-08。**§11 ALT-M02 に反映済み |

**Q-M01〜Q-M05 は 2026-09-08 にすべて回答を受領し、着手前ゲートは解消した**（§16 承認表）。Q-M04 の回答だけは新規のクライアント発言ではなく、2026-04-22 定例の既存方針（`client-vision-from-lark.md:67-68`）を踏襲する判断として確定させたもので、根拠の所在が他の4件と異なる。

### 未決定事項（今は決めない）

| ID | 内容 | 理由 | 再検討の条件 | 判断者 |
| --- | --- | --- | --- | --- |
| OPEN-M01 | 要約の切り出し（`content_annotation_ai_summary`）を `ANTHROPIC_BASE` へ戻して設定の重複を解消するか | 先に戻すと「要約だけ2行で巻き戻す」という先行仕様のロールバック手段を失う。移行後の実運用で回帰が出ないことを確認してからでよい | 本仕様の移行後、7グループと要約の双方で一定期間回帰が出ないと確認できたとき | 実装者 |
| OPEN-M02 | 特定グループで `thinking: { type: 'adaptive' }` + `output_config: { effort: ... }` を採るか | 現時点で品質低下は観測されていない。採ると `output_config` を渡す口が要り、`maxTokens` の据え置き可否も見直しになる | 移行後に特定グループで品質低下が確認され、かつモデル ID を戻す以外の手を検討するとき | 実装者 / PO |
| OPEN-M03 | プロンプトを Sonnet 5 向けに書き直すか | まずモデル差し替えだけで品質が保てるかを測る。プロンプトも同時に変えると回帰の原因を切り分けられない | 移行後に品質低下が確認され、モデル固有の指示が原因だと切り分けられたとき | 実装者 |
| OPEN-M04 | Web検索ツールを `web_search_20260209`（動的フィルタリング付き）へ更新するか | RISK-M01 で旧バリアントが通るなら、更新は要件になっていない（MVP 最優先） | Web検索の精度や制御に不足が出たとき | PO |
| OPEN-M05 | 入力トークン推定器の係数（`src/lib/knowledgeBudget.ts:2` の `TOKEN_ESTIMATE_CHARS_PER_TOKEN = 1.5`）を Sonnet 5 の新トークナイザに合わせて校正し直すか | **今は決めない。**係数を変えるとナレッジ注入予算と step7 の入力ガードが同時に動き、モデル移行と変数が重なって回帰の切り分けができなくなる（BR-M01 と同じ理由）。まず移行後に G1 でガードの発火条件を観測する（RISK-M06） | §13 G1 の確認で `L1 injection skipped` / `L1 budget reduced` の発火が移行前と明らかに変わり、かつ生成品質か途中切れに実害が出たとき | 実装者 / PO |

## 13. テスト・リリース・ロールバック

### テスト方針

**自動テストでは回帰を検知できない。** 本仕様が変えるのは LLM の出力そのもので、既存のユニットテストは LLM をモックしている。したがって確認は**7グループの手動実行**で行う。

**比較対象は §14 手順0 で採取した移行前ベースライン**とする。手順1以降で共有定数を書き換えると比較対象が失われるため、採取は必ず変更前に行う。合否条件は §8「出力品質・評価基準」と揃えてある。

| グループ | 確認手順 | 見るところ |
| --- | --- | --- |
| G1 ブログ生成 | `/chat` で step1〜step7 を通し、見出し単位モードも1回実行する | 各ステップが応答すること。**step7 の本文が途中で切れないこと**＝`[LLMService] output truncated at max_tokens` が出ないこと（RISK-M02）。Web検索が有効な経路で 400 が出ないこと（RISK-M01）。**途中切れが起きた場合、既存の続き生成導線（`isContinuation` 経路）が従来どおり働き、続きが元メッセージへ上書き保存されるか**（RISK-M02）。**ナレッジ注入が大きい記事で `[KnowledgeBudget] L1 injection skipped` / `L1 budget reduced` が移行前と同じ条件で出るか**（RISK-M06） |
| G2 広告コピー | `/chat` で広告コピー生成を1回 | 出力の見出し・箇条書き構造がベースラインと同じか |
| G3 LP草案 | `/chat` で LP 草案生成を1回 | 32000 トークン枠内で完結するか＝上記の切り詰め警告が出ないか（RISK-M02） |
| G4 GSC 提案 | 4種（タイトル・書き出し・本文・ペルソナ）を各1回 | 4種とも応答が返るか。**本文の提案はストリーミング**なので、途切れずに完了するか |
| G5 Google Ads 戦略提案 | `/google-ads-dashboard` で1回 | **末尾 JSON ブロックが `JSON.parse` に通り、画面に提案が出るか**（RISK-M03） |
| G6 Google Ads 除外KW | 1回 | キーワードが画面に出るか。出力構造がベースラインと同じか |
| G7 GA4 評価 | GA4 コンテンツ評価を1回 | 700 トークン枠内で返るか。「未評価（データが不足）」にならないか。**`[Ga4EvaluationLlm] structured output validation failed` が出ないこと**（RISK-M05。ここが出るなら `thinking` の詰め替えが漏れている疑いが濃い） |

あわせて `npm run verify`（audit / lint / test / build / knip）を通す。既存テストは通るはずで、**通らなければモデル ID がどこかにハードコードされていた証拠**になる。

### リリース方針

1. 移行前のベースラインを採取する（§14 手順0）
2. `ANTHROPIC_BASE` を変更し、呼び出し元 8ファイル・11箇所へ `thinking` の詰め替えを追加して `npm run verify` を通す
3. プレビュー環境またはローカルで G1〜G7 を確認し、ベースラインと突き合わせる
4. 回帰が無ければ develop へマージし、本番へ反映する
5. 反映後、G5（末尾 JSON）・G1（長文）・G7（700 トークン枠）を本番で1回ずつ再確認する

### ロールバック方針

`ANTHROPIC_BASE` の2行（`actualModel` と `thinking`）を戻してデプロイする。DB の変更が無いためデータの巻き戻しは不要。**専用の停止機構は作らない**（§4 Non-goals）。

グループ単位で戻したい場合は、そのエントリだけを `ANTHROPIC_BASE` から切り出す（ALT-M02 の影響）。

## 14. 実装手順・チェックポイント

### 手順

0. **【変更前に必ず実施】移行前ベースラインを採取する。** G1〜G7 を現行の `claude-sonnet-4-6` で各1回実行し、出力を保存する（G1 step7 の本文と `stop_reason`、G2 / G6 の出力構造、G3 の完結可否、G4 4種の応答、G5 の末尾 JSON、G7 の評価 JSON）。あわせて実行時のサーバーログ（`[LLMService] output truncated at max_tokens` / `[Ga4EvaluationLlm] structured output validation failed` / `[KnowledgeBudget] L1 injection skipped` / `L1 budget reduced` の有無）を控える。**新しい計測基盤は作らない**（既存ログと画面出力の保存で足りる）。手順1以降では比較対象が失われるため、この採取を飛ばすと AC-M03〜AC-M09 と §15 の「回帰が無いことを確認できている」が検証不能になる
1. `src/lib/constants.ts:60` の `ANTHROPIC_BASE` に `actualModel: 'claude-sonnet-5'` と `thinking: { type: 'disabled' }` を設定する。**あわせて、要約の切り出しを残す理由（OPEN-M01）をコメントで1行残す**（切り出しが不要に見えて消されるのを防ぐ）。**同じコメントブロック（`src/lib/constants.ts:131`）の「ANTHROPIC_BASE は 19 エントリへ展開されており」を「18 エントリ」へ訂正する**（実測 `grep -c "\.\.\.ANTHROPIC_BASE" src/lib/constants.ts` = 18。§6 の対象表と一致）
2. **`MODEL_CONFIGS` の `thinking` を Anthropic リクエストへ詰め替える配線を、18エントリの呼び出し元 8ファイル・11箇所へ追加する。**必ず `thinking: modelConfig.thinking` の形（共有定数への参照）で書く。リテラル直書きは AC-M10 を壊すため禁止（§7 の根拠を参照）。**同一ファイル内に複数の呼び出し経路を持つファイルが3つある**（`canvas/stream/route.ts` が3箇所、`chatService.ts` と `googleAdsAiAnalysisService.ts` が各2箇所）ため、**ファイル単位で「触った」と判断せず、下記11箇所すべてを個別に確認すること**。ファイル数と箇所数が一致しないことがこの配線漏れの主因である。対象:
   - `app/api/chat/anthropic/stream/route.ts` — `llmChat` を経由せず `anthropic.messages.stream` を直接呼ぶ。`streamParams`（:272-293）は現在 model / max_tokens / temperature / system / messages / tools のみで `thinking` を持たない。`cfg.thinking` を `resolvedTemperature` と同じ `!== undefined` ガードの形で追加する
   - `app/api/chat/canvas/stream/route.ts`（**3箇所**）— `:360` の `const { maxTokens, temperature, actualModel } = modelConfig;` が `thinking` を捨てている。**分割代入に `thinking` を足したうえで、同ファイル内の `anthropic.messages.stream` 3箇所すべてに渡す**: `:560`（Web検索段階、`max_tokens: 2000`）／`:722`（Canvas 編集本体、`max_tokens: canvasMaxTokens`）／`:945`（差分分析、**`max_tokens: 500`**）。3箇所とも `model: actualModel`（`:341` の `MODEL_CONFIGS[modelKey]` 由来）を使うため、いずれも移行対象エントリで動く。とくに `:945` は**本仕様で最も狭い出力枠**（G7 の 700 より狭い）で、詰め替えが漏れると RISK-M05 と同じ機序（思考トークンが `max_tokens` に算入される）で本文が返らなくなる
   - `src/server/services/chatService.ts`（**2箇所**）— `:83-90` の `llmCallOptions` と `:283-290` の `continueLlmOptions` は、**それぞれ独立したインラインリテラル型**（どちらも `temperature` / `maxTokens` / `anthropicSystemBlocks?` の3フィールド固定）。**片方だけ直しても型エラーにならないため、2つの型リテラル両方に `thinking` を足す**。渡す先は `:95`（新規チャット）と `:295`（継続会話）の2経路。`:295` を落とすと継続会話を通る G1 `blog_title_meta_generation` / G2 広告コピー / G3 LP草案で詰め替えが漏れる
   - `src/server/services/gscSuggestionService.ts` — `:268` の `llmChat` 呼び出し（G4）
   - `src/server/services/googleAdsAiAnalysisService.ts`（**2箇所**）— `:249` と `:494` の2つの `llmChat` 呼び出し。**両方に渡す**（G5）
   - `src/server/services/googleAdsNegativeKeywordsSuggestionService.ts` — `:302`（G6）
   - `src/server/services/ga4EvaluationLlmService.ts` — `:130-137` の `llmChat` 呼び出しが `{ timeoutMs, maxTokens }` のみ。`Ga4EvaluationLlmRequest` 型に `thinking` を追加し、`llmChat` の options へ渡す（G7。RISK-M05 の解消に必須）
   - `src/server/services/ga4ContentEvaluationService.ts` — `:870-878` の `generateGa4EvaluationLlmOutput` の request 構築に `thinking: config.thinking` を足す（`config` は `:841` の `MODEL_CONFIGS.ga4_content_evaluation`）。**上の `ga4EvaluationLlmService.ts` と対で必要**で、片方だけでは値が届かない（G7）

   参考実装は `src/server/services/contentAnnotationSummaryService.ts:226-229`（現状これが唯一の詰め替え箇所で、直上に「この1行が無いと `MODEL_CONFIGS` の `thinking` は params に載らない」という警告コメントがある）
3. `npm run verify` を通す
4. **G1 のブログ生成を Web検索が有効な経路で1回実行する**（RISK-M01 の確認。ここで 400 が出たら手順5へ、出なければ手順6へ）
5. （RISK-M01 が顕在化した場合のみ）`app/api/chat/anthropic/stream/route.ts:281` の `web_search_20250305` を `web_search_20260209` へ変更し、**あわせて `allowed_callers: ['direct']` を明示する**。20260209 以降は `allowed_callers` の既定が `['code_execution_20260120']` に変わり、明示しないと動的フィルタリング（コード実行サンドボックス）経由になるか 400 になる（出典 URL・確認日・verbatim は §16）。変更後に再確認する
6. G1〜G7 を §13 の手順で確認し、手順0 のベースラインと突き合わせる
7. 回帰があれば原因を特定し、BR-M04（モデル ID を戻す）か、RISK-M02 の対応（まず既存の続き生成導線での吸収。`maxTokens` 引き上げはクライアントへの事前共有を経てから）かを判断する
8. **（済）** `docs/plans/content-annotation-bulk-summary-background-spec.md` の OPEN-B01 は **2026-09-07 に「本仕様へ移管」と更新済み**（同仕様 §12 OPEN-B01 行）。**再確認のみで、書き換え作業は不要**

### チェックポイント

| チェックポイント | 確認内容 | 満たさない場合 | 確認者 | 状態 |
| --- | --- | --- | --- | --- |
| 着手前 | Q-M01〜Q-M05 が回答済みで、ALT-M02 の判断者が確定し、§16 承認表が埋まっている | **着手しない。**回答を待つ | プロジェクトオーナー | **充足（2026-09-08）** |
| 手順0完了時 | G1〜G7 の移行前出力とログが保存されている | 採取してから手順1へ進む（採取前に共有定数を変えると比較対象が消える） | 実装者 | 未確認 |
| 手順3完了時 | `npm run verify` が通る。モデル ID のハードコードが無い。**§14 手順2 に列挙した 8ファイル・11箇所すべてで `MODEL_CONFIGS` の `thinking` が Anthropic リクエストへ渡っていること**を、箇所ごとに1つずつ確認する（`canvas/stream/route.ts` は3経路、`chatService.ts` と `googleAdsAiAnalysisService.ts` は各2経路あるため、ファイル単位で数えると漏れる）。**grep のヒット件数を合格条件にしない**（`LLMOptions.thinking` は optional なので、渡し漏れがあっても型エラーにならず `npm run verify` も通る。件数一致で合格にすると未配線の経路が通過する） | 漏れている箇所を埋めてから進む。ハードコード箇所は `MODEL_CONFIGS` 経由に直す | 実装者 | 未確認 |
| 手順4完了時 | Web検索経路が 400 にならない | 手順5を実施する | 実装者 | 未確認 |
| 手順6完了時 | G1〜G7 すべてで §8「出力品質・評価基準」の合否条件を満たし、ベースラインからの回帰が無い | 手順7へ | 実装者 | 未確認 |
| 手順8完了時 | 先行仕様の OPEN-B01 が本仕様へ移管された旨になっている（**2026-09-07 に更新済み。再確認のみ**） | 差異があれば報告する | 実装者 | 未確認 |

## 15. 完了条件

- AC-M01〜AC-M10（AC-M02b を含む）をすべて満たす
- `npm run verify` が通る
- **18エントリの呼び出し元 8ファイル・11箇所すべてが `MODEL_CONFIGS` の `thinking` を Anthropic リクエストへ渡している**（AC-M02b）
- §14 手順0 のベースラインが採取済みで、G1〜G7 の手動確認がそれとの比較で完了し、§8「出力品質・評価基準」の合否条件を満たしている
- RISK-M01（Web検索ツール型）の可否が確定している。`web_search_20260209` へ上げた場合は `allowed_callers: ['direct']` が明示されている
- 先行仕様 `content-annotation-bulk-summary-background-spec.md` の OPEN-B01 が本仕様へ移管された旨になっている（2026-09-07 更新済み。再確認のみ）

**着手前ゲート（完了条件とは別に、実装開始の前提）**: Q-M01〜Q-M05 が回答済みで、ALT-M02 の判断者が確定し、§16 承認表が埋まっていること。→ **2026-09-08 に充足した**（§12 確認質問 / §16 承認表）。

## 16. レビュー記録・承認・変更履歴

### レビュー記録

| 日付 | 種別 | 指摘件数 | 反映状況 |
| --- | --- | --- | --- |
| 2026-09-07 | `spec-review` 初回（identify → audit → revise） | 12件（🔴2 / 🟡6 / 🟢4）＋ 外部入力待ち1件 | **12件すべて反映済み。**内訳は下記「2026-09-07 の反映内容」 |
| 2026-09-07 | `spec-review` 2回目（audit → revise） | 3件（🟡1 / 🟢2）＋ revise の実測で追加検出した 🔴1件 ＋ 外部入力待ち1件（継続） | **4件すべて反映済み。**前回12件は再監査で全件 `resolved` と確認された。内訳は下記「2026-09-07（2回目）の反映内容」 |
| 2026-09-07 | `spec-review` 3回目（audit）**未完了** | — | **Claude SDK の5時間レート上限（`five_hour` / `org_level_disabled`）で中断し、フォールバックの `claude` provider も session limit に達したため、workflow が6/12ステップ目で失敗した**（`.takt/runs/20260907-075003-docs-plans-anthropic-base-sonn/`）。3回目の監査結果は得られていない。2回目 audit は「未解決6件（Q-M01〜Q-M05 と承認表）は外部入力を要するため次回 audit でも `approved` にはならない」と明記しており、**残件が外部入力のみであることは2回目時点で確定していた**。その外部入力を 2026-09-08 に受領したため、`spec-review` の再実行は行わずに承認へ進めた（判断者: プロジェクトオーナー） |

#### 2026-09-07 の反映内容

- 🔴 **`thinking` の配管が実在しない**: §5 前提が「配管の追加は不要」としていたが、`MODEL_CONFIGS` の `thinking` を `llmChat` の options へ詰め替えている箇所は全リポジトリで `contentAnnotationSummaryService.ts:229` の1つだけで、移行対象18エントリの呼び出し元7ファイルはいずれも渡していなかった（`grep -rn "thinking" src app` の全9ヒットで確認）。仕様どおり実装しても API に `thinking` が載らず、アダプティブ思考が既定オンのまま出力料金で課金される状態になる。§4 / §5 / §6 FR-M02 / §7 AC-M02b / §14 手順2 / §15 を書き換え、詰め替え先を明記した（**このときの「7ファイル」という計数は誤りで、2回目のレビューで「8ファイル・11箇所」へ訂正した。下記「2026-09-07（2回目）の反映内容」参照**）。BR-M01 の「2項目だけ」は `MODEL_CONFIGS` 内の変更に限る契約だと書き分けた
- 🔴 **G7 の 700 トークンが思考で埋まる**: 上記の帰結として `ga4_content_evaluation`（`maxTokens: 700`）で本文が返らず `llm_output_invalid` になる経路を RISK-M05 として明示し、§13 G7 に検知条件を追加した
- 🟡 **ベースライン採取手順が無い**: AC-M04 / §13 が「移行前と同じ構造」を要求しながら採取手順を持たず、手順1で共有定数を変えた後は比較対象が存在しなかった。§14 に手順0 を追加し、§8 に「出力品質・評価基準」行（グループごとの機械判定条件）を足した
- 🟡 **入力トークン推定器が旧トークナイザ校正**: `knowledgeBudget.ts:2` の係数がモデル非依存で、Sonnet 5 では約30%過小に見積もる。§10 技術前提に明記し RISK-M06 / OPEN-M05 を追加。**係数は本仕様で変えない**
- 🟡 **途中切れ対処がクライアント判断と衝突**: RISK-M02 の対処を「`maxTokens` 引き上げ」一択で書いていたが、2026-04-22 定例では続き生成への誘導を優先する判断が出ている。既存の続き生成導線（`anthropic/stream/route.ts:359-365`）を先に見る形へ書き換え、Q-M04 を立てた。**新規 UI は作らない**
- 🟡 **Web検索フォールバックの前提崩れ**: `web_search_20260209` 以降は `allowed_callers` の既定が変わるため、型文字列だけの差し替えでは足りない。§14 手順5 と RISK-M01 に `allowed_callers: ['direct']` の明示を追加
- 🟡 **非機能要件の7分類が空欄**: テンプレート11分類に対し4行しか無く「検証方法」列も欠けていた。11分類へ拡張し、該当しない分類は理由付きで `対象外` と明記した。**新しい非機能要件は発明していない**
- 🟡 **公式ドキュメント引用規約の未充足**: 下記「公式ドキュメント照合」を本ランの実照合結果へ差し替えた。あわせて C-M03 を「思考が有効なとき」の条件付きへ、BR-M02 の「400」を公式表現（invalid）へ揃え、`claude-api` skill の所在注記を復元した
- 🟢 `src/lib/constants.ts:131` コメントの「19 エントリ」→「18 エントリ」訂正を §14 手順1 に追加／OPEN-B01 は親仕様側で更新済みのため §14 手順8・チェックポイント・§15 を「済・再確認のみ」へ／テンプレート形式（§1 成功指標表・§5 換算と見積状態と工数サマリー列・§14 チェックポイントの確認者と状態列・メタデータの未確定理由）を充足／README 予告を §4 に追加

#### 2026-09-07（2回目）の反映内容

- 🟡 **配線ゲートの計数が実体と食い違っていた**: §14 チェックポイント「手順3完了時」の合格条件が「`grep -rn "thinking" src app` で詰め替え箇所が8つ（既存1 + 追加7経路）」だったが、手順2 が列挙した実体は **8ファイル・11箇所**だった（手順2 第7項が `ga4EvaluationLlmService.ts` と `ga4ContentEvaluationService.ts` の2ファイルを1バレットに畳んでいたため、バレット数7＝ファイル数7 が成立していなかった）。9箇所のうち8箇所を配線した時点で件数ゲートが合格し、残る未配線が `chatService.ts:295`（`continueLlmOptions`）だった場合、**継続会話経路を通る G1 `blog_title_meta_generation` / G2 / G3 の3グループで詰め替えが漏れたまま通過する**。`LLMOptions.thinking` が optional のため型エラーにも `npm run verify` にも現れない。合格条件を件数から「9箇所を1つずつ確認」へ置換し、「grep のヒット件数を合格条件にしない」を理由付きで明記。あわせて「7ファイル」を **「8ファイル・11箇所」**へ §4 / §7 AC-M02b / §14 手順2 / §15 の4箇所で統一し、手順2 第7項を2バレットへ分割、第3項に `continueLlmOptions`（`:283-290`）が `llmCallOptions`（`:83-90`）とは**別のインラインリテラル型**である事実（実測で確認）を追記した
- 🟢 §1 成功指標「思考トークンの混入がないこと」の測定方法が **AC-M02** を参照していたが、記載内容は AC-M02b の定義そのものだった（AC-M02 は共有定数の記述しか検証しない）。参照を **AC-M02b** へ訂正
- 🟢 §12 確認質問の表がテンプレート `requirement-definition.md:303` の列（回答が必要な理由 / 期限）を欠いていた。両列を追加し、期限はメタデータの「実装着手前」を転記した（**新しい期限は発明していない**）

- 🔴 **（revise の実測で追加検出。audit 指摘外）配線対象の列挙自体が 2箇所不足していた**: `app/api/chat/canvas/stream/route.ts` は `anthropic.messages.stream` を **3箇所**（`:560` Web検索段階 `max_tokens: 2000` ／ `:722` Canvas 編集本体 ／ `:945` 差分分析 **`max_tokens: 500`**）で呼び、3箇所とも `:360` で分割代入した `actualModel`（`:341` の `MODEL_CONFIGS[modelKey]` 由来）を使う。前回改訂と2回目 audit はいずれも `:722` の1箇所しか数えておらず、**残り2箇所は移行対象モデルで動きながら `thinking` を渡さないまま残る**設計になっていた。とくに `:945` は `max_tokens: 500` で本仕様の中で最も出力枠が狭く（G7 の 700 より狭い）、RISK-M05 と同じ機序で本文が返らなくなりうる。実測により総数を **8ファイル・11箇所**へ訂正し（audit が提示した「9箇所」は canvas の2箇所を含まない）、手順2 の canvas 項に3箇所を個別に列挙、チェックポイントの注記も「3ファイルが複数経路を持つ」へ更新した

**この回の 🟡🟢3件はいずれも既存記述の計数訂正・参照訂正・テンプレ列追加**で、新規要件・新規機構は追加していない。追加検出した 🔴 も、FR-M02（「18エントリすべての呼び出し元がその値を渡す」）を満たすために必要な既存要件の充足であり、新しい要件ではない。

#### 残置合意・未解決として残す論点

- **クライアント合意・承認ゲートは未充足のまま残す（外部入力待ち）。**§6 FR-M01 の根拠「クライアント合意 2026-09-04」を追跡したところ、記録は親仕様 `content-annotation-bulk-summary-background-spec.md:941`「追加のクライアント合意（2026-09-04 受領）: Claude Sonnet 5 への移行に合意」と同 :1146「**合意は「Sonnet 5 へ移行する」であって「全機能を一斉に移す」ではない**」のみで、**18機能を一斉に切り替える範囲・時期までの合意記録は確認できなかった**（`docs/context/client-vision-from-lark.md` にモデル移行の記述は無い）。さらに §2 が自認する「生成文の文体・粒度・レイテンシの変化」は同 :56「事前許可なく挙動を変えない」・:59「これまで通りのステップ感を維持する」・:69「実装上の制約やトレードオフは事前共有が必須」と衝突しうる。**エージェント側では確定できないため、Q-M03 / Q-M04 / Q-M05 を §12 へ追加し、回答は作っていない。**Q-M01 / Q-M02 とあわせて未解決5件で、ALT-M02 の判断者と §16 承認表も未確定のまま。**この状態では仕様レビューは完了とせず、`spec-to-pr` へ投入しない**（→ **2026-09-08 に Q-M01〜Q-M05 の回答を受領して解消した**。§12 確認質問 / §16 承認表。この行は当時の判断の記録として残す）
- 上記以外に、理由付きで残置合意とした 🟡 論点は無い（🔴2 / 🟡6 / 🟢4 はすべて本改訂で反映済み）

### 公式ドキュメント照合

**本仕様の `spec-review`（2026-09-07）で、下記の公式ページを直接取得して照合した**（先行仕様の引用への依拠をやめ、一次情報へ差し替えた）。引用と、そこから導いた解釈は分けて書く。

| 照合対象 | 参照 URL | 確認日 |
| --- | --- | --- |
| 単価・新トークナイザ | https://platform.claude.com/docs/en/about-claude/pricing | 2026-09-07 |
| 思考の既定挙動・`display`・サンプリング制約・プレフィル・強制ツール使用・`max_tokens` 算入 | https://platform.claude.com/docs/en/build-with-claude/thinking | 2026-09-07 |
| モデル別の思考対応・既定・400 で拒否される値 | https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting | 2026-09-07 |
| モデル ID・既定 effort・出力上限・提供終了 | https://platform.claude.com/docs/en/models/overview | 2026-09-07 |
| Web検索ツールのバージョンと `allowed_callers` | https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool | 2026-09-07 |

**verbatim 引用**（公式ページ本文をそのまま引用）:

> | Claude Sonnet 5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.20 / MTok | $10 / MTok |
> | Claude Sonnet 4.6 | $3 / MTok | $3.75 / MTok | $6 / MTok | $0.30 / MTok | $15 / MTok |

> Claude 4.7 and later models and Claude Mythos Preview use a newer tokenizer that contributes to their improved performance on a wide range of tasks. This tokenizer produces approximately 30% more tokens for the same text. The exact increase depends on the content and workload shape. Claude Sonnet 4.6 and earlier models use the previous tokenizer.

> The $2/$10 per million input/output token pricing for Claude Sonnet 5, announced at launch as introductory pricing through August 31, 2026, is now the standard price. The previously scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not occur.

> On Claude Opus 5, Claude Sonnet 5, Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, Claude Mythos 5, and Claude Mythos Preview, thinking is already on and needs no configuration. `display` defaults to `"omitted"` on these models, so the thinking text is hidden until you opt in.

> the tokens Claude spends reasoning are billed as output tokens, even when the thinking text isn't returned to you, and they count toward `max_tokens` alongside the response text.

> **Current-turn thinking** always counts toward `max_tokens`, is billed as output tokens, and occupies context window space for the turn that generated it.

> `display` is invalid with `thinking.type: "disabled"` (there is nothing to display).

> On Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, Claude Mythos 5, Claude Mythos Preview, Claude Opus 5, Claude Opus 4.8, Claude Opus 4.7, and Claude Sonnet 5, non-default `temperature`, `top_p`, or `top_k` values return a 400 error on every request, regardless of whether thinking is used.

> You can't prefill the assistant response while thinking is on. Forced tool use (`tool_choice: {"type": "any"}` or `{"type": "tool", ...}`) is incompatible with manual extended thinking but works with adaptive thinking. The exceptions are Claude Fable 5.1 and Claude Mythos 5.1, which reject forced tool use on every request with a 400 error.

モデル別対応表（Troubleshooting ページ）:

> | Claude Sonnet 5 | Adaptive only | On | `"enabled"` |

> Models marked `Always on` cannot turn thinking off. Models marked `On` default to thinking but accept `thinking: {type: "disabled"}`.

> Extended thinking (`thinking.type: "enabled"` with `budget_tokens`) is deprecated on the Claude 4.6 models (requests using it still succeed). Claude 4.7 and later models do not support it and reject requests that use it, returning a 400 error.

models overview（Claude Sonnet 5 の列）:

> Claude API ID: `claude-sonnet-5` ／ Default effort: `high` ／ Max output: 128K tokens ／ Context window: 1M tokens ／ Retirement: Not sooner than June 30, 2027

Web検索ツール:

> Three versions of the web search tool are available: `web_search_20250305`: basic web search / `web_search_20260209`: adds dynamic filtering / `web_search_20260318`: adds response inclusion control for agentic workflows

> All web search tool versions accept `allowed_callers`, which controls whether Claude calls web search directly or from code execution through dynamic filtering. On `web_search_20260209` and later it defaults to `["code_execution_20260120"]` instead of `["direct"]`.

> To call web search directly, without dynamic filtering, set `allowed_callers: ["direct"]`. Models that don't support programmatic tool calling require this setting. Without it, the API returns a 400 error that tells you to set it.

**解釈（引用と分離）**:

- Sonnet 5 は思考が既定オンで、`display` の既定が `"omitted"`。よって指定漏れは出力に現れず請求額でしか気づけない（BR-M02 の根拠）。一方で Sonnet 5 は `thinking: { type: 'disabled' }` を**受け付ける**ため、本仕様の方針は公式の対応表と矛盾しない（C-M02）
- 思考トークンは `max_tokens` に算入されるので、`maxTokens: 700` の G7 が最も脆い（RISK-M05）。Sonnet 5 の既定 effort が `high` であることがこれを悪化させる
- 単価は 2/3 だが同じテキストのトークン数が約30%増えるため、実効削減率は `2/3 × 1.3 ≒ 0.87`＝約13%減（§8）。「一律 2/3・約33%減」は誤り
- 出力上限 128K に対し最大の `blog_creation_step7` は 64000 なので、上限には抵触しない（§8 拡張性・互換性）
- `temperature` / `top_p` / `top_k` の 400 は思考の有無に関係なく適用される（C-M01）。プレフィル不可は「思考が有効なとき」の条件付きで、無条件の 400 ではない（C-M03）
- Canvas 経路の強制ツール使用（`canvas/stream/route.ts:728` の `tool_choice: { type: 'tool', ... }`）はアダプティブ思考では動作するとされており、Sonnet 5 で問題にならない
- 20260209 以降は既定 caller が変わるため、フォールバック時は `allowed_callers: ['direct']` の明示が必要（RISK-M01 / §14 手順5）

**未確認として残す項目（断定しない）**:

- C-M04「`output_format` は非推奨（正は `output_config.format`）」の一次情報は、上記5ページには記載が無かった。現行コードで不使用のため本仕様への影響は無い
- C-M05「ミッドカンバセーション system メッセージは Sonnet 5 では非対応」は本ランで照合していない。現行コードで不使用（`system` はトップレベル）のため影響は無い
- **`web_search_20250305` × `claude-sonnet-5` の明示的なモデル対応表は公式に存在しない**。Web検索ツールのページは「For model support, see the Tool reference」、Tool reference は各ツールのページへ戻る相互参照で終わる。したがって RISK-M01 は「公式未記載・実機確認が必要」として §14 手順4 の実機確認に委ねる（`.agents/skills/spec-review/external-services.md:66` の規約どおり）
- 上記の `claude-api` は **Claude Code バンドル skill であり、リポジトリ内 `.agents/skills` には存在しない**（実測: `.agents/skills/` は13 skill で `claude-api` は無い）。実装着手時にリポジトリ内を探しても見つからないため、参照する場合は上記の公式ページを一次情報とすること

### 承認

| 役割 | 氏名 | 状態 | 日付 |
| --- | --- | --- | --- |
| プロジェクトオーナー | shoma-endo | **承認**（Q-M01〜Q-M05 に回答済み。ALT-M02 の判断者を確定） | 2026-09-08 |

**着手前ゲートは充足した**（§14 チェックポイント「着手前」／§15 着手前ゲート）。ただし承認は**移行の実施と確認方法**に対するものであって、§13 の各グループ確認を省いてよいという意味ではない。

### 変更履歴

| 日付 | 変更内容 | 理由 | 変更者 |
| --- | --- | --- | --- |
| 2026-09-08 | **Q-M01〜Q-M05 の回答を受領し、ステータスを `draft` → `approved` にした。**Q-M01「一斉移行でよい」／Q-M02「本番の実データで確認してよい（LLM 実費を承知）」／Q-M03「挙動変更は許容。共有内容は §2 と §8 を正本とする」／Q-M04「(a) 既存の続き生成導線で吸収を優先」／Q-M05「判断者はプロジェクトオーナー、判断日 2026-09-08」。あわせて ALT-M02 の判断者・§14 チェックポイント「着手前」・§15 着手前ゲート・§16 承認表・メタデータ（承認者 / 対象リリース）・§5 見積の状態を更新した。**Q-M04 の回答だけは新規のクライアント発言ではなく、2026-04-22 定例の既存方針（`client-vision-from-lark.md:67-68`）を踏襲する判断として確定させたもの**で、その旨を §12 に明記した。`spec-review` 3回目はレート上限で未完了だが、2回目 audit が「残件は外部入力のみ」と確定させていたため再実行はしていない（§16 レビュー記録）。**仕様の内容そのものは変更していない** | 承認が下り、着手前ゲートの前提だった外部入力がすべて揃ったため。仕様レビューで検出済みの技術的指摘（🔴2 / 🟡7 / 🟢6）は 2026-09-07 の2ラウンドで反映済みで、本更新はゲート状態の反映に限る | Claude（ローカルセッション） |
| 2026-09-07 | `spec-review` 2回目の指摘3件（🟡1 / 🟢2）を反映。**🟡 は前回改訂が持ち込んだ計数の誤り**で、§14 チェックポイント「手順3完了時」が `grep` のヒット件数（8つ）を合格条件にしていたが、手順2 の列挙実体は 8ファイル・11箇所だった。9箇所中8箇所を配線した時点でゲートが合格し、未配線が `chatService.ts:295`（`continueLlmOptions`）だと継続会話経路の G1 `blog_title_meta_generation` / G2 / G3 で詰め替えが漏れたまま通過する（`LLMOptions.thinking` が optional のため型エラーにも `npm run verify` にも出ない）。合格条件を「9箇所を1つずつ確認」へ置換し「grep 件数を合格条件にしない」を明記。「7ファイル」→「8ファイル・11箇所」を仕様書内の**9箇所**（§4 / §5 前提・工数サマリー・内訳 / §6 FR-M02 / §7 AC-M10 根拠・シナリオ対応表 / §8 AI観点 / §10 / §13 リリース方針 / §14 手順2 / §15）で統一し、手順2 第7項を2バレットへ分割、第3項に `continueLlmOptions` が別型である旨を追記。あわせて §1 成功指標の参照を AC-M02 → AC-M02b へ、§12 確認質問の表にテンプレート列（回答が必要な理由 / 期限）を追加。**さらに revise の実測で、audit 指摘外の 🔴 を1件追加検出した**: `canvas/stream/route.ts` の `anthropic.messages.stream` は `:722` だけでなく `:560`・`:945` の計3箇所あり、いずれも移行対象の `actualModel` を使う。総数を「8ファイル・11箇所」へ訂正（audit 提示の「9箇所」は canvas の2箇所を欠く）。`:945` は `max_tokens: 500` で本仕様中もっとも枠が狭い | 前回改訂で追加した配線ゲートが、実装中に前回 🔴 を捕まえる唯一の関門であるにもかかわらず、件数一致で合格する設計だったため、3グループ分の詰め替え漏れを通過させうる状態だった。ゲート自体が機能しないと 🔴 の修正が実装段階で無効化される。加えて、配線対象の列挙そのものが2箇所不足しており、列挙どおり実装しても FR-M02 を満たせなかった | Claude（spec-review revise 2回目） |
| 2026-09-07 | `spec-review` 初回の指摘12件（🔴2 / 🟡6 / 🟢4）を反映。最重大は §5 前提「`thinking` の配管追加は不要」が実コードと矛盾していた点で、詰め替えが要約1経路にしか無いことを実測で確認し、呼び出し元7ファイルへの配線追加を §4 / §5 / FR-M02 / AC-M02b / §14 手順2 / §15 に入れた。あわせて G7（700 トークン）が思考で埋まる経路を RISK-M05 に、旧トークナイザ校正の入力推定器を RISK-M06 / OPEN-M05 に、移行前ベースライン採取を §14 手順0 と §8「出力品質・評価基準」に、途中切れ対処のクライアント判断（続き生成導線の優先）を RISK-M02 と Q-M04 に、Web検索フォールバックの `allowed_callers: ['direct']` を §14 手順5 と RISK-M01 に追加。§8 非機能を11分類＋検証方法列へ、§16 を公式5ページの実照合（URL・確認日・verbatim・未確認項目）へ差し替え、C-M03 / BR-M02 を公式表現へ揃えた。テンプレート形式（§1 成功指標表・§5 換算と工数サマリー列・§14 チェックポイント列・メタデータの未確定理由）と README 予告も充足。**クライアント合意・承認ゲートは解消せず、Q-M03 / Q-M04 / Q-M05 を追加して外部入力待ちとして残した（回答は作っていない）** | 仕様どおり実装しても `thinking` が API に載らず、アダプティブ思考が18機能すべてで既定オンのまま出力料金で課金され、`display` 既定 `"omitted"` のため請求額でしか気づけない状態になっていたため（BR-M02 が警告した状態が仕様準拠の実装結果として発生する）。あわせて回帰確認の比較対象が存在しない、公式引用が二次情報依拠、という検証不能・トレース不能な箇所を閉じた | Claude（spec-review revise） |
| 2026-09-07 | 初版作成。先行仕様の OPEN-B01 を独立した仕様へ起こした。対象18エントリを7グループに整理し、コード実測で C-M01〜C-M05 の該当有無を確定した（`temperature` 未使用・プレフィル無し・モデル ID のハードコード無し）。`thinking` 方針は ALT-M01 で `{ type: 'disabled' }` に決定 | OPEN-B01 が「後で判断する」の1行登録のみで、実装の指示書として使えなかったため | Claude（ローカルセッション） |
