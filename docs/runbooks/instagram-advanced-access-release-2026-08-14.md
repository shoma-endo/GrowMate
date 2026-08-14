# Instagram 限定公開の解除 Runbook（2026-08-14）

App Review 通過に伴い、Instagram 機能を **admin / paid / trial** へ開放する本番作業の手順書。
設計書の正本は [`docs/plans/instagram-integration-design.md`](../plans/instagram-integration-design.md) §4 Phase 2 item6 / §7 / §9 Q4。

**コード側（trial 経路の開放 + 限定公開ゲートの撤去）は実装・マージ済み**。本 Runbook が扱うのは **本番デプロイ・Vercel の変数削除・本番実測**。

> ⚠ **解除は「環境変数を空にするだけ」ではなくなった（2026-08-14 変更）**。当初設計では `INSTAGRAM_BETA_USER_IDS` を空にする無停止の切り替えだったが、審査通過に伴い **allowlist をコードごと撤去**したため、解除＝デプロイ、ロールバック＝revert デプロイになる（§6）。

---

## 0. 前提条件（すべて満たすまで着手しない）

- [ ] App Review 通過（Advanced Access 付与）
- [ ] アクセス認証（Tech Provider）完了 — 未完だと**アプリに役割を持たないユーザー**の呼び出しが `error code 100` で落ちる（設計書 §3.2）
- [ ] クライアント側のビジネス認証完了（2026-08-01 時点で完了済み）

---

## 1. 事前準備: ロールバック手段を確認する

allowlist を撤去したため、**露出を絞り直す唯一の手段は revert デプロイ**である。着手前に以下を押さえる。

- [ ] revert 対象のコミット範囲を把握した（限定公開ゲートの撤去 + trial 開放）
- [ ] Vercel の Instant Rollback で直前のデプロイへ戻せることを確認した（どちらか片方が使えれば足りる）

> `INSTAGRAM_BETA_USER_IDS` は Vercel の Sensitive 設定で値を読み戻せない。**撤去後に「元の3件」を復元する必要は無い**（コードが変数を見なくなるため）が、revert して allowlist を復活させる場合は変数を再登録することになる。その際の 3 件（遠藤・薫・審査用、2026-08-02 時点）は連携実績から再構成できる:
>
> ```sql
> SELECT user_id, username, created_at
>   FROM public.instagram_credentials
>  ORDER BY created_at;
> ```
>
> ただしこれが返すのは「連携済みユーザー」であって「allowlist に載っていたユーザー」ではない。連携しないまま載っていた ID は取りこぼす。

---

## 2. 実測用アカウントを用意する

ここが本 Runbook の肝。**軸が 2 つあり、混同すると「通った」が偽陰性になる**。

| 軸 | 何で決まるか | 何を決めるか |
|----|-------------|-------------|
| GrowMate のユーザー | `role`（admin / paid / trial） | 画面に到達できるか |
| **Instagram プロアカウント** | **Meta App Dashboard の Instagram Tester** | **API が通るか** |

`error code 100` で落ちるかを決めているのは Meta 側の「アプリに役割を持つか」であって、GrowMate のロールではない（設計書 §3.2「開発中に動いているのは開発者がアプリの役割を持っているからにすぎない」）。

用意するもの:

- [ ] **GrowMate**: role が admin / paid / trial のいずれかのユーザー（**trial での確認を必ず1回は含める** — 今回開放した経路のため）
- [ ] **Instagram**: **Instagram Tester に追加していない**プロアカウント（ビジネス or クリエイター）

> `manbou536` / `aozorayoukei` は Tester 登録済みのため**実測に使えない**。**アプリに役割を持つユーザー**として通ってしまい、本番の顧客（役割を持たないユーザー）の状況を再現できない。
>
> テスト用に個人アカウントをプロへ転換するのが早い。ただし**プロ転換より前の投稿はインサイトが取れない**（`error_subcode 2108006` — 設計書 §3.3）ので、「連携が通ること」と「指標が入ること」は分けて見る。

---

## 3. 本番へデプロイする（＝解除）

限定公開ゲートを撤去したコードを本番に載せた時点で解除が成立する。`canAccessInstagram` は設計書 §7 のロール判定（admin / paid / trial）だけを見る。

