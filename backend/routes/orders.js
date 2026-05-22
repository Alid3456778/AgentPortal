// routes/orders.js — v2 (multiple medicines, customer upsert, email)
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../db/connection');
const { verifyToken, agentOnly } = require('../middleware/auth');
const { sendOrderConfirmation, sendTrackingUpdate } = require('../services/emailService');

const router = express.Router();

// Accept simplified lead sources; keep old values for backward compatibility with existing data.
const LEAD_SOURCES = ['Truemed','Mcland','Syncore','Tradewave','Other','Syncore_IndiaMart','Tradewave_IndiaMart'];

const generateOrderId = () => {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const rand = Math.floor(1000+Math.random()*9000);
  return `ORD${yy}${mm}${dd}${rand}`;
};

// ── Validation ─────────────────────────────────────────────────────────────
const orderValidation = [
  body('first_name').trim().notEmpty().withMessage('First name is required'),
  body('last_name').trim().notEmpty().withMessage('Last name is required'),
  body('street_address').trim().notEmpty().withMessage('Street address is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('state').trim().notEmpty().withMessage('State is required'),
  body('pincode').trim().notEmpty().withMessage('Pincode is required'),
  body('country').trim().notEmpty().withMessage('Country is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('email').trim().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('lead_source').isIn(LEAD_SOURCES).withMessage('Invalid lead source'),
  body('payment_mode').trim().notEmpty().withMessage('Payment mode is required'),
  body('order_info').trim().notEmpty().withMessage('Order info is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one medicine item is required'),
  body('items.*.product_name').trim().notEmpty().withMessage('Product name required for each item'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be >= 1 for each item'),
  body('items.*.mg').trim().notEmpty().withMessage('MG required for each item'),
  body('items.*.cost').isFloat({ min: 0 }).withMessage('Cost must be >= 0 for each item'),
  body('tracking_id').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
];

// ── POST /api/orders — Submit new order (multiple items) ───────────────────
router.post('/', verifyToken, agentOnly, orderValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    first_name, last_name, street_address, city, state, pincode, country,
    phone, email, lead_source, payment_mode, order_info, tracking_id, notes, items,
  } = req.body;

  const agent_id   = req.user.login_id;
  const agent_name = req.user.name;
  
  // console.log("Lead source:", req.body.lead_source);
  // console.log("Order info:", req.body.order_info);

  const client = await require('../db/connection').pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Upsert customer by phone (unique identifier)
    await client.query(`
      INSERT INTO customers (phone, first_name, last_name, email, street_address, city, state, pincode, country)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (phone) DO UPDATE SET
        first_name     = EXCLUDED.first_name,
        last_name      = EXCLUDED.last_name,
        email          = EXCLUDED.email,
        street_address = EXCLUDED.street_address,
        city           = EXCLUDED.city,
        state          = EXCLUDED.state,
        pincode        = EXCLUDED.pincode,
        country        = EXCLUDED.country,
        updated_at     = NOW();
    `, [phone, first_name, last_name, email, street_address, city, state, pincode, country]);

    // 2. Generate unique order_id
    let order_id = generateOrderId();
    const existing = await client.query('SELECT id FROM orders WHERE order_id=$1', [order_id]);
    if (existing.rows.length > 0) order_id = generateOrderId();

    // 3. Insert order
    const orderResult = await client.query(`
      INSERT INTO orders (
        order_id, agent_id, agent_name, lead_source, payment_mode, order_info, customer_phone,
        first_name, last_name, street_address, city, state, pincode, country,
        phone, email, tracking_id, notes, order_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'placed')
      RETURNING *;
    `, [order_id, agent_id, agent_name, lead_source, payment_mode, order_info, phone,
        first_name, last_name, street_address, city, state, pincode, country,
        phone, email, tracking_id||null, notes||null]);

    const order = orderResult.rows[0];

    // 4. Insert all items
    for (const item of items) {
      await client.query(`
        INSERT INTO order_items (order_id, product_name, quantity, mg, cost)
        VALUES ($1,$2,$3,$4,$5);
      `, [order_id, item.product_name.trim(), item.quantity, item.mg.trim(), item.cost]);
    }

    await client.query('COMMIT');

    // 5. Send confirmation email (non-blocking — don't fail order if email fails)
    sendOrderConfirmation(order, items).catch(e => console.error('[EMAIL]', e.message));

    // Fetch items for response
    const itemsResult = await require('../db/connection').query(
      'SELECT * FROM order_items WHERE order_id=$1', [order_id]
    );

    return res.status(201).json({
      message: 'Order submitted successfully!',
      order: { ...order, items: itemsResult.rows },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ORDERS] Submit error:', err.message);
    return res.status(500).json({ error: 'Failed to submit order. Please try again.' });
  } finally {
    client.release();
  }
});

// ── GET /api/orders/mine — Agent: view own orders ──────────────────────────
router.get('/mine', verifyToken, agentOnly, async (req, res) => {
  const agent_id = req.user.login_id;
  const { page=1, limit=20 } = req.query;
  const offset = (parseInt(page)-1)*parseInt(limit);

  try {
    const [ordersRes, countRes] = await Promise.all([
      query(`
        SELECT o.order_id, o.order_date, o.order_status, o.lead_source,
               o.first_name, o.last_name, o.phone, o.email,
               o.tracking_id, o.notes, o.created_at,
               COALESCE(
                 json_agg(json_build_object(
                   'product_name', i.product_name,
                   'quantity', i.quantity,
                   'mg', i.mg,
                   'cost', i.cost
                 ) ORDER BY i.id), '[]'
               ) AS items
        FROM orders o
        LEFT JOIN order_items i ON i.order_id = o.order_id
	        WHERE o.agent_id=$1
	          AND (o.tracking_id IS NULL OR o.tracking_id = '')
        GROUP BY o.id, o.order_id, o.order_date, o.order_status, o.lead_source,
                 o.first_name, o.last_name, o.phone, o.email, o.tracking_id, o.notes, o.created_at
        ORDER BY o.order_date DESC
        LIMIT $2 OFFSET $3;
      `, [agent_id, parseInt(limit), offset]),
	      query(`SELECT COUNT(*) FROM orders WHERE agent_id=$1 AND (tracking_id IS NULL OR tracking_id = '')`, [agent_id]),
	    ]);

    return res.json({
      orders: ordersRes.rows,
      pagination: {
        total: parseInt(countRes.rows[0].count),
        page: parseInt(page), limit: parseInt(limit),
        pages: Math.ceil(countRes.rows[0].count/parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('[ORDERS] mine error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// ── PUT /api/orders/:order_id/tracking ────────────────────────────────────
router.put('/:order_id/tracking', verifyToken, agentOnly, [
  param('order_id').notEmpty(),
  body('tracking_id').trim().notEmpty().withMessage('Tracking ID required').isLength({ max:100 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { order_id } = req.params;
  const { tracking_id } = req.body;
  const agent_id = req.user.login_id;

  try {
    const result = await query(`
      UPDATE orders SET tracking_id=$1, updated_at=NOW()
      WHERE order_id=$2 AND agent_id=$3
      RETURNING order_id, tracking_id, updated_at;
    `, [tracking_id, order_id, agent_id]);

    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Order not found or access denied.' });

    // Fire-and-forget email to customer (uses lead source SMTP like order confirmation)
    try {
      const orderRes = await query(
        `SELECT order_id, lead_source, email, first_name, last_name, tracking_id
         FROM orders
         WHERE order_id=$1 AND agent_id=$2
         LIMIT 1;`,
        [order_id, agent_id],
      );
      if (orderRes.rows.length) {
        await sendTrackingUpdate(orderRes.rows[0]);
      }
    } catch (e) {
      console.error('[EMAIL] Tracking send error:', e.message);
    }

    return res.json({ message: 'Tracking ID updated.', order: result.rows[0] });
  } catch (err) {
    console.error('[ORDERS] tracking error:', err.message);
    return res.status(500).json({ error: 'Failed to update tracking.' });
  }
});

module.exports = router;
