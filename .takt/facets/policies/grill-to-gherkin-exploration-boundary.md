# Grill-to-Gherkin 探索境界

この workflow の全 step で、次の探索境界を必ず守ってください。

- `.takt/runs/` は TAKT の実行状態であり、要件・実装の根拠ではありません。再帰探索しないでください。
- 現在の run の `workflow-bundle/`、`logs/`、`session-state`、実行中のログは読まないでください。
- `find`、`ls`、`cat`、`jq`、`file` で `.takt/runs/` を探索しないでください。
- 読み取り対象は、各 step で明示された前段レポート、Source Path、要求資料、関連するプロジェクト実装に限定してください。
- Bash で探索せず、必要な読み取りは Read / Glob / Grep を使ってください。
