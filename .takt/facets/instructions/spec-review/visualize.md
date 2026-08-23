`.agents/skills/spec-to-html/SKILL.md` を正本として、対象仕様書の図解 HTML を最新化してください。

最初に実行要否を判定する:
1. `git status --porcelain docs/plans/` と `git diff --stat HEAD -- docs/plans/` で、本ランで対象仕様書が変更されたかを確認する。
2. `docs/plans/_html/<slug>/core.yaml` の有無を確認する（`<slug>` は対象仕様書のファイル名から `.md` を除いたもの）。
3. **対象仕様書が未変更、かつ `docs/plans/_html/<slug>.html` が既に存在する**場合は、生成を行わずスキップした旨だけ報告して次に進む。

実行する場合:
- 再構成ビュー（01 ステータス / 02 設計判断 / 03 クイズ）: `core.yaml` が既にあるなら **更新モード**。仕様書の差分に対応する `concepts` / `relations` / `risks` / `questions` だけを直し、id は安定させる。全書き直しはしない。`core.yaml` が無いなら **新規モード**で SKILL.md の手順に従って起案する。
- 全文ビュー（04）: **手で書かず** `python3 scripts/spec-html.py fulltext --spec <対象仕様書> --out docs/plans/_html/<slug>/views/04-fulltext.html` で機械変換する。仕様書が変わっていれば必ず再生成する。
- 結合は必ず `python3 scripts/spec-html.py build` に必須4ビュー（01/02/03/04）と `--source <対象仕様書>` を渡して行う。画面仕様の章があれば `05-screens.html`、UIたたき台CPがあれば `06-ui-mock.html` も `--view` に含め、タブ順は「ステータス→設計判断→画面仕様→UIモック→クイズ→全文」（無い任意ビューは省略）。安全検査で落ちた場合は違反箇所を直して再実行する。
- **`build` の整合性チェック出力を必ず読む。** `[fail]` が出た場合は `core.yaml` の `source_refs` の行番号が仕様書の改訂に追従できていない。`.agents/skills/spec-to-html/maintenance.md` の「更新モードで fail が出たときの手順」に従って該当参照を貼り直し、その参照を根拠にした concept の記述を見直したうえで `build` を再実行し、fail が消えるまで繰り返す（最大3回まで。消えなければ残る fail を報告して次に進む）。
- 生成結果を headless Chrome の `--dump-dom` で確認し、パネル数が渡した `--view` 数、`hidden` が (ビュー数 - 1) であることを検証する。

必須条件:
- 編集対象は `docs/plans/_html/` 配下に限定する。仕様書本文・プロダクションコード・設定ファイルは一切編集しない。
- `docs/plans/_html/` は `.gitignore` 済みのため commit しない。commit は次の finalize の責務。
- 図解生成に失敗しても ABORT しない。レビュー結果の commit を妨げないよう、失敗理由を報告して finalize に進む。
