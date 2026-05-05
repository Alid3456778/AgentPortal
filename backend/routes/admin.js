// routes/admin.js — v2 (full order edit, agent CRUD, customer view)
const express = require("express");
const XLSX = require("xlsx");
const bcrypt = require("bcryptjs");
const { param, body, validationResult } = require("express-validator");
const { query, pool } = require("../db/connection");
const { verifyToken, adminOnly } = require("../middleware/auth");

const router = express.Router();
router.use(verifyToken, adminOnly);

// Accept simplified lead sources; keep old values for backward compatibility with existing data.
const LEAD_SOURCES = [
  "Truemed",
  "Mcland",
  "Syncore",
  "Tradewave",
  "Other",
  "Syncore_IndiaMart",
  "Tradewave_IndiaMart",
];
const STATUSES = ["placed", "processing", "shipped", "delivered", "cancelled"];

// ── Filter builder ─────────────────────────────────────────────────────────
const buildFilters = (q) => {
  const conds = [],
    vals = [];
  let idx = 1;
  if (q.agent_id) {
    conds.push(`o.agent_id=$${idx++}`);
    vals.push(q.agent_id);
  } else if (q.agent_name) {
    conds.push(`o.agent_name ILIKE $${idx++}`);
    vals.push(`%${q.agent_name}%`);
  }
  // Dates are interpreted in US time (DB session timezone is America/New_York)
  if (q.date_from) {
    conds.push(`o.order_date >= $${idx++}::timestamp`);
    vals.push(`${q.date_from} 00:00:00`);
  }
  if (q.date_to) {
    conds.push(`o.order_date <= $${idx++}::timestamp`);
    vals.push(`${q.date_to} 23:59:59.999`);
  }
  if (q.lead_source) {
    const leadAliases = {
      Syncore: ["Syncore", "Syncore_IndiaMart"],
      Tradewave: ["Tradewave", "Tradewave_IndiaMart"],
    };
    const list = leadAliases[q.lead_source];
    if (list) {
      conds.push(`o.lead_source = ANY($${idx++})`);
      vals.push(list);
    } else {
      conds.push(`o.lead_source=$${idx++}`);
      vals.push(q.lead_source);
    }
  }
  if (q.order_status) {
    conds.push(`o.order_status=$${idx++}`);
    vals.push(q.order_status);
  }
  if (q.order_info) {
    conds.push(`o.order_info=$${idx++}`);
    vals.push(q.order_info);
  }
  return {
    whereClause: conds.length ? `WHERE ${conds.join(" AND ")}` : "",
    vals,
  };
};

// ── GET /api/admin/stats ───────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const { whereClause, vals } = buildFilters(req.query);
    const [tot, breakdown, topAgents, totalCustomers] = await Promise.all([
      query(
        `
        SELECT COUNT(DISTINCT o.order_id) AS total,
               COALESCE(SUM(i.cost),0) AS total_revenue
        FROM orders o
        LEFT JOIN order_items i ON i.order_id=o.order_id
        ${whereClause};
      `,
        vals,
      ),
      query(
        `
        SELECT o.order_status, COUNT(DISTINCT o.order_id) AS count
        FROM orders o
        ${whereClause}
        GROUP BY o.order_status
        ORDER BY count DESC;
      `,
        vals,
      ),
      query(
        `
        SELECT o.agent_name, o.agent_id, COUNT(DISTINCT o.order_id) AS order_count
        FROM orders o
        ${whereClause}
        GROUP BY o.agent_name,o.agent_id
        ORDER BY order_count DESC
        LIMIT 5;
      `,
        vals,
      ),
      query(
        `
        SELECT COUNT(DISTINCT o.customer_phone) AS total
        FROM orders o
        ${whereClause};
      `,
        vals,
      ),
    ]);
    res.json({
      total_orders: parseInt(tot.rows[0].total),
      total_revenue: parseFloat(tot.rows[0].total_revenue || 0),
      total_customers: parseInt(totalCustomers.rows[0].total),
      status_breakdown: breakdown.rows,
      top_agents: topAgents.rows,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats." });
  }
});

