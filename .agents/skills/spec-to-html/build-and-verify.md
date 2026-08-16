# 全文生成・結合・動作確認の正本（手順6〜8）

`spec-to-html` の手順6〜8（`core.yaml` と再構成ビューを書き終えた後）で読む。core.yaml・ビューの書き方は `SKILL.md` と `authoring-views.md` 側。

## 6. 全文ビューを生成する

```bash
python3 scripts/spec-html.py fulltext \
  --spec docs/plans/<slug>.md \
  --out docs/plans/_html/<slug>/views/04-fulltext.html
```

原本 Markdown を機械変換する。目次（クリックで該当セクションを展開してスクロール）、セクション単位の折りたたみ、「すべて開く / 閉じる」が付く。DDL・プロンプト本文・表・入れ子フェンス（```` で ``` を包む形）はすべて逐語で保持される。

- **原本は一切変更しない。** 正本は常に `docs/plans/<slug>.md`。
- 目次のジャンプは `href="#..."` ではなくスクロールで行う。`location.hash` はテーマ状態（`#theme=dark`）に使っているため。
- 原本に含まれる URL は **スキームを除いた平文**になる（オフライン自己完結の制約）。この旨はビュー冒頭に明記される。

## 7. 結合して安全検査する

```bash
python3 scripts/spec-html.py build \
  --out docs/plans/_html/<slug>.html \
  --title "<仕様書名> — 図解" \
  --source docs/plans/<slug>.md \
  --view "ステータスと次の一手=docs/plans/_html/<slug>/views/01-status.html" \
  --view "設計判断=docs/plans/_html/<slug>/views/02-decisions.html" \
  --view "クイズ=docs/plans/_html/<slug>/views/03-quiz.html" \
  --view "全文=docs/plans/_html/<slug>/views/04-fulltext.html"
```

`build` は結合後に安全検査を自動実行し、違反があれば **exit 1** で落ちる。検査だけしたいときは `python3 scripts/spec-html.py check <path>`。

`--source` を渡すと**整合性チェックと前回比 diff**（`SKILL.md` 参照）も走る（省略すると `core.yaml` の参照突合が行われず、ズレを検知できない。必ず渡すこと）。こちらは fail が出ても exit 1 にはならないので、**コンソール出力を必ず読む**。

スクリプトがやること: 各ビューの `<style>` を連結、`<body>` を `.panel` として並べ、`<script>` の `document.querySelector` 系を自パネルのルートに差し替える（ビュー間で DOM 探索が衝突しないようにするため）。タブバーとテーマトグルはスクリプトが付与する。**ビューの中身は書き換えない。**

安全検査は2段構え。マークアップとして書かれた時点で外部依存になるもの（外部スクリプト / 外部CSS / iframe / `http(s)://` 等）は**文書全体**、JS API（`localStorage` / `fetch` 等）は **`<script>` 本文と `on*` 属性だけ**を見る。全文ビューは仕様書の地の文に「localStorage に保持する」のような記述をそのまま含むが、テキストノードは何も実行しないため検査対象外。

## 8. 動作を確認する

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --virtual-time-budget=3000 --dump-dom "file://$PWD/docs/plans/_html/<slug>.html" | \
  grep -c 'class="panel"'
```

`<html data-theme=...>` が付いていれば JS が動いている。パネル数がビュー数と一致し、`hidden` が (ビュー数 - 1) 個あればタブ制御も動いている。

`data-goto` を書いたら、**参照先 ID が実在するか**も確認する（存在しなくてもエラーは出ない）:

```bash
python3 - <<'PY'
import re; from pathlib import Path
t = Path("docs/plans/_html/<slug>.html").read_text()
ids = set(re.findall(r'id="(ft-[\w-]+)"', t))
print("dangling:", sorted({g for g in re.findall(r'data-goto="([^"]+)"', t) if g not in ids}))
PY
```

## 更新モードで fail が出たとき

`maintenance.md` の「更新モードで fail が出たときの手順」に従って `source_refs` を貼り直し、fail が消えるまで `build` を再実行する。
