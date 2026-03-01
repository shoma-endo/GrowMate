# Step7 見出し単位生成フロー仕様書

> 本仕様は step6-step7-heading-flow-spec.md からの変更版。見出し単位生成を Step6 から Step7 に移行し、Step6 は従来の書き出し案（通常バージョン管理）に戻す。

## 1. 目的

Step6 を従来の「書き出し案」として復元し、Step7 で見出し単位（1見出し+本文）の生成・確認・保存を行う。  
Step7 の最後の見出し保存後、Step6 書き出し案＋完成形を Canvas で再表示して最終確認する。

## 2. スコープ

- 対象ステップ:
  - Step5: 構成案確認（目次/見出しの確定）
  - Step6: 書き出し案（**通常のバージョン管理**、変更前の挙動）
  - Step7: 見出し単位本文生成 ＋ 最終本文作成
- 非対象:
  - 新しい見出し専用フォームUIの導入（今回は行わない）
  - Step7 中の見出し単位バージョン管理（今回は行わない）

## 3. 用語定義

- 生成対象見出し: Step5 で保存された構成案テキストから抽出した `###`（H3）および `####`（H4）行。
- 見出しレベル: 各生成対象見出しのレベル（H3/H4）。保存時に H3=3 / H4=4 へ正規化して保持する。
- セクション確定本文: 各見出しに対して「保存して次へ」で確定した本文。
- Step6 書き出し案: Step6 で生成・保存された書き出し案テキスト。DB 上の Step6 最新版。
- 完成形: Step7 時点で、**Step6 書き出し案**＋**見出し確定本文（order_index 順）**を連結した全体本文。見出しの前に Step6 書き出し案が入る。

## 4. 見出し認識ルール

Step5 の構成案テキストから、以下のルールで見出しを認識する。

- 生成対象:
  - `###`（H3）と `####`（H4）の行を生成対象見出しとして抽出する
  - 生成順はテキスト内の出現順とする
  - 抽出した見出しの `heading_level` は保存時に H3=3 / H4=4 へ正規化する
- 非対象:
  - `#`, `##`, `#####`, `######` は生成対象見出しとしては扱わない

補足:
- 箇条書き（`-` / `*`）は見出しとして扱わない。
- 空見出しは除外する。
- セクション本文範囲は「対象見出し（`###` or `####`）の直下から、次の対象見出し（`###` or `####`）の直前まで」。
- 抽出失敗時は Step5 の見直し導線を表示する。

## 5. 機能仕様

### 5.1 Step6（書き出し案・通常バージョン管理）

- Step6 は**変更前の通常のバージョン管理**に戻す。
- AI が書き出し案を生成し、Canvas で確認・編集する。
- バージョン管理あり（従来どおり）。
- 見出し単位生成は行わない。

### 5.2 Step7（見出し単位生成）

1. Step7 初回開始時（および構成リセット後）の見出し抽出元は以下の優先順位とする。
   - **優先**: メモ・補足情報の基本構成（`content_annotations.basic_structure`）。`###`/`####` が見出しとして抽出できる場合のみ使用。
   - **フォールバック**: 上記が空または見出しを抽出できない場合、チャットの Step5 構成案テキストを使用。
   以降の再開時は再抽出せず、`session_heading_sections` を正本として読み込む。
2. 見出し配列の先頭から順に「1見出し+本文」を生成する。
3. 生成結果は Canvas で確認・修正可能。
4. ユーザーが「保存して次へ」を押した時点で、その見出し本文を確定保存する。
5. 見出し保存時は `session_heading_sections` のみ更新し、`session_combined_contents` へは保存しない。
6. **最後の見出し保存後、Step6 書き出し案＋見出し本文を Canvas で再表示し最終確認する。**
   - DB 上の Step6 書き出し案は見出しの**前**に入る。
   - 完成形 = Step6 書き出し案 + 見出し確定本文（order_index 順で連結）

### 5.3 Step7 再編集（途中）

- 再編集の反映範囲は「対象見出し1つのみ」。
- 他見出しは変更しない。
- 保存時に完成形の DB 保存は行わない。

### 5.4 Step7 完了後の修正

- Step7 で最後まで完成した後は、見出し単位ではなく従来どおり Canvas で全文修正する。
- 以降の修正は全文編集フローとして扱う。

### 5.5 Step5 再保存時の見出し再同期

- Step7 未開始（`session_heading_sections` が未作成）の場合:
  - 見出し抽出元の優先順位（5.2 参照）に従い、基本構成または Step5 最新テキストから見出しを新規抽出して開始する。
