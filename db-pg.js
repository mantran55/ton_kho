// db-pg.js - Phiên bản tối ưu cho async/await
// Giữ lại các hàm chuyển đổi hữu ích từ phiên bản cũ

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon yêu cầu SSL
});

// --- Các hàm trợ giúp (giữ nguyên) ---

function translateFunctions(sql) {
  sql = sql.replace(/DATE_FORMAT\(\s*([^,]+)\s*,\s*'%d\/%m\/%Y'\s*\)/gi, "to_char($1,'DD/MM/YYYY')");
  sql = sql.replace(/\bYEAR\(\s*([^)]+)\s*\)/gi, "EXTRACT(YEAR FROM $1)");
  sql = sql.replace(/\bMONTH\(\s*([^)]+)\s*\)/gi, "EXTRACT(MONTH FROM $1)");
  return sql;
}

function toPgPlaceholders(sql, params) {
  if (!params || !Array.isArray(params) || params.length === 0) {
    return translateFunctions(sql);
  }
  if (/\$\d+/.test(sql)) return translateFunctions(sql);
  sql = translateFunctions(sql);
  let i = 0;
  return sql.replace(/\?/g, () => {
    i += 1;
    return `$${i}`;
  });
}

function shouldReturnId(sql) {
  return /^\s*INSERT\s+INTO\s+/i.test(sql) && !/\bRETURNING\b/i.test(sql);
}

// --- Hàm truy vấn chính (được viết lại) ---

async function run(sql, params = []) {
  const pgSql = toPgPlaceholders(sql, params);
  const addReturning = shouldReturnId(pgSql);
  const finalSql = addReturning ? `${pgSql} RETURNING id` : pgSql;

  const res = await pool.query(finalSql, params);
  const rows = res.rows || [];

  // Xây dựng đối tượng kết quả giống mysql2 cho các thao tác thay đổi (INSERT, UPDATE, DELETE)
  const isMutation = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(pgSql);
  let meta = {};
  if (isMutation) {
    meta.affectedRows = typeof res.rowCount === 'number' ? res.rowCount : 0;
    if (/^\s*INSERT\b/i.test(pgSql)) {
      if (rows.length && rows[0].id !== undefined && rows[0].id !== null) {
        meta.insertId = rows[0].id;
      } else {
        meta.insertId = null;
      }
    }
  }
  return { rows, meta };
}

// --- Xuất module ---

// Xuất ra một hàm query async trực tiếp
// Cách dùng: const { rows } = await db.query(sql, params);
async function query(sql, params = []) {
  return await run(sql, params);
}

// Gi lại phương thức .promise() để tương thích nếu có code cũ nào đó dùng nó
function promise() {
  return { query: query };
}

module.exports = {
  query,
  promise,
  _pool: pool,
};
