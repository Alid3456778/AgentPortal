// services/adminOtpEmailService.js
// Sends admin OTP emails for forgot-password flow.

const nodemailer = require('nodemailer');

const getSmtpConfig = () => {
  // Prefer ADMIN_* SMTP config if provided, otherwise fallback to OTHER_*.
  const admin = {
    host: process.env.ADMIN_SMTP_HOST,
    port: process.env.ADMIN_SMTP_PORT ? parseInt(process.env.ADMIN_SMTP_PORT) : undefined,
    user: process.env.ADMIN_SMTP_USER,
    pass: process.env.ADMIN_SMTP_PASS,
    fromName: process.env.ADMIN_FROM_NAME,
    fromEmail: process.env.ADMIN_FROM_EMAIL,
  };

  const other = {
    host: process.env.OTHER_SMTP_HOST,
    port: process.env.OTHER_SMTP_PORT ? parseInt(process.env.OTHER_SMTP_PORT) : undefined,
    user: process.env.OTHER_SMTP_USER,
    pass: process.env.OTHER_SMTP_PASS,
    fromName: process.env.OTHER_FROM_NAME,
    fromEmail: process.env.OTHER_FROM_EMAIL,
  };

  const cfg = (admin.host && admin.user && admin.pass && admin.fromEmail) ? admin : other;
  if (!cfg.host || !cfg.user || !cfg.pass || !cfg.fromEmail) {
    console.error('[ADMIN-OTP] SMTP Configuration is incomplete. Check your .env file.');
    return null;
  }

  return {
    host: cfg.host,
    port: cfg.port || 587,
    secure: (cfg.port || 587) === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    from: `"${cfg.fromName || 'PayerPortal Admin'}" <${cfg.fromEmail}>`,
    tls: { rejectUnauthorized: false } // Helps with connection issues in many environments
  };
};

const buildOtpHtml = ({ otp, adminName, adminId, ttlMinutes }) => {
  return `
<!doctype html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#4f7cff,#38bdf8);padding:26px 30px">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700">Admin Verification Code</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:13px">PayerPortal</p>
    </div>
    <div style="padding:26px 30px">
      <p style="margin:0 0 10px;font-size:14px;color:#374151">Hi <strong>${adminName || 'Admin'}</strong>,</p>
      <p style="margin:0 0 16px;font-size:14px;color:#6b7280;line-height:1.6">
        Use the verification code below to reset your Admin credentials for <strong>${adminId}</strong>.
        This code expires in <strong>${ttlMinutes}</strong> minutes.
      </p>
      <div style="font-size:28px;letter-spacing:6px;font-weight:800;color:#111827;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;text-align:center">
        ${otp}
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;line-height:1.6">
        If you didn’t request this, you can ignore this email.
      </p>
    </div>
  </div>
</body>
</html>`;
};

const sendAdminOtp = async (toEmail, otp, meta = {}) => {
  const smtp = getSmtpConfig();
  if (!smtp) {
    console.log('[ADMIN-OTP] Skipped — missing SMTP config');
    return { sent: false, reason: 'missing_smtp' };
  }

  console.log(`[ADMIN-OTP] Attempting to send OTP to: ${toEmail} via ${smtp.host}`);
  if (!toEmail) {
    return { sent: false, reason: 'no_recipient_email' };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.auth,
  });

  try {
    const info = await transporter.sendMail({
      from: smtp.from,
      to: toEmail,
      subject: 'PayerPortal Admin OTP',
      html: buildOtpHtml({ otp, ...meta }),
    });
    console.log('[ADMIN-OTP] Sent:', info.messageId);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('[ADMIN-OTP] Failed:', err.message);
    return { sent: false, reason: err.message };
  }
};

module.exports = { sendAdminOtp };
