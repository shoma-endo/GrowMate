# Step6/Step7 見出し単位生成フロー仕様書

## 1. 目的

既存の「Step7で本文を一括生成」フローを補完し、Step6で見出し単位（1見出し+本文）での生成・確認・保存を行えるようにする。  
Step6完了後は従来どおり全文Canvas編集に移行し、Step7で最終生成を行う。

## 2. スコープ

- 対象ステップ:
  - Step5: 構成案確認（目次/見出しの確定）
  - Step6: 見出し単位本文生成（新フロー本体）
  - Step7: 最終本文作成（最新完成形を入力として利用）
- 非対象:
  - 新しい見出し専用フォームUIの導入（今回は行わない）
  - Step6中の見出し単位バージョン管理（今回は行わない）

## 3. 用語定義

- 生成対象見出し: Step5で保存された構成案テキストから抽出した `###`（H3）および `####`（H4）行。
- 見出しレベル: 各生成対象見出しのレベル（H3/H4）。表示順は本文出現順で扱う。
- セクション確定本文: 各見出しに対して「保存して次へ」で確定した本文。
- 完成形: Step6時点で全セクション確定本文を結合した全体本文。

## 4. 見出し認識ルール

Step5の構成案テキストから、以下のルールで見出しを認識する。

- 生成対象:
  - `###`（H3）と `####`（H4）の行を生成対象見出しとして抽出する
  - 生成順はテキスト内の出現順とする
- 非対象:
  - `#`, `##`, `#####`, `######` は生成対象見出しとしては扱わない

補足:
- 箇条書き（`-` / `*`）は見出しとして扱わない。
- 空見出しは除外する。
- セクション本文範囲は「対象見出し（`###` or `####`）の直下から、次の対象見出し（`###` or `####`）の直前まで」。
- 抽出失敗時はStep5の見直し導線を表示する。

## 5. 機能仕様

### 5.1 Step6（見出し単位生成）

1. Step6初回開始時にStep5で保存された構成案テキストを読み込み、`###`（H3）と `####`（H4）を抽出して見出し配列を生成する。
   以降の再開時は再抽出せず、`session_heading_sections` を正本として読み込む。
2. 見出し配列の先頭から順に「1見出し+本文」を生成する。
3. 生成結果はCanvasで確認・修正可能。
4. ユーザーが「保存して次へ」を押した時点で、その見出し本文を確定保存する。
5. 保存のたびに完成形を自動再結合する。
6. 最後の見出し保存後、完成形をCanvasで再表示し最終確認する。

### 5.2 Step6再編集（途中）

- 再編集の反映範囲は「対象見出し1つのみ」。
- 他見出しは変更しない。
- 保存時に完成形を再結合する。

### 5.3 Step6完了後の修正

- Step6で最後まで完成した後は、見出し単位ではなく従来どおりCanvasで全文修正する。
- 以降の修正は全文編集フローとして扱う。

### 5.4 Step7（最終本文作成）

- Step7実行時は、常に「最新完成形」を入力として利用する。
- 最新完成形には以下を含む:
  - Step6の各見出し確定本文
  - Step6完了後の全文Canvas修正内容（存在する場合）

### 5.5 Step5再保存時の見出し再同期

- Step6未開始（`session_heading_sections` が未作成）の場合:
  - Step5最新テキストから見出しを新規抽出して開始する
- Step6開始後にStep5を再保存した場合:
  - 既存の `session_heading_sections` を正本として優先し、自動再同期は行わない
  - 見出し構成を更新したい場合は、ユーザー明示操作でStep6データを初期化して再開始する
- 理由:
  - 途中保存済みの見出し本文との不整合を防ぐため

## 6. 保存・バージョン管理方針

- Step6の見出し単位保存:
  - バージョン管理しない（確定版1つを上書き保持）
- Step6の完成形:
  - 各保存時に再結合して最新化
- Step7:
  - 既存の最終生成/バージョン管理方針に従う

## 7. 画面/操作フロー

