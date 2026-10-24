# 夜通し実行の preflight（spec-to-pr）

`spec-to-pr` を夜通し `takt run` で回す前の手順。権限・テスト準備・環境を寝る前に確かめ、朝に「最初の step で止まっていた」をなくす。

## 失敗したときの動き

- タスクが失敗したら1回だけ自動で積み直す（`.takt/config.yaml` の `auto_requeue_max_attempts: 1`）。2回目の失敗は積み直さずに止まる。
- `takt run` のタスクが全部終わると、`TAKT_NOTIFY_WEBHOOK` に run summary が送られる。TAKT の通知は Slack Incoming Webhook 形式だけで、Lark の Webhook には送れない。
- 実行時間の上限は `scripts/takt-overnight.sh` が持つ（既定 480 分）。TAKT には run 全体の時間上限の設定が無いため、上限に達したら SIGINT で中断させる。中断した run は翌朝 resume できる。
- `max_steps: 30` を超えた run も止まる。レビューの差し戻しは同じ finding_id で2回までで、3周目に入る前に止まって足りないものを返す。

## 1. 一度だけ用意する

UI 変更のある仕様を流すときだけ要る。

1. Chromium を入れる: `npx playwright install chromium`
2. ログイン状態（Playwright の storageState）を作る。GrowMate の作業ツリーで `npm run dev` を起動し、別の端末で次を実行して、開いたブラウザで普段どおりログインしてから閉じる。

   ```bash
   npx playwright codegen --save-storage="$HOME/.takt/growmate-storage-state.json" http://localhost:3000/login
   ```

   - 開発と本番は同じ Supabase を使う。このログインも、`ui_evidence` が画面を開くことも、人がブラウザでログインして画面を開くのと同じ扱いになる。
   - ファイルの中身はセッション cookie なので、リポジトリに置かない・人に渡さない。ログインが切れたら作り直す。

## 2. 寝る前に毎回

1. feature ブランチで、作業ツリーを clean にする（develop / main 上で回すと `create_pr` が土台ブランチへ直接 push する）。
2. 環境変数を export する。値は画面に出さない。

   ```bash
   export TAKT_NOTIFY_WEBHOOK=...                                  # Slack Incoming Webhook
   export TAKT_UI_ENV_FILE=/path/to/GrowMate/.env.local            # UI 変更のある仕様だけ。takt run の clone には .env.local が無い
   export TAKT_UI_STORAGE_STATE="$HOME/.takt/growmate-storage-state.json"  # 同上
   ```

3. タスクを積む。`takt` の対話で workflow に `spec-to-pr` を選び、「Save as Task」で保存する（`takt -w spec-to-pr -t ...` の直接実行は積み直しの対象外）。
4. preflight を通して実行する。

   ```bash
   ./scripts/takt-overnight.sh                   # 既定。上限 480 分
   ./scripts/takt-overnight.sh --ui              # UI 変更のある仕様を流す（UI 証跡の前提を必須にする）
   ./scripts/takt-overnight.sh --verify          # 土台で npm run verify が通るかも確かめる（約10分）
   ./scripts/takt-overnight.sh --limit-minutes 360
   ```

   preflight（`scripts/takt-preflight.sh`）だけを単独で流してもよい。次を確かめ、1つでも ✗ なら実行しない。

   | 区分 | 確かめること |
   |------|--------------|
   | git | feature ブランチ・作業ツリーが clean・`origin/develop` を含む |
   | takt | `.takt-version` の pin 版がある・`workflow doctor` が通る |
   | 権限 | `takt workflow inspect` の解決結果で、spec-review / spec-to-pr の全 step が `claude-sdk`・`full`（Claude では `bypassPermissions`）の step が無い・`auto_requeue_max_attempts` が 1 |
   | 認証 | Anthropic（`scripts/takt-check-provider-auth.sh`）・`gh auth status` |
   | テスト準備 | `node_modules` が `package-lock.json` と一致・Playwright の Chromium が起動する（`--ui` のとき必須）・`--verify` なら `npm run verify` |
   | 環境 | `TAKT_UI_ENV_FILE` と `TAKT_UI_STORAGE_STATE` のファイルがある（`--ui` のとき必須）・`TAKT_NOTIFY_WEBHOOK` がある（無ければ警告） |

## 3. 朝に確かめる

- 通知の run summary、または `.takt/runs/` の最新 run の `meta.json` の status を見る。
- ABORT した run は、レポートの appendix に止まった理由（足りない仕様・判断材料）がある。仕様書を直して `spec-review` から回し直す。
- 時間上限で中断した run は resume する。
