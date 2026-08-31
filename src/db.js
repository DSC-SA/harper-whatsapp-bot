import pg from 'pg';

const { Pool } = pg;

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DB_URL || '';

let pool = null;
let ready = false;

export function dbEnabled() {
  return !!url;
}

export async function connectDb() {
  if (!url) return false;
  try {
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    await pool.query('SELECT 1');
    await pool.query(
      `CREATE TABLE IF NOT EXISTS harper_files (
        id text PRIMARY KEY,
        data text NOT NULL,
        updated_at bigint NOT NULL
      )`
    );
    ready = true;
    console.log('[harper] database connected');
    return true;
  } catch (e) {
    try { await pool?.end(); } catch {}
    pool = null;
    console.log(`[harper] database connect failed: ${e.message} (running local-only)`);
    return false;
  }
}

export async function saveBlob(id, data) {
  if (!pool || !ready) return;
  try {
    await pool.query(
      `INSERT INTO harper_files (id, data, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
      [id, data, Date.now()]
    );
  } catch (e) {
    console.log(`[harper] db save ${id} failed: ${e.message}`);
  }
}

export async function deleteBlob(id) {
  if (!pool || !ready) return;
  try {
    await pool.query(`DELETE FROM harper_files WHERE id = $1`, [id]);
  } catch {}
}

export async function loadBlob(id) {
  if (!pool || !ready) return null;
  try {
    const res = await pool.query(`SELECT data FROM harper_files WHERE id = $1`, [id]);
    return res.rows.length ? res.rows[0].data : null;
  } catch {
    return null;
  }
}

export async function getAllBlobs() {
  const out = new Map();
  if (!pool || !ready) return out;
  try {
    const res = await pool.query(`SELECT id, data, updated_at FROM harper_files`);
    for (const r of res.rows) {
      out.set(r.id, { data: r.data, updatedAt: Number(r.updated_at) || 0 });
    }
  } catch {}
  return out;
}