1. Step5で目次（見出し）を確定
2. Step6で見出し1件目を生成
3. Canvasで確認・修正
4. 「保存して次へ」
5. 2〜4を最終見出しまで繰り返し
6. 最終見出し保存後、完成形をCanvasで再表示
7. 必要に応じて全文Canvas修正
8. Step7実行（最新完成形を入力に最終生成）

## 8. UI仕様

### 8.1 現在見出し表示（StepActionBar）

表示場所:
- `app/chat/components/StepActionBar.tsx` の「現在のステップ」表示の右側（同一行）

表示条件:
- Step6 / Step7 の本文生成フロー中のみ表示
- 見出し配列が取得できない場合は非表示

表示内容:
- 進捗: `現在の見出し: {currentIndex}/{totalCount}`
- 見出し名: `「{headingText}」`

表示例:
- `現在の見出し: 3/8「大寒卵の定義」`

フォールバック:
- 見出し名が空の場合は `（見出し未設定）` を表示
- `totalCount=0` の場合は Step5 見直し導線を優先表示

### 8.2 操作ボタン仕様（Step6）

- `保存して次へ`
  - 対象見出し本文を確定保存
  - 保存成功後に次見出しへ遷移
  - 保存成功時に完成形を自動再結合
- `戻る`
  - 1つ前の見出しに戻る（未保存変更がある場合は確認）
- `スキップ`
  - 本仕様では提供しない（誤操作防止のため）

### 8.3 全文編集への移行

- 最終見出し保存後に、再結合済み完成形をCanvasへ表示
- 以降の修正は見出し単位ではなく全文Canvas編集として扱う

### 8.4 Step6中の状態表示（必須）

- 生成中:
  - Canvasまたは入力欄付近にローディング表示を出す
  - `保存して次へ` / `戻る` は無効化する
- 保存中:
  - `保存して次へ` ボタンをローディング状態にする
  - `保存して次へ` / `戻る` の二重操作を防ぐため無効化する
- 状態解除:
  - 成功/失敗いずれでも処理完了時にローディングと無効化を解除する

### 8.5 エラー表示（必須）

- 表示位置:
  - Step6の操作ボタン近傍（`保存して次へ` の近く）にインライン表示する
- 対象:
  - 見出し本文の保存失敗
  - 完成形再結合の保存失敗
- 文言方針:
  - 原因を短く明示し、次アクションを示す（例: `保存に失敗しました。再試行してください。`）
- 再試行導線:
  - 同一画面で `保存して次へ` を再押下して再試行できること

## 9. データベース設計

### 9.1 追加テーブル

テーブル名: `session_heading_sections`

目的:
- Step6の「見出しごとの確定本文」を永続化する
- 各保存時に完成形を再結合するための正規化データを保持する

想定カラム:

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | `uuid` | Yes | 主キー |
| `session_id` | `uuid` | Yes | `chat_sessions.id` への外部キー |
| `heading_key` | `text` | Yes | 見出し識別子。`{order_index}:{normalized_heading_text}` 形式で生成 |
| `heading_level` | `smallint` | Yes | `1..6`（`#`〜`######`） |
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

インデックス:
- `INDEX session_heading_sections_session_order_idx (session_id, order_index)`
- `INDEX session_heading_sections_session_updated_idx (session_id, updated_at DESC)`

RLS（方針）:
- `chat_sessions` と同じアクセス境界に従う
- `session_id` 経由でオーナー/スタッフ共有アクセスを適用

テーブル名: `session_combined_contents`

目的:
- Step6/全文Canvas修正後の「完成形履歴」を蓄積する
- `is_latest=true` のレコードを Step7実行時の正本として利用する

想定カラム:

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | `uuid` | Yes | 主キー |
| `session_id` | `uuid` | Yes | `chat_sessions.id` への外部キー |
| `version_no` | `integer` | Yes | セッション内の完成形バージョン番号（1始まり） |
| `content` | `text` | Yes | 当該バージョンの完成形全文 |
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
- `INDEX session_combined_contents_updated_idx (updated_at DESC)`

RLS（方針）:
- `chat_sessions` と同じアクセス境界に従う
- `session_id` 経由でオーナー/スタッフ共有アクセスを適用

### 9.2 テーブル関係（ER）

