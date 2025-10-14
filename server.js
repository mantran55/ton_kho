const express = require('express');
const db = require('./db-pg');       // PG wrapper cho Neon - GIỮ NGUYÊN MODULE NÀY
const port = process.env.PORT || 3000;

const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

console.log('DB ready (Neon via pg).');

// Helper function để thực hiện truy vấn với Promise
const query = (sql, params) => {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// ---------------- API ROUTES ---------------- //

// Lấy danh sách sản phẩm - Trả về mảng đơn giản
app.get('/api/products', async (req, res) => {
  try {
    const sql = 'SELECT * FROM SanPham ORDER BY stt';
    const results = await query(sql);
    
    const products = results.map(product => [
      product.id,
      product.ncc,
      product.ten_hang,
      product.dvt,
      product.ton_toi_thieu,
      product.gia,
      product.mau_ncc
    ]);
    
    res.json(products); // Trả về mảng trực tiếp
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: err.message });
  }
});

// Thêm sản phẩm mới - Tối ưu
app.post('/api/products', async (req, res) => {
  try {
    const { ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc } = req.body;
    
    // Lấy stt lớn nhất
    const sttResult = await query('SELECT MAX(stt) as maxStt FROM SanPham');
    const newStt = sttResult[0].maxstt ? sttResult[0].maxstt + 1 : 1;
    
    // Thêm sản phẩm mới
    const result = await query(
      'INSERT INTO SanPham (stt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [newStt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc]
    );
    
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({ error: err.message });
  }
});

// Cập nhật sản phẩm
app.put('/api/products/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc } = req.body;
    
    const result = await query(
      'UPDATE SanPham SET ncc=?, ten_hang=?, dvt=?, ton_toi_thieu=?, gia=?, mau_ncc=? WHERE id=?',
      [ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc, id]
    );
    
    if (result.affectedRows === 0) {
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
    
    const result = await query('DELETE FROM SanPham WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ error: err.message });
  }
});

// Thay đổi vị trí sản phẩm - Tối ưu
app.post('/api/products/reorder', async (req, res) => {
  try {
    const { products } = req.body;
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }
    
    const promises = products.map(p => {
      return query('UPDATE SanPham SET stt=? WHERE id=?', [p.stt, p.id]);
    });
    
    await Promise.all(promises);
    res.json({ success: true });
  } catch (err) {
    console.error('Error reordering products:', err);
    res.status(500).json({ error: err.message });
  }
});

// Lấy dữ liệu tồn kho - Tối ưu
app.get('/api/inventory', async (req, res) => {
  try {
    let sql = `
      SELECT t.id, to_char(t.ngay,'DD/MM/YYYY') as ngay, s.ten_hang, t.so_luong
      FROM TonKho t
      JOIN SanPham s ON t.id_san_pham = s.id
    `;
    const params = [];
    
    if (req.query.date) {
      sql += " WHERE to_char(t.ngay,'DD/MM/YYYY') = ?";
      params.push(req.query.date);
    }
    
    sql += ' ORDER BY t.ngay, s.stt';
    
    const results = await query(sql, params);
    const inventory = results.map(item => [item.id, item.ngay, item.ten_hang, item.so_luong]);
    
    res.json(inventory);
  } catch (err) {
    console.error('Error fetching inventory:', err);
    res.status(500).json({ error: err.message });
  }
});

// Thêm/cập nhật tồn kho - Tối ưu với UPSERT
app.post('/api/inventory', async (req, res) => {
  try {
    const { ngay, id_san_pham, so_luong } = req.body;
    const [day, month, year] = ngay.split('/');
    const pgDate = `${year}-${month}-${day}`;
    
    // Sử dụng UPSERT thay vì kiểm tra rồi insert/update
    const result = await query(`
      INSERT INTO TonKho (ngay, id_san_pham, so_luong) 
      VALUES (?, ?, ?)
      ON CONFLICT (ngay, id_san_pham) 
      DO UPDATE SET so_luong = ?
      RETURNING id
    `, [pgDate, id_san_pham, so_luong, so_luong]);
    
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Error updating inventory:', err);
    res.status(500).json({ error: err.message });
  }
});

// Lấy dữ liệu nhập hàng - Tối ưu
app.get('/api/import', async (req, res) => {
  try {
    let sql = `
      SELECT n.id, to_char(n.ngay,'DD/MM/YYYY') as ngay, s.ten_hang, n.so_luong
      FROM NhapHang n
      JOIN SanPham s ON n.id_san_pham = s.id
    `;
    const params = [];
    
    if (req.query.date) {
      sql += " WHERE to_char(n.ngay,'DD/MM/YYYY') = ?";
      params.push(req.query.date);
    }
    
    sql += ' ORDER BY n.ngay, s.stt';
    
    const results = await query(sql, params);
    const imports = results.map(item => [item.id, item.ngay, item.ten_hang, item.so_luong]);
    
    res.json(imports);
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
      'INSERT INTO NhapHang (ngay, id_san_pham, so_luong) VALUES (?, ?, ?)',
      [ngay, id_san_pham, so_luong]
    );
    
    res.json({ success: true, id: result.insertId });
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
      
      const results = await query(`
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
        LEFT JOIN TonKho   t1 ON s.id = t1.id_san_pham AND t1.ngay = ?
        LEFT JOIN TonKho   t2 ON s.id = t2.id_san_pham AND t2.ngay = ?
        LEFT JOIN NhapHang n  ON s.id = n.id_san_pham  AND n.ngay  = ?
        ORDER BY s.stt
      `, [yDate, reportDate, reportDate]);
      
      res.json(results);
    } else {
      const [year, month] = date.split('-');
      const firstDay = `${year}-${month}-01`;
      const last = new Date(year, month, 0);
      const lastDay = `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;
      
      const results = await query(`
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
        LEFT JOIN TonKho t1 ON s.id = t1.id_san_pham AND t1.ngay = ?
        LEFT JOIN TonKho t2 ON s.id = t2.id_san_pham AND t2.ngay = ?
        LEFT JOIN (
          SELECT id_san_pham, SUM(so_luong) AS total
          FROM NhapHang
          WHERE EXTRACT(YEAR FROM ngay) = ? AND EXTRACT(MONTH FROM ngay) = ?
          GROUP BY id_san_pham
        ) n ON s.id = n.id_san_pham
        ORDER BY s.stt
      `, [firstDay, lastDay, year, month]);
      
      res.json(results);
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
      sql += ' AND s.ncc = ?'; 
      params.push(ncc); 
    }
    
    sql += ' ORDER BY s.stt';
    
    const results = await query(sql, params);
    res.json(results);
  } catch (err) {
    console.error('Error fetching restock list:', err);
    res.status(500).json({ error: err.message });
  }
});

// API đăng nhập - Giữ nguyên từ code cũ
app.post('/api/login', (req, res) => {
  const { ten_dang_nhap, mat_khau } = req.body;
  
  if (!ten_dang_nhap || !mat_khau) {
    return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
  }
  
  const sql = 'SELECT * FROM NguoiDung WHERE ten_dang_nhap = ? AND mat_khau = ?';
  db.query(sql, [ten_dang_nhap, mat_khau], (err, results) => {
    if (err) {
      console.error('Lỗi truy vấn:', err);
      return res.status(500).json({ error: 'Lỗi server' });
    }
    
    if (results.length === 0) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    
    const user = results[0];
    // Không trả về mật khẩu
    const { mat_khau, ...userWithoutPassword } = user;
    
    res.json(userWithoutPassword);
  });
});

// Khởi động server
app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});

