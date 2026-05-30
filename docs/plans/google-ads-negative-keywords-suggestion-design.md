# Google Ads 除外キーワード提案 メール自動配信 設計書

> **改訂履歴**
> - 2026-05-20: 初版作成。クライアント MTG (`objplfi8m89t5a22x2dvgd5c`) の要望 + client-alignment-auditor の論点 + 既存「コンテンツ戦略提案」(`docs/plans/google-ads-evaluation-design.md`) との整合を反映。
> - 2026-05-21: Phase 1 / Phase 2 にフェーズ分割（Phase 2 = メール返信による自動 Google Ads 登録）。
> - 2026-05-21 (改): **クライアント判断により Phase 2 を本設計書のスコープ外に変更**。本機能は **提案メール送信まで** とする。Phase 2 関連セクション（旧 §18）と関連工数を削除。実装が必要になった場合は別設計書で起こす。
> - 2026-05-21 (改2): `service_id` / 分析対象サービス UI を削除。連携アカウント一式取得に統一。設定項目を自動配信 ON/OFF + 配信時刻の 2 つに縮小。**Brief 未登録でも送信可**（Google Ads 連携 + メール登録が前提。`persona` は任意）。

## 開発ステータス

| フェーズ | 内容 | 工数（余裕込み） | 状態 |
|----------|------|-------------------|------|
| **本機能** | 除外キーワード提案を毎朝メールで自動配信（手動実行 + cron + opt-in 設定 + タブ化 UI） | **49.5h（約 6.2 人日）** | 仕様確定・未着手 |

- 提案メール受け取りまでで完結する単発機能。Google Ads への自動登録（mutate）は本設計書では対象外。
- セクション構成: §1 〜 §17 + 工数見積もり + 確認待ち事項

## 1. 目的

- Google Ads の **前日の検索クエリ実績** を AI（claude-opus-4-7）で分析し、（登録済みなら）ペルソナ・既存除外設定・キャンペーン構成に照らして「**除外すべき検索語句**」を構造化して **毎朝のメール**として配信する。Brief 未登録でも **Google Ads 連携済みであれば送信する**。
- 既存「コンテンツ戦略提案」が **ブログ記事の TOP5 提案（手動実行）** で成果を伸ばす機能であるのに対し、本機能は **広告運用の無駄打ちを減らす日次オペレーション**（自動配信）として独立させる。
- **本機能のゴール**は「提案メールが毎朝届く」まで。Google Ads への自動除外登録は **本設計書のスコープ外**（実際の除外登録はクライアントが Google Ads 管理画面で手動実行する想定）。

### 1.1 クライアント要望（一次情報）

Lark MTG (`objplfi8m89t5a22x2dvgd5c`) より:

- 「2 種類できる。一つはオートメーション化、もう一つはメールで一度チェック。今は不安なのでメールで一度チェックしたい」 — 自動裏除外ではなく **人間のレビューを残す方針** を希望。
- 「キャンペーンで除外するパターン」と「広告グループで除外するパターン」の **2 階層** で提案してほしい。例: 「家具買取」全体でアルバイト・アレルギー・アンケート等は共通除外、「古銭買取」広告グループでは「ミントセット買取」「刀剣買取」等の意味隣接語を除外。
- 戦略シート（ペルソナ・商品意図）を読み込ませ、ペルソナ不適合のキーワードを除外候補として提案してほしい。
  → **初期実装のトレードオフ**: Brief は送信の**必須条件にしない**。登録済みの場合のみ Brief 直下の `persona` をプロンプトに渡す。`services[]` の商品意図は渡さず、キャンペーン名・広告グループ名・検索語句実績から AI が判断する。
- カテゴリは **企業系（競合名）／ノウハウ系（〇〇とは・方法）／一般フレーズ（その他）** で分けたい。
- 「提案までは確実に欲しい。返信での実除外までは将来検討」。

client-vision-from-lark.md (`docs/context/client-vision-from-lark.md`) より:

- 「**事前許可なく挙動を変えない**」「**開発前に UI のたたき台を共有し合意してから実装**」 — 自動配信開始は **明示 opt-in** とし、UI モックは実装着手前に共有合意する。
- 「**実装上の制約やトレードオフは事前共有が必須**」 — 配信時刻の粒度（時間単位）は毎時 cron 仕様の制約として明記し、ユーザー（カオルさん）に事前共有する。

## 2. スコープ

### 2.1 機能スコープ

- **対象ユーザー（cron 自動配信）**: 以下 **全て** を満たすユーザー。
  1. `public.users.email IS NOT NULL`（メール登録済）
  2. `google_ads_credentials` あり（Google Ads 連携済）
  3. `google_ads_negative_keywords_settings.enabled = true`（明示 opt-in）
- **Brief（事業者情報）**: **必須ではない**。未登録・`persona` 空でもメール送信する（プロンプトには `（ペルソナ未設定）` を渡す）。品質向上のための任意入力とする。
- **手動テスト送信**: 上記 1・2 のみ必須（`enabled=false` でも可）。Brief は不要。
- **取得範囲**: 連携済みの Google Ads アカウント 1 件を対象に、前日の検索語句データを **アカウント一式でまとめて取得**する。キャンペーン・広告グループを UI で個別選択したり、広告グループごとに手動取得したりしない。取得データにはキャンペーン名・広告グループ名を含め、AI が分類判断に利用する。
- **出力粒度**: 取得は一括で行うが、提案結果は **キャンペーン共通で除外すべき候補** と **広告グループ単位で除外すべき候補** の 2 階層で出力する。広告グループ単位の除外リストはメール本文に明示する。
- **対象期間**: 前日 1 日（JST 基準）固定。将来 7 日/30 日に拡張可能な internal option として `dateRangeDays` を保持。
- **配信タイミング**: ユーザーごとに `send_hour_jst` (0–23, JST) で設定。毎時 cron（GH Actions `hourly-cron.yml`）が毎時 0 分に起動 → 該当時刻 + 当日未送信のユーザーのみ実行。
- **送信先**: `public.users.email`（既存「コンテンツ戦略提案」と同一）。
- **メール本文**: AI 出力には末尾の **構造化 JSON ブロック**（将来「ダッシュボード上ワンクリック除外」用）を要求するが、**メール送信前に `extractStructuredOutput()` で本文から除去する**。送信されるのは Markdown 部分のみを HTML 化したもの。本フェーズではパース可否のログのみ取得し、DB 保存は行わない。
- **手動実行**: ダッシュボードに「今すぐテスト送信」ボタンを設置。cron と同じサービスを呼ぶ。

### 2.2 非スコープ（将来検討）

- **メール返信での自動除外登録**（Resend Inbound → Webhook → Google Ads API mutate）— クライアント判断で本設計書のスコープ外。実装が必要になった場合は別設計書で起こす
- **提案 JSON の DB 保存 + ダッシュボード「除外登録履歴」UI** — 上記と同じく非スコープ
- 期間プリセット（7日 / 30日）の UI 公開
- カテゴリ・緊急度の集計サマリーグラフ
- 連続失敗による自動 OFF（運用ログ監視で対応）
- 配信曜日カスタム（平日のみ等）
- 複数アカウント運用（1 ユーザー 1 アカウント前提）

## 3. 画面設計

### 3.1 ダッシュボードのタブ化

`app/google-ads-dashboard/_components/dashboard-content.tsx` を **タブ構成**にリファクタする。既存の数値表示コンテンツは「数値指標」タブに包み、メール送信系の操作は「メール送信設定」タブへ集約する。

