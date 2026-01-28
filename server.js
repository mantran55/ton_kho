const express = require('express');
const db = require('./db-pg'); // Sử dụng db-pg mới
const port = process.env.PORT || 3000;

const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

console.log('DB ready (Neon via pg).');

// ================== HÀM HỖ TRỢ ==================
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
// =================================================


// ---------------- API ROUTES ---------------- //

// Lấy danh sách sản phẩm
app.get('/api/products', async (req, res) => {
    try {
        const sql = 'SELECT * FROM SanPham ORDER BY stt';
        const { rows } = await db.query(sql); // THAY ĐỔI 1
        
        const products = rows.map(product => [ // THAY ĐỔI 2
            product.id,
            product.ncc,
            product.ten_hang,
            product.dvt,
            product.ton_toi_thieu,
            product.gia,
            product.mau_ncc
        ]);
        
        res.json(products);
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ error: err.message });
    }
});

// Thêm sản phẩm mới
app.post('/api/products', async (req, res) => {
    try {
        const { ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc } = req.body;
        
        const { rows: [maxSttResult] } = await db.query('SELECT MAX(stt) as maxStt FROM SanPham'); // THAY ĐỔI 1
        const newStt = maxSttResult.maxstt ? maxSttResult.maxstt + 1 : 1;
        
        const sql = 'INSERT INTO SanPham (stt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        const { meta } = await db.query(sql, [newStt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc]); // THAY ĐỔI 1
        
        res.json({ success: true, id: meta.insertId }); // THAY ĐỔI 3
    } catch (err) {
        console.error('Error adding product:', err);
        res.status(500).json({ error: err.message });
    }
});

// ... (giữ nguyên tất cả các route khác như da-report, PUT, DELETE products, reorder) ...
// Tôi sẽ để bạn tự sao chép, nhưng hãy chắc chắn bạn áp dụng các thay đổi tương tự cho chúng nếu cần.
// Ví dụ: const [results] -> const { rows }, và result.affectedRows -> meta.affectedRows

// Lấy dữ liệu tồn kho
app.get('/api/inventory', async (req, res) => {
    try {
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
        
        sql += ' ORDER BY t.ngay, s.stt';
        const { rows } = await db.query(sql, params); // THAY ĐỔI 1
        
        const inventory = rows.map(item => [item.id, item.ngay, item.ten_hang, item.so_luong]); // THAY ĐỔI 2
        res.json(inventory);
    } catch (err) {
        console.error('Error fetching inventory:', err);
        res.status(500).json({ error: err.message });
    }
});

// Thêm/cập nhật tồn kho
app.post('/api/inventory', async (req, res) => {
    try {
        const { ngay, id_san_pham, so_luong } = req.body;
        const pgDate = convertDateFormat(ngay); // THÊM CHUYỂN ĐỔI NGÀY
        if (!pgDate) return res.status(400).json({ error: 'Định dạng ngày không hợp lệ' });
        
        const sql = `
            INSERT INTO TonKho (ngay, id_san_pham, so_luong) 
            VALUES ($1, $2, $3) 
            ON CONFLICT (ngay, id_san_pham) 
            DO UPDATE SET so_luong = $3
            RETURNING id
        `;
        
        const { rows: [result] } = await db.query(sql, [pgDate, id_san_pham, so_luong]); // THAY ĐỔI 1
        res.json({ success: true, id: result.id });
    } catch (err) {
        console.error('Error saving inventory:', err);
        res.status(500).json({ error: err.message });
    }
});

// Thêm dữ liệu nhập hàng (RẤT QUAN TRỌNG - SỬA LỖI NGÀY)
app.post('/api/import', async (req, res) => {
    try {
        const { ngay, id_san_pham, so_luong } = req.body;
        
        const pgDate = convertDateFormat(ngay); // <-- THÊM CHUYỂN ĐỔI NGÀY
        if (!pgDate) return res.status(400).json({ error: 'Định dạng ngày không hợp lệ' });

        const sql = 'INSERT INTO NhapHang (ngay, id_san_pham, so_luong) VALUES ($1, $2, $3)';
        const { meta } = await db.query(sql, [pgDate, id_san_pham, so_luong]); // THAY ĐỔI 1 & 2
        
        res.json({ success: true, id: meta.insertId }); // THAY ĐỔI 3
    } catch (err) {
        console.error('Error adding import:', err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy danh sách người dùng
app.get('/api/users', async (req, res) => {
    try {
        const sql = 'SELECT id, ten_dang_nhap, quyen FROM NguoiDung';
        const { rows } = await db.query(sql); // THAY ĐỔI 1
        
        const users = rows.map(user => [ // THAY ĐỔI 2
            user.id,
            user.ten_dang_nhap,
            '',
            user.quyen
        ]);
        
        res.json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
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
        
        const sql = 'SELECT id, ten_dang_nhap, quyen FROM NguoiDung WHERE ten_dang_nhap = $1 AND mat_khau = $2';
        const { rows } = await db.query(sql, [ten_dang_nhap, mat_khau]); // THAY ĐỔI 1
        
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Hàm hỗ trợ lấy tồn kho theo ngày (CẦN SỬA)
async function getInventoryByDate(date) {
    try {
        const sql = `
            SELECT s.ten_hang, t.so_luong
            FROM TonKho t
            JOIN SanPham s ON t.id_san_pham = s.id
            WHERE to_char(t.ngay, 'DD/MM/YYYY') = $1
        `;
        const { rows } = await db.query(sql, [date]); // THAY ĐỔI 1
        return rows; // THAY ĐỔI 2
    } catch (error) {
        console.error('Error getting inventory by date:', error);
        return [];
    }
}


// Khởi động server
app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});