- `chat_sessions (1) - (N) session_heading_sections`
- `chat_sessions (1) - (N) session_combined_contents`

### 9.3 完成形の扱い

本仕様では、`session_combined_contents` に完成形履歴を蓄積し、`is_latest=true` を正本として扱う。  
更新時は以下の順序で扱う:

1. Step6保存時:
- `session_heading_sections` を `order_index` 順で連結
- `version_no` 採番はトランザクション内で行う（`SELECT MAX(version_no)` + 行ロック、またはDB関数で原子的に採番）
- 旧最新レコード（`is_latest=true`）を `false` に更新
- 新しい完成形を `version_no+1` で INSERT（`is_latest=true`）

2. Step6完了後の全文Canvas修正時:
- `version_no` 採番はトランザクション内で行う（同時更新時の重複防止）
- 旧最新レコード（`is_latest=true`）を `false` に更新
- 全文修正結果を新しい `version_no+1` として INSERT（`is_latest=true`）

3. Step7実行時:
- 常に `session_combined_contents` の `is_latest=true` を入力として使用

### 9.4 更新フロー対応

- Step5確定時:
  - 見出し抽出結果を `session_heading_sections` に初期投入（`content=''`, `is_confirmed=false`）
- Step6「保存して次へ」時:
  - 対象 `heading_key` の `content` / `is_confirmed` / `updated_at` を更新
  - 保存後に `order_index` 順で再結合し、トランザクション内で新しい `session_combined_contents` レコードを追加
- Step6完了後の全文Canvas修正時:
  - 全文修正結果をトランザクション内で新しい `session_combined_contents` レコードとして追加（セクション原本は保持）
- Step7実行時:
  - 常に `session_combined_contents.is_latest=true` の `content` を入力に使用

## 10. エッジケース

- 見出し0件:
  - Step6を開始せず、Step5見直しを促す
- 見出し抽出不正（重複・空）:
  - 実行前に警告表示し修正を促す
- 未保存状態での遷移:
  - 確認ダイアログで破棄/継続を選択

## 11. 受け入れ条件

1. Step6で見出し単位生成が順次実行できる
2. 「保存して次へ」で対象見出しのみ確定保存される
3. 各保存時に完成形が自動再結合される
4. 再編集時に対象見出し以外が変更されない
5. Step6完了後は全文Canvas修正が可能
6. Step7実行時に最新完成形が渡される
7. Step6/Step7中、StepActionBarに現在見出し（番号/総数/見出し名）が表示される
8. Step6の生成中/保存中に、ローディング表示と操作無効化が適用される
9. Step6保存失敗時に、操作ボタン近傍へエラー表示され再試行できる
10. Step6の生成対象見出しが `###`（H3）と `####`（H4）である

## 12. 開発工数見積もり

| タスク | 内容 | 工数 |
|---|---|---:|
| 見出し抽出処理 | Step5テキストからMarkdown見出し抽出・バリデーション | 1.0人日 |
| Step6進行管理 | 見出しインデックス管理、1件ずつ生成制御、次へ遷移 | 1.5人日 |
| UI表示追加 | StepActionBarに現在見出し表示（進捗/見出し名）を追加 | 0.5人日 |
| DBスキーマ追加 | `session_heading_sections` と履歴統合型 `session_combined_contents` 追加・制約・RLS反映 | 1.5人日 |
| Step6保存処理 | 見出し単位確定保存（非バージョン） | 1.0人日 |
| 完成形再結合 | 各保存時の自動再結合・再表示 | 1.0人日 |
| Canvas連携調整 | 見出し単位編集と全文編集の切替 | 1.0人日 |
| Step7受け渡し | 最新完成形をStep7入力へ接続 | 0.5人日 |
| テスト/回帰確認 | 手動検証・既存フロー回帰チェック | 1.0人日 |
| バッファ | 不確定要素（抽出精度/UX調整） | 1.0人日 |

**合計: 10.0人日（目安 8.5〜11.5人日）**

## 13. 実装メモ

- Step6保存は「ユーザー操作で確定」が前提。自動確定は行わない。
- Supabase実装時は `supabase/migrations/` にSQLを追加し、ロールバック案をコメントで併記する。
