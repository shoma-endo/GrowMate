# GrowMate Pro 哲学プロファイル機能 実装仕様書

対象：実装担当エンジニア
関連：`growmate_philosophy_interview_v2.md`（質問・選択肢・重みの定義。本書から参照する）

---

## 1. 目的とスコープ

ユーザーごとに「哲学プロファイル」を生成・保持し、ブログ/LP/広告文の各生成APIコールに注入することで、出力を本人らしくする。
プロファイルは初回インタビューで生成し、その後の修正アクションを蓄積して継続更新する。

**スコープ内**：オンボーディング、プロファイル生成、修正ログ収集、プロファイル更新、生成時の注入、追い質問。
**スコープ外**：モデルのファインチューニング（§9で理由を明記）。

---

## 2. 設計の前提（重要）

- **LLM（API）はリクエストごとに状態を持たない。** 学習・記憶は発生しない。「記憶しているように見える」状態は、外部に保存したプロファイルを毎回のリクエストに注入することで実現する。
- したがって本機能の本体は「**記憶レイヤー（保存＋注入）**」であり、AIに学習させる仕組みではない。
- プロファイルは**ホット層／コールド層の2層**で持つ（§6）。

---

## 3. システム全体フロー

```
[初回] オンボーディング10問
          │ 選択 → 重み合算
          ▼
   哲学プロファイル生成（confidence: low）──────┐
          │                                      │ ホット層に保存
          ▼                                      ▼
[通常利用] 生成リクエスト ──→ プロファイルを注入 ──→ LLM API ──→ 出力
                                                          │
                                          ユーザーが出力を修正
                                                          ▼
                                          修正ログを記録（コールド層）
                                                          │ 意味ある修正が閾値到達
                                                          ▼
                                          プロファイル再生成（本人合意の上で反映）
                                                          │ confidence 引き上げ
                                                          ▼
                                          （必要時）追い質問でlow項目を補完
```

---

## 4. データモデル

DB種別非依存。フィールドのみ定義。

### 4.1 question_definition（外部設定・全ユーザー共通）
質問・選択肢・重みは**コードに埋めず外部設定として持つ**。重み調整でデプロイを不要にするため。

```json
{
  "question_id": "Q3_v1",          // 必ずバージョン付き。後から振れないので初動で必須
  "axis": "core_values",            // 哲学軸の分類
  "multi_select": true,
  "skippable": false,
  "options": [
    {
      "option_id": "Q3_v1_opt1",
      "label": "安売り・値下げ競争はしない",
      "weights": { "analytical": 1, "structural": 0, "social": 0, "conceptual": 1 }
    }
  ]
}
```

### 4.2 weight_config / trigger_config（外部設定）
スコアリングとトリガーの閾値。すべて外部設定。実データを見て運用で調整する。

```json
{
  "trigger_config": {
    "meaningful_edit_threshold": 10,
    "edit_interval": 10,
    "require_low_confidence": true,
    "meaningful_edit_types": ["claim_change", "tone_change", "full_reject"],
    "noise_edit_types": ["typo", "minor_wording"]
  }
}
```

### 4.3 philosophy_profile（ユーザーごと・ホット層）
畳み込んだ結論。**生成時に毎回これを注入する。**

```json
{
  "user_id": "...",
  "profile_version": "v2_initial",
  "thinking_type": {
    "scores": { "analytical": 0.34, "structural": 0.12, "social": 0.10, "conceptual": 0.44 },
    "dominant": ["conceptual", "analytical"],
    "deficit": "social"
  },
  "core_values": [
    { "value": "手段の目的化を嫌う", "source": ["Q3_v1", "Q4_v1"], "confidence": "high" }
  ],
  "enemies": [ { "target": "見せかけの成果だけ追う", "source": ["Q4_v1"], "confidence": "high" } ],
  "tradeoff_tendencies": [ { "axis": "質 > 規模", "source": ["Q2_v1"], "confidence": "medium" } ],
  "voice_fingerprint": { "recurring_phrases": ["..."], "tone": "断定的・大局志向", "source": ["Q5_v1","Q7_v1","Q10_v1"] },
  "ideal_persona": { "for": "...", "source": ["Q1_v1","Q8_v1"] },
  "overall_confidence": "low",
  "last_regenerated_at": "ISO8601",
  "edits_since_last_regen": 0
}
```

