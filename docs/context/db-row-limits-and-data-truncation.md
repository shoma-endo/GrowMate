# DB 周りの取得上限とデータ打ち切り（開発コンテキスト）

本ドキュメントは、Google Ads コンテンツ戦略提案機能の不具合調査（2026-06-07）で判明した **「取得上限による暗黙のデータ打ち切り」** の知見を、今後の開発の指針として残すものである。

- **スナップショット作成日**: 2026-06-07
- **きっかけ**: 「既存修正と判定されたのに記事リンク・順位が出ない」不具合。調査の結果、**事実は全部DBに在るのに、取得上限で大半を捨てていた**ことが原因と判明した。
- **最重要メッセージ**: **上限値でデータを勝手に打ち切らない。打ち切るなら必ず検知できる（ログ/フラグ）状態にする。**

---

## 0. 結論（先に読む）

1. **「コード内の突合・集計」に件数上限を付けない。** 上限が要るのは「LLMプロンプトに送る量（トークン制約）」だけ。両者を1つの取得で兼ねると、トークン都合の上限が突合まで波及して**事実があるのに拾えない**事故になる。→ **「突合用」と「プロンプト用」を別々の取得に分離する。**
2. **Supabase(PostgREST) には `db-max-rows = 1000` のグローバル上限がある。** `.from().select()` も `.rpc()` も、1リクエストの返却行数がここで頭打ちになる。`.limit(5000)` と書いても 1000 で切られる。
3. **大量行を「全件取りたい」ときの正攻法は2つ**: (a) **狙い撃ち取得**（必要なキーだけ問い合わせる）、(b) **range ページング**（`db-max-rows` 以下のページで全件を回収）。
4. **集約はDB側（RPC）で完結させる。** RPC内で `GROUP BY`+`LIMIT` してから返せば、母集団が15万行でも返却は数百行に収まり `db-max-rows` に当たらない。

---

## 1. PostgREST `db-max-rows`（Supabase「Max rows」）の事実

- **値**: 現状 **1000**（Supabase ダッシュボード Settings → API → Max rows）。**Supabase の既定値が 1000**。
- **意味**: 自動REST API（`@supabase/supabase-js` クライアント）経由の **1リクエストが返せる最大行数**。安全弁（無フィルタ巨大取得の防止）。
- **効く範囲**:
  | 経路 | 効く？ |
  |---|---|
  | `supabase.from('table').select()` | ✅ |
  | `supabase.rpc('fn')`（集合返却） | ✅ |
  | SQLエディタの直接クエリ | ❌（だから調査時は1047が返った） |
  | 直接 Postgres 接続 | ❌ |
  | 外部API（Google Ads / GSC API 等） | ❌（無関係） |
- **`.limit(N)` との関係**: **上限（天井）として働く**。返る行数 = `min(N, db-max-rows)`。`.limit()` で `db-max-rows` を超えられない。
- **引き上げ可否**: ダッシュボードで変更可。ただし **全API共通＝安全弁を緩める**ため、原則変更しない。**個別取得はページング/狙い撃ちで回避する。**

---

## 2. 設計原則「突合とプロンプトの分離」

この機能では、取得データを2つの異なる用途に使っていた。**要件が正反対**なので分離する。

| 用途 | 件数上限 | 理由 |
|---|---|---|
| **LLMプロンプト送付**（`existingContent` / `rankingData`） | **必須** | コンテキスト長（トークン）の物理制約。全件は入らない。上位を抜粋。 |
| **コード内の突合**（メールの順位/記事リンク生成） | **不要** | トークンを消費しない。全件 or 狙い撃ちで拾うべき。 |

> アンチパターン: 「1回取得して両方で使う」。DRYに見えるが、**プロンプト都合の上限が突合に波及**して、事実があるのに突合が外れる。

---

## 3. 推奨パターン

### (a) 狙い撃ち取得（targeted lookup）— 突合の本命
必要なキー（例: 提案キーワード約35個）だけをDBに問い合わせる。**取得上限が原理的に不要**（結果がキー数に有界）。

- 実装: 統合RPC `get_gsc_ranking_snapshot(..., p_queries text[])` を `p_queries` 指定で呼ぶと `query_normalized = ANY(p_queries)` で絞り集約（`p_limit` 省略＝上限なし・結果はKW数に有界）。プロンプト用は同RPCを `p_limit=500`（`p_queries` 省略）で呼ぶ。集約本体は1つに統合済み。
- 前提: 突合キーの正規化が**両側で一致**していること。`gsc_query_metrics.query_normalized` はインポート時に `normalizeQuery`（`src/lib/normalize-query.ts`、NFKC+lowercase+空白圧縮、**冪等**）で生成されるため、呼び出し側も `normalizeQuery(KW)` を渡せば直接突合できる。

