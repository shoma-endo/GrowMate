/**
 * 文字列の正規化と抽出
 *
 * 検索クエリ（`normalize-query`）、URL（`normalize-url`）、本文テキストと画像点数
 * （`content-text`）、HTML からの本文抽出（`html-content-extractor`）。
 *
 * 元は1モジュール1ファイルに分かれていた。30行未満のファイルが並んで
 * 目的のものを絞れなくなっていたため、役割の単位でまとめている。
 * どのモジュールの検査かは外側の describe が示す。
 * 各モジュールのフック（useFakeTimers 等）も外側の describe に閉じる。
 */
import { describe, expect, it } from 'vitest';
import { normalizeQuery } from '@/lib/normalize-query';
import { normalizeUrl } from '@/lib/normalize-url';
import { countContentChars, countImageTags, normalizeContentText } from '@/lib/content-text';
import {
  extractBasicStructureFromHtml,
  extractOpeningProposalFromHtml,
} from '@/lib/html-content-extractor';

describe('@/lib/normalize-query', () => {
  describe('normalizeQuery', () => {
    it.each([null, undefined, '', '   '])(`%s は空文字を返す`, input => {
      expect(normalizeQuery(input)).toBe('');
    });

    it('NFKC正規化、小文字化、連続空白の畳み込みを行う', () => {
      expect(normalizeQuery('  ＧｒｏｗＭａｔｅ\t 検索　キーワード  ')).toBe(
        'growmate 検索 キーワード'
      );
    });
  });
});

describe('@/lib/normalize-url', () => {
  describe('normalizeUrl', () => {
    it.each([null, undefined, ''])(`%s は null を返す`, input => {
      expect(normalizeUrl(input)).toBeNull();
    });

    it('URL全体を小文字化し、プロトコル・www・末尾スラッシュを除去する', () => {
      expect(normalizeUrl('HTTPS://WWW.Example.COM/Path///')).toBe('example.com/path');
    });

    it('クエリとフラグメントを保持して小文字化する', () => {
      expect(normalizeUrl('https://Example.com/Path?Query=VALUE#Section')).toBe(
        'example.com/path?query=value#section'
      );
    });

    it('文字列末尾にあるクエリ値のスラッシュも除去する', () => {
      expect(normalizeUrl('https://Example.com/Path?Query=VALUE/')).toBe(
        'example.com/path?query=value'
      );
    });
  });
});

describe('@/lib/content-text', () => {
  describe('content-text', () => {
    it('空白とHTMLエンティティを正規化する', () => {
      expect(normalizeContentText('  A\n&nbsp; &amp; &lt; &gt; &quot; &#39; &#x3042;  ')).toBe(
        'A & < > " \' あ'
      );
    });

    it('正規化後の文字数を数える', () => {
      expect(countContentChars(' A  &amp;  B ')).toBe(5);
      expect(countContentChars(null)).toBe(0);
    });

    it('imgタグだけを数える', () => {
      expect(countImageTags('<p>x</p>')).toBe(0);
      expect(countImageTags('<img src="a"><IMG src="b" /><image src="c">')).toBe(2);
    });
  });
});

describe('@/lib/html-content-extractor', () => {
  describe('html-content-extractor', () => {
    describe('extractOpeningProposalFromHtml', () => {
      it('最初のh2より前にあるp要素だけを段落として抽出する', () => {
        const html = `
          <div>対象外のテキスト</div>
          <p>最初の<strong>段落</strong>です。</p>
          <p>2つ目の段落です。</p>
          <h2>最初の見出し</h2>
          <p>見出し後の段落です。</p>
        `;

        expect(extractOpeningProposalFromHtml(html)).toBe(
          '最初の段落です。\n\n2つ目の段落です。'
        );
      });

      it('空段落を除外しHTMLエンティティと空白を正規化する', () => {
        const html = `
          <p>  エアコン &amp; 室外機\n  の説明  </p>
          <p>   </p>
          <h2>見出し</h2>
        `;

        expect(extractOpeningProposalFromHtml(html)).toBe('エアコン & 室外機 の説明');
      });

      it('最初のh2より前にあるリスト項目を装飾を除いて出現順に抽出する', () => {
        const html = `
          <p>導入文です。</p>
          <div class="kj-highlight-box tip">
            <p class="kj-highlight-box-title">先に結論</p>
            <ul>
              <li>上限<strong>50万円</strong>。</li>
              <li><span>対象条件</span>を確認します。</li>
            </ul>
          </div>
          <ol><li>問い合わせ</li><li>申請</li></ol>
          <h2>最初の見出し</h2>
          <ul><li>見出し後の項目</li></ul>
        `;

        expect(extractOpeningProposalFromHtml(html)).toBe(
          '導入文です。\n\n先に結論\n\n・上限50万円。\n・対象条件を確認します。\n\n1.問い合わせ\n2.申請'
        );
      });

      it('h2がない場合は空文字を返す', () => {
        expect(extractOpeningProposalFromHtml('<p>冒頭文です。</p>')).toBe('');
      });
    });

    describe('extractBasicStructureFromHtml', () => {
      it('h2からh4までを出現順に抽出する', () => {
        const html = '<h2>概要</h2><h3>詳細</h3><h4>補足</h4>';

        expect(extractBasicStructureFromHtml(html)).toBe('h2 概要\nh3 詳細\nh4 補足');
      });
    });
  });
});
