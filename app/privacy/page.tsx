import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'プライバシーポリシー - GrowMate',
  description:
    'GrowMateのプライバシーポリシー。Google Search Console、Google Analytics、Google Ads APIの利用目的とデータ保護方針について説明します。',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Button
            variant="ghost"
            asChild
            className="pl-0 hover:bg-transparent hover:text-blue-600 text-gray-600"
          >
            <Link href="/home" className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              トップページに戻る
            </Link>
          </Button>
        </div>

        <article className="bg-white shadow-sm rounded-2xl p-8 sm:p-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-6 border-b pb-4">
            プライバシーポリシー
          </h1>
          <p className="text-sm text-gray-500 mb-8">最終更新日: 2026年3月13日</p>

          <div
            className="bg-gray-100 rounded-2xl p-6 sm:p-8 text-sm text-gray-700 mb-10"
            id="company-info"
          >
            <h2 className="text-lg font-semibold text-gray-900 mb-4">運営者情報</h2>
            <dl className="grid sm:grid-cols-2 gap-y-2">
              <div>
                <dt className="font-medium text-gray-600">法人名</dt>
                <dd>株式会社ドリームプランナー</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-600">代表者</dt>
                <dd>代表取締役 繁田 薫</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-600">所在地</dt>
                <dd>〒716-1551 岡山県加賀郡吉備中央町北702</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-600">連絡先</dt>
                <dd>電話: 090-9922-6467 / メール: support@dreamplanner.co.jp</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-gray-500">
              本ポリシーは Google OAuth
              審査要件（読み取り専用スコープ）および日本の個人情報保護法に準拠します。
            </p>
          </div>

          <div className="prose prose-blue max-w-none space-y-10 text-gray-700">
            <section id="overview">
              <h2 className="text-xl font-bold text-gray-900 mb-3">1. はじめに</h2>
              <p>
                「GrowMate」（以下、「当サービス」といいます）は、ユーザーの個人情報および Google
                Search
                Console（以下、GSC）から取得するデータの取り扱いにおいて、透明性と安全性を最優先します。本ポリシーでは、取得する情報、利用目的、保管場所、第三者提供、ユーザーが行使できる権利について説明します。
              </p>
            </section>

            <section id="data-collected">
              <h2 className="text-xl font-bold text-gray-900 mb-3">2. 取得する情報</h2>
              <p className="mb-2">当サービスが取得・生成する主な情報は以下の通りです。</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>メールアドレス:</strong>{' '}
                  メールOTP認証でログインする場合に取得するメールアドレス。
                </li>
                <li>
                  <strong>LINE アカウント情報:</strong> LINE
                  LIFF認証で取得する表示名・プロフィール画像・ユーザーID。
                </li>
                <li>
                  <strong>Googleユーザーデータ:</strong> 以下のスコープで取得する情報。
                  <ul className="list-circle pl-5 mt-1">
                    <li>
                      GSC:{' '}
                      <code className="bg-gray-100 px-2 py-1 rounded text-xs">
                        https://www.googleapis.com/auth/webmasters.readonly
                      </code>
                      <br />
                      検索クエリ、クリック数、表示回数、掲載順位等。
                    </li>
                    <li>
                      GA4:{' '}
                      <code className="bg-gray-100 px-2 py-1 rounded text-xs">
                        https://www.googleapis.com/auth/analytics.readonly
                      </code>
                      <br />
                      ウェブサイトのアクセス解析データ（表示回数、ユーザー数、イベント等）。
                    </li>
                    <li>
                      Google Ads:{' '}
                      <code className="bg-gray-100 px-2 py-1 rounded text-xs">
                        https://www.googleapis.com/auth/adwords
                      </code>
                      <br />
                      広告キャンペーン情報、広告グループ、クリック数、コンバージョン数等のパフォーマンス指標。
                    </li>
                  </ul>
                </li>
                <li>
                  <strong>WordPress/コンテンツ情報:</strong>{' '}
                  連携サイトの投稿データ、生成したブログや広告コピー、注釈メタデータ。
                </li>
                <li>
                  <strong>利用状況データ:</strong>{' '}
                  チャット履歴、キャンバス編集履歴、アナリティクス閲覧履歴等の操作ログ。
                </li>
              </ul>
            </section>

            <section id="gsc-purpose">
              <h2 className="text-xl font-bold text-gray-900 mb-3">
                3. Googleユーザーデータの利用目的と方法
              </h2>
              <p className="mb-2">
                以下のデータは記載された目的に限定して利用します。GSCおよびGA4データは読み取り専用で取得し、書き込みや設定変更は行いません。
                Google Ads データは分析・改善提案のみに使用し、広告目的での転用は行いません。
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  ユーザーサイトの検索パフォーマンス指標を可視化するため（GSCインサイト画面）。
                </li>
                <li>
                  ウェブサイトのアクセス解析データ（滞在時間、読了率、CV数等）を表示するため（アナリティクス画面）。
                </li>
                <li>
                  Google Ads
                  の広告パフォーマンスを分析し、より効果的な広告コピーやキーワード設定の改善案を生成するため。
                </li>
                <li>指標に基づき、AIが改善提案・コンテンツ案を生成するため。</li>
                <li>
                  レポートダウンロードや履歴比較など、ユーザーが要求した範囲の機能を提供するため。
                </li>
              </ul>
              <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mt-4 text-sm text-blue-900 rounded-r-lg">
                <strong>重要:</strong> GSC データはユーザーの指示がない限り AI
                モデルの学習データに転用されません。分析処理は Supabase 上で実施し、結果のみを UI
                とチャットに返します。
              </div>
              <div className="bg-gray-100 border border-gray-200 p-4 mt-4 text-sm text-gray-800 rounded-lg">
                <p className="font-semibold mb-2">
                  Google API サービスのユーザーデータポリシーへの準拠
                </p>
                <p className="mb-4">
                  本サービスが Google API
                  から取得した情報の使用および他のアプリへの転送は、限定的使用の要件（Limited Use
                  requirements）を含む{' '}
                  <Link
                    href="https://developers.google.com/terms/api-services-user-data-policy"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 underline"
                  >
                    Google API サービスのユーザーデータポリシー
                  </Link>{' '}
                  に準拠します。
                </p>
                <p className="italic text-gray-600">
                  GrowMate&apos;s use and transfer to any other app of information received from
                  Google APIs will adhere to{' '}
                  <Link
                    href="https://developers.google.com/terms/api-services-user-data-policy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline"
                  >
                    Google API Services User Data Policy
                  </Link>
                  , including the Limited Use requirements.
                </p>
              </div>
            </section>

            <section id="storage">
              <h2 className="text-xl font-bold text-gray-900 mb-3">
                4. データの保管場所と保護措置
              </h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Supabase PostgreSQL:</strong> 東京リージョン（ap-northeast-1）で AES-256
                  などの暗号化を適用。RLS と行レベルアクセス制御を設定。
                </li>
                <li>
                  <strong>Vercel:</strong> 東京リージョンでホスティングし、TLS1.2
                  以上で通信を暗号化。
                </li>
                <li>
                  <strong>ログ・ファイル:</strong> Vercel
                  ログとSupabaseストレージに最小限の構成情報のみ保存。機密データは保存しません。
                </li>
              </ul>
              <p className="mt-3">
                物理・組織・技術的な安全管理措置は株式会社ドリームプランナーの情報セキュリティポリシーに従います。
              </p>
            </section>

            <section id="sharing">
              <h2 className="text-xl font-bold text-gray-900 mb-3">5. 第三者サービスと共同利用</h2>
              <p className="mb-2">サービス提供に必要な範囲で以下の事業者を利用します。</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Supabase Inc.（データベース、認証、ストレージ）</li>
                <li>Vercel Inc.（アプリケーションホスティング）</li>
                <li>
                  Google LLC（Google Search Console API, Google Analytics API, Google Ads API）
                </li>
                <li>LINEヤフー株式会社（LIFF 認証）</li>
                <li>Automattic Inc. / WordPress Foundation（WordPress API）</li>
                <li>
                  Anthropic PBC / OpenAI, L.L.C.（AI応答生成。送信データはユーザー入力範囲に限定）
                </li>
              </ul>
              <p className="mt-3">
                これらの事業者へ提供するデータは、業務委託契約の目的達成に必要な最小限に限定します。
              </p>
            </section>

            <section id="retention">
              <h2 className="text-xl font-bold text-gray-900 mb-3">6. データ保持期間と削除方法</h2>
              <p>
                アカウント削除や GSC
                連携解除の指示を受領後、関連データは原則30日以内に削除します。ログや監査記録は法令上必要な期間のみ保持し、その後安全な方法で廃棄します。
              </p>
            </section>

            <section id="user-rights">
              <h2 className="text-xl font-bold text-gray-900 mb-3">7. ユーザーの権利と手続き</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>アクセス・訂正:</strong>{' '}
                  サポート窓口に連絡するか、アプリ内のアカウント情報ページから登録情報を変更できます。
                </li>
                <li>
                  <strong>連携解除:</strong>{' '}
                  <Link
                    href="https://myaccount.google.com/permissions"
                    className="text-blue-600 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google アカウントのアクセス権管理
                  </Link>
                  から「GrowMate」のアクセスを取り消せます。
                </li>
                <li>
                  <strong>削除請求:</strong> support@dreamplanner.co.jp
                  へメールでご連絡ください。本人確認後に処理状況を通知します。
                </li>
              </ul>
            </section>

            <section id="changes">
              <h2 className="text-xl font-bold text-gray-900 mb-3">8. ポリシーの改定</h2>
              <p>
                本ポリシーは法令やサービス内容の変更に応じて改定します。重要な変更がある場合は、アプリ内通知またはメールで告知します。
              </p>
            </section>

            <section id="contact">
              <h2 className="text-xl font-bold text-gray-900 mb-3">9. お問い合わせ</h2>
              <p>
                個人情報の取り扱い、Google OAuth
                審査に関するご要望、データ削除依頼は以下までご連絡ください。
              </p>
              <ul className="mt-3 space-y-1 text-gray-800">
                <li>株式会社ドリームプランナー</li>
                <li>電話: 090-9922-6467</li>
                <li>メール: support@dreamplanner.co.jp</li>
              </ul>
            </section>
          </div>
        </article>

        <div className="mt-8 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} GrowMate. All rights reserved.
        </div>
      </div>
    </div>
  );
}
