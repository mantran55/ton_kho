// db-pg.js - Phiên bản tối ưu cho async/await
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function translateFunctions(sql) {
  sql = sql.replace(/DATE_FORMAT\(\s*([^,]+)\s*,\s*'%d\/%m\/%Y'\s*\)/gi, "to_char($1,'DD/MM/YYYY')");
  sql = sql.replace(/\bYEAR\(\s*([^)]+)\s*\)/gi, "EXTRACT(YEAR FROM $1)");
  sql = sql.replace(/\bMONTH\(\s*([^)]+)\s*\)/gi, "EXTRACT(MONTH FROM $1)");
  return sql;
}

function toPgPlaceholders(sql, params) {
  if (!params || !Array.isArray(params) || params.length === 0) return translateFunctions(sql);
  if (/\$\d+/.test(sql)) return translateFunctions(sql);
  sql = translateFunctions(sql);
  let i = 0;
  return sql.replace(/\?/g, () => { i += 1; return `$${i}`; });
}

async function run(sql, params = []) {
  const pgSql = toPgPlaceholders(sql, params);
  const addReturning = /^\s*INSERT\s+INTO\s+/i.test(pgSql) && !/\bRETURNING\b/i.test(pgSql);
  const finalSql = addReturning ? `${pgSql} RETURNING id` : pgSql;
  const res = await pool.query(finalSql, params);
  const rows = res.rows || [];
  const isMutation = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(pgSql);
  let meta = {};
  if (isMutation) {
    meta.affectedRows = typeof res.rowCount === 'number' ? res.rowCount : 0;
    if (/^\s*INSERT\b/i.test(pgSql) && rows.length && rows[0].id !== undefined) {
      meta.insertId = rows[0].id;
    }
  }
  return { rows, meta };
}

async function query(sql, params = []) {
  return await run(sql, params);
}

module.exports = { query, _pool: pool };