// ── GET /api/admin/orders ─────────────────────────────────────────────────
router.get("/orders", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      sort = "order_date",
      order = "DESC",
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const allowed = ["order_date", "agent_name", "lead_source", "order_status"];
    const safeSort = allowed.includes(sort) ? sort : "order_date";
    const safeOrder = order.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const { whereClause, vals } = buildFilters(req.query);

    const [dataRes, countRes] = await Promise.all([
      query(
        `
        SELECT o.id, o.order_id, o.order_date, o.order_status,
               o.agent_id, o.agent_name, o.lead_source,
               o.first_name, o.last_name, o.street_address,
               o.city, o.state, o.pincode, o.country,
               o.phone, o.email, o.tracking_id, o.notes, o.created_at, o.updated_at,
               COALESCE(json_agg(json_build_object(
                 'id',i.id,'product_name',i.product_name,
                 'quantity',i.quantity,'mg',i.mg,'cost',i.cost
               ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items,
               COALESCE(SUM(i.cost),0) AS total_cost
        FROM orders o
        LEFT JOIN order_items i ON i.order_id=o.order_id
        ${whereClause}
        GROUP BY o.id,o.order_id,o.order_date,o.order_status,o.agent_id,o.agent_name,
                 o.lead_source,o.payment_mode,o.order_info,
                 o.first_name,o.last_name,o.street_address,o.city,o.state,
                 o.pincode,o.country,o.phone,o.email,o.tracking_id,o.notes,o.created_at,o.updated_at
        ORDER BY o.${safeSort} ${safeOrder}
        LIMIT $${vals.length + 1} OFFSET $${vals.length + 2};
      `,
        [...vals, parseInt(limit), offset],
      ),
      query(`SELECT COUNT(*) FROM orders o ${whereClause};`, vals),
    ]);

    const total = parseInt(countRes.rows[0].count);
    res.json({
      orders: dataRes.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("[ADMIN] orders error:", err.message);
    res.status(500).json({ error: "Failed to fetch orders." });
  }
});

