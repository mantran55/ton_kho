const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');

// Cấu hình connection pool cho PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'inventory_db',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
  max: 20, // Số kết nối tối đa trong pool
  idleTimeoutMillis: 30000, // Đóng kết nối nhàn rỗi sau 30 giây
  connectionTimeoutMillis: 2000, // Trả lỗi sau 2 giây nếu không kết nối được
});

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Helper function để thực hiện truy vấn
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Query executed', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error('Query error', { text, error });
    throw error;
  }
};

// Helper function để lấy sản phẩm với phân trang
const getProductsPaginated = async (page = 1, limit = 10) => {
  const offset = (page - 1) * limit;
  const productsQuery = `
    SELECT * FROM SanPham 
    ORDER BY stt 
    LIMIT $1 OFFSET $2
  `;
  const countQuery = 'SELECT COUNT(*) FROM SanPham';
  
  const [productsResult, countResult] = await Promise.all([
    query(productsQuery, [limit, offset]),
    query(countQuery)
  ]);
  
  return {
    products: productsResult.rows,
    total: parseInt(countResult.rows[0].count),
    page,
    limit,
    totalPages: Math.ceil(countResult.rows[0].count / limit)
  };
};

// ---------------- API ROUTES ---------------- //

// Lấy danh sách sản phẩm với phân trang
app.get('/api/products', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    
    const data = await getProductsPaginated(page, limit);
    res.json(data);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: err.message });
  }
});