```
+---------------------------------------------------------------+
| 📊 Google Ads パフォーマンス                                  |
|                                                               |
| [ 数値指標 ] [ メール送信設定 ]   <- @/components/ui/tabs    |
+---------------------------------------------------------------+
| 数値指標 タブ（既存維持）:                                    |
|   MetricsCards                                                |
|   CampaignsTable                                              |
|   上位キーワード                                              |
+---------------------------------------------------------------+
| メール送信設定 タブ（新規）:                                  |
|   ┌─ Google Ads コンテンツ戦略提案 ───────────────────────┐  |
|   │  キーワード指標をもとに、コンテンツ戦略の改善提案を       │  |
|   │  メールで送信します。                                    │  |
|   │  [ Select: 分析対象サービス ] ※既存 UI                   │  |
|   │  [ Input: AI分析期間（日数） ]                            │  |
|   │  [ Button: コンテンツ戦略提案を送信 ]                     │  |
|   └──────────────────────────────────────────────────────────┘ |
|                                                                |
|   ┌─ Google Ads 除外キーワード提案 ─────────────────┐  |
|   │  毎朝、前日の検索クエリから「除外候補」を 3 カテゴリ      │  |
|   │  ×2 レベル ×3 緊急度で整理し、登録メール宛に送信します。 │  |
|   │                                                          │  |
|   │  設定項目:                                                │  |
|   │  [ Switch: 自動配信を有効化 (default OFF) ]              │  |
|   │  [ Select: 配信時刻 (0時〜23時 JST) ] 現在: 07:00        │  |
|   │                                                          │  |
|   │  送信状況:                                                │  |
|   │  最終送信日: 2026-05-19                                  │  |
|   │  最終エラー: なし                                        │  |
|   │                                                          │  |
|   │  [ Button: 今すぐテスト送信 ]                            │  |
|   │  ※ 設定 OFF でも本ボタンから 1 通だけ即時送信できます    │  |
|   └──────────────────────────────────────────────────────────┘ |
|                                                                |
|   ┌─ 停止／再開について ─────────────────────────────────┐  |
|   │  Switch を OFF にすると翌日以降の自動配信を停止します。   │  |
|   │  途中で挙動が変わる場合は最終送信日の翌日まで反映が遅延   │  |
|   │  する可能性があります。                                  │  |
|   └──────────────────────────────────────────────────────────┘ |
+---------------------------------------------------------------+
```

- タブ実装: `@/components/ui/tabs`（Radix Tabs / shadcn）。
- URL 同期: `?tab=metrics|settings`（`useSearchParams` + `router.replace`、`scroll: false`）。デフォルト `metrics`。ディープリンク `/google-ads-dashboard?tab=settings` を許容。
- タブ切替で各タブ内のフォーム入力状態は **保持しない**（再 mount でリセット）。Switch 即時 Server Action 中にタブ切替で unmount されるリスクは `useTransition` の `isPending` でタブ切替自体を抑制または disabled 表示する（実害が大きい場合は両タブ `forceMount` 検討）。
- 既存「コンテンツ戦略提案」`EvaluationControls` は **メール送信設定タブ**へ移動し、`Google Ads コンテンツ戦略提案` カードとして表示する。数値指標タブには広告パフォーマンス表示のみを残す。

### 3.2 メール送信設定タブ UI

新規コンポーネント `app/google-ads-dashboard/_components/negative-keywords-suggestion-settings.tsx`（client component）。

メール送信設定タブでは、以下の 2 カードを縦に並べる。

1. **Google Ads コンテンツ戦略提案**
   - 既存 `EvaluationControls` を移動して利用する。
   - 既存 UI のまま、分析対象サービス、AI分析期間（日数）、送信ボタン、最終成功実行日、未登録時の警告を表示する。
   - 既存 Server Action / 設定保存ロジックは変更しない。
2. **Google Ads 除外キーワード提案**
   - 本機能の新規設定 UI。
   - 設定項目は **自動配信 ON/OFF、配信時刻** の 2 つ。
   - Google Ads データは連携済み広告アカウント一式からまとめて取得する。広告グループ単位の選択 UI は初期実装では設けない。
   - UI で広告グループを選択しなくても、取得データに `campaignName` / `adGroupName` を含めるため、メール本文では `campaign` / `ad_group` の 2 階層で除外候補を分類して出力する。
   - 最終送信日、最終エラー、今すぐテスト送信、分類・メール本文プレビュー、停止／再開説明は設定項目ではなく、確認・操作・説明要素として分離して表示する。

構成要素:

| 要素 | 実装 | 備考 |
|------|------|------|
| 配信 ON/OFF | `@/components/ui/switch` | `enabled` を更新。Switch トグルで即 Server Action 呼び出し。 |
| 配信時刻 | `@/components/ui/select` (0〜23時) | `send_hour_jst` を更新。Select 確定で即 Server Action 呼び出し。 |
| 最終送信日 | テキスト表示 | `last_sent_on` が null の場合「未送信」と表示。 |
| 最終エラー | テキスト表示（赤） | `last_send_error` が null/空の場合は非表示。 |
| 今すぐテスト送信 | `@/components/ui/button` | `runNegativeKeywordsSuggestionNow` を呼ぶ。`useTransition` でローディング。完了後は最終送信日を refetch。**`last_sent_on` は更新しない**（本番 cron をスキップさせないため） |
| 説明文 | 静的 | client-vision §1.6 を踏まえ、停止/再開の挙動・遅延を明示。 |

- **初回 upsert タイミング**: 設定タブ初表示時はテーブルに行が無い場合がある。`getNegativeKeywordsSuggestionSettings()` は未存在時にデフォルト値を返すのみで row を作らず、最初の Switch / 配信時刻変更で **Service Role 経由の `upsert`** により row を作成する。
- 未登録条件（Google Ads 未連携 / メール未登録）のいずれかが満たされない場合、Switch を **disabled** にし、各 CTA リンクを `<LinkedMessage>` 風に表示する。エラーメッセージは `src/domain/errors/error-messages.ts` の `GOOGLE_ADS_NEGATIVE_KEYWORDS` セクションに集約。

### 3.3 設定 UI の状態遷移

```
[初期 mount]
  └─ getNegativeKeywordsSuggestionSettings()
     → { enabled, sendHourJst, lastSentOn, lastSendError }
[Switch トグル]
  └─ updateNegativeKeywordsSuggestionSettings({ enabled })
     └─ 楽観更新 + 失敗時は元に戻す + toast でエラー表示
[配信時刻変更]
  └─ updateNegativeKeywordsSuggestionSettings({ sendHourJst })
     └─ 楽観更新 + 失敗時は元に戻す
[今すぐテスト送信]
  └─ runNegativeKeywordsSuggestionNow()
     ├─ 成功: toast(送信完了) ※ last_sent_on は更新しない
     └─ 失敗: toast(エラー詳細)
```

## 4. AI 分析ロジック

### 4.1 モデル設定

- `src/lib/constants.ts` の `MODEL_CONFIGS` に追加:
  ```ts
  google_ads_negative_keywords_suggestion: {
    ...ANTHROPIC_BASE,            // provider: 'anthropic', actualModel: 'claude-opus-4-7'
    maxTokens: 8000,
    label: 'Google Ads 除外キーワード提案',
  }
  ```
- maxTokens を 8000 にする根拠: 出力はリスト中心で本文密度が低い見込み。検証で不足なら段階的に増やす（既存 `google_ads_ai_evaluation` は 12000）。

#### コスト試算（概算）

Anthropic Claude Opus 4.7 の公開単価（2026 年時点想定: 入力 \$15 / 100 万 tok、出力 \$75 / 100 万 tok）に基づく **1 ユーザー 1 日 1 通の概算**:

