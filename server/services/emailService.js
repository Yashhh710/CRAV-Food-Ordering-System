let nodemailerPkg = null;
try {
  nodemailerPkg = require('nodemailer');
} catch (e) {}

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!nodemailerPkg) return null;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    transporter = nodemailerPkg.createTransport({
      host: host,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass }
    });
  }
  return transporter;
}

async function sendOtpEmail(email, otp, firstName = 'Food Lover') {
  const mailTransporter = getTransporter();

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eee; border-radius: 12px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #D90019; margin: 0; font-size: 28px; letter-spacing: 2px;">CRAV</h1>
        <p style="color: #8F1420; font-size: 14px; margin-top: 4px;">From Craving to Doorstep</p>
      </div>
      <div style="padding: 20px; background-color: #FFF9E9; border-radius: 8px; border-left: 4px solid #D90019; margin-bottom: 24px;">
        <h2 style="color: #080808; font-size: 18px; margin-top: 0;">Verify Your Email Address</h2>
        <p style="color: #444; font-size: 15px; line-height: 1.5;">Hello <strong>${firstName}</strong>,</p>
        <p style="color: #444; font-size: 15px; line-height: 1.5;">Thank you for registering with CRAV. Use the verification code below to activate your account. This code is valid for <strong>5 minutes</strong>.</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #D90019; background: #ffffff; padding: 12px 28px; border-radius: 8px; border: 2px dashed #D90019;">${otp}</span>
        </div>
        <p style="color: #777; font-size: 13px; margin-bottom: 0;">If you did not request this code, you can safely ignore this email.</p>
      </div>
      <div style="text-align: center; color: #999; font-size: 12px; border-top: 1px solid #f0f0f0; padding-top: 16px;">
        © 2026 CRAV. All rights reserved. • Opening Hours: Every Day 11:00 AM - 11:00 PM
      </div>
    </div>
  `;

  console.log('\n======================================================');
  console.log(`🔑 [CRAV OTP NOTIFICATION]`);
  console.log(`✉️  Sent to: ${email}`);
  console.log(`🔢  Verification Code: ${otp}`);
  console.log(`⏳  Expires in: 5 minutes`);
  console.log('======================================================\n');

  if (mailTransporter) {
    try {
      await mailTransporter.sendMail({
        from: process.env.EMAIL_FROM || '"CRAV" <no-reply@crav.example>',
        to: email,
        subject: `${otp} is your CRAV verification code`,
        html: htmlContent
      });
      console.log(`✅ Real email successfully sent to ${email}`);
      return { success: true, delivered: true };
    } catch (err) {
      console.warn(`⚠️ SMTP error sending to ${email}:`, err.message);
      // Fallback is logged to console above
      return { success: true, delivered: false, note: 'Simulated via console log' };
    }
  }

  return { success: true, delivered: false, note: 'Simulated via console log (SMTP not configured)' };
}

module.exports = {
  sendOtpEmail
};