- Step7 開始後に Step5 を再保存した場合:
  - 既存の `session_heading_sections` を正本として優先し、自動再同期は行わない
  - 見出し構成を更新したい場合は、ユーザー明示操作で Step7 データを初期化して再開始する（UI仕様は 8.6 を参照）
- 理由:
  - 途中保存済みの見出し本文との不整合を防ぐため

## 6. 保存・バージョン管理方針

- Step6:
  - **通常のバージョン管理**（変更前の挙動）
- Step7 の見出し単位保存:
  - バージョン管理しない（確定版1つを上書き保持）
- Step7 の完成形:
  - 見出し保存時には保存しない（全文編集または明示的な完成形更新時のみ保存）
  - **Step6 書き出し案**＋**見出し確定本文**を連結

## 7. 画面/操作フロー

1. Step5 で目次（見出し）を確定
2. Step6 で書き出し案を生成・確認（通常フロー）
3. Step7 で見出し1件目を生成
4. Canvas で確認・修正
5. 「保存して次へ」
6. 3〜5 を最終見出しまで繰り返し
7. 最終見出し保存後、**Step6 書き出し案＋完成形**を Canvas で再表示
8. 必要に応じて全文 Canvas 修正
9. 最終生成（最新完成形を入力に）

## 8. UI仕様

### 8.1 現在見出し表示（StepActionBar）

表示場所:
- `app/chat/components/StepActionBar.tsx` の「現在のステップ」表示の右側（同一行）

表示条件:
- **Step7** の見出し単位生成フロー中のみ表示
- 見出し配列が取得できない場合は非表示

表示内容:
- 進捗: `現在の見出し: {currentIndex}/{totalCount}`
- 見出し名: `「{headingText}」`

表示例:
- `現在の見出し: 3/8「大寒卵の定義」`

フォールバック:
- 見出し名が空の場合は `（見出し未設定）` を表示
- `totalCount=0` の場合は Step5 見直し導線を優先表示

### 8.2 操作ボタン仕様（Step7）

- `保存して次へ`
  - 対象見出し本文を確定保存
  - 保存成功後に次見出しへ遷移
  - 保存成功時に `session_combined_contents` は更新しない
- `戻る`
  - 1つ前の見出しに戻る（未保存変更がある場合は確認）
- `スキップ`
  - 本仕様では提供しない（誤操作防止のため）

### 8.3 全文編集への移行

- 最終見出し保存後に、**Step6 書き出し案＋**再結合済み完成形を Canvas へ表示
- 以降の修正は見出し単位ではなく全文 Canvas 編集として扱う

### 8.4 Step7 中の状態表示（必須）

- 生成中:
  - Canvas または入力欄付近にローディング表示を出す
  - `保存して次へ` / `戻る` は無効化する
- 保存中:
  - `保存して次へ` ボタンをローディング状態にする
  - `保存して次へ` / `戻る` の二重操作を防ぐため無効化する
- 状態解除:
  - 成功/失敗いずれでも処理完了時にローディングと無効化を解除する

### 8.5 エラー表示（必須）

- 表示位置:
  - Step7 の操作ボタン近傍（`保存して次へ` の近く）にインライン表示する
- 対象:
  - 見出し本文の保存失敗
- 文言方針:
  - 原因を短く明示し、次アクションを示す（例: `保存に失敗しました。再試行してください。`）
- 再試行導線:
  - 同一画面で `保存して次へ` を再押下して再試行できること

### 8.6 Step7 データ初期化（見出し構成の再抽出）

Step5 を再保存した後、見出し構成を Step5 最新に合わせて更新したい場合に使用する破壊的操作。

#### トリガー

| 項目 | 仕様 |
|------|------|
| ボタン配置 | Step7 の Canvas 操作エリア（StepActionBar または CanvasPanel 内）を基本とする。旧step6データからの移行導線として step6 表示中に出す場合も、同位置相当とする。`戻る` ボタンの近くなど、目立ちすぎない位置。 |
| 表示条件 | Step7 表示中は表示可。Step6 表示中は **旧step6データ移行対象を検知できた場合のみ** 表示可（通常step6では非表示）。 |
| ボタン文言 | `見出し構成を初期化` または `見出しを再抽出` |

#### 確認ダイアログ（必須）

- ボタンクリック時、**必ず**確認ダイアログを表示する。ワンクリックでの実行は禁止。
- 文言例:
  ```text
  保存済みの見出し本文がすべて削除されます。
  この操作は取り消せません。
  実行しますか？
  ```
- 選択肢: `キャンセル` / `初期化する`（破壊的操作を右側に配置）

#### 初期化後の遷移先

