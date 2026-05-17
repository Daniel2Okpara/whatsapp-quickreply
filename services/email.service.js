const { Resend } = require('resend');

const apiKey = process.env.RESEND_API_KEY;
const resend = apiKey ? new Resend(apiKey) : null;

if (!resend) {
  console.warn('[Email Service] RESEND_API_KEY is missing. Emails will not be sent.');
}

const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
  
  try {
    if (!resend) {
      console.error('[Email Service] Cannot send verification email: Resend not initialized');
      return;
    }

    await resend.emails.send({
      from: 'WA QuickReply <onboarding@auth.wa-quick-reply.com>', 
      to: email,
      subject: 'Verify your WA QuickReply account',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin: 0; padding: 0; background-color: #0f172a; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';">
          <div style="max-width: 600px; margin: 40px auto; background-color: #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4); border: 1px solid #334155;">
            <div style="padding: 40px; text-align: center; border-bottom: 1px solid #334155; background: linear-gradient(180deg, rgba(37,211,102,0.1) 0%, rgba(30,41,59,0) 100%);">
              <h1 style="color: #f8fafc; font-size: 24px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">Welcome to WA QuickReply!</h1>
            </div>
            <div style="padding: 40px;">
              <p style="color: #cbd5e1; font-size: 16px; line-height: 1.6; margin-top: 0;">Hi there,</p>
              <p style="color: #cbd5e1; font-size: 16px; line-height: 1.6;">Thank you for joining WA QuickReply, the smartest WhatsApp Assistant. Please verify your email address to unlock your account and start saving hours of typing.</p>
              
              <div style="text-align: center; margin: 40px 0;">
                <a href="${verificationUrl}" style="display: inline-block; background: linear-gradient(135deg, #25D366 0%, #1ea350 100%); color: #ffffff; padding: 14px 32px; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 14px rgba(37, 211, 102, 0.4);">Verify Email Address</a>
              </div>
              
              <p style="color: #94a3b8; font-size: 14px; line-height: 1.5; margin-bottom: 0;">This verification link will expire in 24 hours.</p>
              <p style="color: #94a3b8; font-size: 14px; line-height: 1.5;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #3b82f6; font-size: 13px;"><a href="${verificationUrl}" style="color: #25D366;">${verificationUrl}</a></p>
            </div>
            <div style="padding: 24px 40px; background-color: #0f172a; text-align: center; border-top: 1px solid #334155;">
              <p style="color: #64748b; font-size: 12px; margin: 0;">Need help? Reply to this email or reach out to <a href="mailto:support@wa-quick-reply.com" style="color: #25D366; text-decoration: none;">support@wa-quick-reply.com</a></p>
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
  const verificationUrl = `${process.env.FRONTEND_URL}/confirm-email-change?token=${token}&email=${encodeURIComponent(email)}`;
  
  try {
    if (!resend) {
      console.error('[Email Service] Cannot send change verification: Resend not initialized');
      return;
    }
    await resend.emails.send({
      from: 'WA QuickReply <onboarding@auth.wa-quick-reply.com>',
      to: email,
      subject: 'Confirm your new email address',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="margin: 0; padding: 0; background-color: #0f172a; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="max-width: 600px; margin: 40px auto; background-color: #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4); border: 1px solid #334155;">
            <div style="padding: 40px; text-align: center; border-bottom: 1px solid #334155; background: linear-gradient(180deg, rgba(37,211,102,0.1) 0%, rgba(30,41,59,0) 100%);">
              <h1 style="color: #f8fafc; font-size: 24px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">Confirm Email Change</h1>
            </div>
            <div style="padding: 40px;">
              <p style="color: #cbd5e1; font-size: 16px; line-height: 1.6; margin-top: 0;">Hello,</p>
              <p style="color: #cbd5e1; font-size: 16px; line-height: 1.6;">You requested to change your email address for WA QuickReply. Please click the button below to confirm this change.</p>
              
              <div style="text-align: center; margin: 40px 0;">
                <a href="${verificationUrl}" style="display: inline-block; background: linear-gradient(135deg, #25D366 0%, #1ea350 100%); color: #ffffff; padding: 14px 32px; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px; box-shadow: 0 4px 14px rgba(37, 211, 102, 0.4);">Confirm Email Change</a>
              </div>
              
              <p style="color: #94a3b8; font-size: 14px; line-height: 1.5; margin-bottom: 0;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #3b82f6; font-size: 13px;"><a href="${verificationUrl}" style="color: #25D366;">${verificationUrl}</a></p>
            </div>
            <div style="padding: 24px 40px; background-color: #0f172a; text-align: center; border-top: 1px solid #334155;">
              <p style="color: #64748b; font-size: 12px; margin: 0;">If you did not request this change, you can safely ignore this email.</p>
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
