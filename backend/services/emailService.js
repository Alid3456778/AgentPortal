// services/emailService.js
// Sends order confirmation emails FROM the lead-source's own email account

const nodemailer = require('nodemailer');

// ─── Map each lead source to its SMTP credentials from .env ───────────────
const getTransporter = (leadSource) => {
  const configs = {
    Truemed: {
      host:  process.env.TRUEMED_SMTP_HOST,
      port:  parseInt(process.env.TRUEMED_SMTP_PORT) || 587,
      user:  process.env.TRUEMED_SMTP_USER,
      pass:  process.env.TRUEMED_SMTP_PASS,
      name:  process.env.TRUEMED_FROM_NAME  || 'Truemed Orders',
      from:  process.env.TRUEMED_FROM_EMAIL,
    },
    Mcland: {
      host:  process.env.MCLAND_SMTP_HOST,
      port:  parseInt(process.env.MCLAND_SMTP_PORT) || 587,
      user:  process.env.MCLAND_SMTP_USER,
      pass:  process.env.MCLAND_SMTP_PASS,
      name:  process.env.MCLAND_FROM_NAME  || 'Mcland Orders',
      from:  process.env.MCLAND_FROM_EMAIL,
    },
    // New simplified lead sources (UI values)
    Syncore: {
      host:  process.env.SYNCORE_SMTP_HOST,
      port:  parseInt(process.env.SYNCORE_SMTP_PORT) || 587,
      user:  process.env.SYNCORE_SMTP_USER,
      pass:  process.env.SYNCORE_SMTP_PASS,
      name:  process.env.SYNCORE_FROM_NAME  || 'Syncore Orders',
      from:  process.env.SYNCORE_FROM_EMAIL,
    },
    Tradewave: {
      host:  process.env.TRADEWAVE_SMTP_HOST,
      port:  parseInt(process.env.TRADEWAVE_SMTP_PORT) || 587,
      user:  process.env.TRADEWAVE_SMTP_USER,
      pass:  process.env.TRADEWAVE_SMTP_PASS,
      name:  process.env.TRADEWAVE_FROM_NAME  || 'Tradewave Orders',
      from:  process.env.TRADEWAVE_FROM_EMAIL,
    },

    // Backward-compat (existing data / older UI values)
    Syncore_IndiaMart: {
      host:  process.env.SYNCORE_SMTP_HOST,
      port:  parseInt(process.env.SYNCORE_SMTP_PORT) || 587,
      user:  process.env.SYNCORE_SMTP_USER,
      pass:  process.env.SYNCORE_SMTP_PASS,
      name:  process.env.SYNCORE_FROM_NAME  || 'Syncore IndiaMart',
      from:  process.env.SYNCORE_FROM_EMAIL,
    },
    Tradewave_IndiaMart: {
      host:  process.env.TRADEWAVE_SMTP_HOST,
      port:  parseInt(process.env.TRADEWAVE_SMTP_PORT) || 587,
      user:  process.env.TRADEWAVE_SMTP_USER,
      pass:  process.env.TRADEWAVE_SMTP_PASS,
      name:  process.env.TRADEWAVE_FROM_NAME  || 'Tradewave IndiaMart',
      from:  process.env.TRADEWAVE_FROM_EMAIL,
    },
    Other: {
      host:  process.env.OTHER_SMTP_HOST,
      port:  parseInt(process.env.OTHER_SMTP_PORT) || 587,
      user:  process.env.OTHER_SMTP_USER,
      pass:  process.env.OTHER_SMTP_PASS,
      name:  process.env.OTHER_FROM_NAME  || 'PayerPortal Orders',
      from:  process.env.OTHER_FROM_EMAIL,
    },
  };

  const cfg = configs[leadSource] || configs['Other'];

  // If SMTP credentials are missing, return null (skip email silently)
  if (!cfg.user || !cfg.pass || !cfg.host || !cfg.from) {
    return null;
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  return { transporter, from: `"${cfg.name}" <${cfg.from}>` };
};

// ─── Build HTML email body ────────────────────────────────────────────────
const buildOrderEmail = (order, items) => {
  const itemRows = items.map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">${item.product_name}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${item.mg}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right">$${parseFloat(item.cost).toFixed(2)}</td>
    </tr>
  `).join('');

  const total = items.reduce((sum, i) => sum + parseFloat(i.cost), 0);

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:linear-gradient(135deg,#4f7cff,#38bdf8);padding:32px 40px">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">Order Confirmed ✓</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px">Order ID: <strong>${order.order_id}</strong></p>
    </div>
    <div style="padding:32px 40px">
      <p style="font-size:15px;color:#374151">Dear <strong>${order.first_name} ${order.last_name}</strong>,</p>
      <p style="font-size:14px;color:#6b7280;line-height:1.6">
        Thank you for your order. Here is a summary of what was placed on
        <strong>${new Date(order.order_date).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })}</strong>.
      </p>

      <h3 style="font-size:14px;font-weight:700;color:#111827;margin:24px 0 12px;text-transform:uppercase;letter-spacing:0.5px">Items Ordered</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase">Product</th>
            <th style="padding:10px 12px;text-align:center;color:#6b7280;font-size:12px;text-transform:uppercase">Qty</th>
            <th style="padding:10px 12px;text-align:center;color:#6b7280;font-size:12px;text-transform:uppercase">MG</th>
            <th style="padding:10px 12px;text-align:right;color:#6b7280;font-size:12px;text-transform:uppercase">Cost</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr style="background:#f9fafb">
            <td colspan="3" style="padding:12px;font-weight:700;color:#111827">Total</td>
            <td style="padding:12px;font-weight:700;color:#111827;text-align:right">$${total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <h3 style="font-size:14px;font-weight:700;color:#111827;margin:24px 0 12px;text-transform:uppercase;letter-spacing:0.5px">Delivery Address</h3>
      <p style="font-size:14px;color:#374151;line-height:1.8;margin:0">
        ${order.street_address}<br/>
        ${order.city}, ${order.state} — ${order.pincode}<br/>
        ${order.country}
      </p>

      ${order.tracking_id ? `
      <div style="margin-top:24px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px">
        <p style="margin:0;font-size:14px;color:#166534">
          🚚 <strong>Tracking ID:</strong> ${order.tracking_id}
        </p>
      </div>` : ''}

      <p style="font-size:13px;color:#9ca3af;margin-top:32px;border-top:1px solid #e5e7eb;padding-top:20px">
        If you have any questions, please reply to this email or contact your agent.
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

// ─── Main export: send order confirmation ────────────────────────────────
const sendOrderConfirmation = async (order, items) => {
  const transport = getTransporter(order.lead_source);

  if (!transport) {
    console.log(`[EMAIL] Skipped — no SMTP config for lead source: ${order.lead_source}`);
    return { sent: false, reason: 'No SMTP config' };
  }

  try {
    const info = await transport.transporter.sendMail({
      from:    transport.from,
      to:      order.email,
      subject: `Your Order ${order.order_id} is Confirmed!`,
      html:    buildOrderEmail(order, items),
    });
    console.log(`[EMAIL] Sent to ${order.email} via ${order.lead_source}: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL] Failed for ${order.lead_source}:`, err.message);
    return { sent: false, reason: err.message };
  }
};

module.exports = { sendOrderConfirmation };