### 4.4 edit_log（ユーザーごと・コールド層・追記のみ）
生の修正データ。**保存するが注入はしない。** 再生成時の入力になる。

```json
{
  "edit_id": "...",
  "user_id": "...",
  "created_at": "ISO8601",
  "generation_type": "blog | lp | ad",
  "edit_type": "claim_change | tone_change | full_reject | typo | minor_wording",
  "is_meaningful": true,            // §7の分類結果
  "before": "修正前テキスト（差分でも可）",
  "after": "修正後テキスト",
  "consumed_by_regen": false        // 再生成で消費済みか
}
```

---

## 5. フェーズ1：初回オンボーディング

### 5.1 フロー
1. 10問を**1問ずつ**提示（`question_definition` から動的に描画）。
2. Q1は商品名記入＋選択。Q2〜Q10は複数選択（最低1つ必須）。Q5の自由記述のみスキップ可。
3. 全回答の `weights` を色ごとに合算 → `各色 ÷ 全選択数` で正規化 → `thinking_type.scores`。
4. 最下位の色を `deficit` に設定。
5. 哲学軸を§5.2のクロスチェックで確定。
6. `profile_version: "v2_initial"`、`overall_confidence: "low"` で保存。

### 5.2 クロスチェック（哲学軸の確信度判定）
- **Q3とQ4が同一色に収束** → 該当テーマを `core_values` に `confidence: "high"` で昇格。
- **Q6とQ9が一致** → `core_values` に確定。
- **1問のみ由来** → `confidence: "low"` で保留（後の追い質問の対象）。

### 5.3 語り口の採取
Q5の自由記述が入力された場合のみ、LLMで語彙・トーンを抽出し `voice_fingerprint` に格納。未入力ならスキップ（必須化しない）。

---

## 6. フェーズ2：通常利用時の注入

### 6.1 2層モデル
| 層 | 中身 | 注入 |
|---|---|---|
| ホット | philosophy_profile（圧縮済みの結論） | **毎回注入** |
| コールド | edit_log（生ログ） | 注入しない |

### 6.2 注入の擬似コード
```
function generate(user_id, generation_type, user_input):
    profile = loadProfile(user_id)                      // ホット層
    system_prompt = buildSystemPrompt(profile, generation_type)
    response = callLLM(system_prompt, user_input)       // APIは毎回まっさら
    return response
```

### 6.3 注入内容の絞り込み（トークン対策）
profile全文ではなく、generation_type に関係する部分のみ注入する。
- 全タイプ共通：`core_values`, `voice_fingerprint`, `thinking_type.dominant/deficit`
- 広告/LP：`enemies`, `ideal_persona` を追加
- ブログ：`tradeoff_tendencies` を追加

> 注入強度（哲学の濃さ）は generation_type ごとに調整可能にする。全開固定にすると全出力が説教臭くなるため。

---

## 7. フェーズ3：修正ログの収集と分類

### 7.1 収集
ユーザーが生成結果を編集・却下するたびに `edit_log` へ1件追記。

### 7.2 意味あり/ノイズ分類（is_meaningful の判定）
誤字修正などのノイズを哲学データに混ぜないため分類する。判定は以下のいずれか（実装はどちらでも可、推奨は併用）：
- **操作種別ベース**（軽量・推奨初手）：UI上の操作（全文却下ボタン＝full_reject、トーン切替＝tone_change 等）から直接 edit_type を決める。
- **差分ベース**：before/after をLLMに渡し edit_type を分類。精度は高いがコスト増。

`meaningful_edit_types` に該当するものだけ `is_meaningful: true`。`noise_edit_types` はカウントから除外。

---

## 8. フェーズ4：プロファイル更新

### 8.1 再生成トリガー（AND条件・すべて trigger_config 参照）
```
( is_meaningful な edit の累計 >= meaningful_edit_threshold )
AND ( 前回再生成からの is_meaningful な edit >= edit_interval )
AND ( require_low_confidence == false  OR  profileに confidence:low の項目が存在 )
```