- **Step7 の先頭見出し（order_index 0）**に遷移する。
- Step5 の最新テキストから見出しを再抽出し、`session_heading_sections` を全削除後に新規投入する。
- `session_combined_contents` は保持する（構成リセット後も完成形履歴は参照可能）。
- ユーザーは新しい見出しリストの1件目から再開する。Step5 に戻すことはしない（Step7 内で完結）。

#### 可逆性

- **元に戻せない（見出し構成のみ完全削除）**。`session_heading_sections` の該当レコードは物理削除する。
- 確認ダイアログで「この操作は取り消せません」を必ず明示する。

#### 非機能要件

- 初期化処理中のローディング表示とボタン無効化を行う。
- 初期化失敗時はエラーメッセージを表示し、データは変更しない。

### 8.7 Canvas 編集内容の保存優先順位

「保存して次へ」および完成形の全文 Canvas 修正時、どのコンテンツを保存するかの決定ロジック。

#### contentRef の更新タイミング

| 項目 | 仕様 |
|------|------|
| 更新タイミング | **onChange 毎**に CanvasPanel が `contentRef.current` を更新する。ユーザーが入力・削除するたびに同期的に反映する。 |
| onBlur 時 | 採用しない。onChange で十分に最新状態を保持できる。 |
| ストリーミング中 | AI 生成のストリーミング結果は `canvasStreamingContent` として別管理。CanvasPanel は受け取った内容を表示し、ユーザーが編集した時点で `contentRef` にその内容を反映する。 |

#### 保存時の内容決定ロジック（優先順位）

「保存して次へ」実行時に、保存する本文を以下の順で決定する。

| 優先度 | ソース | 説明 |
|--------|--------|------|
| 1 | `contentRef.current` | CanvasPanel が onChange 毎に更新する最新編集内容。ユーザーが編集中に「保存して次へ」を押した場合、ここに最新の入力が入っている。 |
| 2 | `canvasStreamingContent` | AI 生成中のストリーミング内容。ストリーミング直後にユーザーが編集せず保存した場合に使用。 |
| 3 | `canvasContent` | 表示中の確定内容（session_heading_sections の確定本文 or 完成形）。フォールバック。 |

判定式: `保存する内容 = contentRef.current ?? canvasStreamingContent ?? canvasContent`

（`??` を使用すること。`||` だと `contentRef.current` が空文字列のときに誤って次候補にフォールバックし、ユーザーが意図的に全削除して保存した内容が失われる）

#### 優先順位の根拠

- **contentRef を最優先**: ユーザーが編集中に「保存して次へ」を押した場合、React の state 更新（canvasContent）は非同期で遅れる可能性がある。`contentRef` は onChange で同期的に更新されるため、確実に最新の編集内容が取得できる。
- **canvasStreamingContent を次点**: ストリーミング完了直後のクリックでは、canvasContent がまだ更新されていないことがある。このタイミングを逃さないため。
- **canvasContent をフォールバック**: ref や streaming が空の場合（例: 確定済み見出しの表示のみで編集なし）の保険。

#### 保証事項

ユーザーが編集中に「保存して次へ」を押した場合、**最新の編集内容が確実に保存される**ことを本仕様で保証する。実装時は `contentRef` の onChange 同期更新を必須とする。

## 9. データベース設計

### 9.1 追加テーブル

テーブル名: `session_heading_sections`

目的:
- **Step7** の「見出しごとの確定本文」を永続化する
- 各保存時に完成形を再結合するための正規化データを保持する

想定カラム:

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | `uuid` | Yes | 主キー |
| `session_id` | `uuid` | Yes | `chat_sessions.id` への外部キー |
| `heading_key` | `text` | Yes | 見出し識別子。`{order_index}:{normalized_heading_text}:{short_hash(original_heading_text)}` 形式で生成 |
| `heading_level` | `smallint` | Yes | アプリ保存時に H3=3 / H4=4 へ正規化して保持（DB制約は `1..6` を許容） |
| `heading_text` | `text` | Yes | 見出し本文 |
| `order_index` | `integer` | Yes | 並び順（0始まり推奨） |
| `content` | `text` | Yes | 当該見出しの確定本文（最新版1件） |
| `is_confirmed` | `boolean` | Yes | `保存して次へ`で`true` |
| `created_at` | `timestamptz` | Yes | 作成日時 |
| `updated_at` | `timestamptz` | Yes | 更新日時 |

制約:
- `PRIMARY KEY (id)`
- `UNIQUE (session_id, heading_key)`
- `CHECK (heading_level BETWEEN 1 AND 6)`
- `CHECK (order_index >= 0)`

補足:
- `heading_level` は将来拡張余地のため DB 制約を `1..6` とするが、本フローの保存処理では必ず H3/H4（3/4）へ正規化し、3/4 以外は保存しない。
- `heading_key` は `normalized_heading_text` が同一化するケースでも、`original_heading_text` 由来の `short_hash` を付与して衝突回避する。

