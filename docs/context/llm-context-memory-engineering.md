# LLM コンテキスト / メモリ設計原則

本ドキュメントは、GrowMate で LLM を使う機能を設計・実装するときの共通方針を定義する。

対象は、チャット生成、Canvas 編集、Google Ads / GSC 分析、RAG、外部ドキュメント連携、将来のエージェント型機能を含む。

## 前提

LLM はリクエスト間の状態を保持しない。ユーザーに「覚えている」ように見える情報は、アプリケーション側が保持し、次の LLM 呼び出しへ渡している。

したがって、LLM 機能では以下を実装側が明示的に設計する。

- 何をコンテキストとして渡すか
- 何を渡さないか
- どの順序・区切り・役割で渡すか
- どこまで長くなったら削るか
- 何を長期記憶として保存してよいか
- 誰がその記憶を書き込めるか

プロンプト本文だけを調整しても、コンテキストやメモリの設計が曖昧な場合、出力品質・コスト・セキュリティ・運用品質は安定しない。

## 用語

| 用語 | GrowMate での意味 |
|------|-------------------|
| Prompt Engineering | 1 回の指示文・テンプレート本文の書き方 |
| Context Engineering | 1 回の LLM 呼び出しへ渡す入力全体の組み立て方 |
| Memory Engineering | セッションを跨いで保持する情報の書き込み・保持・取得・削除の設計 |
| Harness Engineering | LLM の周辺処理全体。ツール、状態管理、権限、リトライ、ログ、評価など |

## Context Engineering

Context Engineering では、LLM に渡す入力を「system prompt」だけでなく、会話履歴、ユーザー入力、外部データ、ツール定義、ツール結果、保存済み知識を含めて設計する。

新しい LLM 経路を追加するときは、先に Context Assembly Contract を作る。

### Context Assembly Contract

各 LLM 呼び出し経路は、最低限以下を明示する。

| 項目 | 記載内容 |
|------|----------|
| 経路 | 例: chat stream、Canvas 編集、Google Ads 分析 |
| 目的 | この呼び出しで LLM に判断・生成させること |
| 入力要素 | system、template、user message、history、external data、tool definitions、tool results |
| 注入条件 | ロール、model key、feature flag、画面状態など |
| 上限 | token / 文字数 / 件数 / データ期間 |
| 削減順序 | 何から削るか。原則として正本テンプレートより補助情報を先に削る |
| 禁止情報 | 混ぜてはいけない情報、保存してはいけない情報 |
| ログ方針 | 全文ログ可否、要約ログ、メトリクスのみ等 |

### 推奨構成

LLM 入力は、役割と由来が混ざらないように分ける。

| 要素 | 例 | 方針 |
|------|----|------|
| System / Policy | 役割、制約、出力形式 | 最上位の固定指示。動的データを混ぜすぎない |
| Knowledge | 管理者指定 Doc、社内ナレッジ | 書き込み主体・更新経路を明確にする |
| Template | `prompt_templates` | 制作物の型。原則 trim しない |
| User Facts | 事業者情報、サービス情報 | ユーザー固有の事実。Knowledge と混ぜない |
| Episodic Context | 会話履歴、セッション要約 | 必要な範囲だけ渡す。古い履歴は要約または除外 |
| Tool Context | tool 定義、tool 結果 | 必要な経路だけに渡す。raw 大量投入は禁止 |
| User Request | 今回の入力 | 最後に明確に渡す |

## Context Fail 対策

LLM の入力が大きくなるほど、以下の失敗が起きやすい。

| 失敗パターン | 意味 | GrowMate での対策 |
|--------------|------|-------------------|
| Context Clash | 矛盾する指示・知識が同時に入る | 情報の由来を分け、優先順位を明記する |
| Context Pollution | 古い・誤った・不要な情報が残る | 保存対象を限定し、古い履歴や不要な tool 結果を削る |
| Context Distraction | ノイズが多く本題が薄れる | allowlist、token budget、要約、取得件数制限を使う |
| Context Confusion | 境界が曖昧でモデルが混同する | block 名、見出し、区切り、role を明確にする |
| Context Poisoning | ユーザー入力や LLM 出力が正本メモリに混入する | Memory Write Policy を守る |

## Memory Engineering

Memory Engineering では、保存する情報を種類ごとに分ける。すべてを「メモリ」と呼ぶと、管理者の正本知識、ユーザー固有情報、会話履歴、プロンプト手順が混線する。

### Memory Taxonomy