### 8.2 再生成処理（コールド→ホットへの畳み込み）
1. 未消費（`consumed_by_regen: false`）の意味ある edit_log を集約。
2. 現プロファイル＋集約した修正傾向をLLMに渡し、更新案を生成。
3. **自動では反映しない。** ユーザーに「N件の傾向からプロファイルを見直しました。反映しますか?」と提示。
4. 承認時のみ profile を更新。`edits_since_last_regen` リセット、対象 edit を `consumed_by_regen: true` に。
5. 確信度が裏付けられた項目は `low → medium → high` へ引き上げ。

### 8.3 鉄則（必ず守る）
- **本人合意なしにプロファイルを書き換えない。** 裏で勝手に変わると「言うことが違う」と不信を招く。
- **重み（weight_config）を変えても、既存ユーザーのプロファイルは再計算しない（凍結がデフォルト）。** 全員へ新基準を当てるのは「再キャリブレーション」明示実行時のみ。
- 質問・選択肢の変更は**新バージョンID**で追加。旧IDの過去回答はそのまま共存させる。

---

## 9. フェーズ5：追い質問（プロファイルの継続深化）

### 9.1 トリガー
§8.1と同じく**修正数ベース**（経過日数では発火させない＝放置ユーザーへの誤発火防止）。
`confidence: low` の項目が残っている場合に、その項目のソース軸を埋める質問を**単発で1問だけ**提示。

### 9.2 設計
- 「最近の修正を見ていて、1つ確認したいことが」という文脈で出す（修正ログが溜まっている前提だから成立する）。
- 初回オンボーディングには質問を追加しない（離脱増）。深掘りは常に追い質問で行う。
- 追い質問も `question_definition` に格納し、新バージョンIDで管理。

---

## 10. Layer 3：不足軸レンズによる新哲学提案

`thinking_type.deficit` に対応する固定レンズで、**既存の強みを弱い軸から照射した提案**を生成する。

| deficit | レンズ（提案テンプレの方向性） |
|---|---|
| analytical | 効果を数値で確かめ、力を入れる場所を絞る |
| structural | 成功を仕組み化し、再現できるようにする |
| social | 正しさを相手の感情に通して届ける |
| conceptual | 積み上げを一段上で言語化し、軸を固める |

### 鉄則
- **強みを否定しない。** 提案は常に「既存の強み × 弱いレンズ」の増幅形のみ。「弱点を埋めるために強みを捨てろ」は生成禁止。
- 提案は確定ではなく**仮説**。ユーザーが採用／棄却／修正を選ぶ。棄却された提案傾向は edit_log と同様に学習材料にする。

---

## 11. 推奨APIエンドポイント

| メソッド | パス | 役割 |
|---|---|---|
| GET | /onboarding/questions | question_definition を返す |
| POST | /onboarding/answers | 回答受領→スコア合算→プロファイル生成 |
| POST | /generate | プロファイル注入込みで生成（§6.2） |
| POST | /edits | 修正ログ追記＋分類（§7） |
| POST | /profile/regenerate | 再生成案を作り提示（§8.2、承認待ち） |
| POST | /profile/confirm | 承認→反映 |
| GET | /followup/next | 発火条件を満たせば追い質問を1問返す |

---

## 12. やらないこと（明示）

- **ファインチューニングはしない。** ユーザーごとのモデル生成は100社上限でも運用破綻し、更新の即時反映もできない。注入方式ならプロファイル差し替えで即時切替が可能。
- **プロファイルの自動・無断書き換えをしない**（§8.3）。
- **「エマジェネティクス」を診断名としてUIに表示しない**（商標）。内部の色分類は `analytical/structural/social/conceptual` を使用。

---

## 13. 初動で必ず入れる（後から付けられないもの）

1. **質問・選択肢のバージョン付きID**（`Q3_v1` 形式）。後から遡って振れない。
2. **重み・閾値の外部設定化**（weight_config / trigger_config）。コード埋め込み禁止。
3. **edit_log への is_meaningful 分類フラグ**。最初から記録しないと過去分を救えない。

この3つだけは初回実装に含めること。残りは段階的に追加できる。
