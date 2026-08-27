実装・修正・architecture review が収束した時点の全差分を確認し、`README.md` の同期要否を判断してください。本ステップは **reviewers が all(approved) の直後に1回だけ**走る。self_review / self_review_fix ループからは戻ってこない。

{{include:instructions/unattended-operation}}

運用前提（このステップ固有）:
- `.agents/skills/update-docs/SKILL.md` の「更新方針を提案して合意」は、対象仕様書と本 workflow への事前合意で満たされているものとし、LLM が全差分から README 更新要否を判断する。
- 対象仕様書は添付 `plan.md` の `# タスク計画` 直後の `対象仕様書:` 行のパス。その現行ファイルを読む。`docs/plans/` を列挙・推測しない。ヘッダ欠落なら `cannot_judge`。

必須手順:
1. `.agents/skills/update-docs/SKILL.md`（docs 分類と README の役割・手順の正本）、`plan.md` の対象仕様書、`README.md`、`git status`、`git diff --stat`、`git diff` を読む。
2. 実装差分によって README の既存説明（概要・コア機能・主要画面・データ構造・セットアップ・npm scripts・環境変数・認証/ロール/外部連携等）が古くなるか、利用者・開発者・運用者が新たに知るべき恒久的な情報が生じたかを判定する。内部実装だけの変更・一時的な修正内容・レビュー過程は更新不要。
   - 対象仕様書の README 更新予告は候補として扱い、**最終判断は実装差分に基づく**。判断が予告と食い違った場合は理由を `readme-sync.md` に書く。
3. 更新が必要な場合だけ、既存構成と記述粒度に合わせて `README.md` を最小差分で同期する。README を変更すること自体を目的にしない（更新不要判断も正常な完了）。README 以外は編集せず、実装差分にない機能や将来構想・秘密値・自動生成ファイルの複製を書かない。
4. `readme-sync.md` に「更新要 / 更新不要」「判断根拠」「確認した差分」「更新セクション（更新不要ならなし）」を記録する。
5. README だけを変更した場合、直前の `npm run verify` 成功証跡があればフル検証を再実行せず、リンク先の実在と `git diff --check` を確認する。

## plan.md（全文）
{report:plan.md}