// ── GET /api/admin/orders/export ──────────────────────────────────────────
router.get("/orders/export", async (req, res) => {
  try {
    const { whereClause, vals } = buildFilters(req.query);
    const result = await query(
      `
      SELECT
        o.order_id AS "Order ID",
        TO_CHAR(o.order_date,'YYYY-MM-DD HH24:MI') AS "Order Date",
        o.order_status AS "Status",
        o.agent_name AS "Agent Name", o.agent_id AS "Agent ID",
        o.lead_source AS "Lead Source",
        o.payment_mode AS "Payment Mode",
        o.order_info AS "Order Info",
        o.first_name AS "First Name", o.last_name AS "Last Name",
        o.street_address AS "Street Address", o.city AS "City",
        o.state AS "State", o.pincode AS "Pincode", o.country AS "Country",
        o.phone AS "Phone", o.email AS "Email",
        i.product_name AS "Product", i.quantity AS "Qty", i.mg AS "MG",
        i.cost AS "Unit Cost",
        COALESCE(o.tracking_id,'') AS "Tracking ID",
        COALESCE(o.notes,'') AS "Notes"
      FROM orders o
      LEFT JOIN order_items i ON i.order_id=o.order_id
      ${whereClause}
      ORDER BY o.order_date DESC, o.order_id, i.id;
    `,
      vals,
    );

    if (!result.rows.length)
      return res.status(404).json({ error: "No orders found." });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(result.rows);
    ws["!cols"] = [
      { wch: 16 },
      { wch: 18 },
      { wch: 12 },
      { wch: 20 },
      { wch: 12 },
      { wch: 22 },
      { wch: 14 },
      { wch: 14 },
      { wch: 30 },
      { wch: 14 },
      { wch: 14 },
      { wch: 10 },
      { wch: 12 },
      { wch: 16 },
      { wch: 26 },
      { wch: 24 },
      { wch: 6 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 20 },
      { wch: 30 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    const summaryWS = XLSX.utils.json_to_sheet([
      { Info: "Exported At", Value: new Date().toLocaleString() },
      { Info: "Total Rows", Value: result.rows.length },
      { Info: "Exported By", Value: req.user.name },
    ]);
    XLSX.utils.book_append_sheet(wb, summaryWS, "Info");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="PayerPortal_Orders_${new Date().toISOString().split("T")[0]}.xlsx"`,
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.send(buffer);
  } catch (err) {
    console.error("[ADMIN] export error:", err.message);
    res.status(500).json({ error: "Export failed." });
  }
});

// ── GET /api/admin/orders/:order_id — fetch single order ──────────────────
router.get("/orders/:order_id", async (req, res) => {
  try {
    const oRes = await query(
      `
      SELECT o.*, COALESCE(json_agg(json_build_object(
        'id',i.id,'product_name',i.product_name,'quantity',i.quantity,'mg',i.mg,'cost',i.cost
      ) ORDER BY i.id) FILTER(WHERE i.id IS NOT NULL),'[]') AS items
      FROM orders o LEFT JOIN order_items i ON i.order_id=o.order_id
      WHERE o.order_id=$1 GROUP BY o.id;
    `,
      [req.params.order_id],
    );
    if (!oRes.rows.length)
      return res.status(404).json({ error: "Order not found." });
    res.json({ order: oRes.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch order." });
  }
});

// ── PUT /api/admin/orders/:order_id — full order edit ─────────────────────
router.put(
  "/orders/:order_id",
  [
    param("order_id").notEmpty(),
    body("order_status")
      .optional()
      .isIn(STATUSES)
      .withMessage("Invalid status"),
    body("lead_source")
      .optional()
      .isIn(LEAD_SOURCES)
      .withMessage("Invalid lead source"),
    body("payment_mode")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("Payment mode cannot be empty"),
    body("order_info").optional().trim().notEmpty(),
    body("first_name").optional().trim().notEmpty(),
    body("last_name").optional().trim().notEmpty(),
    body("phone").optional().trim().notEmpty(),
    body("email").optional().trim().isEmail().normalizeEmail(),
    body("items")
      .optional()
      .isArray({ min: 1 })
      .withMessage("At least 1 item required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { order_id } = req.params;
    const {
      order_status,
      lead_source,
      payment_mode,
      tracking_id,
      notes,
      order_info,
      first_name,
      last_name,
      street_address,
      city,
      state,
      pincode,
      country,
      phone,
      email,
      items,
    } = req.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Build SET clause dynamically
      const sets = [],
        vals = [];
      let idx = 1;
      const addSet = (col, val) => {
        sets.push(`${col}=$${idx++}`);
        vals.push(val);
      };

      if (order_status !== undefined) addSet("order_status", order_status);
      if (lead_source !== undefined) addSet("lead_source", lead_source);
      if (payment_mode !== undefined) addSet("payment_mode", payment_mode);
      if (order_info !== undefined) addSet("order_info", order_info || null);
      if (tracking_id !== undefined) addSet("tracking_id", tracking_id || null);
      if (notes !== undefined) addSet("notes", notes || null);
      if (first_name !== undefined) addSet("first_name", first_name);
      if (last_name !== undefined) addSet("last_name", last_name);
      if (street_address !== undefined)
        addSet("street_address", street_address);
      if (city !== undefined) addSet("city", city);
      if (state !== undefined) addSet("state", state);
      if (pincode !== undefined) addSet("pincode", pincode);
      if (country !== undefined) addSet("country", country);
      if (phone !== undefined) addSet("phone", phone);
      if (email !== undefined) addSet("email", email);
      sets.push(`updated_at=NOW()`);

      if (sets.length > 1) {
        vals.push(order_id);
        const res2 = await client.query(
          `UPDATE orders SET ${sets.join(",")} WHERE order_id=$${idx} RETURNING *;`,
          vals,
        );
        if (!res2.rows.length) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Order not found." });
        }
      }

      // Replace items if provided
      if (items && items.length) {
        await client.query("DELETE FROM order_items WHERE order_id=$1", [
          order_id,
        ]);
        for (const item of items) {
          await client.query(
            `INSERT INTO order_items(order_id,product_name,quantity,mg,cost) VALUES($1,$2,$3,$4,$5)`,
            [order_id, item.product_name, item.quantity, item.mg, item.cost],
          );
        }
      }

      await client.query("COMMIT");

      const updated = await query(
        `
      SELECT o.*, COALESCE(json_agg(json_build_object(
        'id',i.id,'product_name',i.product_name,'quantity',i.quantity,'mg',i.mg,'cost',i.cost
      ) ORDER BY i.id) FILTER(WHERE i.id IS NOT NULL),'[]') AS items
      FROM orders o LEFT JOIN order_items i ON i.order_id=o.order_id
      WHERE o.order_id=$1 GROUP BY o.id;
    `,
        [order_id],
      );

      res.json({
        message: "Order updated successfully.",
        order: updated.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[ADMIN] order update error:", err.message);
      res.status(500).json({ error: "Failed to update order." });
    } finally {
      client.release();
    }
  },
);

// ── GET /api/admin/agents ─────────────────────────────────────────────────
// ── DELETE /api/admin/orders/:order_id — delete order (cascades order_items) ──
router.delete(
  "/orders/:order_id",
  [param("order_id").notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { order_id } = req.params;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const exists = await client.query(
        "SELECT order_id FROM orders WHERE order_id=$1",
        [order_id],
      );
      if (!exists.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Order not found." });
      }

      await client.query("DELETE FROM orders WHERE order_id=$1", [order_id]);
      await client.query("COMMIT");

      return res.json({ message: "Order deleted successfully.", order_id });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[ADMIN] delete order error:", err.message);
      return res.status(500).json({ error: "Failed to delete order." });
    } finally {
      client.release();
    }
  },
);

router.get("/agents", async (req, res) => {
  try {
    const result = await query(`
      SELECT a.id, a.agent_id, a.agent_name, a.email, a.phone, a.is_active, a.created_at,
             COUNT(o.id) AS total_orders
      FROM agents a
      LEFT JOIN orders o ON o.agent_id=a.agent_id
      GROUP BY a.id,a.agent_id,a.agent_name,a.email,a.phone,a.is_active,a.created_at
      ORDER BY a.agent_name ASC;
    `);
    res.json({ agents: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch agents." });
  }
});

// ── POST /api/admin/agents — Add new agent ────────────────────────────────
router.post(
  "/agents",
  [
    body("agent_id")
      .trim()
      .notEmpty()
      .withMessage("Agent ID required")
      .isLength({ max: 50 }),
    body("agent_name").trim().notEmpty().withMessage("Agent name required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("email")
      .optional({ checkFalsy: true })
      .trim()
      .isEmail()
      .normalizeEmail(),
    body("phone").optional({ checkFalsy: true }).trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { agent_id, agent_name, password, email, phone } = req.body;
    try {
      const exists = await query("SELECT id FROM agents WHERE agent_id=$1", [
        agent_id,
      ]);
      if (exists.rows.length)
        return res
          .status(409)
          .json({ error: `Agent ID "${agent_id}" already exists.` });

      const hashed = await bcrypt.hash(password, 12);
      const result = await query(
        `
      INSERT INTO agents(agent_id,agent_name,password,email,phone)
      VALUES($1,$2,$3,$4,$5) RETURNING id,agent_id,agent_name,email,phone,is_active,created_at;
    `,
        [agent_id, agent_name, hashed, email || null, phone || null],
      );

      res
        .status(201)
        .json({
          message: "Agent created successfully.",
          agent: result.rows[0],
        });
    } catch (err) {
      console.error("[ADMIN] create agent error:", err.message);
      res.status(500).json({ error: "Failed to create agent." });
    }
  },
);

// ── PUT /api/admin/agents/:agent_id — Edit agent ──────────────────────────
router.put(
  "/agents/:agent_id",
  [
    param("agent_id").notEmpty(),
    body("agent_name").optional().trim().notEmpty(),
    body("email")
      .optional({ checkFalsy: true })
      .trim()
      .isEmail()
      .normalizeEmail(),
    body("phone").optional({ checkFalsy: true }).trim(),
    body("is_active").optional().isBoolean(),
    body("password")
      .optional({ checkFalsy: true })
      .isLength({ min: 6 })
      .withMessage("Min 6 chars"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { agent_id } = req.params;
    const { agent_name, email, phone, is_active, password } = req.body;

    try {
      const sets = [],
        vals = [];
      let idx = 1;
      if (agent_name !== undefined) {
        sets.push(`agent_name=$${idx++}`);
        vals.push(agent_name);
      }
      if (email !== undefined) {
        sets.push(`email=$${idx++}`);
        vals.push(email || null);
      }
      if (phone !== undefined) {
        sets.push(`phone=$${idx++}`);
        vals.push(phone || null);
      }
      if (is_active !== undefined) {
        sets.push(`is_active=$${idx++}`);
        vals.push(is_active);
      }
      if (password) {
        const h = await bcrypt.hash(password, 12);
        sets.push(`password=$${idx++}`);
        vals.push(h);
      }

      if (!sets.length)
        return res.status(400).json({ error: "Nothing to update." });
      vals.push(agent_id);

      const result = await query(
        `UPDATE agents SET ${sets.join(",")} WHERE agent_id=$${idx} RETURNING id,agent_id,agent_name,email,phone,is_active,created_at;`,
        vals,
      );
      if (!result.rows.length)
        return res.status(404).json({ error: "Agent not found." });
      res.json({ message: "Agent updated.", agent: result.rows[0] });
    } catch (err) {
      console.error("[ADMIN] update agent error:", err.message);
      res.status(500).json({ error: "Failed to update agent." });
    }
  },
);

// ── GET /api/admin/customers ──────────────────────────────────────────────
router.get("/customers", async (req, res) => {
  try {
    const { page = 1, limit = 50, search = "" } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const searchCond = search
      ? `WHERE c.phone ILIKE $1 OR c.first_name ILIKE $1 OR c.last_name ILIKE $1 OR c.email ILIKE $1`
      : "";
    const searchVals = search ? [`%${search}%`] : [];

    const [custRes, countRes] = await Promise.all([
      query(
        `
        SELECT c.id, c.phone, c.first_name, c.last_name, c.email,
               c.city, c.state, c.country, c.created_at,
               COUNT(DISTINCT o.order_id) AS total_orders,
               COALESCE(SUM(i.cost),0) AS total_spent,
               MAX(o.order_date) AS last_order_date
        FROM customers c
        LEFT JOIN orders o ON o.customer_phone=c.phone
        LEFT JOIN order_items i ON i.order_id=o.order_id
        ${searchCond}
        GROUP BY c.id,c.phone,c.first_name,c.last_name,c.email,c.city,c.state,c.country,c.created_at
        ORDER BY last_order_date DESC NULLS LAST
        LIMIT $${searchVals.length + 1} OFFSET $${searchVals.length + 2};
      `,
        [...searchVals, parseInt(limit), offset],
      ),
      query(`SELECT COUNT(*) FROM customers c ${searchCond};`, searchVals),
    ]);

    res.json({
      customers: custRes.rows,
      pagination: {
        total: parseInt(countRes.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(countRes.rows[0].count / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("[ADMIN] customers error:", err.message);
    res.status(500).json({ error: "Failed to fetch customers." });
  }
});

// ── GET /api/admin/customers/:phone — customer detail + all purchases ─────
router.get("/customers/:phone", async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const [custRes, ordersRes] = await Promise.all([
      query("SELECT * FROM customers WHERE phone=$1", [phone]),
      query(
        `
        SELECT o.order_id, o.order_date, o.order_status, o.lead_source,
               o.agent_name, o.tracking_id,
               COALESCE(json_agg(json_build_object(
                 'product_name',i.product_name,'quantity',i.quantity,'mg',i.mg,'cost',i.cost
               ) ORDER BY i.id) FILTER(WHERE i.id IS NOT NULL),'[]') AS items,
               COALESCE(SUM(i.cost),0) AS order_total
        FROM orders o
        LEFT JOIN order_items i ON i.order_id=o.order_id
        WHERE o.customer_phone=$1
        GROUP BY o.id,o.order_id,o.order_date,o.order_status,o.lead_source,o.agent_name,o.tracking_id
        ORDER BY o.order_date DESC;
      `,
        [phone],
      ),
    ]);

    if (!custRes.rows.length)
      return res.status(404).json({ error: "Customer not found." });

    res.json({ customer: custRes.rows[0], orders: ordersRes.rows });
  } catch (err) {
    console.error("[ADMIN] customer detail error:", err.message);
    res.status(500).json({ error: "Failed to fetch customer." });
  }
});

module.exports = router;