| 項目 | トークン数（想定） | 単価 | 金額 |
|------|--------------------|------|------|
| 入力（プロンプト本文 + persona + searchTermData 等） | 約 5,000 tok | \$15 / 1M | 約 \$0.075 |
| 出力（Markdown + JSON） | 約 8,000 tok | \$75 / 1M | 約 \$0.60 |
| **合計（1 通あたり）** | — | — | **約 \$0.68 / 通** |
| **月 30 通 / ユーザー** | — | — | **約 \$20 / ユーザー / 月** |

- 50 ユーザー規模で月 **\$1,000** が固定費として発生。失敗リトライがあれば二重課金。
- LLM コスト圧縮の選択肢:
  - **Sonnet 4.6 検証**: Opus の約 1/5 価格。除外キーワード提案は分類タスク中心で Sonnet で品質が出る可能性が高い。
  - 入力削減: `searchTermData` を impressions 上位 500 件にトリム、`existingNegativeKeywords` をカテゴリ別に集約。
  - **データ整形スキルの適用**: LLM に渡す構造化データは `formatting-llm-context` の方針で、flat table は CSV、階層・半構造データは TOON、機械処理前提の出力は JSON のまま扱い、入力トークンを抑えつつ campaign / ad_group / matchType などの意味を保持する。
- **モデル選択は本フェーズ Step 4 検証で Opus / Sonnet 両方の実出力を比較し、クライアントに品質差を提示してから本番モデルを確定する**。コスト見積もりは Opus 想定で保持（上振れ防止）。

### 4.2 プロンプト変数

| 変数名 | ソース | 内容 |
|--------|--------|------|
| `persona` | `BriefService.getVariablesByUserId()` → **Brief 直下の `persona`**（Brief 未登録・取得失敗時はスキップ） | 任意の補助文脈。値が無い場合は `（ペルソナ未設定）`。送信可否には影響しない |
| `customerName` | `GoogleAdsService.getCustomerInfo()` | アカウント名（失敗時は空文字） |
| `dateRange` | 前日 1 日（JST 基準） | 例: `2026-05-19 〜 2026-05-19` |
| `searchTermData` | **拡張版** `GoogleAdsService.getSearchTermMetrics({ startDate=前日, endDate=前日 })` | **キャンペーン名・広告グループ名・cost・conversionValue を含む** LLM 入力用の構造化テキスト（§7 参照）。impressions DESC、最大 1000 件。flat table のため CSV 形式を基本とし、行数・列順を固定する |
| `existingNegativeKeywords` | `GoogleAdsService.getNegativeKeywords()` | 既存除外（重複登録回避用）。単純一覧なら bullet / CSV、campaign / ad_group / matchType など階層情報がある場合は TOON 形式で渡す |

> **注**: 旧設計では `campaignsInfo` をキャンペーン・広告グループ構成として別変数で渡す案だったが、**`searchTermData` 自体にキャンペーン名と広告グループ名を含める方が AI の判断精度が高い**（実検索クエリがどの広告グループに発生したかが直接見える）。`campaignsInfo` 変数は削除する。

### 4.3 プロンプトテンプレート骨子

`prompt_templates.name = 'google_ads_negative_keywords_suggestion'` に upsert。admin/prompts カテゴリ「Google Ads分析」配下。

初期テンプレート本文（マイグレーションで投入、admin/prompts で運用者編集可能）:

```text
あなたはリスティング広告（Google Ads）の運用最適化の専門コンサルタントです。
以下のインプットを元に「除外キーワード提案レポート」を Markdown 形式で作成してください。

## インプット

### アカウント
- アカウント名: {{customerName}}
- 集計期間: {{dateRange}}（前日 1 日）
- 分析範囲: 連携済み Google Ads アカウント全体

### ターゲットペルソナ
{{persona}}

### 既存除外キーワード（重複登録を避けるための文脈）
{{existingNegativeKeywords}}

### 期間内の検索クエリ実績
CSV 形式（列: search_term,campaign_id,campaign_name,ad_group_id,ad_group_name,impressions,clicks,cost_yen,conversions,conversion_value_yen）
{{searchTermData}}

## 分析と分類ルール

1. 提案レベル
   - **campaign**: 全広告グループに共通で除外すべき（明らかにビジネス外、求人、アンケート、無料系 等）
   - **ad_group**: 特定広告グループの意図と合わない意味隣接語（例: 「古銭買取」広告グループに「ミントセット買取」）
2. カテゴリ
   - **company**: 競合企業・他ブランドの指名検索
   - **knowhow**: 「〇〇とは」「方法」「自分で」「DIY」など情報収集意図
   - **general_phrase**: 上記いずれにも当てはまらないその他不要語
3. 緊急度
   - **click_occurred**: クリック発生済み（既に課金が出ている。最優先で除外）
   - **preventive**: インプレッションのみ（予防的除外）
   - **review_needed**: 意図不明・要確認（人間判断推奨）
4. 既存除外と完全一致する語句は提案に含めない。
5. 各提案には根拠となる検索語句と数値（impressions / clicks / cost / conversions）を明記する。

## 出力形式

### 1. レポートサマリー
- 分析クエリ数（ユニーク）
- 前日広告費・クリック数・コンバージョン数の合計
- 🚨 除外候補（クリック発生済み）件数、⚠️ 予防的除外件数、🤔 要検討件数

### 2. 🚨 除外候補（クリック発生済み）
表形式: No. / 検索クエリ / レベル / カテゴリ / 提案マッチタイプ / 除外理由 / クリック / 費用 / CV

### 3. ⚠️ 予防的除外候補
表形式: No. / 検索クエリ / レベル / カテゴリ / 提案マッチタイプ / 除外理由 / 表示回数

### 4. 🤔 要検討
表形式（理由を明記）

### 5. ✅ 主要クエリ TOP5（参考・残留推奨）
表形式

### 6. 📝 運用メモ
- ペルソナと検索クエリの整合
- 商品ページ訴求の改善ヒント
- 季節・トレンド要素のコメント

## 構造化データ出力（最後に必ず出力）

レポート最後に、上記提案を以下の JSON ブロックで出力してください。アプリでの将来連携用です。

```json
[
  {
    "suggestionId": "ABC123",
    "level": "campaign",
    "category": "knowhow",
    "urgency": "click_occurred",
    "keyword": "自分で 掃除",
    "matchType": "PHRASE",
    "reason": "DIY 意図でコンバージョン見込みなし",
    "evidence": { "searchTerm": "エアコン 自分で 掃除 方法", "impressions": 320, "clicks": 18, "cost": 5400, "conversions": 0 },
    "campaignId": "12345678901",
    "campaignName": "エアコン洗浄_一般",
    "adGroupId": null,
    "adGroupName": null
  }
]
```

- **`suggestionId`**: AI が出力するのではなく、サービス層が後付けで採番する（§4.4 参照）。プロンプトには「`suggestionId` フィールドは空文字で出力してよい」と指示し、サービス層で nanoid (URL-safe 大文字英数字 6 文字) を上書きする。将来「ダッシュボード上ワンクリック除外」や「メール返信で自動登録」を実装する際の識別子として使用するためログ出力する。
- **`campaignId` / `adGroupId`**: §7.1 で取得した数値 ID を文字列で。`level=campaign` の場合 `adGroupId=null`。`level=ad_group` の場合は両方必須。本フェーズではメール本文の表示用途のみだが、将来 mutate 実装時に `customers/{cid}/campaigns/{campaignId}` 形式の resource_name 組立に使用できる形で保持する。
- JSON 以外のコードブロックは作らないこと。
- 全提案を含めること（除外候補と予防的除外と要検討の和集合）。
```

