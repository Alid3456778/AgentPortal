// scripts/setupDatabase.js — Run: node scripts/setupDatabase.js
const path = require('path');
require('dotenv').config({ path: './.env' });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'payerportal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

const createTables = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // agents
    await client.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id          SERIAL PRIMARY KEY,
        agent_name  VARCHAR(100) NOT NULL,
        agent_id    VARCHAR(50)  UNIQUE NOT NULL,
        password    TEXT         NOT NULL,
        email       VARCHAR(150),
        phone       VARCHAR(20),
        is_active   BOOLEAN      DEFAULT TRUE,
        created_at  TIMESTAMP    DEFAULT NOW()
      );
    `);
    console.log('✅ Table: agents');

    // admins
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id          SERIAL PRIMARY KEY,
        admin_name  VARCHAR(100) NOT NULL,
        admin_id    VARCHAR(50)  UNIQUE NOT NULL,
        password    TEXT         NOT NULL,
        created_at  TIMESTAMP    DEFAULT NOW()
      );
    `);
    console.log('✅ Table: admins');

    // customers — uniquely identified by phone
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id             SERIAL PRIMARY KEY,
        phone          VARCHAR(20)  UNIQUE NOT NULL,
        first_name     VARCHAR(100) NOT NULL,
        last_name      VARCHAR(100) NOT NULL,
        email          VARCHAR(150),
        street_address VARCHAR(255),
        city           VARCHAR(100),
        state          VARCHAR(100),
        pincode        VARCHAR(20),
        country        VARCHAR(100),
        created_at     TIMESTAMP    DEFAULT NOW(),
        updated_at     TIMESTAMP    DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);`);
    console.log('✅ Table: customers');

    // orders
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id            SERIAL PRIMARY KEY,
        order_id      VARCHAR(20)  UNIQUE NOT NULL,
        order_date    TIMESTAMP    DEFAULT NOW(),
        order_status  VARCHAR(30)  DEFAULT 'placed',
        order_info    VARCHAR(25)  NOT NULL,
        agent_id      VARCHAR(50)  NOT NULL,
        agent_name    VARCHAR(100) NOT NULL,
        lead_source   VARCHAR(50)  NOT NULL,
        payment_mode  VARCHAR(50)  NOT NULL,
        customer_phone VARCHAR(20) NOT NULL,
        first_name    VARCHAR(100) NOT NULL,
        last_name     VARCHAR(100) NOT NULL,
        street_address VARCHAR(255) NOT NULL,
        city          VARCHAR(100) NOT NULL,
        state         VARCHAR(100) NOT NULL,
        pincode       VARCHAR(20)  NOT NULL,
        country       VARCHAR(100) NOT NULL,
        phone         VARCHAR(20)  NOT NULL,
        email         VARCHAR(150) NOT NULL,
        tracking_id   VARCHAR(100),
        notes         TEXT,
        created_at    TIMESTAMP    DEFAULT NOW(),
        updated_at    TIMESTAMP    DEFAULT NOW(),
        CONSTRAINT fk_agent FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE RESTRICT,
        CONSTRAINT fk_customer FOREIGN KEY (customer_phone) REFERENCES customers(phone) ON DELETE RESTRICT
      );
    `);
    console.log('✅ Table: orders');
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(50) NOT NULL DEFAULT 'Pending';`);
    console.log('✅ Column: payment_mode');
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_info VARCHAR(25) NOT NULL DEFAULT 'NewOrder';`);
    console.log('✅ Column: order_info');

    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_agent_id      ON orders(agent_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_order_date    ON orders(order_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_lead_source   ON orders(lead_source);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_payment_mode  ON orders(payment_mode);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_order_status  ON orders(order_status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orders_order_info ON orders(order_info);`);

    // order_items — multiple medicines per order
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id           SERIAL PRIMARY KEY,
        order_id     VARCHAR(20) NOT NULL,
        product_name VARCHAR(200) NOT NULL,
        quantity     INTEGER      NOT NULL CHECK (quantity > 0),
        mg           VARCHAR(50)  NOT NULL,
        cost         NUMERIC(10,2) NOT NULL CHECK (cost >= 0),
        CONSTRAINT fk_order_item FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);`);
    console.log('✅ Table: order_items');

    // auto update_at triggers
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ language 'plpgsql';
    `);
    for (const tbl of ['orders', 'customers']) {
      await client.query(`DROP TRIGGER IF EXISTS update_${tbl}_updated_at ON ${tbl};`);
      await client.query(`
        CREATE TRIGGER update_${tbl}_updated_at
          BEFORE UPDATE ON ${tbl}
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      `);
    }
    console.log('✅ Triggers: updated_at');

    await client.query('COMMIT');
    console.log('\n🎉 Database setup complete!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Setup failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

createTables().catch(err => { console.error(err); process.exit(1); });