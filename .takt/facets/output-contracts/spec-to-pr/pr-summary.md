<!-- 節の構成を変えるときは .github/pull_request_template.md も同じ構成に直す -->
````markdown
# {日本語・1行・50字以内のPRタイトル。What/Whyが一覧で分かる。禁止: [Auto]、ブランチ名のみ、実装完了/対応完了、英語のみ、conventional commits 接頭辞}

## 概要
{仕様書の「背景・目的」を起点に、何を・なぜ変えたか。2〜4文}

## 最終確認（引き継ぎ用）
確認した項目にチェックを入れ、結果（OK / NG と気づいた点）をこの PR のコメントに残す。
- [ ] {どこで（画面パス・ロール。プレビューは Vercel bot コメントの Preview）・何をして・何が見えれば OK か}
- [ ] {受け入れ検証で 手動確認待ち / 未検証 のシナリオ、UI 変更時の手動ブラウザ確認、pending 型追加時の管理者作業、レポート間の食い違い}
{無ければ「なし（受け入れ検証はすべて自動検証済み）」}

## 全体像
{mermaid 図を必ず1枚と凡例1行。コードの経路が無い docs・設定・開発フローの変更は、変更したファイルを :::changed のノードにし、効く先（工程・機能）へ矢印でつなぐ}
```mermaid
flowchart LR
  n1["{既存の要素名}"] --> n2["{追加・変更した要素名}"]:::changed
  classDef changed stroke:#f08c00,stroke-width:3px
```
太枠（橙）= 本PRで追加・変更

## 関連仕様書
- {`plan.md` の `# タスク計画` 直後の `対象仕様書:` パス。なければ self-review の記載}
- {完全実装なら「本PR完了後 `docs/plans/xxx.md` → `docs/specs/xxx.md` へ移動（create_pr が git mv・参照パス置換・ステータス `implemented` 更新まで実施）」。部分実装なら「`docs/plans/` に残置（未実装: ○○）」}

## 変更要点
- {カテゴリ単位で3〜7点。ファイル一覧の羅列は禁止}

## 実装中の判断
- {仕様書に無く実装中に決めたこと: 選んだ案と理由。無ければ「なし」}

## 受け入れ検証
| シナリオ | 検証手段 | 結果 |
| --- | --- | --- |
| {仕様書の Gherkin シナリオ名} | {テストのパスと名前 / npm run verify / 手動} | {自動検証済み / 手動確認待ち / 未検証} |

## レビュー結果
- ai-antipattern: {approved / open findings 数}
- architecture-review: {approved / open findings 数}
- self-review: {pass / needs_fix / cannot_verify と要点}

## 完了判断
- 事実: {verify 成功、open findings 0、仕様要件充足など確認済み事項}
- 判断: {事実に基づく完了判断。未確認を完了扱いにしない}

## 検証
- `npm run verify`: {結果}
- その他: {あれば。手動ブラウザ確認は無人のため未実施が既定}

## 画面キャプチャ
{`plan.md` の `UIモック:` が `対象外` なら「対象外」。UI 対象なら `.takt/artifacts/pr-screenshots/` の許可拡張子ファイルを `![alt](.takt/artifacts/pr-screenshots/NN-short-slug.ext)` で列挙。0件なら「なし（ローカルキャプチャ未配置）」。モック HTML・図解は禁止}

## PR コメント対応
PR 作成の約5分後に、TAKT がこの PR へコメント（見出し「PR コメント対応の記録（TAKT）」）で記録する。それより後のコメントは最終確認の担当者が扱う。

## コミットメッセージ案
{日本語1行}
````
