# Instagram 限定公開の解除 Runbook（2026-08-14）

App Review 通過に伴い、Instagram 機能を **admin / paid / trial** へ開放する本番作業の手順書。
設計書の正本は [`docs/plans/instagram-integration-design.md`](../plans/instagram-integration-design.md) §4 Phase 2 item6 / §7 / §9 Q4。

**コード側（trial 経路の開放）は実装・マージ済み**。本 Runbook が扱うのは **Vercel の環境変数操作と本番実測**のみ。

---

## 0. 前提条件（すべて満たすまで着手しない）

- [ ] App Review 通過（Advanced Access 付与）
- [ ] アクセス認証（Tech Provider）完了 — 未完だと**アプリに役割を持たないユーザー**の呼び出しが `error code 100` で落ちる（設計書 §3.2）
- [ ] クライアント側のビジネス認証完了（2026-08-01 時点で完了済み）
- [ ] trial 開放のコードが本番にデプロイ済み

---

## 1. 事前準備: 現在の allowlist を控える（**最重要**）

`INSTAGRAM_BETA_USER_IDS` は Vercel の **Sensitive 設定で値を読み戻せない**。空にする前に現在の 3 件（遠藤・薫・審査用、2026-08-02 時点）を控えておかないと、ロールバック時に再構成が必要になる。

控え忘れた場合は連携実績から再構成する:

```sql
SELECT user_id, username, created_at
  FROM public.instagram_credentials
 ORDER BY created_at;
```

> ⚠ この SQL が返すのは「連携済みユーザー」であって「allowlist に載っていたユーザー」ではない。
> 連携しないまま allowlist に載っていた ID があると取りこぼす。**控えるのが正**、SQL は最後の手段。

- [ ] 現在の 3 件を安全な場所に控えた

---

## 2. 実測用アカウントを用意する

ここが本 Runbook の肝。**軸が 2 つあり、混同すると「通った」が偽陰性になる**。

| 軸 | 何のリスト | 何を決めるか |
|----|-----------|-------------|
| GrowMate の `user_id` | `INSTAGRAM_BETA_USER_IDS` | 画面に到達できるか |
| **Instagram プロアカウント** | **Meta App Dashboard の Instagram Tester** | **API が通るか** |

`error code 100` で落ちるかを決めているのは Meta 側の「アプリに役割を持つか」であって、GrowMate の allowlist ではない（設計書 §3.2「開発中に動いているのは開発者がアプリの役割を持っているからにすぎない」）。

用意するもの:

- [ ] **GrowMate**: これまで allowlist に載っていなかったユーザー（変数を空にすれば全員が該当）。role は admin / paid / trial のいずれか
- [ ] **Instagram**: **Instagram Tester に追加していない**プロアカウント（ビジネス or クリエイター）

> `manbou536` / `aozorayoukei` は Tester 登録済みのため**実測に使えない**。スタンダードアクセスの特権で通ってしまい、本番の顧客の状況を再現できない。
>
> テスト用に個人アカウントをプロへ転換するのが早い。ただし**プロ転換より前の投稿はインサイトが取れない**（`error_subcode 2108006` — 設計書 §3.3）ので、「連携が通ること」と「指標が入ること」は分けて見る。

---

## 3. allowlist を空にする

- [ ] Vercel の **Production** スコープで `INSTAGRAM_BETA_USER_IDS` を空にする
- [ ] Vercel の **Preview** スコープでも同様に空にする
- [ ] 再デプロイして反映（環境変数の変更だけではランタイムに載らない）

`canAccessInstagram` が §7 のロール判定（admin / paid / trial）にフォールバックする。コード変更は不要。

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
- [ ] paid / admin の `/analytics` は従来どおりブログ / Instagram の 2 タブ
- [ ] Instagram 未連携の trial が `/analytics` を直接開くと `/unauthorized`

---

## 5. 完了後の後始末

4 がすべて通ってから実施する。

- [ ] `INSTAGRAM_BETA_USER_IDS` をコードごと削除する（`src/server/lib/instagram-permissions.ts` の allowlist 分岐・テスト・`.env.example`・README・設計書・Vercel の変数）
- [ ] `REVIEW_LOGIN_EMAIL` を削除する（これだけで `/review-login` が 404 になる。撤去範囲は README の環境変数表の該当行に列挙済み）。**審査用 GrowMate アカウント自体は削除しない** — Meta の定期再審査とデータ使用状況の確認（年 1 回）で再利用する（設計書 §3.2）
- [ ] 継続義務を運用側へ引き継ぐ:
  - **データ使用状況の確認（DUC）**: 年 1 回。放置するとアドバンスアクセスが失効し**全ユーザーの Instagram 連携が停止する**
  - **データ保護アセスメント（DPA）**: 対象になると通知から **60 日**で回答期限。アプリの連絡先メールと管理者設定を生きた状態に保つ

---

## 6. ロールバック

4-1 で `error code 100` が出た場合、または想定外の露出が起きた場合。

- [ ] `INSTAGRAM_BETA_USER_IDS` に §1 で控えた 3 件を Production / Preview とも復元する（**追記ではなく全件上書き**になる点に注意）
- [ ] 再デプロイして反映
- [ ] allowlist 外のユーザーに `/setup` の Instagram カードが出ないことを確認
- [ ] 原因（多くはアクセス認証未完了）を解消してから §3 からやり直す

コードのロールバックは不要。allowlist が非空の間は `canAccessInstagram` が user_id のみを見るため、trial 開放のコードが入っていても露出は閉じる。
