# GrowMate Repository Guidelines

<language>Japanese</language>

## Core Rules

- **GrowMateはMVP開発を最優先とする。判断に迷った場合はこれを軸の1つにする。** 要件に無い機能を先回りで作らない。とくに安全機構（Kill Switch・feature flag・専用の設定テーブル・監視ダッシュボード・冗長化）は、**要件に明示されている場合のみ**対象とする。チェックリストを満たすことを目的化しない。
  - 外部API・LLMに依存する機能でも、まず「壊れたときユーザーに何が見えるか」を定義するだけで足りないかを問う。既存手段（デプロイ巻き戻し、該当UIの非表示）で足りるなら新規の停止機構を作らない。
  - 作らない判断をしたものは、対象仕様書のNon-goalに理由付きで書く（黙って省略しない）。
- `.env`・secret・credential・tokenは読取・出力しない。破壊的操作は対象を限定する。
- 新規機能は原則として `admin` または `paid` ロールだけに提供する。`trial` と `unavailable` は対象外とし、例外は対象仕様書で明示する。
- 新規機能の認可はUIだけでなく、Server Action・Route Handler・APIなどのサーバー側でも検証する。
- 実装の最小化（YAGNI ラダー）は `.takt/workflows/rules/minimal-impl-ladder.md` に従う。