#### heading_key 生成仕様

| 項目 | 仕様 |
|------|------|
| 形式 | `{order_index}:{normalized_heading_text}:{short_hash}`（代替案ではサフィックス付与あり。下記参照） |
| normalized_heading_text | 小文字化・記号除去・連続ハイフン圧縮（既存の正規化ロジックを踏襲） |
| ハッシュアルゴリズム | SHA-256 |
| ハッシュ長 | 先頭8文字（16進数、小文字）。16^8 ≒ 43億通り。 |
| ハッシュ入力 | `original_heading_text`（正規化前の見出し本文） |
| 衝突検知 | INSERT / UPSERT 時の `UNIQUE (session_id, heading_key)` 制約違反をキャッチし、呼び出し元にエラーを返す。静黙スキップは行わない。 |
| 衝突時の挙動 | デフォルト: ユーザーに「見出しの重複の可能性があります。Step5 の構成案を確認してください。」等のメッセージを表示し、Step5 見直しを促す。代替案は下記を参照。 |

補足:
- `normalized_heading_text` が同一で `original_heading_text` が酷似している場合、short_hash でも衝突する可能性はあるが、SHA-256 先頭8文字（16^8 ≒ 43億通り）であれば現実的な見出し数では極めてまれ。
- 現行実装の `simpleHash`（4文字 Base36）は衝突リスクが高いため、本仕様に合わせて SHA-256 ベースへの移行を推奨する。

#### heading_key 衝突時の代替案

上記の「衝突時はエラー返却・Step5 見直しを促す」はデータ整合性を優先する方針であるが、万が一の衝突時にユーザーが Step5 に戻って修正する必要がある点は UX 上のハードルとなりうる。

**実装パス（段階的）**:
- **初回実装**: A 案（現状維持）を採用し、衝突時はエラー表示のまま Step5 見直しを促す。
- **実運用**: 衝突発生をモニタリング。実際に報告された場合に D 案（retry_count 付与）または B 案（タイムスタンプ追加）へ移行を検討する。
- **衝突を事前に避けたい場合**: E 案（UUID v4）を初回から採用する。

| 案 | 内容 | メリット | デメリット |
|----|------|----------|------------|
| **A. 現状維持**（初回採用） | 衝突時はエラー表示のまま。ユーザーに Step5 見直しを促す。 | 実装がシンプル。データ整合性が明確。過剰な初期実装を防げる。 | 衝突時の UX 負荷が高い。 |
| **B. タイムスタンプ追加** | 衝突検知時のみ、`heading_key` に `_${timestamp}` サフィックスを付与して再試行（最大1回）。 | 多くの衝突を自動解消。ユーザー操作不要。 | heading_key の形式が変則的になる。同一ミリ秒での再衝突は理論上ありうる（極めてまれ）。 |
| **C. 段階的アプローチ** | A 案でリリースし、実運用で衝突発生をモニタリング。実際に発生した場合に B/D 案を検討。 | 初期実装が軽い。衝突が稀である前提では十分。 | 衝突発生時に改修が必要。 |
| **D. retry_count 付与** | 衝突検知時、`{order_index}:{normalized_heading_text}:{hash}:{retry_count}` 形式で再試行。retry_count を 0, 1, 2 とインクリメントし、最大3回まで試行。3回失敗時はユーザーに見出しテキストの修正を促すエラーを表示。 | 衝突を自動解消する確率が高い。形式が一定（タイムスタンプより予測可能）。 | heading_key 形式の拡張が必要。3回連続衝突は極めてまれだが、その場合は Step5 修正が必要。 |
| **E. UUID v4** | `heading_key` に UUID v4 を使用する。衝突リスクを実質ゼロにする。形式は `{order_index}:{uuid}` 等（order_index は並び順の確保に必要）。 | 衝突が実質的に発生しない。 | 見出しテキストと key の対応が DB 上では uuid のみとなり、デバッグ・手動確認がしづらい。正規化見出しテキストを別カラム（heading_text）で保持する現状の設計なら運用可能。 |

インデックス:
- `INDEX session_heading_sections_session_order_idx (session_id, order_index)`
- `INDEX session_heading_sections_session_updated_idx (session_id, updated_at DESC)`

RLS（方針）:
- `chat_sessions` と同じアクセス境界に従う
- `session_id` 経由でオーナー/スタッフ共有アクセスを適用

テーブル名: `session_combined_contents`

目的:
- **Step7** の「完成形履歴」を蓄積する
- 完成形 = **Step6 書き出し案** + 見出し確定本文（order_index 順で連結）
- `is_latest=true` のレコードを最終生成時の正本として利用する