- [ ] trial 開放 + 限定公開ゲート撤去のコードを本番にデプロイした
- [ ] デプロイ後、Vercel の **Production** / **Preview** の両スコープから `INSTAGRAM_BETA_USER_IDS` を削除した（コードが参照しなくなるため、残っていても無害だが紛らわしい）

> 変数を先に消してもコードを先に出しても結果は同じ（撤去後のコードは変数を読まない）。**デプロイが解除のトリガー**である点だけ間違えないこと。

---

## 4. 本番実測

### 4-1. API が本番の顧客に対して通ること（最重要）

§2 で用意したアカウントで実施する。

- [ ] `/setup/instagram` から OAuth 連携が完了する
- [ ] プロフィール（username・フォロワー数）が表示される
- [ ] 最新投稿のプレビューが表示される（転換前投稿しか無い場合は「対象外」表示でよい。**連携自体が通ることが合格条件**）

**`error code 100` が出たらアクセス認証が未完了**。§6 のロールバックへ。

### 4-2. trial 経路が通しで動くこと

trial は `/setup` ハブに到達できないため、専用の導線を通る。

- [ ] ホームに「Instagram連携」カードが出る
- [ ] カード →`/setup/instagram` に到達できる（`/unauthorized` に飛ばされない）
- [ ] 戻るリンクが「ホームに戻る」になっている（「設定に戻る」だと行き止まり）
- [ ] 連携後、「投稿一覧を見る」→ `/analytics` の Instagram タブが開く
- [ ] `/analytics` に**ブログタブが出ない**（trial に有料機能が露出していない）

### 4-3. 有料機能の境界が動いていないこと

- [ ] trial で `/setup` を直接開くと `/unauthorized`
- [ ] trial で `/setup/wordpress`・`/setup/gsc`・`/setup/ga4` を直接開くと `/unauthorized`
- [ ] paid / admin の `/analytics` は従来どおり（**Instagram 連携済みなら**ブログ / Instagram の 2 タブ、未連携ならタブバー無しのブログ一覧のみ）
- [ ] Instagram 未連携の trial が `/analytics` を直接開くと `/setup/instagram`（連携画面）へ送られる。**`/unauthorized` にはしない** — 権限が無いのではなく未設定なだけで、必要なのは連携導線だから

---

## 5. 完了後の後始末

4 がすべて通ってから実施する。

- [x] ~~`INSTAGRAM_BETA_USER_IDS` の撤去~~ → **§3 に前倒し済み**（コード側は撤去済み。Vercel の変数削除も §3 に含む）
- [ ] `REVIEW_LOGIN_EMAIL` を削除する（これだけで `/review-login` が 404 になる。撤去範囲は README の環境変数表の該当行に列挙済み）。**審査用 GrowMate アカウント自体は削除しない** — Meta の定期再審査とデータ使用状況の確認（年 1 回）で再利用する（設計書 §3.2）
- [ ] 継続義務を運用側へ引き継ぐ:
  - **データ使用状況の確認（DUC）**: 年 1 回。放置するとアドバンスアクセスが失効し**全ユーザーの Instagram 連携が停止する**
  - **データ保護アセスメント（DPA）**: 対象になると通知から **60 日**で回答期限。アプリの連絡先メールと管理者設定を生きた状態に保つ

---

## 6. ロールバック

4-1 で `error code 100` が出た場合、または想定外の露出が起きた場合。

**allowlist を撤去したため、環境変数で戻す手段は無い。ロールバックはデプロイである。**

- [ ] Vercel の Instant Rollback で直前のデプロイへ戻す、または §1 で把握した範囲を `git revert` してデプロイする
- [ ] 戻した後、対象外のユーザーに `/setup` / ホームの Instagram カードが出ないことを確認する
- [ ] 原因（多くはアクセス認証未完了）を解消してから §3 からやり直す

**部分的に閉じたい場合**（例: trial だけ止めて paid / admin は残す）は、`src/server/lib/instagram-permissions.ts` の `INSTAGRAM_ALLOWED_ROLES` から `'trial'` を外してデプロイするのが最小の変更。ホームの Instagram カード（`app/page.tsx`）はロールを見ずに全員へ出しているので、押すと `/setup/instagram` のページガードで弾かれる（trial は `/unauthorized`）。行き止まりを避けたいならカードの表示条件も併せて調整する。

なお **OAuth callback は認可を再確認する**（`app/api/instagram/oauth/callback/route.ts`）ので、ロールバック中に `/start` を通過済みのユーザーが戻ってきても credential は保存されない。
