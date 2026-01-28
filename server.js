const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db-pg'); // pg Pool (Neon)

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

console.log('🚀 Server started - Neon Postgres ready');

// ================== HÀM HỖ TRỢ CHUYỂN ĐỔI NGÀY ==================
// Hàm chuyển đổi ngày từ DD/MM/YYYY thành YYYY-MM-DD một cách an toàn
function convertDateFormat(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.trim().split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    // Đảm bảo ngày và tháng có 2 chữ số
    const pgDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return pgDate;
  }
  return null;
}
// ===============================================================


// ================== PRODUCTS ==================

// Lấy danh sách sản phẩm
app.get('/api/products', async (req, res) => {
  try {
    const sql = `
      SELECT id, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc
      FROM SanPham
      ORDER BY stt
    `;
    const { rows } = await db.query(sql);

    res.json(rows.map(p => ({
      id: p.id,
      ncc: p.ncc,
      tenHang: p.ten_hang,
      dvt: p.dvt,
      tonToiThieu: p.ton_toi_thieu,
      gia: p.gia,
      mauNcc: p.mau_ncc
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi lấy sản phẩm' });
  }
});

// Thêm sản phẩm
app.post('/api/products', async (req, res) => {
  try {
    const { ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc } = req.body;

    const { rows } = await db.query(`SELECT COALESCE(MAX(stt),0)+1 AS stt FROM SanPham`);
    const stt = rows[0].stt;

    await db.query(`
      INSERT INTO SanPham (stt,ncc,ten_hang,dvt,ton_toi_thieu,gia,mau_ncc)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [stt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi thêm sản phẩm' });
  }
});

// ================== INVENTORY ==================

// Lấy tồn kho theo ngày (ĐÃ SỬA)
app.get('/api/inventory', async (req, res) => {
  try {
    const { date } = req.query; // <-- date có định dạng DD/MM/YYYY

    let sql = `
      SELECT t.id, to_char(t.ngay,'DD/MM/YYYY') as ngay, s.ten_hang, t.so_luong
      FROM TonKho t
      JOIN SanPham s ON s.id = t.id_san_pham
    `;
    const params = [];

    if (date) {
      const pgDate = convertDateFormat(date); // <-- SỬ DỤNG HÀM CHUYỂN ĐỔI
      if (!pgDate) return res.status(400).json({ error: 'Định dạng ngày không hợp lệ' });
      sql += ` WHERE t.ngay = $1`;
      params.push(pgDate);
    }

    sql += ` ORDER BY t.ngay, s.stt`;

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi lấy tồn kho' });
  }
});

// UPSERT tồn kho (ĐÃ SỬA)
app.post('/api/inventory', async (req, res) => {
  try {
    const { ngay, id_san_pham, so_luong } = req.body;

    const pgDate = convertDateFormat(ngay); // <-- SỬ DỤNG HÀM CHUYỂN ĐỔI
    if (!pgDate) return res.status(400).json({ error: 'Định dạng ngày không hợp lệ' });

    const sql = `
      INSERT INTO TonKho (ngay, id_san_pham, so_luong)
      VALUES ($1,$2,$3)
      ON CONFLICT (ngay,id_san_pham)
      DO UPDATE SET so_luong = EXCLUDED.so_luong
    `;
    await db.query(sql, [pgDate, id_san_pham, so_luong]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi lưu tồn kho' });
  }
});

// ================== REPORT ==================

// Báo cáo nhập hàng (ĐÃ SỬA)
app.get('/api/inventory-imports', async (req, res) => {
  try {
    const { date } = req.query; // <-- date có định dạng DD/MM/YYYY

    // Chuyển đổi ngày trước khi tạo đối tượng Date
    const pgDate = convertDateFormat(date);
    if (!pgDate) return res.status(400).json({ error: 'Định dạng ngày không hợp lệ' });

    const current = new Date(pgDate + 'T00:00:00.000Z'); // Tạo Date từ chuỗi chuẩn
    const prev = new Date(current);
    prev.setDate(prev.getDate() - 1);

    const sql = `
      SELECT
        s.ten_hang,
        GREATEST(
          COALESCE(t2.so_luong,0) - COALESCE(t1.so_luong,0),
          0
        ) AS so_luong_nhap
      FROM SanPham s
      LEFT JOIN TonKho t1 ON s.id = t1.id_san_pham AND t1.ngay = $1
      LEFT JOIN TonKho t2 ON s.id = t2.id_san_pham AND t2.ngay = $2
      WHERE COALESCE(t2.so_luong,0) > COALESCE(t1.so_luong,0)
      ORDER BY s.stt
    `;

    const { rows } = await db.query(sql, [
      prev.toISOString().slice(0,10),
      current.toISOString().slice(0,10)
    ]);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi báo cáo nhập hàng' });
  }
});

// ================== LOGIN ==================

app.post('/api/login', async (req, res) => {
  try {
    const { ten_dang_nhap, mat_khau } = req.body;

    const sql = `
      SELECT id, ten_dang_nhap, quyen
      FROM NguoiDung
      WHERE ten_dang_nhap = $1 AND mat_khau = $2
    `;

    const { rows } = await db.query(sql, [ten_dang_nhap, mat_khau]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi đăng nhập' });
  }
});

// Lấy danh sách người dùng
app.get('/api/users', async (req, res) => {
  try {
    const sql = 'SELECT id, ten_dang_nhap, quyen FROM NguoiDung';
    const { rows } = await db.query(sql);
    
    // Frontend của bạn có vẻ muốn dữ liệu ở dạng mảng lồng
    const users = rows.map(user => [
      user.id, 
      user.ten_dang_nhap, 
      '', // Không trả về mật khẩu
      user.quyen
    ]);
    
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi khi tải danh sách người dùng' });
  }
});

// Thêm người dùng mới
app.post('/api/users', async (req, res) => {
  try {
    const { ten_dang_nhap, mat_khau, quyen } = req.body;
    
    const sql = 'INSERT INTO NguoiDung (ten_dang_nhap, mat_khau, quyen) VALUES ($1, $2, $3) RETURNING id';
    const { rows: [result] } = await db.query(sql, [ten_dang_nhap, mat_khau, quyen]);
    
    res.json({ success: true, id: result.id });
  } catch (err) {
    console.error(err);
    
    // Kiểm tra lỗi trùng tên đăng nhập
    if (err.code === '23505') { // PostgreSQL unique violation error code
      return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
    }
    
    res.status(500).json({ error: 'Lỗi thêm người dùng' });
  }
});

// Cập nhật người dùng
app.put('/api/users/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { ten_dang_nhap, mat_khau, quyen } = req.body;
    
    let sql, params;
    
    if (mat_khau) {
      // Cập nhật cả mật khẩu
      sql = 'UPDATE NguoiDung SET ten_dang_nhap = $1, mat_khau = $2, quyen = $3 WHERE id = $4';
      params = [ten_dang_nhap, mat_khau, quyen, id];
    } else {
      // Không cập nhật mật khẩu
      sql = 'UPDATE NguoiDung SET ten_dang_nhap = $1, quyen = $2 WHERE id = $3';
      params = [ten_dang_nhap, quyen, id];
    }
    
    // Lấy meta để kiểm tra affectedRows
    const { meta } = await db.query(sql, params);
    
    if (meta.affectedRows === 0) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
    }
    
    res.status(500).json({ error: 'Lỗi cập nhật người dùng' });
  }
});

// Xóa người dùng
app.delete('/api/users/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const sql = 'DELETE FROM NguoiDung WHERE id = $1';
    
    // Lấy meta để kiểm tra affectedRows
    const { meta } = await db.query(sql, [id]);
    
    if (meta.affectedRows === 0) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi xóa người dùng' });
  }
});


// ================== START ==================

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});