想定カラム:

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | `uuid` | Yes | 主キー |
| `session_id` | `uuid` | Yes | `chat_sessions.id` への外部キー |
| `version_no` | `integer` | Yes | セッション内の完成形バージョン番号（1始まり） |
| `content` | `text` | Yes | 当該バージョンの完成形全文（Step6書き出し案＋見出し本文） |
| `is_latest` | `boolean` | Yes | 最新完成形なら`true`（各`session_id`で1件のみ） |
| `created_at` | `timestamptz` | Yes | 作成日時 |
| `updated_at` | `timestamptz` | Yes | 更新日時 |

制約:
- `PRIMARY KEY (id)`
- `UNIQUE (session_id, version_no)`
- `UNIQUE (session_id) WHERE is_latest = true`
- `CHECK (version_no >= 1)`

インデックス:
- `INDEX session_combined_contents_session_version_idx (session_id, version_no DESC)`
- `INDEX session_combined_contents_latest_idx (session_id) WHERE is_latest = true`
- `INDEX session_combined_contents_updated_idx (session_id, updated_at DESC)`

RLS（方針）:
- `chat_sessions` と同じアクセス境界に従う
- `session_id` 経由でオーナー/スタッフ共有アクセスを適用

### 9.2 テーブル関係（ER）

- `chat_sessions (1) - (N) session_heading_sections`
- `chat_sessions (1) - (N) session_combined_contents`

### 9.3 完成形の扱い

本仕様では、`session_combined_contents` に完成形履歴を蓄積し、`is_latest=true` を正本として扱う。  
完成形の**先頭**には **Step6 書き出し案**（DB 上の Step6 最新版）を置き、その後に見出し確定本文を `order_index` 順で連結する。Step6 が未作成の場合は空文字列を先頭に置く（見出し確定本文のみの連結）。

更新時は以下の順序で扱う:

1. Step7 見出し保存時:
   - `session_heading_sections` の対象見出しのみ更新する
   - `session_combined_contents` には保存しない（見出し保存時の完成形バージョン作成は行わない）

2. Step7 完了後の全文 Canvas 修正時:
   - `version_no` 採番は同一トランザクション内で `COALESCE(MAX(version_no), 0) + 1` を `FOR UPDATE` 付きで実行。同時更新時の競合は 9.3.1 のリトライ仕様に従う。
   - 旧最新レコード（`is_latest=true`）を `false` に更新
   - 全文修正結果を採番済み `version_no` として INSERT（`is_latest=true`、`UNIQUE(session_id, version_no)` 前提）

3. 最終生成実行時:
   - 常に `session_combined_contents` の `is_latest=true` を入力として使用

#### version_no 採番リトライ仕様（9.3.1）

`version_no` 採番時に DB 競合（デッドロック・一意制約違反等）が発生した場合のリトライ仕様。

| 項目 | 仕様 |
|------|------|
| 最大リトライ回数 | 3回（初回含め計4回実行）。ユーザー体験を損なわない待機時間の上限として約1.5秒（200+400+800ms）を想定。 |
| リトライ間隔 | 指数バックオフ: 200ms → 400ms → 800ms。各リトライ前に待機。初期値200ms は一般的な DB トランザクション競合の解消時間を考慮。 |
| 最大リトライ超過時 | エラーとして扱い、ユーザーに「保存に失敗しました。しばらく経ってから再試行してください。」と表示する。 |
| リトライ中のUI状態 | 「保存中...」ローディングを継続する。ボタンは無効化したまま。 |
| 競合の検知 | トランザクションのコミット失敗、または `FOR UPDATE` 時のロック待ちタイムアウトをリトライ対象とする。 |

補足:
- 無限ループを防ぐため、最大リトライ回数は厳守する。
- 3回失敗後はローディングを解除し、エラー表示へ切り替える。ユーザーは「保存して次へ」の再押下で再試行できる。
- リトライ間隔は FOR UPDATE のロック待ちやトランザクション競合の解消に要する時間を考慮した値。DB 負荷が低い環境では実運用でリトライ発生率をモニタリングし、必要に応じて調整する段階的アプローチも有効。

### 9.4 更新フロー対応

- Step7 初回入場時（`session_heading_sections` が未作成の場合）:
  - Step5 最新テキストから見出しを抽出し、`session_heading_sections` に初期投入（`content=''`, `is_confirmed=false`）。5.2 および 5.5 を参照。
- Step7「保存して次へ」時:
  - 対象 `heading_key` の `content` / `is_confirmed` / `updated_at` を更新
  - `session_combined_contents` への保存は行わない
