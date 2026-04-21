import { Resend } from 'resend';
import { env } from '@/env';

export class EmailService {
  async sendGoogleAdsAnalysis(
    to: string,
    subject: string,
    htmlContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!env.RESEND_API_KEY) {
        console.error('[EmailService] RESEND_API_KEY is not configured');
        return {
          success: false,
          error: 'RESEND_API_KEY is not configured',
        };
      }

      const resend = new Resend(env.RESEND_API_KEY);
      const response = await resend.emails.send({
        from: 'GrowMate <noreply@mail.growmate.tokyo>',
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
}
