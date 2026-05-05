// scripts/seedAdmin.js
// Run with: node scripts/seedAdmin.js
// Creates default admin account + optional sample agents

const path = require('path');
require('dotenv').config({ path: './.env' });
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'payerportal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

const seed = async () => {
  const client = await pool.connect();
  try {
    // ─── Create Default Admin ─────────────────────────────────────────────
    const adminId       = process.env.ADMIN_ID       ;
    const adminName     = process.env.ADMIN_NAME     ;
    const adminPassword = process.env.ADMIN_PASSWORD ;
    const adminEmail    = process.env.ADMIN_EMAIL    ;

    const hashedAdminPass = await bcrypt.hash(adminPassword, 12);

    await client.query(`
      INSERT INTO admins (admin_name, admin_id, email, password)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (admin_id) DO UPDATE
        SET admin_name = EXCLUDED.admin_name,
            email      = EXCLUDED.email,
            password   = EXCLUDED.password;
    `, [adminName, adminId, adminEmail || null, hashedAdminPass]);
    console.log(`✅ Admin created → ID: ${adminId} | Password: ${adminPassword}`);

    console.log('\n🎉 Seeding complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Admin Login:  admin001 ');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