### 4.4 出力の後処理

- AI 出力には末尾の ```` ```json ... ``` ```` ブロックを要求する（§4.3 のプロンプト指示）。
- サービス層で **送信前** に正規表現抽出し（既存設計書 §16.10 の `extractStructuredOutput()` パターン）、本文から JSON ブロック部分を **除去** する。
- 抽出した JSON 配列の各要素に対し、サービス層で **`suggestionId` を後付け採番**（nanoid: URL-safe 大文字英数字 6 文字、`A-Z0-9` のみ）。本フェーズではログ出力用途のみだが、将来の自動登録機能のために残しておく。
- 除去後の Markdown を `marked` で HTML 変換 → `sanitizeEmailHtml` でサニタイズ → メール送信。**メール本文に JSON は含めない**。
- 抽出した JSON はパース可否のみログ出力し、本フェーズでは DB 保存をしない（将来「ダッシュボードからのワンクリック除外」や「メール返信での自動除外登録」を実装する際の素材として保持するためログだけ出力する）。
- JSON パース失敗時はメール送信を阻害しない（本文の Markdown だけ送る + warn ログ）。

## 5. データ設計

### 5.1 新規テーブル `google_ads_negative_keywords_settings`

```sql
create table if not exists public.google_ads_negative_keywords_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  enabled boolean not null default false,
  send_hour_jst smallint not null default 7
    check (send_hour_jst between 0 and 23),

  last_sent_on date,                  -- 最終成功送信日（JST 基準、自動配信のみ更新）
  last_send_error text,               -- 直近失敗のエラーメッセージ（成功で nullify）

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  unique(user_id)
);

alter table public.google_ads_negative_keywords_settings enable row level security;
```

### 5.2 RLS ポリシー

```sql
-- SELECT のみ RLS で制御。INSERT/UPDATE は Service Role が担う
drop policy if exists "google_ads_negative_keywords_settings_select" on public.google_ads_negative_keywords_settings;
create policy "google_ads_negative_keywords_settings_select"
  on public.google_ads_negative_keywords_settings for select
  using (user_id::text = any(get_accessible_user_ids((select auth.uid()))));
```

### 5.3 サービスロール使用箇所

| 操作 | ロール | 備考 |
|------|--------|------|
| 設定 SELECT | User Role (RLS) | `get_accessible_user_ids` で絞り込み |
| 設定 INSERT (初回作成) | Service Role | Server Action から `SupabaseService.upsertGoogleAdsNegativeKeywordsSettings` |
| 設定 UPDATE (enabled / send_hour_jst) | Service Role | 同上 |
| `last_sent_on` / `last_send_error` UPDATE | Service Role | cron / 手動実行サービス内 |
| Cron 抽出 SELECT (`listDue...`) | Service Role | RLS バイパスして全ユーザー対象 |

### 5.4 代表クエリ

```sql
-- cron 抽出: 現在 JST 時 = H, 当日 JST 日付 = D
SELECT id, user_id
FROM public.google_ads_negative_keywords_settings
WHERE enabled = true
  AND send_hour_jst = :H
  AND (last_sent_on IS NULL OR last_sent_on < :D);

-- 成功送信時
UPDATE public.google_ads_negative_keywords_settings
SET last_sent_on = :D,
    last_send_error = NULL,
    updated_at = timezone('utc', now())
WHERE id = :settings_id;

-- 失敗時（last_sent_on は更新しない）
UPDATE public.google_ads_negative_keywords_settings
SET last_send_error = :error_message,
    updated_at = timezone('utc', now())
WHERE id = :settings_id;
```

## 6. メール送信基盤

### 6.1 既存基盤の流用

- `src/server/services/emailService.ts` の `EmailService.sendGoogleAdsAnalysis(to, subject, htmlContent)` と同じ Resend クライアントを使う。
- 既存メソッドそのまま再利用すると件名ロギングが両機能で混じるため、薄いラッパーを追加:

```ts
class EmailService {
  // 既存
  async sendGoogleAdsAnalysis(to, subject, htmlContent) { /* ... */ }

  // 新規: 件名・ログタグだけ差し替え、内部実装は共通化
  async sendGoogleAdsNegativeKeywords(to, subject, htmlContent) {
    return this.sendViaResend({
      to, subject, html: htmlContent,
      logTag: 'GoogleAdsNegativeKeywords',
    });
  }
}
```

- 既存メソッドを `sendViaResend` プライベートに集約してから両ラッパーに分岐させる軽リファクタを許容。

### 6.2 件名仕様

- 成功時例:
  - `【GrowMate】Google Ads 除外キーワード提案レポート（2026-05-20 / 買取ジャパン）`
  - アカウント名取得失敗時: `【GrowMate】Google Ads 除外キーワード提案レポート（2026-05-20）`
- 日付は **対象期間の前日 JST**（実行日 JST から1日引いた日付）を使う。

### 6.3 開発環境

- `DEV_SAMPLE_NEGATIVE_KEYWORDS` / `DEV_SAMPLE_SEARCH_TERMS` 等の既存サンプル変数を流用。
- DEV モードでは `MOCK_GOOGLE_ADS_API=true` 相当の分岐でサンプルを使用（既存 `googleAdsAiAnalysisService.ts` と同パターン）。

## 7. Google Ads API 利用

| 用途 | メソッド | 備考 |
|------|----------|------|
| 既存除外取得 | `GoogleAdsService.getNegativeKeywords({ accessToken, customerId, loginCustomerId })` | 既存（変更不要） |
| 検索クエリ実績 | `GoogleAdsService.getSearchTermMetrics({ accessToken, customerId, startDate, endDate, loginCustomerId })` | **GAQL 拡張必須**（後述）。`startDate=endDate=前日(JST)` で呼ぶ |
| アカウント情報 | `GoogleAdsService.getCustomerInfo(...)` | 既存 |
| トークン更新 | `GoogleAdsService.refreshAccessToken(...)` + `GoogleTokenService` | 既存 |

### 7.1 `getSearchTermMetrics` の GAQL 拡張（必須・Step 0）

現行の SELECT 句では `search_term_view.search_term`, `metrics.impressions`, `metrics.clicks`, `metrics.conversions` しか取得していない。本機能の **キャンペーン共通除外 / 広告グループ除外の 2 階層提案** の根拠データとして、以下を追加取得する必要がある。

```sql
SELECT
  search_term_view.search_term,
  campaign.id,
  campaign.name,
  ad_group.id,
  ad_group.name,
  metrics.impressions,
  metrics.clicks,
  metrics.conversions,
  metrics.cost_micros        -- 円換算 (micros / 1_000_000)
FROM search_term_view
WHERE segments.date BETWEEN '...' AND '...'
LIMIT 1000
```

#### 影響範囲

- **型定義 `GoogleAdsSearchTermMetric`** (`src/types/googleAds.types.ts`) に以下を追加:
  ```ts
  export interface GoogleAdsSearchTermMetric {
    searchTerm: string;
    campaignId: string;     // 追加
    campaignName: string;   // 追加
    adGroupId: string;      // 追加
    adGroupName: string;    // 追加
    impressions: number;
    clicks: number;
    conversions: number;
    cost: number;           // 追加（円換算済み）
  }
  ```