| 種類 | GrowMate での例 | 書き込み主体 | 注入方法 |
|------|-----------------|--------------|----------|
| Semantic Memory | 管理者指定ナレッジ、業務知識、カオルさん Doc | 管理者または明示承認済み処理 | Knowledge block / RAG |
| Procedural Memory | `prompt_templates`、出力形式、生成手順 | 管理者 | Template / system |
| Episodic Memory | chat history、session summary、操作履歴 | ユーザー行動・会話 | recent messages / summary |
| User Fact Memory | business info、service、persona | ユーザー登録情報 | template variables |
| Operational Memory | 同期状態、last_fetched_at、last_fetch_error | システム | UI 表示・制御。原則 LLM には必要時のみ |

### Memory Operations

Memory Engineering では、情報の種類だけでなく、保持した情報に対してどの操作を許可するかも定義する。

| 操作 | 意味 | GrowMate での例 |
|------|------|-----------------|
| Compaction | 長くなった情報を要約・圧縮する | chat history summary / L1 summary |
| Retrieval | 必要な記憶を取り出す | RAG / Doc セクション検索 |
| Write / Consolidation | 新しい情報を保存・統合する | admin 承認済み knowledge update |
| Forgetting / Decay | 古い・誤った情報を削除、または優先度を下げる | stale memory cleanup / 無効化 |

### Memory Write Policy

長期記憶へ保存する経路は、必ず書き込み主体と承認条件を定義する。

| ルール | 方針 |
|--------|------|
| 自動正本化禁止 | ユーザー入力、LLM 応答、Web 検索結果を正本ナレッジへ自動保存しない |
| 管理者正本 | 管理者指定ナレッジは、管理者操作または承認済みの取得経路だけで更新する |
| LLM 要約の扱い | LLM が作った要約を正本にする場合は、管理者承認または明示的なレビューを必須にする |
| 書き込みログ | いつ、誰が、どの経路で、何を更新したかを追跡できるようにする |
| 失敗時 | 更新失敗時に既存の正本を消さない。stale content を使う場合は UI に明示する |
| 削除 | 誤った記憶を消せる運用導線を用意する |

## Token / Context Budget

Prompt cache はコスト・速度の最適化であり、コンテキスト量そのものを減らす仕組みではない。cache される情報も、モデルに渡す入力として設計する必要がある。

LLM 呼び出し前には、可能な範囲で総入力サイズを見積もる。

見積もり対象には以下を含める。

- system / knowledge / template
- user message
- recent messages
- summary
- tool definitions
- tool results
- Canvas body や分析対象データ

総入力が閾値を超える場合は、原則として次の順に削減する。

1. 補助的な外部知識の注入量を減らす
2. tool results や検索結果を要約・件数制限する
3. 古い会話履歴を要約・除外する
4. それでも超過する場合は LLM 呼び出しを止め、ユーザーに短縮が必要なことを明示する

正本テンプレートや必須のユーザー入力を黙って削ることは禁止する。

## Progressive Disclosure

必要な情報だけを段階的に渡す設計は有効だが、要件によっては「毎回必ず注入する」ことが正しい場合もある。

採用判断は以下で分ける。

| 方針 | 使う場面 |
|------|----------|
| 毎回注入 | クライアント合意上、常に前提にすべき思想・制約・正本知識 |
| 要約注入 | 長文だが、全体の方向性を常に効かせたい知識 |
| Retrieval / RAG | 大量文書から関連箇所だけが必要な場合 |
| JIT Tool | モデルが必要時に外部情報を読む設計が合意されている場合 |

毎回注入から JIT / RAG へ変更すると、出力の前提が変わる可能性がある。ユーザー運用に影響する場合は、事前合意を必須とする。

## Security / Privacy

LLM に渡す情報と保存する情報は、セキュリティ境界を分けて考える。

- `.env`、secret、token、credential は LLM に渡さない
- 個人情報や顧客固有情報は、必要経路だけに限定する
- 管理者正本ナレッジとユーザー固有情報を同じ保存領域に混ぜない
- デバッグログに LLM 入力全文を常時出さない
- ロール・allowlist・feature flag による注入制御を LLM 呼び出し直前で確認する

## 実装前チェックリスト

LLM 機能を追加・変更するときは、以下を確認する。

- [ ] Context Assembly Contract を書いた
- [ ] 入力要素の由来と優先順位を分けた
- [ ] token / 件数 / 期間などの上限を決めた
- [ ] 超過時に何を削るかを決めた
- [ ] LLM 呼び出しを止める条件を決めた
- [ ] 長期記憶へ書く情報と書かない情報を分けた
- [ ] ユーザー入力・LLM 出力を正本メモリへ自動保存していない
- [ ] ロール・allowlist・feature flag の注入条件を明示した
- [ ] デバッグログに機密情報や全文コンテキストを常時出さない
- [ ] 既存の `docs/context/client-vision-from-lark.md` と矛盾しない

## 参考

- [記憶を持たないLLMの記憶 - コンテキスト/メモリー/ハーネスエンジニアリング入門の前に](https://qiita.com/yuji-arakawa/items/da4d5eec968b92ebc26d)
