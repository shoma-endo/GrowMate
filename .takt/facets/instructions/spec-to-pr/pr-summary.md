push 前に、下記に全文添付された最新レポート群から、PR 本文の正本となる `pr-summary.md` を作成してください。
PR 本文は開発後のカルテである。実装後の最終確認だけを別の人に引き継いでも、本文だけで「何を・なぜ・どう検証済みで・何を確認すれば完了か」が分かるように書く。

必須条件:
- 実装やレビュー判断は行わない。確認済みの事実と意見（完了判断）を分けて整理する。
- 一次情報は下記添付の `plan.md` / `implement-report.md` / `fix-result.md` / `ai-antipattern-review.md` / `architecture-review.md` / `readme-sync.md` / `self-review.md` に限る。`fix-result.md` は fix 工程が一度も走らなかった run では欠落文になるが、正常であり ABORT 理由にしない。run ディレクトリやレポートパスを探索しない。**例外:** `plan.md` ヘッダの `UIモック:` が `対象外` 以外のときだけ、キャプチャ有無の確認のため `.takt/artifacts/pr-screenshots/` を列挙してよい（スクショの新規撮影・生成はしない）。**例外2:** `## 概要` の「なぜ」を書くためだけに、`plan.md` の `対象仕様書:` のパスにある仕様書の「背景・目的」節を読んでよい。
- `self-review.md` の仕様書完全実装判定を読み取り、`## 関連仕様書` に転記する（実装やレビュー判断はしない、転記のみ）。
- `pr-summary.md` は GitHub PR 本文としてそのまま使える Markdown にする。先頭に PR タイトル案を1行（`# ` 見出し）で書き、続けて本文セクションを書く。
- PR タイトル形式（必須）:
  - 日本語・1行・50字以内（`# ` を除く本文）。
  - What/Why が一覧で分かる内容にする（例: `コンテンツ注釈の保存APIを仕様どおり実装する`）。
  - 禁止: `[Auto]` 接頭辞、ブランチ名だけのタイトル、`実装完了` / `対応完了` などの自己申告、英語のみ、conventional commits 接頭辞（`feat:` 等）。