- Step7 完了後の全文 Canvas 修正時:
  - 全文修正結果をトランザクション内で新しい `session_combined_contents` レコードとして追加（セクション原本は保持）
- 最終生成実行時:
  - 常に `session_combined_contents.is_latest=true` の `content` を入力に使用

## 10. エッジケース

- 見出し0件:
  - Step7 の見出し単位生成を開始せず、Step5 見直しを促す
- 見出し抽出不正（重複・空）:
  - 実行前に警告表示し修正を促す
- 未保存状態での遷移:
  - 確認ダイアログで破棄/継続を選択
- Step6 書き出し案が未作成の場合:
  - **空文字列として扱う**。完成形の先頭に何も付与せず、見出し確定本文のみを連結する。Step6 完了を促すガードやブロックは実装しない。

## 11. 受け入れ条件

1. Step6 は通常の書き出し案フロー（バージョン管理）である
2. Step7 で見出し単位生成が順次実行できる
3. 「保存して次へ」で対象見出しのみ確定保存される
4. 見出し保存時に `session_combined_contents` へ新規バージョンが作成されない
5. 完成形の先頭に Step6 書き出し案（未作成時は空文字列）が入る
6. 再編集時に対象見出し以外が変更されない
7. Step7 完了後は全文 Canvas 修正が可能
8. 最後の見出し保存後、Step6 書き出し案＋完成形が Canvas に表示される
9. Step7 中、StepActionBar に現在見出し（番号/総数/見出し名）が表示される
10. Step7 の生成中/保存中に、ローディング表示と操作無効化が適用される
11. Step7 保存失敗時に、操作ボタン近傍へエラー表示され再試行できる
12. Step7 の生成対象見出しが `###`（H3）と `####`（H4）である
13. Step7 中に「見出し構成を初期化」を実行すると、確認ダイアログ後に `session_heading_sections` が削除され、Step5 最新から見出しを再抽出して先頭見出しから再開できる（`session_combined_contents` は保持）
14. 既存の step6 見出し生成済みデータは通常 step6 として扱い、ユーザーが任意で「構成リセット」を実行した場合のみ step7 に移行できる

## 12. 実装メモ

- Step7 見出し保存は「ユーザー操作で確定」が前提。自動確定は行わない。
- 完成形の再結合時は、Step6 書き出し案を先頭に置く。未作成の場合は空文字列として扱い、見出し確定本文のみを連結する。
- Step6 書き出し案の取得元: DB 上の Step6 最新メッセージ（または blog_canvas_versions の step6 最新版）
- Supabase 実装時は `supabase/migrations/` に SQL を追加し、ロールバック案をコメントで併記する。
- `heading_key` の short_hash: `src/lib/heading-extractor.ts` の `simpleHash` を SHA-256 先頭8文字（16進）に置き換える。`initializeHeadingSections` の upsert は、UNIQUE 制約違反時にエラーを返すようにする（`ignoreDuplicates` による静黙スキップをやめる）。
- `version_no` 採番: `save_atomic_combined_content` RPC または呼び出し元で、9.3.1 のリトライ仕様（最大3回、指数バックオフ 200/400/800ms）を実装する。
- Canvas 保存時の内容取得: 8.7 に従い、`contentRef.current ?? canvasStreamingContent ?? canvasContent` の順で決定する（空文字列は有効な編集結果のため `??` を使用すること）。CanvasPanel は onChange 毎に contentRef を更新すること。

## 13. ChatLayout 簡素化方針

### 13.1 課題

ChatLayout には Step7 見出しフロー専用の状態・ロジックが多数直書きされており、以下の問題がある。

- **可読性**: step7 判定と通常 Canvas の分岐が混在し、全体の流れを追いにくい
- **保守性**: step7 変更時に ChatLayout 内を広範囲に触る必要がある
- **テスト容易性**: 見出しフロー単体のロジックを分離してテストしづらい

### 13.2 方針: 専用フックへの抽出

Step7 見出しフロー専用の状態とロジックを **`useHeadingCanvasState`** フックに集約する。

| 抽出対象 | 説明 |
|----------|------|
| `viewingHeadingIndex` | 表示中の見出しインデックス（null = 完成形表示） |
| `pendingViewingIndexRef` | タイルクリック時に effect へ渡す見出しインデックス |
| `isContentStale` | 見出し保存後のステール検知（誤保存防止） |
| `hasContentForViewingHeading` | 表示中見出し向けコンテンツの有無判定 |
| `canvasContent` | Step7 時の Canvas 表示内容（見出し単位 or 完成形） |
| `isCombinedFormView` / `isCombinedFormViewWithVersions` | 完成形表示モードかどうか |
| `canvasVersionsWithMeta` | Step7 時のバージョン一覧（完成形 or 見出し単位） |
| `handleSaveHeadingSection` | 見出し保存のラッパー（stripLeadingHeadingLine 適用） |
| `handlePrevHeading` / `handleNextHeading` | 見出し間ナビゲーション |
| `handleBeforeHeadingChange` | 見出し遷移時の未保存変更確認 |
| `handleBeforeManualStepChange` | ステップ切り替え時の未保存変更確認（step7→前ステップ時） |
| `setPendingViewingIndexFromTile` | タイルクリック時に該当見出しインデックスを設定 |