### (b) range ページング — 全件が要るが狙い撃ちできない場合
タイトル部分一致など、完全一致で引けない突合は全件が要る。`db-max-rows` 以下のページで回収する。

- 汎用ヘルパー: `SupabaseService.fetchAllPaged<T>(runPage, { pageSize, maxRows })`。
  - `pageSize` は **`db-max-rows` 以下**（既定1000）。超えると各ページがクランプされ早期終了し取りこぼす。
  - **`order` は決定的（タイブレーク付き）**にする。例: `updated_at desc, id desc`。境界での重複/欠落を防ぐ。
  - `select(..., { count: 'exact' })` を付けると総件数で確実に停止できる。
- 利用例: `getContentInventoryForMatching`（WP記事在庫を全件取得）。

### (c) DB側集約（RPC）— 大量母集団を小さく返す
母集団が大きくても、RPC内で `GROUP BY`+`LIMIT` してから返せば返却行は小さく、`db-max-rows` に当たらない。

- 例: `get_gsc_ranking_snapshot`（15万行を集約し上位 `p_limit`=500 行のみ返す）。

### (d) 打ち切りの検知（やむを得ず上限を残す場合）
ソフト上限を残すなら、**無言で欠けさせない**。`count:'exact'` の総件数と返却件数を比較し、`total > returned` で `console.warn`。`fetchAllPaged` は `truncated` フラグを返す。

> ❌ `items.length >= limit` での検知は不可。`db-max-rows` でクランプされると `length < limit` になり検知できない。**必ず `count:'exact'` の総件数と比較する。**

### (e) プロンプト投入を絞るときは「量」でなく「選別品質」
トークン都合で投入数を絞る場合、**「impression 上位 N 件」のような単純カットは選別バイアスを生む**。出稿が1キャンペーンに偏ると上位がそのテーマで独占され、コンテンツ機会に効く多様な検索意図が締め出される（=「捨てていないのに役に立たない入力」）。

- 原則: **取得は広めプール / 投入は選別**。取得上限（プール）と投入上限（プロンプト）を**別の値に分離**する。
- 選別軸の例: **キー（例: キャンペーンID）横断のラウンドロビンで独占防止** + **関連度（情報系修飾の加点・純購買/ブランド語の減点）**。
- 実装例: `curateSearchTermsForPrompt`（検索語句を pool 5000 → 投入 1500 に選別）。`campaignId` でグループ化（同名キャンペーン統合を回避）。

---

## 4. データソース別・上限の所在（2026-06-07 時点）

### コンテンツ戦略提案フロー（`googleAdsAiAnalysisService.ts`）
| 取得 | メソッド | 上限 | 種別 |
|---|---|---|---|
| 在庫（プロンプト） | `getContentInventoryByUserId(userId, 100)` | 100（`main_kw` あり優先 → `updated_at` 降順 → `id` 副キー。§17.4-B で 50→100 に拡大・抜粋付き） | 意図的（トークン制御） |
| 在庫（突合） | `getContentInventoryForMatching(userId)` | **上限なし**（range ページング全件・軽量） | ― |
| 順位（プロンプト） | `getRankingSnapshotByUserId(userId, 500, days)` → RPC `get_gsc_ranking_snapshot` | 500（上位サンプル） | 意図的（トークン制御） |
| 順位（突合） | `getRankingForQueries(userId, days, kws)` → 統合RPC `get_gsc_ranking_snapshot`（`p_queries` 指定） | **上限なし**（提案KWに有界・狙い撃ち） | ― |
| 検索語句（プロンプト） | `getSearchTermMetrics`（pool）→ `curateSearchTermsForPrompt` | 取得5000プール → 投入1500に選別（impression偏重をやめキャンペーン横断＋情報寄り）。GAQL `LIMIT` は引数化（既定1000） | 意図的（トークン制御＋多様性） |

突合ロジック（`composeEmailMarkdown` 配下）:
- 順位: `buildSnapshotMap`（`normalizeQuery(query)` で索引）
- 在庫: `buildInventoryIndex`（`byMainKw` / `byKw` を分離）+ `resolveInventoryArticle`（① main_kw 完全一致 → ② kw 完全一致 → ③ タイトル全トークン包含）

### GSC インポート側の上限（`src/server/lib/gsc-config.ts`, `gscImportService.ts`）
**ここは「DBに入る前」の上限**。突合をいくら直しても、インポートされていないデータは拾えない。
- クエリ別: `GSC_QUERY_ROW_LIMIT`（既定1000、env で最大25000）× `queryMaxPages`（10） = **1フェッチ最大10,000行**、**クリック降順**。→ ロングテール（低クリック）はそもそも保存されない可能性。`hitLimit` フラグで到達検知。
- ページ別: `maxRows`（既定1000、画面最大25000）。

