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
}

export const emailService = new EmailService();