### 13.3 フックのインターフェース（想定）

```ts
// 入力
interface UseHeadingCanvasStateParams {
  resolvedCanvasStep: BlogStepId | null;
  headingStepId: BlogStepId;           // 'step7'
  headingSections: SessionHeadingSection[];
  activeHeadingIndex: number | undefined;
  activeHeading: SessionHeadingSection | undefined;
  versionsForHeadingStep: BlogCanvasVersion[];  // blogCanvasVersionsByStep.step7
  canvasStreamingContent: string;
  selectedCombinedContent: string | null;
  combinedContentVersions: CombinedContentVersion[];
  activeCanvasVersion: BlogCanvasVersion | null;
  onSaveHeadingSection: (content: string, overrideKey?: string) => Promise<boolean>;
  sessionId: string | null;
  /** CanvasPanel が onChange 毎に更新する編集内容の ref。保存優先順位は 8.7 を参照 */
  contentRef: React.MutableRefObject<string | null>;
}

// 戻り値（Step7 時のみ意味を持つ。それ以外は null/false や noop を返す）
interface UseHeadingCanvasStateReturn {
  viewingHeadingIndex: number | null;
  setViewingHeadingIndex: (idx: number | null) => void;
  isContentStale: boolean;
  canvasContent: string;
  isCombinedFormView: boolean;
  isCombinedFormViewWithVersions: boolean;
  canvasVersionsWithMeta: CanvasVersionWithMeta[];
  handleSaveHeadingSection: () => Promise<void>;
  handlePrevHeading: () => void;
  handleNextHeading: () => void;
  handleBeforeHeadingChange: () => boolean;
  handleBeforeManualStepChange: (params: { direction; currentStep; targetStep }) => boolean;
  setPendingViewingIndexFromTile: (message: ChatMessage, messages: ChatMessage[]) => void;
  viewingSection: SessionHeadingSection | undefined;
  displayHeadingSection: SessionHeadingSection | undefined;
}
```

### 13.4 ChatLayout 側の責務（簡素化後）

- `useHeadingCanvasState` を呼び出し、Step7 時はその戻り値を CanvasPanel 等に渡す
- `resolvedCanvasStep === 'step7'` のときだけフックの戻り値を使用する分岐を1箇所に集約
- タイルクリック（`handleShowCanvas`）時は、step7 タイルであれば `setPendingViewingIndexFromTile` を呼ぶ
- それ以外のステップ切り替え・Canvas 表示ロジックは従来どおり維持

### 13.5 期待効果

- ChatLayout から Step7 専用ロジックを約 150〜200 行削減
- Step7 仕様変更時は `useHeadingCanvasState` と `useHeadingFlow` を中心に修正可能
- 見出しフロー単体のユニットテストがしやすくなる

### 13.6 実装順序の推奨

1. **Step7 移行と同時にフック抽出を行う**（推奨）
   - `useHeadingCanvasState` を step7 前提で新規作成し、ChatLayout から Step6 見出しロジックを移す
   - step6→step7 の置換とフック化を1作業で完了できる
2. **事前リファクタリングで分離する**
   - 現状の step6 見出しロジックを先に `useHeadingCanvasState` へ抽出
   - その後、フック内の step6→step7 置換を実施
   - 変更が2段階になるが、各段階の差分は小さくなる

## 14. 可読性・保守性のための追加指針

### 14.1 定数の一元化

見出しフロー対象ステップをハードコードせず、定数で管理する。

```ts
// src/lib/constants.ts 等
/** 見出し単位生成フローが紐づくステップID */
export const HEADING_FLOW_STEP_ID: BlogStepId = 'step7';
```

- `resolvedCanvasStep === 'step7'` → `resolvedCanvasStep === HEADING_FLOW_STEP_ID`
- フックの `headingStepId` にはこの定数を渡す
- 将来 step 構成が変わっても変更箇所を1点に集約できる

### 14.2 命名規則（step 依存の排除）

フック・コンポーネント内の変数名から step 番号を外し、責務に基づいた名前にする。

| 避ける | 推奨 |
|--------|------|
| `isStep7ContentStale` | `isContentStale` |
| `pendingStep7ViewingIndexRef` | `pendingViewingIndexRef` |
| `step7Versions` | `versionsForHeadingStep` |

