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
      from: 'WA QuickReply <onboarding@resend.dev>', 
      to: email,
      subject: 'Verify your WA QuickReply account',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #25D366;">Welcome!</h2>
          <p>Verify your account to start using WA QuickReply Pro.</p>
          <a href="${verificationUrl}" style="display: inline-block; background-color: #25D366; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 10px;">Verify Email</a>
        </div>
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
    await resend.emails.send({
      from: 'WA QuickReply <security@resend.dev>',
      to: email,
      subject: 'Confirm your new email address',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #25D366;">Confirm Email Change</h2>
          <p>You requested to change your email address for WA QuickReply. Please click the button below to confirm this change.</p>
          <a href="${verificationUrl}" style="display: inline-block; background-color: #25D366; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 10px;">Confirm Email Change</a>
          <p style="margin-top: 20px; font-size: 12px; color: #777;">If you did not request this change, you can safely ignore this email.</p>
        </div>
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