- **`GoogleAdsSearchStreamRow`**: 既存型に `searchTermView` / `campaign` / `adGroup` / `metrics` がトップレベルに並列で存在するため、**大規模な再設計は不要**。ただし現状 `adGroup` には `name` / `status` しか定義されておらず `id` が無いため、**`adGroup.id?: string` を optional 追加**する（マッピングで `row.adGroup?.id` を読むため）。それ以外（`campaign.id/name`、`metrics.costMicros`）は既存定義で取得可能。
- **マッピング方針**: `getSearchTermMetrics` 内で `row.campaign?.id/name`, `row.adGroup?.id/name`, `row.metrics?.costMicros` を読み取り、上記 `GoogleAdsSearchTermMetric`（**必須で拡張**）に詰め直す。`searchTermView` の中にこれらをネストさせない。
- **後方互換**: 既存の `googleAdsAiAnalysisService.ts`（コンテンツ戦略提案）も `searchTermData` を渡しているが、新フィールドは追加するだけで既存利用箇所は無視される（破壊的変更なし）。
- **OAuth スコープ**: 上記フィールドはいずれも `https://www.googleapis.com/auth/adwords` で取得可能。スコープ追加不要。

### 7.2 `campaignsInfo` 変数の廃止

旧設計の `campaignsInfo`（キャンペーン名 + 広告グループ名の事前一覧）は **`searchTermData` 自体にキャンペーン名・広告グループ名を含めることで不要化**。前日 IMP/Click が無い広告グループは AI 判断に必要ない（除外候補にならない）ため、サマリ情報としても省略可。

## 8. 新規サービス層

`src/server/services/googleAdsNegativeKeywordsSuggestionService.ts`（新規）

### 8.1 クラス設計

```ts
export class GoogleAdsNegativeKeywordsSuggestionService {
  private readonly supabaseService: SupabaseService;
  private readonly googleAdsService: GoogleAdsService;
  private readonly emailService: EmailService;
  private readonly promptService: PromptService;
  private readonly briefService: BriefService;

  /**
   * 1 ユーザー分の取得→AI→メール送信→記録を実行。手動実行・cron 共通。
   */
  async sendNegativeKeywordsSuggestionForUser(
    userId: string,
    options?: {
      // true: enabled チェックをスキップし、last_sent_on も更新しない（手動テスト送信用）
      force?: boolean;
      // 手動実行時のみ override 可能。cron は常に 1 日固定（前日）
      dateRangeDays?: number;
    }
  ): Promise<SuggestionResult>;

  /**
   * cron 入口。現在 JST 時 + 当日 JST 日付で対象ユーザーを抽出し、Promise.allSettled で並列実行。
   * dateRangeDays は常に 1（前日）固定。
   */
  async runAllDueSuggestions(): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;     // 前日 IMP 0 件等でスキップした件数
  }>;
}
```

### 8.2 処理ステップ（`sendNegativeKeywordsSuggestionForUser`）

1. **対象ユーザー検証**: メールアドレス、Google Ads credential を確認（**Brief 登録の有無は見ない**）。`force=false`（cron 経路）の場合のみ `enabled=true` を必須にする。`force=true`（手動テスト）の場合は `enabled` チェックをスキップ。
2. **取得範囲の決定**: 初期実装では、連携済み Google Ads アカウント 1 件を対象にアカウント一式で検索語句データを取得する。キャンペーン・広告グループの選択 UI や個別取得処理は設けない。取得データ内の `campaignName` / `adGroupName` を AI 判断材料として使う。
3. **対象日付の決定（JST）**:
   ```ts
   // 既存 `formatJstDateISO()` を内部利用する JST 専用ユーティリティを新設
   const today = getJstTodayDateISO();      // YYYY-MM-DD（JST 今日）
   const yesterday = getJstYesterdayDateISO(); // YYYY-MM-DD（JST 前日）
   // cron は常に startDate=endDate=yesterday、手動 dateRangeDays 指定時のみ override
   // 注: Date 抽象に `addDays` 等は使わず JST 完結 API のみを用いることでテスト容易性とタイムゾーン事故防止を担保
   ```
4. **アクセストークン更新**: `ensureAccessToken(credential)`（5 分閾値で自動 refresh、既存 `googleAdsAiAnalysisService` パターン）。
5. **データ取得（並列）**:
   - `getSearchTermMetrics({ startDate=yesterday, endDate=yesterday })` ※ §7.1 の拡張版
   - `getNegativeKeywords()`
   - `briefService.getVariablesByUserId(userId)` を試行し、成功時のみ **Brief 直下の `persona`** を抽出。Brief 未登録・取得失敗・`persona` 空は `（ペルソナ未設定）` とし、**処理は継続**（致命エラーにしない）
   - `getCustomerInfo()`（失敗は致命にしない）
6. **空データチェック**: 取得した `searchTermData` の `impressions` 合計が 0 件なら、**メール送信をスキップ + `last_sent_on` を当日(JST)で更新**（次日まで沈黙）。`last_send_error` は NULL。「前日 IMP 0 件のためスキップ」と info ログ。
7. **データ整形**: `formatting-llm-context` の方針を適用し、`formatSearchTermMetrics` / `formatNegativeKeywords` で AI 入力テキストを生成する。
   - `searchTermData`: flat table のため **CSV 形式**を基本とする。列順は `search_term,campaign_id,campaign_name,ad_group_id,ad_group_name,impressions,clicks,cost_yen,conversions,conversion_value_yen` で固定し、値にカンマ・改行・引用符が含まれる場合は RFC 4180 相当でエスケープする。Markdown table はトークン効率が悪いため LLM 入力には使わない。
   - `existingNegativeKeywords`: 単純な keyword 一覧なら bullet または CSV。campaign / ad_group / matchType など階層・半構造データを持つ場合は **TOON 形式**で渡し、行数・フィールド名を明示する。
   - AI 出力末尾の構造化データは後続の JSON パースが必要なため、TOON へ変換せず **JSON のまま**維持する。
8. **プロンプト取得**: `PromptService.getTemplateByName('google_ads_negative_keywords_suggestion')` → `replaceVariables`。
9. **AI 実行**: `llmChat('anthropic', 'claude-opus-4-7', messages, MODEL_CONFIGS.google_ads_negative_keywords_suggestion)`。
10. **JSON 抽出**: `extractStructuredOutput(rawOutput)` → `{ markdown, suggestions }`。失敗時は `suggestions=[]` で続行、warn ログ。
11. **HTML 化**: `await marked.parse(markdown)` → `sanitizeEmailHtml`。
12. **メール送信**: `emailService.sendGoogleAdsNegativeKeywords(userEmail, subject, html)`。
13. **記録更新**（`force=false` の cron 経路のみ）:
    - 成功: `last_sent_on = 当日(JST)` + `last_send_error = NULL`
    - 失敗: `last_send_error = メッセージ`, `last_sent_on` 更新しない
    - **`force=true`（手動テスト）の場合は `last_sent_on` を更新しない**（本番 cron のスキップを防ぐ）。エラー時の `last_send_error` 更新も任意（ユーザーに toast でエラーが返るため運用上不要、ノイズ防止で更新しないことを推奨）。

### 8.3 `runAllDueSuggestions` 処理

```text
1. nowJst = currentJst()
2. hourJst = nowJst.hour
3. todayJst = nowJst.dateISO
4. dueUsers = SupabaseService.listDueNegativeKeywordsSuggestionUsers(hourJst, todayJst)
5. for chunk of chunk(dueUsers, 3):
     await Promise.allSettled(chunk.map(u => sendNegativeKeywordsSuggestionForUser(u.userId)))
6. return aggregate counts
```

