# メール配信設定ガイド

**対象**: GrowMate の Supabase Auth を用いた OTP メール配信  
**更新日**: 2026-03-09

---

## 1. 目的

本書は、GrowMate のメール OTP 認証を本番環境で安定運用するための設定基準を定義する。  
認証仕様そのものは [docs/plans/2026-03-01-email-auth-and-migration-spec.md](/Users/shoma.endo/private/GrowMate/docs/plans/2026-03-01-email-auth-and-migration-spec.md) を参照し、本書ではメール配信基盤、DNS、テンプレート、レート制限、運用チェックを扱う。

---

## 2. 開発環境と本番環境の差分

| 項目 | 開発環境 | 本番環境 |
|------|----------|----------|
| 送信基盤 | Supabase Hosted Email を許容 | **カスタム SMTP 必須** |
| 送信元ドメイン | 共有または暫定ドメインを許容 | **独自ドメイン必須** |
| 到達性 | 手動確認中心 | Gmail / Outlook を含む到達性確認必須 |
| DNS 認証 | 省略可 | **SPF / DKIM / DMARC 必須** |
| 監視 | 手動確認中心 | バウンス / 苦情 / 送信失敗を監視 |
| 送信上限 | 小規模テストを想定 | 想定会員数に応じて SMTP 側上限を確認 |

補足:

- Supabase 公式設定値として、`auth.rate_limit.email_sent` のデフォルトは 1 時間あたり 2 件、`auth.email.max_frequency` のデフォルトは 1 分、`auth.email.otp_expiry` のデフォルトは 3600 秒である。これらはローカル/セルフホスト向け公式設定名だが、実装時の確認基準として採用する。
- Email OTP の resend は `signInWithOtp()` を再度呼ぶ方式であり、OTP は 6 桁コード、再送信最短間隔は 60 秒、デフォルト有効期限は 1 時間。

---

## 3. SMTP プロバイダー選定基準

SMTP の選定は以下の順で評価する。

1. 到達率
2. 送信失敗時の可観測性
3. 本番想定の送信枠
4. 運用コスト
5. 初期設定の容易さ

評価観点:

- 独自ドメイン送信に対応しているか
- SPF / DKIM / DMARC の設定手順が明確か
- バウンス、苦情、送信失敗の可視化があるか
- API キー / SMTP 認証情報のローテーションが容易か
- 日本向け運用で問題の少ないサポート体制か

### 3.1 推奨順位

本プロジェクトの推奨順位は以下とする。

1. **Resend**
2. **Amazon SES**
3. **Postmark**
4. **SendGrid**

### 3.2 推奨理由

#### 第一候補: Resend

- 初期導入が速い
- Supabase 連携導線がある
- トランザクションメール用途に寄せやすい
- 開発者向け UX が良く、障害切り分けがしやすい

#### 第二候補: Amazon SES

- 大量配信時のコスト効率が高い
- 将来スケール時に強い
- ただし、初期設定と運用は Resend より重い

#### 第三候補以降

- Postmark は到達率重視の運用に向く
- SendGrid は導入実績は多いが、今回の要件では第一候補にはしない

### 3.3 採用判断

GrowMate では以下の基準で採用を決める。

- 月間 OTP 送信件数が少量〜中量で、導入速度と保守性を優先する場合: `Resend`
- 月間 OTP 送信件数が多く、コスト最適化を優先する場合: `Amazon SES`

---

## 4. 推奨構成

本番環境の推奨構成は以下。

```text
Supabase Auth
  └─ Custom SMTP
       └─ Resend または Amazon SES
            └─ growmate.jp 系ドメイン
                 ├─ SPF
                 ├─ DKIM
                 └─ DMARC
```

送信元の推奨:

- Sender email: `noreply@mail.<your-domain>`
- Sender name: `GrowMate`
- Reply-To: `support@<your-domain>` またはサポート窓口用アドレス

---

## 5. DNS 認証設定

### 5.1 SPF

役割:

- このドメインからメール送信してよいサーバーを宣言する

方針:

- 既存 SPF がある場合は 1 レコードに統合する
- `~all` で開始し、運用安定後に `-all` を検討する

設定例:

```text
v=spf1 include:amazonses.com ~all
v=spf1 include:spf.resend.com ~all
```

注意:

- SPF レコードは複数作らない
- 10 lookup 制限を超えないようにする

### 5.2 DKIM

役割:

- 送信メールに電子署名を付け、改ざんされていないことを示す

方針:

- SMTP プロバイダーが提示する DKIM レコードをそのまま設定する
- 2048 bit 鍵を優先する

### 5.3 DMARC

役割:

- SPF / DKIM 失敗時の受信側ポリシーを宣言する
- 集計レポートを受け取る

推奨導入手順:

1. 初期導入: `p=none`
2. 安定後: `p=quarantine`
3. 十分な観測後: `p=reject`

初期推奨値:

```text
v=DMARC1; p=none; rua=mailto:dmarc-reports@<your-domain>; adkim=s; aspf=s; pct=100
```

本番安定後の推奨値:

```text
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@<your-domain>; adkim=s; aspf=s; pct=100
```

厳格運用時の推奨値:

```text
v=DMARC1; p=reject; rua=mailto:dmarc-reports@<your-domain>; adkim=s; aspf=s; pct=100
```

### 5.4 検証手順

DNS 設定後は以下を確認する。

- SMTP プロバイダー側のドメイン Verify 完了
- Gmail 宛てテストで `SPF=PASS`, `DKIM=PASS`, `DMARC=PASS`
- Outlook 宛てテストで迷惑メールに落ちない

---

## 6. Supabase Auth 設定

### 6.1 必須設定

