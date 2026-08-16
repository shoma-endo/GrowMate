# 外部サービス連携のレビュー観点（一次情報検証・連携ライフサイクル）

外部サービス（Google / WordPress / Instagram(Meta) / Supabase 等）に依存する仕様書に、`SKILL.md` の共通観点 A〜D へ **追加で** 適用する。「公式仕様と合っているか（一次情報検証）」と「切れたときどうなるか（連携ライフサイクル）」の2本立て。重大度の定義は `SKILL.md` の「重大度」表が正本。

## 一次情報検証

外部サービスの仕様は変わる。記憶・過去の実装・ブログ記事・要約サイトを根拠にした記述は信用しない。**一次情報は公式ドキュメントのページ本文のみ**とし、レビュー時に WebFetch で取得して照合する。

### 公式ドキュメントの起点

| サービス | 起点 URL |
| --- | --- |
| Google Search Console API | [https://developers.google.com/webmaster-tools](https://developers.google.com/webmaster-tools) |
| Google Analytics Data API (GA4) | [https://developers.google.com/analytics/devguides/reporting/data/v1](https://developers.google.com/analytics/devguides/reporting/data/v1) |
| Google Ads API | [https://developers.google.com/google-ads/api/docs/start](https://developers.google.com/google-ads/api/docs/start) |
| Google OAuth 2.0 | [https://developers.google.com/identity/protocols/oauth2](https://developers.google.com/identity/protocols/oauth2) |
| WordPress REST API | [https://developer.wordpress.org/rest-api/](https://developer.wordpress.org/rest-api/) |
| Instagram Platform (Meta Graph API) | [https://developers.facebook.com/docs/instagram-platform](https://developers.facebook.com/docs/instagram-platform) |
| Supabase | [https://supabase.com/docs](https://supabase.com/docs) |

起点 URL が 404・リダイレクトになっている場合は各サービスの公式トップから辿り直す。表にないサービスは公式ドメインのドキュメントを探す。**この表自体が古い / 足りない場合は、本ファイルの更新を別途提案する**（仕様書への指摘ではないため重大度は付けない）。

### 検証必須項目

仕様書が外部 API の挙動を前提にしている箇所について、以下を公式ページで確認する。

- [ ] エンドポイント・メソッド・API バージョンが実在し、仕様書の記述と一致するか
- [ ] 必須パラメータ・レスポンスフィールド名が公式の定義どおりか（フィールド名の綴り・型・省略可否）
- [ ] 必要な権限スコープ / パーミッション（OAuth scope、Meta の permission、WordPress のユーザー権限等）が仕様書に列挙されているか
- [ ] レート制限・クォータ・データ取得上限が明記され、仕様書の取得量・実行頻度と矛盾しないか
- [ ] 非推奨（deprecated）・提供終了予定・移行先の告知が出ていないか
- [ ] 前提条件（例: アカウント種別、事前審査、連携済みであること）が公式に明記され、仕様書がそれを満たす前提になっているか
- [ ] データ反映遅延・集計仕様（例: 指標の確定タイミング）が公式に定義されている場合、仕様書の期待値と一致するか

### 引用規約

公式ドキュメントを根拠に仕様書を書く・直す場合は、必ず次を残す。

- 参照 URL（トップではなく該当ページ）
- 確認日（YYYY-MM-DD）
- **原文の verbatim 引用**。要約サイト・記事・過去の会話の要約を経由した引用は禁止。公式ページ本文を実際に取得し、そこにある文言をそのまま引く
- 引用から導いた自分の解釈は、引用と分けて書く（引用の中に解釈を混ぜない）

## 連携ライフサイクル（失効・剥奪・切断）

外部連携は「つながった瞬間」だけでなく **切れたとき** の設計が必要。`google-integrations` の needsReauth は Google 専用のため、Google 以外（Instagram / WordPress）でも同等の設計があるかを横断で確認する。

- [ ] アクセストークン / リフレッシュトークンの失効時に、保存済みの認証情報をどう扱うか（期限を落とす・削除する）と、画面表示をどう揃えるかが定義されているか
- [ ] **ユーザーが外部サービス側で連携を解除した場合**（Meta のアプリ連携解除、Google のアクセス権削除、WordPress の application password 失効等）の検知方法と、検知後の挙動が定義されているか
- [ ] 外部アカウント自体が削除・凍結された場合に、取得済みデータをどう扱うか（残す / 隠す / 削除する）が定義されているか
- [ ] 再連携の導線が設計されているか。再連携後、切断中に欠けたデータを埋め戻すのか、欠損のまま進むのかが明記されているか
- [ ] 権限スコープが後から縮小された場合（一部権限だけ剥奪）の部分的失敗が想定されているか

> 実例: Instagram の認可解除は API エラーとしてしか観測できず、保存済みトークンの期限を明示的に落として初めて画面表示が揃った。「失効の検知」と「表示の整合」は別々に設計する必要がある。

## 判定（重大度の適用例）

重大度の定義そのものは `SKILL.md` の「重大度」表が正本。ここは外部サービス連携で頻出する状況の当てはめを示す。

| 状況 | 扱い |
| --- | --- |
| 公式ドキュメントの記述と仕様書が矛盾する | 🔴。公式を正とし、仕様書を修正する |
| 公式に非推奨・提供終了が告知されている API に依存している | 🔴 |
| 権限スコープ・レート制限・前提条件が公式にあるのに仕様書が未記載 | 🟡 |
| トークン失効・ユーザーによる連携解除時の挙動が未定義 | 🔴。外部連携が機能の前提なら、切れた状態が必ず本番で発生する |
| 公式ドキュメントに記述が見つからない挙動を仕様書が前提にしている | 断定せず「公式未記載・実機確認が必要」として確認質問に隔離する。推測で仕様を確定しない |
| WebFetch が失敗し公式ページを取得できない | レビューを止めず、「未確認（取得失敗した URL）」として明記したうえで残りの観点を続行する |
