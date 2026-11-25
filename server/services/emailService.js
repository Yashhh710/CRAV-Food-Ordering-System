
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      'SMTP is not configured. Check SMTP_HOST, SMTP_USER and SMTP_PASS.'
    );
  }

  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);

    transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user,
        pass
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000
    });
  }

  return transporter;
}

async function sendOtpEmail(email, otp, firstName = 'Food Lover') {
  const mailTransporter = getTransporter();

  const safeName = String(firstName).replace(/[<>&"']/g, '');

  const htmlContent = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;background:#fff;border:1px solid #eee;border-radius:12px;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="color:#D90019;margin:0;font-size:28px;letter-spacing:2px;">CRAV</h1>
        <p style="color:#8F1420;font-size:14px;">From Craving to Doorstep</p>
      </div>

      <div style="padding:20px;background:#FFF9E9;border-radius:8px;border-left:4px solid #D90019;">
        <h2 style="color:#080808;font-size:18px;">Verify Your Email Address</h2>

        <p style="color:#444;">Hello <strong>${safeName}</strong>,</p>

        <p style="color:#444;line-height:1.6;">
          Thank you for registering with CRAV.
          Use the verification code below to activate your account.
          This code is valid for <strong>5 minutes</strong>.
        </p>

        <div style="text-align:center;margin:30px 0;">
          <span style="display:inline-block;font-size:32px;font-weight:bold;letter-spacing:8px;color:#D90019;background:#fff;padding:12px 28px;border-radius:8px;border:2px dashed #D90019;">
            ${otp}
          </span>
        </div>

        <p style="color:#777;font-size:13px;">
          If you did not request this code, safely ignore this email.
        </p>
      </div>

      <div style="text-align:center;color:#999;font-size:12px;padding-top:16px;">
        © 2026 CRAV. All rights reserved.
      </div>
    </div>
  `;

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  if (!from) {
    throw new Error('EMAIL_FROM or SMTP_USER must be configured.');
  }

  try {
    const info = await mailTransporter.sendMail({
      from: `"CRAV" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `${otp} is your CRAV verification code`,
      text: `Hello ${safeName}, your CRAV verification code is ${otp}. It expires in 5 minutes.`,
      html: htmlContent
    });

    console.log('CRAV email accepted by SMTP:', {
      to: email,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected
    });

    if (!info.accepted || info.accepted.length === 0) {
      throw new Error('SMTP did not accept the recipient.');
    }

    return {
      success: true,
      delivered: true,
      messageId: info.messageId
    };

  } catch (error) {
    console.error('CRAV SMTP DELIVERY ERROR:', {
      message: error.message,
      code: error.code,
      command: error.command,
      responseCode: error.responseCode
    });

    throw error;
  }
}

async function verifyEmailConnection() {
  const mailTransporter = getTransporter();
  return mailTransporter.verify();
}

module.exports = {
  sendOtpEmail,
  verifyEmailConnection
};