- 必須セクション（この順）:
  1. `## 概要` — 何を・なぜ変えたか（仕様書の「背景・目的」を起点に、2〜4文）
  2. `## 最終確認（引き継ぎ用）` — 冒頭に1行「確認した項目にチェックを入れ、結果（OK / NG と気づいた点）をこの PR のコメントに残す。」と書き、続けてチェックボックス（`- [ ] `）で並べる。各項目は、この PR を初めて見る人がそのまま実行できるよう「どこで（画面パス・ロール。プレビュー環境は Vercel bot コメントの Preview）・何をして・何が見えれば OK か」を1項目に書く。
     - 入れるもの: `## 受け入れ検証` で `手動確認待ち` / `未検証` のシナリオ全件、UI 変更時の手動ブラウザ確認（キャプチャ 0 件でも）、`src/types/database.types.pending.ts` を追加している場合の管理者作業（マイグレーション適用・`npm run supabase:types` 実行・pending ファイル削除）、添付レポート間の食い違い（何と何が食い違うか、どちらを確かめるか）、その他の未確認事項。
     - 無い場合は「なし（受け入れ検証はすべて自動検証済み）」の1行にする。
  3. `## 全体像` — 変更の全体像を Mermaid 図（` ```mermaid ` フェンス）で**必ず1枚**示す。GitHub 上で図として描画される前提で書く。
     - 図は `flowchart LR`（縦長なら `flowchart TD`）を1枚だけ。変更が載る経路（画面 → Server Action / Route Handler → サービス → DB / 外部API など）をノードと矢印で描く。本PRで追加・変更した要素に `:::changed` を付け、既存のまま使う要素は無印にする。ノードは15個以内。
     - 根拠: 実装の実体は `implement-report.md`（実装箇所と影響経路）と `fix-result.md`（その後の修正）から取る。`plan.md` は変更候補にすぎないため、実装レポートに無い要素を plan だけを根拠に描かない。推測でノードや矢印を足さない。読み取れない部分は描かずに省く。plan と実装レポートが食い違う場合は実装レポート側を描き、食い違いを `## 最終確認（引き継ぎ用）` に書く。
     - 記法（描画エラー防止）:
       - ノード ID は `n1`〜`n15` の連番、subgraph ID は `g1` からの連番にする（予約語との衝突を避けるため）。
       - ノードは `n1["..."]`、エッジラベルは `-->|"..."|`、subgraph は `subgraph g1["..."]` と、ラベルは必ず `"` で囲む。
       - ラベル内に `"` とバッククォートを書かない（識別子もそのまま書く）。改行は `<br/>`。
       - 図の末尾に `classDef changed stroke:#f08c00,stroke-width:3px` を置く（`fill` は指定しない。ダークテーマで文字が読めなくなるため）。`%%{init}%%`・`click`・`style` は使わない。
     - 図の直後に凡例を1行書く: `太枠（橙）= 本PRで追加・変更`。
     - 変更が docs・設定・開発フローのみでコードの経路が無い場合も、図は省かない。変更した文書・設定ファイルを `:::changed` のノードにし、それが効く先（工程・機能・利用者の手順）を矢印でつなぐ。効く先も上の根拠ルールに従い、`implement-report.md` と `fix-result.md` に書かれているものだけを描く。効く先が読み取れなくても、変更したファイルのノードだけで図にする（空の図にしない）。
  4. `## 関連仕様書` — `plan.md` の `# タスク計画` 直後の `対象仕様書:` パス（なければ `self-review.md` の記載）。`self-review.md` が完全実装と判定した場合は「本PR完了後 `docs/plans/xxx.md` → `docs/specs/xxx.md` へ移動（create_pr が git mv・当該 slug の参照パス置換・ステータスを `implemented` に更新まで実施）」と明記する。部分実装の場合は「`docs/plans/` に残置（未実装: ○○）」と明記する（移動指示を書かない）
  5. `## 変更要点` — 主要変更のみ（ファイル一覧の羅列は禁止。カテゴリ単位で3〜7点）
  6. `## 実装中の判断` — 仕様書に書かれておらず、実装中に決めたこと（`implement-report.md` と `fix-result.md` の判断記録から。どれを選び、なぜか）。次の担当者が同じ判断をやり直さないための記録。無ければ「なし」
  7. `## 受け入れ検証` — `self-review.md` の受け入れ検証表を転記する（シナリオ / 検証手段 / 結果）。結果は `自動検証済み` / `手動確認待ち` / `未検証` のいずれか。自分で判定し直さない。表が無ければ「self-review に記録なし」と書き、`## 最終確認（引き継ぎ用）` に「受け入れ条件を仕様書の Gherkin と突き合わせて確認する」を入れる
  8. `## レビュー結果` — ai-antipattern / architecture-review / self-review の結論（approved / open findings 数）
  9. `## 完了判断` — 事実（verify 成功、open findings 0、仕様要件充足など）と、それに基づく完了判断を分けて書く
  10. `## 検証` — `npm run verify` 等の結果（手動ブラウザ確認は無人のため未実施が既定）
  11. `## 画面キャプチャ` — `plan.md` の `UIモック:` が `対象外` なら「対象外」1行のみ。UI 対象（`なし` / `あり(...)`）なら `.takt/artifacts/pr-screenshots/` を列挙し、許可拡張子（`.png` `.jpg` `.jpeg` `.webp` `.gif` `.mp4` `.webm`）のファイルだけを `![alt](.takt/artifacts/pr-screenshots/NN-short-slug.ext)` で書く（alt は拡張子を除いたファイル名。create_pr が `--attach` で URL に書き換える）。0件なら「なし（ローカルキャプチャ未配置）」。モック HTML・図解バンドルへのリンクは書かない。スクショを新規に撮らない。
  12. `## PR コメント対応` — 「PR 作成の約5分後に、TAKT がこの PR へコメント（見出し「PR コメント対応の記録（TAKT）」）で記録する。それより後のコメントは最終確認の担当者が扱う。」の1行だけを書く。
  13. `## コミットメッセージ案` — 日本語1行
- 変更ファイルの詳細表は作らない。
- 節の構成を変えるときは、TAKT を通さない PR 用の `.github/pull_request_template.md` も同じ構成に直す。

## plan.md（全文）
{report:plan.md}

## implement-report.md（全文）
{report:implement-report.md}

## fix-result.md（最新・全文）
{report:fix-result.md}

## ai-antipattern-review.md（全文）
{report:ai-antipattern-review.md}

## architecture-review.md（全文）
{report:architecture-review.md}

## readme-sync.md（全文）
{report:readme-sync.md}

## self-review.md（全文）
{report:self-review.md}