- 「見出しフロー用」であることは `useHeadingCanvasState` の文脈で明らかにする
- step 番号を変数名に含めないことで、将来の step 変更時のリネームを減らす

### 14.3 変更影響ファイル一覧（実装チェックリスト）

Step7 移行時に触る想定ファイルを一覧化する。実装漏れ防止用。

| ファイル | 主な変更内容 |
|----------|----------------|
| `src/lib/constants.ts` | `HEADING_FLOW_STEP_ID` 追加 |
| `src/lib/heading-extractor.ts` | `isStep7HeadingUnitMode` 化、step7 条件、`generateHeadingKey` の short_hash を SHA-256 先頭8文字に変更 |
| `src/server/services/headingFlowService.ts` | `combineSections` に Step6 先頭付与、Step6 取得、`initializeHeadingSections` の UNIQUE 制約違反時エラー返却、`resetHeadingSections`（Step7 初期化用） |
| `app/api/chat/canvas/stream/route.ts` | `isStep7HeadingUnit`、targetStep 条件、saveCombined の step7 対応 |
| `src/hooks/useHeadingFlow.ts` | step7 条件、トースト文言 |
| `src/hooks/useHeadingCanvasState.ts` | **新規**。見出し Canvas 状態の集約 |
| `app/chat/components/ChatLayout.tsx` | フック利用、step7 分岐集約、タイルクリック |
| `app/chat/components/CanvasPanel.tsx` | `activeStepId === 'step7'`、「見出し構成を初期化」ボタン、contentRef を onChange 毎に更新（8.7） |
| `app/chat/components/StepActionBar.tsx` | 見出し表示条件 step7 |
| `src/server/actions/heading-flow.actions.ts` | `resetHeadingSections` アクション追加 |
| `app/chat/components/MessageArea.tsx` | step7 メッセージ照合、タイルラベル |
| `app/chat/components/InputArea.tsx` | step7 プレースホルダー |
| `src/lib/prompts.ts` | 見出し生成プロンプトの step7 前提（該当箇所のみ） |

### 14.4 既存データ（Step6 見出し生成済みセッション）の扱い

#### 方針: Step6 は常に通常フロー。Step7 へは「構成リセット」で任意移行

既に step6 で見出し単位生成済みのセッションであっても、**step6 は通常の書き出し案フローとして扱う**。  
見出しフロー（1見出し+本文）は **step7 のみ**とする。

#### 既存セッションのデータ構造

- `session_heading_sections`: 既存レコードは保持する（自動利用しない）。
- `session_combined_contents`: 既存レコードは保持する。
- チャットメッセージ: `blog_creation_step6` はそのまま保持し、step6 の履歴として扱う。

#### 表示・編集の可否

| 観点 | 方針 |
|------|------|
| Step6 表示 | **通常 Canvas 表示**。見出し単位UI（進捗/保存して次へ/戻る）は表示しない。 |
| Step6 編集 | **通常の全文編集**のみ許可。 |
| Step7 への移行 | ユーザーが任意で `構成リセット` を実行した場合のみ、Step5 最新から再抽出して step7 を開始する。 |
| タイル→Canvas 紐づけ | `blog_creation_step6` は常に step6 タイルとして扱う。step7 として解釈しない。 |

#### 構成リセット時の動作（旧step6データからの移行）

1. ユーザーが `構成リセット` を明示実行する。
2. `session_heading_sections` を削除する（`session_combined_contents` は保持）。
3. Step5 最新テキストから `###`/`####` を再抽出する。
4. step7 の先頭見出しから見出しフローを再開する。

#### データ移行

- 自動移行は行わない。
- `blog_creation_step6` を `blog_creation_step7` に書き換える移行も行わない。

#### 受け入れテスト

- 既存の step6 見出し生成済みセッションで、step6 を開いたときに見出し単位UIが表示されないこと。
- `blog_creation_step6` タイルをクリックしても step7 へ自動解釈されないこと。
- `構成リセット` 実行後にのみ step7 見出しフローが開始されること。

### 14.5 コメント規約

複雑な条件分岐には、**なぜ**その条件が必要かを JSDoc またはインラインコメントで残す。

例:
```ts
// 見出し保存直後は activeHeadingIndex が進むが Canvas は前見出しのまま。
// この状態で再保存すると誤って前見出しに上書きするため、新規生成が入るまでステール扱いにする。
if (isContentStale && viewingHeadingIndex === activeHeadingIndex) {
  return '';
}
```

- 「何をしているか」より「なぜそうしているか」を優先して記載
- エッジケース対応の意図が後から分かるようにする
