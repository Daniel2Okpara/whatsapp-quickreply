const { Resend } = require('resend');

const apiKey = process.env.RESEND_API_KEY;
const resend = apiKey ? new Resend(apiKey) : null;

if (!resend) {
  console.warn('[Email Service] RESEND_API_KEY is missing. Emails will not be sent.');
}

const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  const logoUrl = `${process.env.FRONTEND_URL}/assets/logo.png`;
  
  try {
    if (!resend) {
      console.error('[Email Service] Cannot send verification email: Resend not initialized');
      return;
    }

    await resend.emails.send({
      from: 'WA QuickReply <verify@auth.wa-quick-reply.com>', 
      to: email,
      reply_to: 'support@wa-quick-reply.com',
      subject: 'Verify your email address for WA QuickReply',
      text: `Hi there,\n\nPlease verify your email address to unlock your account and start saving hours of typing on WhatsApp.\n\nClick the link below to verify:\n${verificationUrl}\n\nIf the link doesn't work, copy and paste it into your browser.\n\nThanks,\nThe WA QuickReply Team`,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <!-- Header with Logo -->
            <div style="text-align: center; padding: 32px 0; border-bottom: 1px solid #e2e8f0;">
              <img src="${logoUrl}" alt="WA QuickReply" style="height: 48px; width: auto; margin-bottom: 12px;">
              <h1 style="margin: 0; font-size: 20px; color: #111; font-weight: 700;">WA QuickReply</h1>
            </div>
            
            <!-- Main Content -->
            <div style="background: #ffffff; border-radius: 18px; padding: 40px; margin-top: 20px; box-shadow: 0 24px 80px rgba(0,0,0,0.08);">
              <h2 style="font-size: 24px; margin: 0 0 16px; text-align: center; color: #111;">Verify your email</h2>
              <p style="font-size: 16px; line-height: 1.6; color: #4b5563; text-align: center; margin: 0 0 28px;">Thank you for joining WA QuickReply, the smartest WhatsApp Assistant. Click the button below to verify your email and start saving hours of typing on WhatsApp Web.</p>
              
              <div style="text-align: center; margin-bottom: 32px;">
                <a href="${verificationUrl}" style="display: inline-block; background: #25d366; color: white; padding: 14px 32px; border-radius: 999px; text-decoration: none; font-weight: 700; font-size: 16px;">Verify Email Address</a>
              </div>
              
              <p style="font-size: 14px; color: #6b7280; line-height: 1.7; margin: 24px 0 0 0;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="font-size: 13px; color: #2563eb; word-break: break-all; margin: 8px 0 0 0;"><a href="${verificationUrl}" style="color: #2563eb; text-decoration: none;">${verificationUrl}</a></p>
              
              <p style="font-size: 13px; color: #94a3b8; margin-top: 24px; padding-top: 24px; border-top: 1px solid #e2e8f0;">This verification link will expire in 24 hours.</p>
            </div>
            
            <!-- Branded Footer -->
            <div style="text-align: center; padding: 40px 0; color: #64748b; font-size: 14px;">
              <p style="margin: 0 0 12px 0; font-weight: 600; color: #1e293b;">WA QuickReply</p>
              <p style="margin: 0 0 16px 0; color: #94a3b8;">AI-powered replies for WhatsApp Web</p>
              <p style="margin: 0 0 24px 0;">
                <a href="https://www.wa-quick-reply.com" style="color: #2563eb; text-decoration: none;">https://www.wa-quick-reply.com</a>
              </p>
              <p style="margin: 0 0 4px 0; font-weight: 600; color: #1e293b;">Need help?</p>
              <p style="margin: 0;"><a href="mailto:support@wa-quick-reply.com" style="color: #2563eb; text-decoration: none;">support@wa-quick-reply.com</a></p>
            </div>
          </div>
        </body>
        </html>
      `
    });
    console.log(`[Email Service] Verification email sent to ${email}`);
  } catch (error) {
    console.error('[Email Service] Error sending verification email', error.message);
  }
};

const sendEmailChangeVerification = async (email, token) => {
  const verificationUrl = `${process.env.FRONTEND_URL}/confirm-email-change?token=${token}`;
  const logoUrl = `${process.env.FRONTEND_URL}/assets/logo.png`;
  
  try {
    if (!resend) {
      console.error('[Email Service] Cannot send change verification: Resend not initialized');
      return;
    }
    await resend.emails.send({
      from: 'WA QuickReply <verify@auth.wa-quick-reply.com>',
      to: email,
      reply_to: 'support@wa-quick-reply.com',
      subject: 'Confirm your new email address',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <!-- Header with Logo -->
            <div style="text-align: center; padding: 32px 0; border-bottom: 1px solid #e2e8f0;">
              <img src="${logoUrl}" alt="WA QuickReply" style="height: 48px; width: auto; margin-bottom: 12px;">
              <h1 style="margin: 0; font-size: 20px; color: #111; font-weight: 700;">WA QuickReply</h1>
            </div>
            
            <!-- Main Content -->
            <div style="background: #ffffff; border-radius: 18px; padding: 40px; margin-top: 20px; box-shadow: 0 24px 80px rgba(0,0,0,0.08);">
              <h2 style="font-size: 24px; margin: 0 0 16px; text-align: center; color: #111;">Confirm Email Change</h2>
              <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 28px 0;">Hello,</p>
              <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 28px 0;">You requested to change your email address for WA QuickReply. Please click the button below to confirm this change.</p>
              
              <div style="text-align: center; margin-bottom: 32px;">
                <a href="${verificationUrl}" style="display: inline-block; background: #25d366; color: white; padding: 14px 32px; border-radius: 999px; text-decoration: none; font-weight: 700; font-size: 16px;">Confirm Email Change</a>
              </div>
              
              <p style="font-size: 14px; color: #6b7280; line-height: 1.7; margin: 24px 0 0 0;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="font-size: 13px; color: #2563eb; word-break: break-all; margin: 8px 0 0 0;"><a href="${verificationUrl}" style="color: #2563eb; text-decoration: none;">${verificationUrl}</a></p>
              
              <p style="font-size: 13px; color: #94a3b8; margin-top: 24px; padding-top: 24px; border-top: 1px solid #e2e8f0;">If you did not request this change, you can safely ignore this email.</p>
            </div>
            
            <!-- Branded Footer -->
            <div style="text-align: center; padding: 40px 0; color: #64748b; font-size: 14px;">
              <p style="margin: 0 0 12px 0; font-weight: 600; color: #1e293b;">WA QuickReply</p>
              <p style="margin: 0 0 16px 0; color: #94a3b8;">AI-powered replies for WhatsApp Web</p>
              <p style="margin: 0 0 24px 0;">
                <a href="https://www.wa-quick-reply.com" style="color: #2563eb; text-decoration: none;">https://www.wa-quick-reply.com</a>
              </p>
              <p style="margin: 0 0 4px 0; font-weight: 600; color: #1e293b;">Need help?</p>
              <p style="margin: 0;"><a href="mailto:support@wa-quick-reply.com" style="color: #2563eb; text-decoration: none;">support@wa-quick-reply.com</a></p>
            </div>
          </div>
        </body>
        </html>
      `
    });
  } catch (error) {
    console.error('[Email Service] Error sending email change verification', error);
    throw new Error('Failed to send confirmation email');
  }
};

module.exports = {
  sendVerificationEmail,
  sendEmailChangeVerification
};
