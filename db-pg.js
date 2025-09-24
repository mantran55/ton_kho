
// db-pg.js - MySQL→Postgres compatibility wrapper for Neon
// Drop-in for minimal changes when migrating mysql2 code.
// Supports:
//   - db.query(sql, params?, callback)
//   - db.promise().query(sql, params?)
// Returns mysql2-like shapes: [rows] and for mutate ops includes affectedRows/insertId.
// Handles placeholders '?' → $1..$n, DATE_FORMAT, YEAR(), MONTH().

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL
});

function translateFunctions(sql) {
  // DATE_FORMAT(x, '%d/%m/%Y') -> to_char(x,'DD/MM/YYYY')
  sql = sql.replace(/DATE_FORMAT\(\s*([^,]+)\s*,\s*'%d\/%m\/%Y'\s*\)/gi, "to_char($1,'DD/MM/YYYY')");

  // YEAR(col) -> EXTRACT(YEAR FROM col)
  sql = sql.replace(/\bYEAR\(\s*([^)]+)\s*\)/gi, "EXTRACT(YEAR FROM $1)");

  // MONTH(col) -> EXTRACT(MONTH FROM col)
  sql = sql.replace(/\bMONTH\(\s*([^)]+)\s*\)/gi, "EXTRACT(MONTH FROM $1)");

  return sql;
}

function toPgPlaceholders(sql, params) {
  if (!params || !Array.isArray(params) || params.length === 0) {
    return translateFunctions(sql);
  }
  // If already PG-style placeholders, just translate functions
  if (/\$\d+/.test(sql)) return translateFunctions(sql);

  sql = translateFunctions(sql);

  let i = 0;
  return sql.replace(/\?/g, () => {
    i += 1;
    return `$${i}`;
  });
}

function shouldReturnId(sql) {
  // If it's an INSERT INTO ... and no explicit RETURNING present, add RETURNING id
  return /^\s*INSERT\s+INTO\s+/i.test(sql) && !/\bRETURNING\b/i.test(sql);
}

async function run(sql, params = []) {
  const pgSql = toPgPlaceholders(sql, params);
  const addReturning = shouldReturnId(pgSql);
  const finalSql = addReturning ? `${pgSql} RETURNING id` : pgSql;

  const res = await pool.query(finalSql, params);
  const rows = res.rows || [];

  // Build a mysql2-like result object for mutations
  const isMutation = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(pgSql);
  let meta = {};
  if (isMutation) {
    meta.affectedRows = typeof res.rowCount === 'number' ? res.rowCount : 0;
    if (/^\s*INSERT\b/i.test(pgSql)) {
      // If RETURNING id, set insertId from first row id (if present)
      if (rows.length && rows[0].id !== undefined && rows[0].id !== null) {
        meta.insertId = rows[0].id;
      } else {
        meta.insertId = null;
      }
    }
  }
  return { rows, meta };
}

// Callback style: db.query(sql, params?, cb)
function queryCb(sql, params, cb) {
  let _sql = sql;
  let _params = [];
  let _cb = cb;
  if (typeof params === 'function') {
    _cb = params;
  } else if (Array.isArray(params)) {
    _params = params;
  }

  run(_sql, _params)
    .then(({ rows, meta }) => {
      // mysql2 callback signature: (err, results, fields)
      // Many apps expect "results" to be an array for SELECT,
      // and a result object for mutations. We'll pass rows for both,
      // and attach meta when useful.
      const results = rows;
      // Attach mysql2-like properties if present
      if (meta && (meta.affectedRows !== undefined || meta.insertId !== undefined)) {
        results.affectedRows = meta.affectedRows;
        results.insertId = meta.insertId;
      }
      _cb(null, results, null);
    })
    .catch(err => _cb(err));
}

// Promise style: db.promise().query(sql, params?)
function queryPromise(sql, params = []) {
  return new Promise((resolve, reject) => {
    run(sql, params)
      .then(({ rows, meta }) => {
        // mysql2 returns [rows, fields]; we return [rows]
        // Attach affectedRows/insertId onto rows for compatibility
        if (meta && (meta.affectedRows !== undefined || meta.insertId !== undefined)) {
          rows.affectedRows = meta.affectedRows;
          rows.insertId = meta.insertId;
        }
        resolve([rows]);
      })
      .catch(err => reject(err));
  });
}

module.exports = {
  query: queryCb,
  promise() {
    return { query: queryPromise };
  },
  _pool: pool,
};
