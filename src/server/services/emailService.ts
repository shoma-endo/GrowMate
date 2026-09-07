import { Resend } from 'resend';
import { env } from '@/env';

const DEFAULT_EMAIL_FROM = 'GrowMate <noreply@mail.growmate.tokyo>';

export class EmailService {
  private resendClient: Resend | null = null;

  private getResendClient(): Resend | null {
    if (!env.RESEND_API_KEY) {
      return null;
    }

    if (!this.resendClient) {
      this.resendClient = new Resend(env.RESEND_API_KEY);
    }

    return this.resendClient;
  }

  async sendGoogleAdsAnalysis(
    to: string,
    subject: string,
    htmlContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const resendClient = this.getResendClient();
      if (!resendClient) {
        console.error('[EmailService] RESEND_API_KEY is not configured');
        return {
          success: false,
          error: 'RESEND_API_KEY is not configured',
        };
      }

      const emailFrom = process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
      const response = await resendClient.emails.send({
        from: emailFrom,
        to,
        subject,
        html: htmlContent,
      });

      if (response.error) {
        console.error('[EmailService] Failed to send Google Ads analysis email:', response.error);
        return {
          success: false,
          error: response.error.message,
        };
      }

      return {
        success: true,
        messageId: response.data?.id,
      };
    } catch (error) {
      console.error('[EmailService] Unexpected email send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'メール送信に失敗しました',
      };
    }
  }

  async sendGoogleAdsNegativeKeywords(
    to: string,
    subject: string,
    htmlContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.sendGoogleAdsAnalysis(to, subject, htmlContent);
  }

  /**
   * GA4コンテンツ評価サイクルの完了通知（§9.5）。既存2メソッドと送信処理を共有するが、
   * BR-12の冪等性を担保するため Idempotency-Key（評価履歴行のid）を渡す点が異なる
   * （公式仕様は §16「Resend — レート制限・クォータ・冪等キー」）。
   */
  async sendGa4ContentEvaluation(
    to: string,
    subject: string,
    htmlContent: string,
    idempotencyKey: string
  ): Promise<{ success: boolean; messageId?: string; error?: string; errorName?: string }> {
    try {
      const resendClient = this.getResendClient();
      if (!resendClient) {
        console.error('[EmailService] RESEND_API_KEY is not configured');
        return {
          success: false,
          error: 'RESEND_API_KEY is not configured',
        };
      }

      const emailFrom = process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
      const response = await resendClient.emails.send(
        { from: emailFrom, to, subject, html: htmlContent },
        { idempotencyKey }
      );

      if (response.error) {
        console.error('[EmailService] Failed to send GA4 content evaluation email:', response.error);
        return {
          success: false,
          error: response.error.message,
          errorName: response.error.name,
        };
      }

      return {
        success: true,
        messageId: response.data?.id,
      };
    } catch (error) {
      console.error('[EmailService] Unexpected email send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'メール送信に失敗しました',
      };
    }
  }

  /**
   * AI要約一括のバックグラウンド実行の完了通知（BR-B06）。
   * 引数形は `sendGa4ContentEvaluation` に揃える（cron + メール + 冪等という同じ構図）。
   *
   * `idempotencyKey` にはジョブ ID（UUID）を渡す。1ジョブ1通なのでキーの意味が一致する。
   * **送信成功後・`notified_at` 更新前のハードキル窓を塞ぐのはこのキーだけ**
   * （`maxRetries: 1` と `notified_at` の2段では塞げない）。
   */
  async sendContentAnnotationSummaryCompletion(
    to: string,
    subject: string,
    htmlContent: string,
    idempotencyKey: string
  ): Promise<{ success: boolean; messageId?: string; error?: string; errorName?: string }> {
    try {
      const resendClient = this.getResendClient();
      if (!resendClient) {
        console.error('[EmailService] RESEND_API_KEY is not configured');
        return {
          success: false,
          error: 'RESEND_API_KEY is not configured',
        };
      }

      const emailFrom = process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
      const response = await resendClient.emails.send(
        { from: emailFrom, to, subject, html: htmlContent },
        { idempotencyKey }
      );

      if (response.error) {
        console.error(
          '[EmailService] Failed to send content annotation summary email:',
          response.error
        );
        return {
          success: false,
          error: response.error.message,
          errorName: response.error.name,
        };
      }

      return {
        success: true,
        messageId: response.data?.id,
      };
    } catch (error) {
      console.error('[EmailService] Unexpected email send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'メール送信に失敗しました',
      };
    }
  }
}

export const emailService = new EmailService();
