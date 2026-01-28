const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db-pg'); // Sử dụng db-pg mới

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

console.log('🚀 Server started - Neon Postgres ready');

// --- HÀM HỖ TRỢ CHUYỂN ĐỔI NGÀY ---
// Hàm chuyển đổi ngày từ DD/MM/YYYY thành YYYY-MM-DD
function convertDateFormat(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.trim().split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    const pgDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return pgDate;
  }
  return null;
}

// ================== API ROUTES ==================

// Lấy danh sách sản phẩm
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM SanPham ORDER BY stt');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: err.message });
  }
});

// Thêm sản phẩm mới
app.post('/api/products', async (req, res) => {
  try {
    const { ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc } = req.body;
    const { rows: [maxSttResult] } = await db.query('SELECT COALESCE(MAX(stt),0)+1 AS newStt FROM SanPham');
    const newStt = maxSttResult.newstt;
    const { rows: [result] } = await db.query('INSERT INTO SanPham (stt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [newStt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc]);
    res.json({ success: true, id: result.id });
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({ error: err.message });
  }
});

// ... (Bạn có thể thêm các route khác như PUT, DELETE products tương tự) ...

// Lấy dữ liệu tồn kho
app.get('/api/inventory', async (req, res) => {
  try {
    let sql = `SELECT t.id, to_char(t.ngay,'DD/MM/YYYY') as ngay, s.ten_hang, t.so_luong FROM TonKho t JOIN SanPham s ON t.id_san_pham = s.id`;
    const params = [];
    if (req.query.date) {
      sql += " WHERE to_char(t.ngay,'DD/MM/YYYY') = $1";
      params.push(req.query.date);
    }
    sql += ' ORDER BY t.ngay, s.stt';
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching inventory:', err);
    res.status(500).json({ error: err.message });
  }
});

// Thêm/cập nhật tồn kho (SỬA LỖI NGÀY)
app.post('/api/inventory', async (req, res) => {
  try {
    const { ngay, id_san_pham, so_luong } = req.body;
    const pgDate = convertDateFormat(ngay); // <-- CHUYỂN ĐỔI NGÀY
    if (!pgDate) return res.status(400).json({ error: 'Định dạng ngày không hợp lệ' });

    const sql = `INSERT INTO TonKho (ngay, id_san_pham, so_luong) VALUES ($1, $2, $3) ON CONFLICT (ngay, id_san_pham) DO UPDATE SET so_luong = EXCLUDED.so_luong RETURNING id`;
    const { rows: [result] } = await db.query(sql, [pgDate, id_san_pham, so_luong]);
    res.json({ success: true, id: result.id });
  } catch (err) {
    console.error('Error saving inventory:', err);
    res.status(500).json({ error: err.message });
  }
});

// Thêm dữ liệu nhập hàng (SỬA LỖI NGÀY - RẤT CÓ THỂ LÀ NGUYÊN NHÂN)
app.post('/api/import', async (req, res) => {
  try {
    const { ngay, id_san_pham, so_luong } = req.body;
    const pgDate = convertDateFormat(ngay); // <-- THÊM CHUYỂN ĐỔI NGÀY Ở ĐÂY
    if (!pgDate) return res.status(400).json({ error: 'Định dạng ngày không hợp lệ' });

    const { rows: [result] } = await db.query('INSERT INTO NhapHang (ngay, id_san_pham, so_luong) VALUES ($1, $2, $3) RETURNING id', [pgDate, id_san_pham, so_luong]);
    res.json({ success: true, id: result.id });
  } catch (err) {
    console.error('Error adding import:', err);
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
    const { rows } = await db.query('SELECT id, ten_dang_nhap, quyen FROM NguoiDung WHERE ten_dang_nhap = $1 AND mat_khau = $2', [ten_dang_nhap, mat_khau]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Khởi động server
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
