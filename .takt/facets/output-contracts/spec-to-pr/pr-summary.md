```markdown
# {日本語・1行・50字以内のPRタイトル。What/Whyが一覧で分かる。禁止: [Auto]、ブランチ名のみ、実装完了/対応完了、英語のみ、conventional commits 接頭辞}

## 概要
{仕様起点で何を・なぜ変えたか。2〜4文}

## 関連仕様書
- {`plan.md` の `# タスク計画` 直後の `対象仕様書:` パス。なければ self-review の記載}
- {完全実装なら「本PR完了後 `docs/plans/xxx.md` → `docs/specs/xxx.md` へ移動」。部分実装なら「`docs/plans/` に残置（未実装: ○○）」}

## 変更要点
- {カテゴリ単位で3〜7点。ファイル一覧の羅列は禁止}

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

## 未確認事項
- {UI変更時は「手動ブラウザ確認未実施」を含める}
- {`database.types.pending.ts` 追加時は管理者によるマイグレーション適用・`npm run supabase:types`・pending削除を含める}
- {添付レポート間の食い違いがあれば含める}
- {なければ「なし」}

## コミットメッセージ案
{日本語1行}
```
