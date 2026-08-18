下記に全文添付された `self-review.md` の未解決指摘を一次情報として修正してください。architecture review は収束済みのため、同じ確認を繰り返さないでください。

必須条件:
- 修正着手前に対象仕様書の現行版を確認し、指摘の範囲を超える仕様変更がないか確認する。
- self-review.md の該当項目を優先して修正する。
- 修正対象が git hygiene / 不要ファイル混入 / レポート不足 / 検証証跡不足だけの場合は、その対象だけを直す。
- 簡易・形式的・低価値なユニットテストは追加しない。テスト追加は対象仕様書またはユーザー指示で明示されている場合に限る。
- 同種の潜在箇所がある場合は同時に修正する。
- プロダクションコードを変更した場合は `npm run verify` を再実行する。
- ここでは commit / push を行わない。最終ステップでまとめて実施する。

## self-review.md（全文）
{report:self-review.md}

## architecture-review.md（全文・参考。APPROVE 済みの前提を崩さない）
{report:architecture-review.md}