// Thêm sản phẩm mới
app.post('/api/products', async (req, res) => {
  const client = await pool.connect();
  try {
    const { ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc } = req.body;
    
    await client.query('BEGIN');
    
    // Lấy stt lớn nhất
    const sttResult = await client.query('SELECT MAX(stt) as maxStt FROM SanPham');
    const newStt = sttResult.rows[0].maxstt ? sttResult.rows[0].maxstt + 1 : 1;
    
    // Thêm sản phẩm mới
    const result = await client.query(
      'INSERT INTO SanPham (stt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [newStt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc]
    );
    
    await client.query('COMMIT');
    
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error adding product:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Cập nhật sản phẩm
app.put('/api/products/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc } = req.body;
    
    const result = await query(
      'UPDATE SanPham SET ncc=$1, ten_hang=$2, dvt=$3, ton_toi_thieu=$4, gia=$5, mau_ncc=$6 WHERE id=$7 RETURNING *',
      [ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ error: err.message });
  }
});

// Xóa sản phẩm
app.delete('/api/products/:id', async (req, res) => {
  try {
    const id = req.params.id;
    
    const result = await query('DELETE FROM SanPham WHERE id=$1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: err.message });
  }
});

// Thay đổi vị trí sản phẩm - Tối ưu với batch update
app.post('/api/products/reorder', async (req, res) => {
  const client = await pool.connect();
  try {
    const { products } = req.body;
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }
    
    await client.query('BEGIN');
    
    // Tạo câu lệnh batch update
    const updateQueries = products.map(p => {
      return client.query('UPDATE SanPham SET stt=$1 WHERE id=$2', [p.stt, p.id]);
    });
    
    await Promise.all(updateQueries);
    await client.query('COMMIT');
    
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error reordering products:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Lấy dữ liệu tồn kho với phân trang
app.get('/api/inventory', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    let sql = `
      SELECT t.id, to_char(t.ngay,'DD/MM/YYYY') as ngay, s.ten_hang, t.so_luong
      FROM TonKho t
      JOIN SanPham s ON t.id_san_pham = s.id
    `;
    const params = [];
    
    if (req.query.date) {
      sql += " WHERE to_char(t.ngay,'DD/MM/YYYY') = $1";
      params.push(req.query.date);
    }
    
    sql += ' ORDER BY t.ngay, s.stt LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    
    const result = await query(sql, params);
    
    res.json({
      data: result.rows,
      page,
      limit,
      total: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching inventory:', err);
    res.status(500).json({ error: err.message });
  }
});

// Thêm/cập nhật tồn kho - Tối ưu với UPSERT
app.post('/api/inventory', async (req, res) => {
  const client = await pool.connect();
  try {
    const { ngay, id_san_pham, so_luong } = req.body;
    const [day, month, year] = ngay.split('/');
    const pgDate = `${year}-${month}-${day}`;
    
    await client.query('BEGIN');
    
    // Sử dụng UPSERT thay vì kiểm tra rồi insert/update
    const result = await client.query(`
      INSERT INTO TonKho (ngay, id_san_pham, so_luong) 
      VALUES ($1, $2, $3)
      ON CONFLICT (ngay, id_san_pham) 
      DO UPDATE SET so_luong = $3
      RETURNING id
    `, [pgDate, id_san_pham, so_luong]);
    
    await client.query('COMMIT');
    
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating inventory:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Lấy dữ liệu nhập hàng
app.get('/api/import', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    let sql = `
      SELECT n.id, to_char(n.ngay,'DD/MM/YYYY') as ngay, s.ten_hang, n.so_luong
      FROM NhapHang n
      JOIN SanPham s ON n.id_san_pham = s.id
    `;
    const params = [];
    
    if (req.query.date) {
      sql += " WHERE to_char(n.ngay,'DD/MM/YYYY') = $1";
      params.push(req.query.date);
    }
    
    sql += ' ORDER BY n.ngay, s.stt LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    
    const result = await query(sql, params);
    
    res.json({
      data: result.rows,
      page,
      limit,
      total: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching imports:', err);
    res.status(500).json({ error: err.message });
  }
});

// Thêm dữ liệu nhập hàng
app.post('/api/import', async (req, res) => {
  try {
    const { ngay, id_san_pham, so_luong } = req.body;
    
    const result = await query(
      'INSERT INTO NhapHang (ngay, id_san_pham, so_luong) VALUES ($1, $2, $3) RETURNING id',
      [ngay, id_san_pham, so_luong]
    );
    
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Error adding import:', err);
    res.status(500).json({ error: err.message });
  }
});

// Lấy dữ liệu báo cáo (daily/monthly) - Tối ưu
app.get('/api/report', async (req, res) => {
  try {
    const { type, date } = req.query;
    
    if (type === 'daily') {
      const [y, m, d] = date.split('-');
      const reportDate = `${y}-${m}-${d}`;
      const yesterday = new Date(y, m - 1, d - 1);
      const yDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
      
      const result = await query(`
        SELECT 
          s.ncc,
          s.ten_hang AS "tenHang",
          s.dvt,
          COALESCE(t1.so_luong, 0) AS "tonTruoc",
          COALESCE(t2.so_luong, 0) AS "tonSau",
          COALESCE(n.so_luong, 0)  AS "nhap",
          (COALESCE(t1.so_luong,0) - COALESCE(t2.so_luong,0) + COALESCE(n.so_luong,0))         AS "suDung",
          (COALESCE(t1.so_luong,0) - COALESCE(t2.so_luong,0) + COALESCE(n.so_luong,0)) * s.gia  AS "thanhTien"
        FROM SanPham s
        LEFT JOIN TonKho   t1 ON s.id = t1.id_san_pham AND t1.ngay = $1
        LEFT JOIN TonKho   t2 ON s.id = t2.id_san_pham AND t2.ngay = $2
        LEFT JOIN NhapHang n  ON s.id = n.id_san_pham  AND n.ngay  = $2
        ORDER BY s.stt
      `, [yDate, reportDate]);
      
      res.json(result.rows);
    } else {
      const [year, month] = date.split('-');
      const firstDay = `${year}-${month}-01`;
      const last = new Date(year, month, 0);
      const lastDay = `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;
      
      const result = await query(`
        SELECT 
          s.ncc,
          s.ten_hang AS "tenHang",
          s.dvt,
          COALESCE(t1.so_luong, 0) AS "tonDauThang",
          COALESCE(t2.so_luong, 0) AS "tonCuoiThang",
          COALESCE(n.total, 0)     AS "nhapTrongThang",
          (COALESCE(t1.so_luong,0) - COALESCE(t2.so_luong,0) + COALESCE(n.total,0))         AS "suDungTrongThang",
          (COALESCE(t1.so_luong,0) - COALESCE(t2.so_luong,0) + COALESCE(n.total,0)) * s.gia AS "thanhTien"
        FROM SanPham s
        LEFT JOIN TonKho t1 ON s.id = t1.id_san_pham AND t1.ngay = $1
        LEFT JOIN TonKho t2 ON s.id = t2.id_san_pham AND t2.ngay = $2
        LEFT JOIN (
          SELECT id_san_pham, SUM(so_luong) AS total
          FROM NhapHang
          WHERE EXTRACT(YEAR FROM ngay) = $3 AND EXTRACT(MONTH FROM ngay) = $4
          GROUP BY id_san_pham
        ) n ON s.id = n.id_san_pham
        ORDER BY s.stt
      `, [firstDay, lastDay, year, month]);
      
      res.json(result.rows);
    }
  } catch (err) {
    console.error('Error generating report:', err);
    res.status(500).json({ error: err.message });
  }
});

// Lấy danh sách lên hàng - Tối ưu với window function
app.get('/api/restock', async (req, res) => {
  try {
    const { ncc } = req.query;
    
    let sql = `
      WITH latest_inventory AS (
        SELECT 
          id_san_pham, 
          so_luong,
          ROW_NUMBER() OVER (PARTITION BY id_san_pham ORDER BY ngay DESC) as rn
        FROM TonKho
      )
      SELECT 
          s.id,
          s.stt,
          s.ncc,
          s.ten_hang as tenHang,
          s.dvt,
          COALESCE(li.so_luong, 0) as tonHienTai,
          s.ton_toi_thieu,
          s.gia,
          GREATEST(s.ton_toi_thieu - COALESCE(li.so_luong, 0), 0) as canDat,
          GREATEST(s.ton_toi_thieu - COALESCE(li.so_luong, 0), 0) * s.gia as thanhTien
      FROM SanPham s
      LEFT JOIN latest_inventory li ON s.id = li.id_san_pham AND li.rn = 1
      WHERE s.ton_toi_thieu > COALESCE(li.so_luong, 0)
    `;
    
    const params = [];
    if (ncc) { 
      sql += ' AND s.ncc = $1'; 
      params.push(ncc); 
    }
    
    sql += ' ORDER BY s.stt';
    
    const result = await query(sql, params);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching restock list:', err);
    res.status(500).json({ error: err.message });
  }
});

// API đăng nhập
app.post('/api/login', async (req, res) => {
  try {
    const { ten_dang_nhap, mat_khau } = req.body;
    
    if (!ten_dang_nhap || !mat_khau) {
      return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
    }
    
    const result = await query(
      'SELECT id, ten_dang_nhap, quyen FROM NguoiDung WHERE ten_dang_nhap = $1 AND mat_khau = $2',
      [ten_dang_nhap, mat_khau]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Khởi động server
app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});

// Xử lý lỗi chung
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Đảm bảo đóng pool khi ứng dụng đóng
process.on('SIGINT', () => {
  pool.end(() => {
    console.log('Pool has been closed');
    process.exit(0);
  });
});
