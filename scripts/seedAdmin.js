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
    const adminId       = process.env.ADMIN_ID       || 'admin001';
    const adminName     = process.env.ADMIN_NAME     || 'Super Admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';

    const hashedAdminPass = await bcrypt.hash(adminPassword, 12);

    await client.query(`
      INSERT INTO admins (admin_name, admin_id, password)
      VALUES ($1, $2, $3)
      ON CONFLICT (admin_id) DO UPDATE
        SET admin_name = EXCLUDED.admin_name,
            password   = EXCLUDED.password;
    `, [adminName, adminId, hashedAdminPass]);
    console.log(`✅ Admin created → ID: ${adminId} | Password: ${adminPassword}`);

    // ─── Create Sample Agents ─────────────────────────────────────────────
    const sampleAgents = [
      { agent_name: 'Alice Johnson', agent_id: 'AGT001', password: 'Agent@1234' },
      { agent_name: 'Bob Martinez',  agent_id: 'AGT002', password: 'Agent@1234' },
      { agent_name: 'Carol Singh',   agent_id: 'AGT003', password: 'Agent@1234' },
    ];

    for (const agent of sampleAgents) {
      const hashed = await bcrypt.hash(agent.password, 12);
      await client.query(`
        INSERT INTO agents (agent_name, agent_id, password)
        VALUES ($1, $2, $3)
        ON CONFLICT (agent_id) DO NOTHING;
      `, [agent.agent_name, agent.agent_id, hashed]);
      console.log(`✅ Agent created → ID: ${agent.agent_id} | Name: ${agent.agent_name}`);
    }

    console.log('\n🎉 Seeding complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Admin Login:  admin001 / Admin@1234');
    console.log('Agent Login:  AGT001   / Agent@1234');
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