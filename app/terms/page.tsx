import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '利用規約 - GrowMate',
  description: 'GrowMateの利用規約です。サービスの利用条件、権利義務関係について定めています。',
};

export default function TermsPage() {
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
          <h1 className="text-3xl font-bold text-gray-900 mb-6 border-b pb-4">利用規約</h1>
          <p className="text-sm text-gray-500 mb-8">最終更新日: 2026年2月18日</p>

          <div className="prose prose-blue max-w-none space-y-8 text-gray-700">
            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">1. はじめに</h2>
              <p>
                この利用規約（以下「本規約」といいます）は、株式会社ドリームプランナー（以下「当社」といいます）が提供するサービス「GrowMate」（以下「本サービス」といいます）の利用に関する条件を定めるものです。本サービスを利用される皆さま（以下「ユーザー」といいます）には、本規約に従って本サービスをご利用いただきます。
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">
                2. Google サービスの利用について
              </h2>
              <p>
                本サービスは、Google Search Console API、Google Analytics API および Google Ads API
                を使用して機能を提供します。ユーザーは本サービスを利用することで、以下の事項に同意したものとみなされます：
              </p>
              <ul className="list-disc pl-5 space-y-2 mt-2">
                <li>
                  <a
                    href="https://policies.google.com/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Google 利用規約
                  </a>
                  および
                  <a
                    href="https://policies.google.com/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Google プライバシーポリシー
                  </a>
                  に拘束されること。
                </li>
                <li>
                  本サービスが Google API
                  から取得したデータ（検索パフォーマンスデータ、アクセス解析データ、広告パフォーマンスデータ等）を、ユーザーへのレポート提供およびコンテンツ生成の目的で利用すること。
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">3. 禁止事項</h2>
              <p>ユーザーは、本サービスの利用にあたり、以下の行為をしてはなりません。</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>法令または公序良俗に違反する行為</li>
                <li>犯罪行為に関連する行為</li>
                <li>
                  本サービスの内容等、本サービスに含まれる著作権、商標権ほか知的財産権を侵害する行為
                </li>
                <li>
                  当社、ほかのユーザー、またはその他第三者のサーバーまたはネットワークの機能を破壊したり、妨害したりする行為
                </li>
                <li>本サービスによって得られた情報を商業的に利用する行為</li>
                <li>当社のサービスの運営を妨害するおそれのある行為</li>
                <li>不正アクセスをし、またはこれを試みる行為</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">4. 免責事項</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  当社は、本サービスに事実上または法律上の瑕疵（安全性、信頼性、正確性、完全性、有効性、特定の目的への適合性、セキュリティなどに関する欠陥、エラーやバグ、権利侵害などを含みます）がないことを明示的にも黙示的にも保証しておりません。
                </li>
                <li>
                  AIによって生成されたコンテンツ（ブログ記事、広告コピー等）の正確性や法的適合性について、当社は一切の責任を負いません。生成されたコンテンツはユーザー自身の責任において確認・利用するものとします。
                </li>
                <li>
                  Google
                  APIの仕様変更や制限により、本サービスの一部または全部が利用できなくなった場合でも、当社はそれによりユーザーに生じた損害について一切の責任を負いません。
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">5. サービス内容の変更等</h2>
              <p>
                当社は、ユーザーに通知することなく、本サービスの内容を変更し、または本サービスの提供を中止することができるものとし、これによってユーザーに生じた損害について一切の責任を負いません。
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">6. 準拠法・裁判管轄</h2>
              <p>
                本規約の解釈にあたっては、日本法を準拠法とします。本サービスに関して紛争が生じた場合には、当社の本店所在地を管轄する裁判所を専属的合意管轄とします。
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-3">7. お問い合わせ</h2>
              <p>本規約に関するお問い合わせは、以下の窓口までお願いいたします。</p>
              <div className="mt-3 text-sm">
                <p>株式会社ドリームプランナー</p>
                <p>メール: support@dreamplanner.co.jp</p>
              </div>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
