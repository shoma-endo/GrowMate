'use strict';

/**
 * GitHub Actions ワークフロー用 Lark（飛書）Webhook 通知の共通ヘルパー。
 * Node標準モジュールのみに依存（npm ci なしで `node scripts/lark-notify.cjs` から require 可能）。
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

// lark_md のMarkdown/メンション記法として解釈されないよう、外部由来のテキストをエスケープする
function escapeLarkMd(value) {
  return String(value).replace(/[*_~`[<]/g, (char) => `${char}${ZERO_WIDTH_SPACE}`);
}

function div(content) {
  return { tag: 'div', text: { tag: 'lark_md', content } };
}

function hr() {
  return { tag: 'hr' };
}

function note(content) {
  return { tag: 'note', elements: [{ tag: 'lark_md', content }] };
}

// chartSpec は VChart の定義。関数や JS 構文は Lark 側で解釈されない
function chart(chartSpec, { aspectRatio = '16:9' } = {}) {
  return { tag: 'chart', aspect_ratio: aspectRatio, chart_spec: chartSpec };
}

// columns: [{ name, display_name, data_type, width?, format? }]、rows: name をキーにしたオブジェクト。
// page_size は Lark の上限が 10
function table(columns, rows, { pageSize = 10 } = {}) {
  return { tag: 'table', page_size: pageSize, row_height: 'low', columns, rows };
}

// template: 'red' | 'orange' | 'blue' | 'green'（Lark card header の色）
function sendLarkCard({ webhookUrl, title, template, elements }) {
  return new Promise((resolve, reject) => {
    if (!webhookUrl) {
      reject(new Error('webhookUrl が設定されていません'));
      return;
    }

    // GitHub Actions ログでWebhook URL（機密値）をマスクする。以降のログ出力全体に効く
    console.log(`::add-mask::${webhookUrl}`);
    console.log('Webhook URL: [masked]');

    let url;
    try {
      url = new URL(webhookUrl);
    } catch (error) {
      reject(new Error(`Invalid webhook URL: ${error.message}`));
      return;
    }

    const payload = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: title },
          template,
        },
        elements,
      },
    };

    const client = url.protocol === 'https:' ? https : http;
    const postData = JSON.stringify(payload);
    console.log('Payload size:', postData.length, 'bytes');

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 30000, // 30秒のタイムアウト
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log('Response status:', res.statusCode);
        // Lark はカードの形式エラーなども HTTP 200 で返し、本文の code で失敗を示す
        let larkCode = 0;
        try {
          const parsed = JSON.parse(data);
          if (typeof parsed.code === 'number') {
            larkCode = parsed.code;
          }
        } catch {
          // 本文が JSON でない場合は HTTP ステータスだけで判定する
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && larkCode !== 0) {
          console.error(`❌ Webhook notification rejected by Lark (code ${larkCode})`);
          console.error('Response body:', data.substring(0, 500));
          reject(new Error(`Lark code ${larkCode}`));
        } else if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ Webhook notification sent successfully');
          console.log('Response body:', data.substring(0, 500)); // 最初の500文字のみ
          resolve();
        } else {
          console.error(`❌ Webhook notification failed with status ${res.statusCode}`);
          console.error('Response body:', data);
          reject(new Error(`Webhook HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Webhook notification error:', error.message);
      reject(error);
    });

    req.on('timeout', () => {
      console.error('❌ Webhook request timeout');
      req.destroy();
      reject(new Error('Webhook request timeout'));
    });

    console.log('Sending webhook request...');
    req.write(postData);
    req.end();
  });
}

module.exports = { escapeLarkMd, sendLarkCard, div, hr, note, chart, table };