- 同時並列度 `N=3` は初期値。実測でレートリミットや関数並列度の問題が出れば調整。
- 1 ユーザーの実処理時間目安: 30〜60 秒（Opus 4.7 / maxTokens 8000）。Vercel `maxDuration=300` を超えそうな場合は dueUsers を batch 化 + 続きを次の cron 起動に持ち越す（次フェーズ）。

### 8.4 DEV モード分岐

`process.env.NODE_ENV === 'development'` かつ `process.env.MOCK_GOOGLE_ADS_API === 'true'` のとき:
- Google Ads API 呼び出しを `DEV_SAMPLE_SEARCH_TERMS` / `DEV_SAMPLE_NEGATIVE_KEYWORDS` で代替。
- Resend 送信は本番 API キーが設定されていればそのまま送る（開発者の自分宛に届く）。

## 9. Server Actions

`src/server/actions/googleAdsNegativeKeywordsSuggestion.actions.ts`（新規）

```ts
'use server';

export async function getNegativeKeywordsSuggestionSettings(): Promise<{
  success: boolean;
  data?: {
    enabled: boolean;
    sendHourJst: number;
    lastSentOn: string | null;
    lastSendError: string | null;
  };
  error?: string;
}>;

export async function updateNegativeKeywordsSuggestionSettings(
  input: { enabled?: boolean; sendHourJst?: number }
): Promise<{ success: boolean; error?: string }>;

export async function runNegativeKeywordsSuggestionNow(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}>;
```

- 全 Action で `authMiddleware()` を使い `userDetails` を取得。
- `update*` の Zod スキーマ: `src/server/schemas/googleAdsNegativeKeywordsSuggestion.schema.ts` に定義。
  - `enabled: z.boolean().optional()`
  - `sendHourJst: z.number().int().min(0).max(23).optional()`
- `runNegativeKeywordsSuggestionNow` は `force: true` でサービスを呼び、`enabled=false` でも 1 通送る。`last_sent_on` は更新しない（§8.2 ステップ 13）。

## 10. Cron Route

`app/api/cron/google-ads-negative-keywords-suggestion/route.ts`（新規）

```ts
import { NextRequest, NextResponse } from 'next/server';
import { googleAdsNegativeKeywordsSuggestionService } from '@/server/services/googleAdsNegativeKeywordsSuggestionService';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ success: false, error: 'Cron secret not configured' }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await googleAdsNegativeKeywordsSuggestionService.runAllDueSuggestions();
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'バッチ処理に失敗しました';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
```

### 10.1 Cron 実行基盤（運用）

毎時 cron は **GitHub Actions の `.github/workflows/hourly-cron.yml` に一本化**する。各エンドポイントは **単一の実行基盤のみ**から呼ぶこと（Vercel Cron と GH Actions の二重発火はメール重複の原因になる）。新規の毎時 cron を追加する場合は `hourly-cron.yml` の `matrix.include` に `{ id, path, profile }` を 1 件追加し、必要なら `scripts/invoke-cron.sh` の validation profile を拡張する。

| エンドポイント | 実行基盤 | profile | 備考 |
|----------------|----------|---------|------|
| `/api/cron/gsc-evaluate` | **GH Actions（hourly-cron.yml）** | `gsc-batch` | `stoppedReason / errors / totalSystemError` を FAIL 判定、`totalImportFailed / usersSkippedDueToLimit` を WARN 通知 |
| `/api/cron/google-ads-negative-keywords-suggestion`（**本機能**） | **GH Actions（hourly-cron.yml）** | `count-batch` | `success / data.failed` を FAIL 判定、`data.skipped` を WARN 通知 |
| `/api/cron/google-ads-evaluate` | Vercel Dashboard（既存・本機能の範囲外） | — | 必要時に hourly-cron.yml への移行を検討 |
| `/api/cron/ga4-sync` | Vercel Dashboard（既存・本機能の範囲外） | — | 必要時に hourly-cron.yml への移行を検討 |

`vercel.json` は追加しない。

#### 共通仕様（`scripts/invoke-cron.sh`）

- リトライ: `curl exit 28 / HTTP 503 / 504` で指数バックオフ最大 3 回
- HTTP 2xx ＋ JSON 妥当性（`jq -e`）を共通でチェック
- 二重起動防止: `concurrency: hourly-cron-${{ matrix.id }}` で job 単位ロック
- 認証: `Authorization: Bearer $CRON_SECRET`

#### PR マージ前チェックリスト

1. Vercel Dashboard の Cron 一覧を確認する
2. `/api/cron/gsc-evaluate` が **登録されていない** こと（GH Actions に移行済み）
3. `/api/cron/google-ads-negative-keywords-suggestion` が **登録されていない** こと（GH Actions に統一）
4. GH リポジトリ Secrets に `CRON_SECRET` / `NEXT_PUBLIC_SITE_URL` が設定されていること


## 11. ファイル変更一覧

### 新規ファイル

| ファイル | 役割 |
|---------|------|
| `supabase/migrations/YYYYMMDD_create_google_ads_negative_keywords_settings.sql` | テーブル + RLS + プロンプト upsert |
| `src/types/google-ads-negative-keywords.ts` | 設定型 / Suggestion JSON 型 / Result 型 |
| `src/server/schemas/googleAdsNegativeKeywordsSuggestion.schema.ts` | Zod スキーマ |
| `src/server/services/googleAdsNegativeKeywordsSuggestionService.ts` | コアサービス |
| `src/server/actions/googleAdsNegativeKeywordsSuggestion.actions.ts` | Server Actions |
| `app/api/cron/google-ads-negative-keywords-suggestion/route.ts` | Cron route |
| `app/google-ads-dashboard/_components/negative-keywords-suggestion-settings.tsx` | 設定タブ UI |

### 既存ファイル修正

| ファイル | 変更内容 |
|---------|---------|
| `app/google-ads-dashboard/page.tsx` | 設定を取得し props 注入 |
| `app/google-ads-dashboard/_components/dashboard-content.tsx` | Radix Tabs ラップ + `?tab=` 同期 |
| `src/server/services/googleAdsService.ts` | **§7.1 GAQL 拡張**: `getSearchTermMetrics` の SELECT に `campaign.id/name`, `ad_group.id/name`, `metrics.cost_micros` 追加。後方互換 |
| `src/types/googleAds.types.ts` | **§7.1 型拡張**: `GoogleAdsSearchTermMetric` に `campaignId/Name`, `adGroupId/Name`, `cost` を **必須で追加**。`GoogleAdsSearchStreamRow` は大規模再設計不要で **`adGroup.id?: string` を optional 追加**するのみ（その他フィールドは既存定義で取得可能） |
| `src/server/services/supabaseService.ts` | `getGoogleAdsNegativeKeywordsSettings(userId)` / `upsertGoogleAdsNegativeKeywordsSettings(userId, ...)` / `updateGoogleAdsNegativeKeywordsSettings(...)` / `listDueNegativeKeywordsSuggestionUsers(hourJst, todayJst)` 追加 |
| `src/server/services/emailService.ts` | `sendGoogleAdsNegativeKeywords` 追加（内部実装は既存と共通化） |
| `src/lib/constants.ts` | `MODEL_CONFIGS.google_ads_negative_keywords_suggestion` 追加 |
| `src/lib/prompt-descriptions.ts` | `PROMPT_DESCRIPTIONS.google_ads_negative_keywords_suggestion` + 変数説明追加 |
| `src/domain/errors/error-messages.ts` | `GOOGLE_ADS_NEGATIVE_KEYWORDS` セクション追加 |
| `src/types/database.types.ts` | `supabase gen types` 再生成 |

## 12. プロンプトテンプレートの DB 登録

