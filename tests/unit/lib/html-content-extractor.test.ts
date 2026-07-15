import { describe, expect, it } from 'vitest';

import {
  extractBasicStructureFromHtml,
  extractOpeningProposalFromHtml,
} from '@/lib/html-content-extractor';

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
