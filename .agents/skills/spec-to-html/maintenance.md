# 整合性チェックと自動追従の正本（fail 対処・発火経路）

`spec-to-html` の `build` が出す整合性チェックの読み方と、`refresh` の発火経路。**`fail` / `warn` が出たとき、または追従の仕組みを触るときに読む**。コマンドと運用フローは `SKILL.md` 側。

## 整合性チェックのレベルと対処

| レベル | 何を意味するか | 対処 |
|---|---|---|
| `fail` 参照の指す章が変わった | 行番号が完全にズレて別の章を指している | `core.yaml` の該当 `source_refs` を貼り直す |
| `fail` 章の内容は変わっていないのに参照先本文が変わった | 上流の章で行が増減し、以降が全部ズレた | 同上（まとめて1行に集約される） |
| `fail` 行範囲が原本の範囲外 | 仕様書が短くなった／参照が古い | 同上 |
| `warn` 参照先の章が改訂された | 原本が本当に変わった。ビューの記述が古い可能性 | 該当 concept を更新モードで直す |
| `info` どの `source_ref` でも触れていない章 | 再構成ビューから章が抜けている可能性 | 拾うべき章なら concept を追加。意図的な非対象なら放置してよい |

- **fail が出てもビルドは落ちない。** レビューの commit を妨げないため、自己申告に留める。落ちるのは安全検査（外部依存）だけ。
- 前回生成からの **章の追加 / 削除 / 変更** も同じバーに出る。各章名はジャンプボタンになっていて、クリックすると全文タブの該当章が開く。

## 更新モードで fail が出たときの手順

1. コンソールの fail 行が指す参照 id（`r_xxx`）を控える。
2. 原本の該当章を読み、`core.yaml` の `source_refs` の `lines` を実際の行番号に直す。
3. その参照を根拠にしている concept の記述が古くなっていないかを確認する。
4. `build` を再実行し、fail が消えることを確認する（消えなければ 2 に戻る）。

## refresh の発火経路

全エージェントが `scripts/spec-html-hook.sh` を共有する。payload の形とイベント名の差はスクリプト側で吸収するので、増やすときも呼び出し1行を足すだけでよい。

| 経路 | 定義 | 渡し方 | 拾えるもの |
|---|---|---|---|
| Claude Code の `PostToolUse` フック | `.claude/settings.json` | `tool_input.file_path` の1本 | エージェントによる `Edit` / `Write` |
| Cursor の `afterFileEdit` フック | `.cursor/hooks.json` | top-level `file_path` の1本 | Agent チャットによるファイル編集 |
| Codex の `PostToolUse` フック | `.codex/hooks.json` | `--all`（`apply_patch` は1回で複数ファイルを変更でき payload から絞れない） | `apply_patch` |
| husky `pre-commit` | `.husky/pre-commit` | staged な `docs/plans/*.md` | エディタでの手編集など、上記フックが拾えない経路の取りこぼし |
| 手動 | `npm run spec-html:refresh` | `--all` | 上記のどれも効かない環境（依存未インストールで husky が入っていない等） |

いずれも失敗しても編集・commit を止めない。`refresh` は `spec_hash` が変わっていなければ無言で終わる（no-op）ので、`--all` でも空振りのコストはほぼゼロ。

**結果の差し戻し方だけがエージェントで違う。** Claude Code / Codex は `additionalContext` として整合性チェックの出力をエージェントへ返せるが、Cursor の `afterFileEdit` は fire-and-forget（返せる口が無い）なので `{}` を返し、警告は stderr に出す。**Cursor で仕様書の章を書き換えたときは、再構成ビューの陳腐化警告がエージェントに届かない。** `npm run spec-html:refresh` を手で叩いて出力を読むこと。

`scripts/verify-agent-skills.sh` が3つの設定ファイルすべてについて共通フックを参照しているか検査する。