### GSC データ自体の性質（不可避）
- **インプレッションが無いクエリは記録されない**（窓内に表示0なら存在しない）。
- **GSC のプライバシー閾値**: ごく稀なクエリは API が返さない。
- → 「実際は上位だが超低ボリューム」なクエリ（例: 1impression）は、上限とは無関係に表示されないことがある。

---

## 5. 調査で得た実数（参考・口座 `aozora-farm.jp` ほか）

不具合の典型例。**上限が「DBにある事実」をどれだけ捨てていたか**の規模感。

- **WP記事在庫**: ある口座は **272本**だが、旧実装は **直近50本（18%）のみ**を突合 → 222本(82%)が不可視。さらに **93% が `main_kw` 未設定 / 94% が `kw` 未設定**（タイトルは全件あり）→ 完全一致突合がほぼ効かず、**タイトル包含突合が必須**だった。
- **GSC順位**: 30日窓に **2,227クエリ**あるが、旧実装は **上位500（22%）のみ** → 1,727件(78%)を切り捨て。切り捨ての**最良順位が3位**（= 上位帯すら入りきらない）、捨てた impressions 合計 32,292。
- **`db-max-rows=1000` クランプ**: WP記事数の最大が **1,047本**の口座があり、`.limit(5000)` を指定しても **1,000でクランプ**され古い47本が漏れていた（→ ページング化で解消）。19/20 口座は1,000以下で無影響。
- **GSC distinct クエリ**: aozora 2,216 / kurasi 1,610 / rakuraku 662 と500超の口座が複数あるが、**RPCが集約+LIMITで返すため `db-max-rows` クランプは発生しない**（生の大量行がPostgRESTに出ない）。プロンプトは上位500サンプル・突合は狙い撃ちなので**ユーザー向け出力に漏れなし**。

---

## 6. 今後の開発チェックリスト

新しくDBからデータを読む実装をするとき、以下を確認する。

- [ ] **この取得は「プロンプト送付」か「コード処理」か?** 後者に件数上限を付けていないか。
- [ ] **返却行が `db-max-rows`(1000) を超え得るか?** 超えるなら **狙い撃ち / ページング / RPC集約** のどれかにする。
- [ ] **`.limit(N)` の `N` を `db-max-rows` 超で書いていないか?**（書いても1000で切られる。誤解の元）
- [ ] **やむを得ず上限を残すなら、`count:'exact'` で総件数と比較して `warn` を出しているか?**（`length >= limit` での検知はNG）
- [ ] **ページングの `order` は決定的（タイブレーク付き）か?**（`updated_at desc, id desc` 等）
- [ ] **突合キーの正規化は両側で一致しているか?**（`query_normalized` は `normalizeQuery` で生成・冪等）
- [ ] **DBに入る前の上限（インポート側）も塞がれていないか?**（GSC import の `GSC_QUERY_ROW_LIMIT` 等）

---

## 7. 参照コード

- `src/server/services/supabaseService.ts`
  - `fetchAllPaged<T>`（汎用 range ページング）
  - `getContentInventoryByUserId`（プロンプト・抜粋付き上位）/ `getContentInventoryForMatching`（突合・全件ページング）
  - `getRankingSnapshotByUserId`（プロンプト・統合RPC を `p_limit` 指定）/ `getRankingForQueries`（突合・統合RPC を `p_queries` 指定＝狙い撃ち）
  - `resolveGscPropertyUri`（取得失敗と未連携の区別）
- `supabase/migrations/20260607000000_add_gsc_ranking_snapshot_rpc.sql`（集約スナップショットRPC・初版／5引数・本番適用済み）
- `supabase/migrations/20260608000000_unify_gsc_ranking_snapshot_rpc.sql`（適用済み5引数を `DROP`→`p_queries`/`p_limit` 省略可の統合版を `CREATE`。狙い撃ちと上位N件を1関数で兼用）
- `src/server/services/googleAdsAiAnalysisService.ts`（`composeEmailMarkdown` / `buildSnapshotMap` / `buildInventoryIndex` / `resolveInventoryArticle` / `curateSearchTermsForPrompt` / 定数 `*_PROMPT_LIMIT`・`SEARCH_TERM_FETCH_POOL`）
- `src/server/services/googleAdsService.ts`（`getSearchTermMetrics` の `limit` 引数＝GAQL 取得プール上限。既定1000、AI分析は5000）
- `src/server/lib/gsc-config.ts`（インポート側の `GSC_QUERY_ROW_LIMIT` / `queryMaxPages`）
- `src/lib/normalize-query.ts`（`normalizeQuery`・冪等）/ `gscImportService.ts`（`query_normalized` 生成）
