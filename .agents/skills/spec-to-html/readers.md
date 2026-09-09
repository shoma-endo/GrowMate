# 読者カタログ（view.yaml のプロファイル）

`core.yaml`（意味）は読者に依存しない。`view.yaml`（見せ方）だけが依存する。
**読者を変えるときに書き換えるのは `view.yaml` だけ**で、`core.yaml` には触らない。
`spec-to-html` の手順3で読む。「ビューを増やす」タブの「読者を変えたビューを足す」
プロンプトからも参照される。

既定は R1。R2 / R3 は必要になったときだけ作る（全仕様書に3枚作らない）。

## R1 開発者本人 — 数週間ぶりの復帰（既定）

| | |
|---|---|
| 何を判断するか | 今どこまで実装されていて、次に何に着手するか。着手前に踏む地雷は何か |
| `audience` | `role: developer` / `familiarity: high`（この仕様を自分で書いた） |
| `emphasize` | `implementation_status` / `next_actions` / `risks` / `decision_rationale` / `dependencies` / `reading_order` |
| `de_emphasize` | `sql_ddl_verbatim` / `prompt_body_verbatim`（全文タブにあるので再構成ビューでは要らない） |
| `density` | high。専門語をそのまま使ってよい |
| `tone` | 事実ベース。前置きを書かない |
| 初期タブ | ステータスと次の一手（01） |

**この読者にだけ効く仕掛け**: 「要注意」ブロック（確認質問・未決定事項・リスク・着手前ゲート）を
01 の先頭に集約し、決着済みのパネルは畳む。本人は正常系をもう知っている。

## R2 PO・クライアント — たたき台の合意

| | |
|---|---|
| 何を判断するか | この画面・この文言で進めてよいか。何が決まっていなくて自分の返事待ちか |
| `audience` | `role: product_owner` / `familiarity: low`（実装を知らない。ドメインは知っている） |
| `emphasize` | `screen_behavior` / `user_visible_changes` / `open_questions` / `decision_points` / `schedule_impact` |
| `de_emphasize` | `implementation_detail` / `sql_ddl_verbatim` / `prompt_body_verbatim` / `dependencies`（内部依存は判断材料にならない） |
| `density` | low。ドメイン語は使ってよいが実装語（テーブル名・関数名・型）は出さない |
| `tone` | 平叙。「〜という理由でこうしたい、これでよいか」の形 |
| 初期タブ | UIモック（06）があればそれ、無ければ画面仕様（05） |

**`06-ui-mock.html` はこの読者のためのビュー。** 仕様書に「UIたたき台／CP」がある場合、
`view.yaml` を R1 のままにするとモックの周りに開発者向けの文脈が混ざる。
**モックを作る仕様書では R2 のプロファイルを別に持つ**か、少なくとも 06 の中では
R2 の `de_emphasize` に従う（PO確認項目 Q をタブ先頭に置く、が最低限）。

**この読者にだけ効く仕掛け**: 未決定事項を「あなたの返事待ち」として名指しで先頭に置く。
R1 の「要注意」と違い、リスクではなく**決めてほしいこと**を集約する。

## R3 引き継ぎ先 — 新しく入る開発者

| | |
|---|---|
| 何を判断するか | この仕様を触る前に何を知っておく必要があるか。どこから読むか。誰に聞くか |
| `audience` | `role: developer` / `familiarity: none`（コードもドメインも初見） |
| `emphasize` | `prerequisites` / `reading_order` / `risks` / `glossary` / `decision_rationale` / `open_questions` |
| `de_emphasize` | `next_actions`（引き継ぎ直後は着手しない）/ `implementation_status` の細部 |
| `density` | medium。ドメイン語には初出で1行の説明を付ける |
| `tone` | 説明的。「なぜそうなっているか」を省略しない |
| 初期タブ | 引き継ぎ（「ビューを増やす」の引き継ぎカードで作る） |

**この読者にだけ効く仕掛け**: 不採用案とトレードオフ（02）を厚くする。
引き継ぎ先が最初にやる事故は「なぜこうなっていないのか分からず作り直す」なので、
R1 なら畳んでよい決着済みの判断も、R3 では開いたまま出す。

## 差し替え手順

1. `docs/plans/_html/<slug>/view.yaml` の `audience` / `emphasize` / `de_emphasize` /
   `density` / `tone` を上の表で置き換える。`core.yaml` は触らない。
2. 対象の再構成ビューを書き直す（`authoring-views.md` の設計原則は読者によらず共通）。
3. `add-view` で足す。既存のビューは消さない ── R1 のビューと R2 のビューは同じ図解の
   別タブとして共存させる（読者ごとにファイルを分けると、どちらが最新か分からなくなる）。

```bash
python3 scripts/spec-html.py add-view \
  --spec docs/plans/<slug>.md \
  --view "PO向け=docs/plans/_html/<slug>/views/07-po.html"
```

## やらないこと

- **読者を増やすために `core.yaml` を書き換えない。** 読者ごとに事実が変わるなら、
  それは `core.yaml` の書き方が既に R1 に寄っている（＝意味と見せ方が混ざっている）。
- 全仕様書に3読者ぶんのビューを作らない。R2 は UIたたき台がある仕様書、R3 は実際に
  引き継ぐときだけ。使われないタブは認知負荷でしかない。