| 項目 | 推奨値 |
|------|--------|
| Email Auth | Enabled |
| メールテンプレート | `{{ .Token }}` を使用 |
| OTP Length | 6 |
| OTP Expiry | 3600 秒 |
| Email max frequency | 1 分以上 |
| Custom SMTP | Enabled |
| Sender Name | `GrowMate` |
| Sender Email | 独自ドメインの `noreply` |

### 6.2 Hosted Email の扱い

Supabase Hosted Email は開発確認用途に限定する。  
本番では使用しない。

理由:

- 送信上限が小さい
- 共有送信基盤のため到達性制御が弱い
- 送信ドメインのブランド一貫性を持てない

### 6.3 カスタム SMTP 設定項目

Supabase Dashboard の Authentication で以下を設定する。

- Enable Custom SMTP
- Sender name
- Sender email
- Host
- Port
- Username
- Password

---

## 7. OTP メールテンプレート

### 7.1 必須記載項目

- サービス名
- OTP コード
- 有効期限
- この操作に心当たりがない場合の案内
- サポート連絡先

### 7.2 推奨テンプレート文面

件名:

```text
GrowMate 認証コード
```

本文例:

```text
GrowMate の認証コードをお送りします。

認証コード: {{ .Token }}
有効期限: 60分

このコードは GrowMate へのログインにのみ使用できます。
心当たりがない場合は、このメールを破棄してください。

ご不明点は support@<your-domain> までご連絡ください。
```

HTML 例の要件:

- ロゴは必須ではないが、GrowMate 表記は入れる
- OTP コードは大きく表示する
- CTA ボタンは不要
- フッターにサポート連絡先を入れる

### 7.3 セキュリティ文言

必ず以下の趣旨を入れる。

- このメールはログイン操作時のみ送信される
- コードを第三者に共有しない
- 心当たりがない場合は破棄する

---

## 8. レート制限

### 8.1 採用する基準値

2026-03-09 時点で、Supabase 公式設定名に基づく基準値は以下。

| 項目 | 基準値 | 意味 |
|------|--------|------|
| `auth.rate_limit.email_sent` | 2 / 時間 | SMTP 有効時のメール送信数 |
| `auth.rate_limit.sign_in_sign_ups` | 30 / 5分 / IP | サインイン・サインアップ要求 |
| `auth.rate_limit.token_verifications` | 30 / 5分 / IP | OTP / Magic Link 検証 |
| `auth.email.max_frequency` | 1 分 | 同一メールへの最短送信間隔 |
| `auth.email.otp_expiry` | 3600 秒 | OTP 有効期限 |
| `auth.email.otp_length` | 6 | OTP 桁数 |

### 8.2 GrowMate の運用方針

- OTP 有効期限は当面 `3600 秒` を維持する
- 送信間隔は `1 分` を下回らない
- `email_sent` が本番トラフィックに対して不足する場合は、カスタム SMTP 前提で増加を検討する

### 8.3 カスタマイズ判断基準

以下のいずれかに当てはまる場合は、レート制限の見直しを行う。

- 同時ログインが増え、正規ユーザーが頻繁に送信制限へ到達する
- サポート問い合わせで「コードが届かない」「再送できない」が継続発生する
- 分散攻撃や大量試行が観測される

見直しの原則:

- まず SMTP 側の送信能力を確認する
- 次に Supabase 側レート制限を調整する
- 緩和する場合は、監視と abuse 対策を先に入れる

### 8.4 監視

最低限、以下を観測対象とする。

- OTP 送信失敗数
- OTP 検証失敗数
- SMTP バウンス
- 苦情率
- 送信遅延

---

## 9. 障害時の切り分け

### 9.1 メールが届かない場合

1. Supabase 側で `signInWithOtp()` が成功しているか
2. SMTP プロバイダー側で送信履歴があるか
3. SPF / DKIM / DMARC が PASS しているか
4. 迷惑メールフォルダに隔離されていないか
5. プロバイダー側の suppression list に載っていないか

### 9.2 コードが無効になる場合

1. OTP Expiry が想定どおりか
2. 古いコードを入力していないか
3. 再送後に古いコードを使っていないか
4. `verifyOtp()` 側のレート制限に達していないか

### 9.3 本番切り戻し基準

以下の場合は一時的にメール OTP 導入を停止または限定する。

- 本番で継続的に配信失敗が発生する
- DKIM / SPF / DMARC が安定しない
- 大量の送信障害でログイン不能ユーザーが増加する

---

## 10. リリース前チェックリスト

```text
- [ ] Custom SMTP を設定した
- [ ] Sender email が独自ドメインになっている
- [ ] SPF を設定した
- [ ] DKIM を設定した
- [ ] DMARC を設定した
- [ ] Gmail 宛てで到達確認した
- [ ] Outlook 宛てで到達確認した
- [ ] OTP テンプレートに GrowMate 名義を入れた
- [ ] サポート連絡先をテンプレートへ入れた
- [ ] OTP 有効期限が 3600 秒であることを確認した
- [ ] 再送信間隔が 1 分以上であることを確認した
- [ ] レート制限値を本番想定トラフィックと照合した
- [ ] 送信失敗時の監視方法を定義した
- [ ] Feature Flag により admin_only で先行公開できる状態にした
- [ ] allowlist / all へ拡大する条件を定義した
```

---

## 11. 参照

- Supabase JavaScript Auth API: https://supabase.com/docs/reference/javascript/auth-api
- Supabase Passwordless email logins: https://supabase.com/docs/guides/auth/auth-magic-link
- Supabase CLI config: https://supabase.com/docs/guides/local-development/cli/config
- Supabase Resend integration: https://supabase.com/partners/resend
- Supabase AutoSend integration: https://supabase.com/partners/AutoSend