```sql
insert into public.prompt_templates (name, display_name, content, variables)
values (
  'google_ads_negative_keywords_suggestion',
  'Google Ads 除外キーワード提案',
  E'（§4.3 の本文をエスケープして挿入）',
  '[
    {"name": "persona", "description": "ターゲットペルソナ"},
    {"name": "customerName", "description": "Google Ads アカウント名"},
    {"name": "dateRange", "description": "集計期間（前日 1 日）"},
    {"name": "searchTermData", "description": "前日の検索クエリ実績"},
    {"name": "existingNegativeKeywords", "description": "既存除外キーワード"}
  ]'::jsonb
)
on conflict (name) do update
  set display_name = excluded.display_name,
      variables = excluded.variables;
-- content は本番運用後 admin/prompts で編集する想定のため、conflict 時は上書きしない
```

> **重要**: **初回マイグレーションでは §4.3 のプロンプト本文を必ず全文投入すること**。content が空のままデプロイされると本番 cron 起動時に「テンプレート未設定」で全ユーザー失敗する。マイグレーション PR レビュー時に必ず本文の妥当性を確認する。

`admin/prompts` 画面のカテゴリ「Google Ads分析」フィルタ（既存）は `template.name.startsWith('google_ads_')` のため、追加対応不要。

## 13. エラーハンドリング方針

| 結果 | `last_sent_on` | `last_send_error` | 次回挙動 |
|------|----------------|-------------------|----------|
| 成功（cron, メール送信まで完了） | 当日(JST) | NULL クリア | 翌日同時刻まで再送信なし |
| 前日 IMP 0 件でスキップ（cron） | 当日(JST) | NULL クリア | 翌日同時刻まで再送信なし。空メールでユーザーを煩わせない |
| Google Ads API 失敗（cron） | 更新しない | エラーメッセージ記録 | 翌日同時刻に再試行 |
| LLM API 失敗（cron） | 更新しない | エラーメッセージ記録 | 翌日同時刻に再試行 |
| メール送信失敗（cron） | 更新しない | エラーメッセージ記録 | 翌日同時刻に再試行 |
| 設定 OFF / 対象外（cron 抽出対象外） | 更新しない | NULL のまま | 何もしない |
| **手動テスト送信（成功 / 失敗いずれも）** | **更新しない** | **更新しない**（toast で即時返却） | 本日の cron 配信を消費しない |
| **手動テスト × 前日 IMP 0 件** | **更新しない** | **更新しない** | UI に「前日 IMP 0 件のためサンプルメールが送れません」と toast で表示。テスト送信は cron と同じく送信スキップ |

- 1 ユーザー失敗で他ユーザーをブロックしない（`Promise.allSettled`）。
- 連続失敗ユーザーの自動 OFF は本フェーズ未実装。運用ログ（Vercel Logs）で監視。
- 手動「今すぐテスト送信」は `last_sent_on` を更新しないため、当日中に何度でも実行可能。本番 cron も通常通り該当時刻に動く。

## 14. 実装順序

| Step | 内容 | 依存 |
|------|------|------|
| 0 | DDL + 型拡張（`GoogleAdsSearchTermMetric` に campaign/ad_group/cost 追加）+ **`getSearchTermMetrics` GAQL 拡張** + Zod + MODEL_CONFIGS + PROMPT_DESCRIPTIONS + エラーメッセージ | なし |
| 1 | `SupabaseService` 拡張 + `EmailService` ラッパー + `googleAdsNegativeKeywordsSuggestionService` 本体（日付ユーティリティ、アカウント一式取得、空データスキップ含む） | Step 0 |
| 2 | Server Actions + Cron Route + GH Actions `hourly-cron.yml` 追加 | Step 1 |
| 3 | `dashboard-content.tsx` タブ化 + 設定 UI（自動配信 ON/OFF、配信時刻のみ） | Step 2 |
| 4 | DEV サンプル検証 + JST 境界テスト + 空データスキップ + 重複送信抑止 + **Opus / Sonnet モデル比較**（クライアント合意用）+ lint/build | Step 3 |

## 15. テスト観点

- **手動 cron トリガー**: `curl -H 'Authorization: Bearer $CRON_SECRET' http://localhost:3000/api/cron/google-ads-negative-keywords-suggestion` で DEV サンプルが届く。
- **DEV サンプルデータ拡張**: `DEV_SAMPLE_SEARCH_TERMS` を **§7.1 拡張後の型**（`campaignId`, `campaignName`, `adGroupId`, `adGroupName`, `cost` 含む）で更新する。既存「コンテンツ戦略提案」の `DEV_SAMPLE_SEARCH_TERMS` 利用箇所も同型に追従する（後方互換確認）。
- **GAQL 拡張**: `getSearchTermMetrics` の戻り値に `campaignId`, `campaignName`, `adGroupId`, `adGroupName`, `cost` が含まれる。既存「コンテンツ戦略提案」も引き続き正常動作する（後方互換確認）。
- **LLM 入力データ整形**: `formatSearchTermMetrics` は §8.2 の固定列順 CSV を出力し、カンマ・改行・引用符を含む検索語句 / キャンペーン名 / 広告グループ名を正しくエスケープする。`formatNegativeKeywords` は階層情報の有無に応じて bullet / CSV / TOON を選択し、AI 出力 JSON は変換しない。既存の `conversionValue` は `conversion_value_yen` として保持する。
- **JST 境界**: UTC 22:00 起動 = JST 翌日 7:00 として正しく `send_hour_jst=7` ユーザーに送信されるか。
- **前日日付計算**: `getJstYesterdayDateISO()` が日跨ぎ前後で正しい日付を返す。
- **設定 OFF 非送信**: `enabled=false` ユーザーは抽出されない。
- **同日重複防止**: 同 JST 日付内に `last_sent_on` 更新済みなら再抽出されない。
- **空データスキップ**: 前日 IMP 0 件のユーザーはメール送信されず、`last_sent_on` だけ更新される。
- **配信時刻変更の即時反映**: 設定変更後、次の cron 起動から新しい時刻が適用される。
- **手動テスト送信**: `enabled=false` でも 1 通送れる。**`last_sent_on` は更新されない**（本番 cron が翌日同時刻に動く）。
- **アカウント一式取得**: 広告グループが複数あっても UI で個別選択せず、連携済みアカウント全体の検索語句データを取得できる。
- **Brief 未登録でも送信**: Google Ads 連携 + メール登録済みで、Brief / `persona` なしでも 1 通送れる（プロンプトは `（ペルソナ未設定）`）。
- **タブ切替**: `?tab=settings` ディープリンク、ブラウザ戻る/進むで URL 同期。
- **エラー記録**: Google Ads 401 / Resend 400 などのケースで `last_send_error` が記録される（cron 経路のみ）。
- **モデル比較（Step 4）**: 同じ入力で Opus 4.7 と Sonnet 4.6 の出力を 5 ユーザー分比較し、品質・コスト・速度を表に整理してクライアントレビュー用 PDF を作成。
- `npm run lint` / `npm run build` 通過。

## 16. リスクと注意点

- **vercel.json と Dashboard 二重登録**: 既存 cron が Dashboard 経由の場合、`vercel.json` を新規作成すると Dashboard 側を解除しないと cron が重複する可能性。実装時に Vercel プロジェクト管理者に確認。
- **Resend 配信制限**: 同時並列 N=3 で 1 ユーザーあたり 30〜60s。配信時刻が集中する時間帯（7時など）はユーザー増加に伴い `maxDuration=300` を超える可能性。次フェーズで「次の cron 起動に持ち越す」設計に拡張可能。
- **JSON 抽出失敗**: AI が JSON フォーマットを守らない可能性あり。本フェーズではメール送信を阻害しないが、本番投入後 1〜2 週は失敗率をログで観測。
- **`forceMount` の検討**: タブ切替で設定タブの編集中状態がリセットされる。実害が出る場合は両タブ `forceMount` で再 mount を防ぐ（Step 3 で判断）。
- **既存「コンテンツ戦略提案」のユーザー混乱**: 同じダッシュボードに 2 つのメール機能（戦略提案ボタン + 除外提案配信設定）が並ぶため、説明文で違いを明確にする（戦略提案 = 手動オンデマンド、除外提案 = 日次自動）。

