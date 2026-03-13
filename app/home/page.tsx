import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, BarChart2, CheckCircle2, Lock, Zap } from 'lucide-react';

export const metadata: Metadata = {
  title: 'GrowMate - AIでマーケティングを自動化',
  description:
    'Google Search ConsoleやGoogle Analytics 4と連携し、データを分析。業界特化の知識を持つAIが、SEOに強いブログ記事や広告コピーを自動生成します。',
};

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Header */}
      <header className="border-b sticky top-0 bg-white/80 backdrop-blur-md z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">G</span>
            </div>
            <span className="font-bold text-xl tracking-tight text-gray-900">GrowMate</span>
          </div>
          <nav className="hidden md:flex items-center gap-8">
            <Link
              href="#features"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              機能
            </Link>
            <Link
              href="#pricing"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              料金
            </Link>
            <Link
              href="#compliance"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              Google連携
            </Link>
            <Link
              href="/privacy"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              プライバシーポリシー
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <Button
              asChild
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200"
            >
              <Link href="/login">無料で始める</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-grow">
        {/* Hero Section */}
        <section className="relative pt-20 pb-32 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-white -z-10" />
          <div className="mx-auto w-full max-w-7xl px-4 text-center">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-blue-100 text-blue-800 text-sm font-medium mb-8 animate-fade-in-up">
              <span className="w-2 h-2 rounded-full bg-blue-600 mr-2" />
              LINE / メールで簡単ログイン
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 tracking-tight mb-6 leading-tight max-w-4xl mx-auto">
              業界特化のマーケティングを
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                AIで自動化・最適化
              </span>
            </h1>
            <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
              Google Search ConsoleやGoogle Analytics 4と連携し、多角的にデータを分析。
              あなたのビジネスに最適なコンテンツ戦略と記事作成をAIがサポートします。
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button
                size="lg"
                asChild
                className="h-14 px-8 text-lg bg-blue-600 hover:bg-blue-700 shadow-xl shadow-blue-200"
              >
                <Link href="/login">
                  今すぐ無料で試す <ArrowRight className="ml-2 w-5 h-5" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                asChild
                className="h-14 px-8 text-lg border-gray-300 hover:bg-gray-50"
              >
                <Link href="#features">詳細を見る</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-24 bg-white">
          <div className="mx-auto w-full max-w-7xl px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                マーケティング業務を効率化する主要機能
              </h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                専門知識がなくても、プロレベルのマーケティング施策を実行できます。
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <div className="p-8 rounded-2xl border border-gray-100 bg-white shadow-lg shadow-gray-100/50 hover:shadow-xl transition-shadow">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-6">
                  <Zap className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">AI記事生成</h3>
                <p className="text-gray-600 leading-relaxed">
                  業界特化の知識を学習したAIが、SEOに強いブログ記事や広告コピーを自動生成。WordPressへの直接投稿も可能です。
                </p>
              </div>

              {/* Feature 2: GSC Integration (Critical for OAuth) */}
              <div className="p-8 rounded-2xl border border-blue-100 bg-blue-50/50 shadow-lg shadow-blue-100/50 relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
                  NEW
                </div>
                <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-6">
                  <BarChart2 className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">検索・アクセス解析</h3>
                <p className="text-gray-600 leading-relaxed">
                  Google Search ConsoleやGoogle Analytics 4（読み取り専用）と連携。
                  表示回数、クリック数、ユーザー行動などのデータを自動取得し、AIが課題の抽出と改善案の提示を同時に行います。
                </p>
              </div>

              {/* Feature 3 */}
              <div className="p-8 rounded-2xl border border-gray-100 bg-white shadow-lg shadow-gray-100/50 hover:shadow-xl transition-shadow">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-6">
                  <Lock className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">セキュアなデータ管理</h3>
                <p className="text-gray-600 leading-relaxed">
                  お客様のデータは厳重に管理され、許可された範囲内でのみAIの学習や分析に使用されます。プライバシー保護を最優先しています。
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Compliance Section */}
        <section id="compliance" className="py-24 bg-blue-50/50">
          <div className="mx-auto w-full max-w-7xl px-4">
            <div className="text-center mb-16">
              <p className="text-sm uppercase tracking-wider text-blue-500 font-semibold mb-2">
                Google OAuth Verification
              </p>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Google サービス（GSC / GA4 / Google Ads）連携とデータ取り扱い
              </h2>
              <p className="text-gray-600 max-w-3xl mx-auto leading-relaxed">
                Google Search Console / Google Analytics 4 の読み取り専用スコープ
                <code className="mx-2 bg-white/80 px-2 py-1 rounded text-sm">
                  .../auth/webmasters.readonly, .../auth/analytics.readonly
                </code>
                および Google Ads API スコープ
                <code className="mx-2 bg-white/80 px-2 py-1 rounded text-sm">.../auth/adwords</code>
                を使用し、ユーザーが許可したデータのみを分析します。取得データは
                Supabase（ap-northeast-1）で暗号化保管し、Vercel
                東京リージョンから安全に配信されます。
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 mb-12">
              <div className="p-8 bg-white rounded-2xl shadow-md border border-blue-100">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">OAuth フロー概要</h3>
                <ul className="space-y-3 text-gray-600 text-sm">
                  <li>1. LINE または メール認証で本人確認後、Google に遷移</li>
                  <li>2. 要求されたスコープの許諾内容を確認</li>
                  <li>3. 許可後、ダッシュボードでデータを参照</li>
                  <li>4. データをもとに AI が改善案を提示</li>
                </ul>
              </div>
              <div className="p-8 bg-white rounded-2xl shadow-md border border-blue-100">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">データ使用と保護</h3>
                <ul className="space-y-3 text-gray-600 text-sm">
                  <li>各プラットフォームのデータは分析のみに使用します。</li>
                  <li>Vercel 東京リージョン + Cloudflare で TLS 経由の通信を強制。</li>
                  <li>
                    LLM への入力はユーザーが明示的に送信した文章のみ。学習データへ自動転用しません。
                  </li>
                </ul>
              </div>
              <div className="p-8 bg-white rounded-2xl shadow-md border border-blue-100">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">サポート窓口</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  連携解除・データ削除・審査用アクセス情報は、以下までご連絡ください。
                </p>
                <ul className="mt-4 text-sm text-gray-700 space-y-2">
                  <li>株式会社ドリームプランナー</li>
                  <li>〒716-1551 岡山県加賀郡吉備中央町北702</li>
                  <li>電話: 090-9922-6467</li>
                  <li>メール: support@dreamplanner.co.jp</li>
                </ul>
                <p className="text-xs text-gray-500 mt-4">受付時間: 平日 10:00-17:00（祝日除く）</p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="py-24 bg-gray-50">
          <div className="mx-auto w-full max-w-7xl px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">シンプルな料金プラン</h2>
              <p className="text-gray-600">まずは無料トライアルから始めましょう。</p>
            </div>

            <div className="max-w-lg mx-auto bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-200">
              <div className="p-8 text-center border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-600 mb-2">スタンダードプラン</h3>
                <div className="flex items-baseline justify-center gap-1 mb-4">
                  <span className="text-5xl font-bold text-gray-900">100,000円</span>
                  <span className="text-gray-500">/月</span>
                </div>
                <p className="text-gray-500 text-sm">3日間の無料トライアル付き</p>
              </div>
              <div className="p-8 bg-gray-50/50">
                <ul className="space-y-4 mb-8">
                  <li className="flex items-center gap-3 text-gray-700">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <span>無制限のAIチャット</span>
                  </li>
                  <li className="flex items-center gap-3 text-gray-700">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <span>WordPress自動投稿</span>
                  </li>
                  <li className="flex items-center gap-3 text-gray-700">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <span>GSC / GA4 連携分析</span>
                  </li>
                  <li className="flex items-center gap-3 text-gray-700">
                    <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <span>優先サポート</span>
                  </li>
                </ul>
                <Button
                  size="lg"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  asChild
                >
                  <Link href="/login">トライアルを開始する</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 py-12">
        <div className="mx-auto w-full max-w-7xl px-4">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-2">
              <h4 className="text-white font-bold text-lg mb-4">GrowMate</h4>
              <p className="text-sm text-gray-400 max-w-sm">
                株式会社ドリームプランナーが提供する業界特化型マーケティングオートメーション。
                Google Search Console / Analytics 4 / Google Ads データと AI
                を組み合わせ、マーケティング施策の意思決定を支援します。
              </p>
              <div className="mt-4 text-xs text-gray-500 space-y-1">
                <p>〒716-1551 岡山県加賀郡吉備中央町北702</p>
                <p>電話: 090-9922-6467 / support@dreamplanner.co.jp</p>
              </div>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4">リンク</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="#features" className="hover:text-white transition-colors">
                    機能一覧
                  </Link>
                </li>
                <li>
                  <Link href="#pricing" className="hover:text-white transition-colors">
                    料金プラン
                  </Link>
                </li>
                <li>
                  <Link href="#compliance" className="hover:text-white transition-colors">
                    Google連携情報
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4">法的情報</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="/privacy" className="hover:text-white transition-colors">
                    プライバシーポリシー
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="hover:text-white transition-colors">
                    利用規約
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-center text-sm text-gray-500">
            &copy; {new Date().getFullYear()} Dream Planner Inc. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