## 17. 将来拡張（本設計書対象外）

クライアント要望が出た時点で別設計書で起こす:

- **メール返信での自動除外登録**: Resend Inbound API + Webhook + Google Ads API mutate。クライアント現状運用（Lark MTG）と一致させる。本機能が安定運用に乗ったあとに検討。
- **ダッシュボード上のワンクリック除外**: 提案 JSON を `google_ads_negative_keyword_suggestions` テーブルに保存し、ダッシュボードでチェックボックス UI から Google Ads API mutate を実行（メール返信フローの代替 UI）。
- **除外登録履歴**: `google_ads_negative_keyword_executions` テーブルで実行ログ保持、ダッシュボードに表示 + 取り消し機能。
- **期間プリセット拡張**: 前日固定 → 7 日 / 30 日に UI 切替可能化。
- **集計サマリーグラフ**: カテゴリ別・緊急度別の傾向グラフ。
- **連続失敗自動 OFF**: N 回連続失敗で `enabled=false` に自動設定し、ユーザーに通知。
- **配信曜日カスタム**: 平日のみ、特定曜日のみ等。
- **複数アカウント対応**: 1 ユーザー複数 customer_id 運用。
- **Brief `services[]` の商品意図をプロンプトに注入**: サービス別の戦略シート連携（現状は `persona` のみ任意）。
- **他広告媒体**: Yahoo!広告等、同じ枠組みで対応。

## 工数見積もり（実装フェーズ）

### 前提

- 1 日に確保できる作業時間: **2 時間 / 営業日**
- バッファ係数: **1.5 倍**（仕様調整・型エラー対応・既存パターン差異の吸収・クライアント確認待ち等の余白）
- 営業日換算（平日のみ作業する想定）

### タスク別見積もり

| # | タスク | 素工数 | 余裕込み | 日数(2h/日) |
|---|---|---|---|---|
| T1 | DDL + RLS + プロンプト upsert マイグレーション | 2.0h | 3.0h | 2日 |
| T2 | 型 / Zod / MODEL_CONFIGS / PROMPT_DESCRIPTIONS / エラーメッセージ + **`GoogleAdsSearchTermMetric` 型拡張** | 1.5h | 2.0h | 1日 |
| T3 | `SupabaseService` 拡張（CRUD + listDue）+ **`getSearchTermMetrics` GAQL 拡張**（campaign/ad_group/cost 追加） | 3.0h | 4.5h | 3日 |
| T4 | `googleAdsNegativeKeywordsSuggestionService` 本体 + JSON 抽出 + DEV モード + 日付ユーティリティ + アカウント一式取得 + 空データスキップ | 7.0h | 10.5h | 6日 |
| T5 | Server Actions（get / update / runNow） | 2.0h | 3.0h | 2日 |
| T6 | Cron route + GH Actions `hourly-cron.yml` への matrix 追加（既存 cron との整合確認含む） | 1.5h | 2.5h | 2日 |
| T7 | `NegativeKeywordsSuggestionSettings` UI コンポーネント（自動配信 ON/OFF、配信時刻） | 4.0h | 6.0h | 3日 |
| T8 | `dashboard-content.tsx` タブ化 + `?tab=` URL 同期 + `useTransition` 中のタブ切替抑制 | 2.5h | 4.0h | 2日 |
| T9 | プロンプト本文の作り込み + 実出力検証 + 微調整 + **Opus/Sonnet 比較レポート作成** | 4.0h | 6.0h | 3日 |
| T10 | DEV サンプル送信検証 + JST 境界テスト + 空データスキップ確認 + アカウント一式取得確認 + lint/build | 4.0h | 6.0h | 3日 |
| T11 | 設計書整備・ドキュメント更新 | 2.0h | 3.0h | 2日 |
| **合計** | | **33.5h** | **49.5h** | **約 27 営業日** |

### ステップ単位のマイルストーン

| Step | 内容 | タスク | 日数(2h/日) | 累計日数 |
|------|------|--------|-------------|----------|
| 0 | 基盤定義（DDL / 型拡張 / GAQL 拡張準備 / 定数 / エラー） | T1, T2 | 3日 | 3日 |
| 1 | サービス層（Supabase CRUD + GAQL 拡張 + コアサービス） | T3, T4 | 9日 | 12日 |
| 2 | Server Action + Cron route + Vercel 登録 | T5, T6 | 4日 | 16日 |
| 3 | UI（タブ化 + 設定タブ） | T7, T8 | 5日 | 21日 |
| 4 | プロンプト調整 + Opus/Sonnet 比較 + 実機検証 + ドキュメント | T9, T10, T11 | 8日 | **27日** |

### カレンダー目安

| ペース | 営業日 | カレンダー |
|--------|--------|------------|
| 2h/日 | 約 27 営業日 | 約 6 週間 |
| 3h/日 | 約 18〜20 営業日 | 約 4 週間 |
| クライアント確認往復含む | +3〜5 営業日 | +1 週間 |

### 注意点

- T9（プロンプト調整）は AI 出力品質に依存。1 回目の本番実行で JSON フォーマット遵守率や提案精度を見てから admin/prompts で再調整するため、見た目の素工数より長引きやすい。本見積もりでは 5h を確保（5日相当）。
- T6 では §10.1 のチェックリスト（Vercel Dashboard 上で `gsc-evaluate` / `google-ads-negative-keywords-suggestion` が登録されていないこと、`google-ads-evaluate` / `ga4-sync` との一覧整合）の確認に時間がかかる可能性あり。確認に半日確保。
- 実装着手前に UI モック（§3.1, §3.2）をクライアント（カオルさん）にレビュー依頼し合意を取ること（client-vision §1.8「開発前で UI のたたき台を共有」）。レビュー往復で **+3〜5 営業日**かかる可能性あり、本見積もりには含まれていない。
- 既存「コンテンツ戦略提案」フェーズ 1 と同じパターン（DB + サービス + Server Action + UI + cron）の踏襲で、新規実装より既存資産流用が多い。慣れた領域では予定より早く終わる可能性もある。

## 確認待ち事項（実装着手前にクライアント合意が望ましい）

1. **UI モックの事前共有**: §3.1 のタブ化レイアウトと §3.2 の設定タブ構成について、実装前にカオルさんへ提示し合意を取る（client-vision §1.8「開発前でいいのでこういう感じですを見せてほしい」）。
2. **配信時刻の初期値 7:00 JST**: デフォルト値として妥当か確認。クライアントが希望する時刻があれば反映。
3. **カテゴリ定義 3 種固定**: 「企業系 / ノウハウ系 / 一般フレーズ」の境界がクライアントの業種（買取系・養鶏場系・買取ジャパン他）に照らして妥当か確認。
4. **自動除外登録が非対応の合意**: 本機能はメール送信までで完結し、実際の除外登録は Google Ads 管理画面でクライアントが手動実行する運用とする。将来 GrowMate 内で自動登録（メール返信フロー or ダッシュボードからのワンクリック）を導入する場合は別設計書で起こす。
