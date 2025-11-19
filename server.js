const express = require('express');
const db = require('./db-pg'); // PG wrapper cho Neon
const port = process.env.PORT || 3000;

const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

console.log('DB ready (Neon via pg).');

// ---------------- API ROUTES ---------------- //

// Lấy danh sách sản phẩm
app.get('/api/products', async (req, res) => {
    try {
        const sql = 'SELECT * FROM SanPham ORDER BY stt';
        const [results] = await db.promise().query(sql);
        
        const products = results.map(product => [
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
        
        // Lấy stt lớn nhất
        const [maxSttResult] = await db.promise().query('SELECT MAX(stt) as maxStt FROM SanPham');
        const newStt = maxSttResult[0].maxstt ? maxSttResult[0].maxstt + 1 : 1;
        
        // Thêm sản phẩm mới
        const sql = 'INSERT INTO SanPham (stt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        const [result] = await db.promise().query(sql, [newStt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc]);
        
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
        
        const sql = 'UPDATE SanPham SET ncc=$1, ten_hang=$2, dvt=$3, ton_toi_thieu=$4, gia=$5, mau_ncc=$6 WHERE id=$7';
        const [result] = await db.promise().query(sql, [ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc, id]);
        
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
        const sql = 'DELETE FROM SanPham WHERE id = $1';
        const [result] = await db.promise().query(sql, [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting product:', err);
        res.status(500).json({ error: err.message });
    }
});

// Thay đổi vị trí sản phẩm
app.post('/api/products/reorder', async (req, res) => {
    try {
        const { products } = req.body;
        if (!products || !Array.isArray(products) || products.length === 0) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
        }
        
        const promises = products.map(p => {
            const sql = 'UPDATE SanPham SET stt=$1 WHERE id=$2';
            return db.promise().query(sql, [p.stt, p.id]);
        });
        
        await Promise.all(promises);
        res.json({ success: true });
    } catch (err) {
        console.error('Error reordering products:', err);
        res.status(500).json({ error: err.message });
    }
});

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
        const [results] = await db.promise().query(sql, params);
        
        const inventory = results.map(item => [item.id, item.ngay, item.ten_hang, item.so_luong]);
        res.json(inventory);
    } catch (err) {
        console.error('Error fetching inventory:', err);
        res.status(500).json({ error: err.message });
    }
});

// Thêm/cập nhật tồn kho (Sử dụng UPSERT để tối ưu)
app.post('/api/inventory', async (req, res) => {
    try {
        const { ngay, id_san_pham, so_luong } = req.body;
        const [day, month, year] = ngay.split('/');
        const pgDate = `${year}-${month}-${day}`;
        
        // Sử dụng UPSERT (ON CONFLICT DO UPDATE) để thực hiện cả 2 thao tác trong 1 truy vấn
        const sql = `
            INSERT INTO TonKho (ngay, id_san_pham, so_luong) 
            VALUES ($1, $2, $3) 
            ON CONFLICT (ngay, id_san_pham) 
            DO UPDATE SET so_luong = $3
            RETURNING id
        `;
        
        const [result] = await db.promise().query(sql, [pgDate, id_san_pham, so_luong]);
        res.json({ success: true, id: result[0].id });
    } catch (err) {
        console.error('Error saving inventory:', err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy dữ liệu nhập hàng
app.get('/api/import', async (req, res) => {
    try {
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
        
        sql += ' ORDER BY n.ngay, s.stt';
        const [results] = await db.promise().query(sql, params);
        
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
        const sql = 'INSERT INTO NhapHang (ngay, id_san_pham, so_luong) VALUES ($1, $2, $3)';
        const [result] = await db.promise().query(sql, [ngay, id_san_pham, so_luong]);
        
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Error adding import:', err);
        res.status(500).json({ error: err.message });
    }
});

// Xóa nhập hàng
app.delete('/api/import/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const sql = 'DELETE FROM NhapHang WHERE id = $1';
        const [result] = await db.promise().query(sql, [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Không tìm thấy bản ghi nhập hàng' });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting import:', err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy dữ liệu báo cáo (daily/monthly)
app.get('/api/report', async (req, res) => {
    try {
        const { type, date } = req.query;
        
        if (type === 'daily') {
            const [y, m, d] = date.split('-');
            const reportDate = `${y}-${m}-${d}`;
            const yesterday = new Date(y, m - 1, d - 1);
            const yDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
            
            const sql = `
                SELECT
                s.ncc,
                s.ten_hang AS "tenHang",
                s.dvt,
                COALESCE(t1.so_luong, 0) AS "tonTruoc",
                COALESCE(t2.so_luong, 0) AS "tonSau",
                COALESCE(n.so_luong, 0) AS "nhap",
                (COALESCE(t1.so_luong,0) - COALESCE(t2.so_luong,0) + COALESCE(n.so_luong,0)) AS "suDung",
                (COALESCE(t1.so_luong,0) - COALESCE(t2.so_luong,0) + COALESCE(n.so_luong,0)) * s.gia AS "thanhTien"
                FROM SanPham s
                LEFT JOIN TonKho t1 ON s.id = t1.id_san_pham AND t1.ngay = $1
                LEFT JOIN TonKho t2 ON s.id = t2.id_san_pham AND t2.ngay = $2
                LEFT JOIN NhapHang n ON s.id = n.id_san_pham AND n.ngay = $3
                ORDER BY s.stt
            `;
            
            const [results] = await db.promise().query(sql, [yDate, reportDate, reportDate]);
            res.json(results);
        } else {
            const [year, month] = date.split('-');
            const firstDay = `${year}-${month}-01`;
            const last = new Date(year, month, 0);
            const lastDay = `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;
            
            const sql = `
                SELECT
                s.ncc,
                s.ten_hang AS "tenHang",
                s.dvt,
                COALESCE(t1.so_luong, 0) AS "tonDauThang",
                COALESCE(t2.so_luong, 0) AS "tonCuoiThang",
                COALESCE(n.total, 0) AS "nhapTrongThang",
                (COALESCE(t1.so_luong,0) - COALESCE(t2.so_luong,0) + COALESCE(n.total,0)) AS "suDungTrongThang",
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
            `;
            
            const [results] = await db.promise().query(sql, [firstDay, lastDay, year, month]);
            res.json(results);
        }
    } catch (err) {
        console.error('Error generating report:', err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy danh sách lên hàng
app.get('/api/restock', async (req, res) => {
    try {
        const { ncc } = req.query;
        
        let sql = `
            SELECT
            s.id,
            s.stt,
            s.ncc,
            s.ten_hang as tenHang,
            s.dvt,
            COALESCE(t.so_luong, 0) as tonHienTai,
            s.ton_toi_thieu,
            s.gia,
            GREATEST(s.ton_toi_thieu - COALESCE(t.so_luong, 0), 0) as canDat,
            GREATEST(s.ton_toi_thieu - COALESCE(t.so_luong, 0), 0) * s.gia as thanhTien
            FROM SanPham s
            LEFT JOIN (
                SELECT t1.id_san_pham, t1.so_luong
                FROM TonKho t1
                INNER JOIN (
                    SELECT id_san_pham, MAX(ngay) as max_date
                    FROM TonKho
                    GROUP BY id_san_pham
                ) t2 ON t1.id_san_pham = t2.id_san_pham AND t1.ngay = t2.max_date
            ) t ON s.id = t.id_san_pham
            WHERE s.ton_toi_thieu > COALESCE(t.so_luong, 0)
        `;
        
        const params = [];
        if (ncc) { 
            sql += ' AND s.ncc = $1'; 
            params.push(ncc); 
        }
        
        sql += ' ORDER BY s.stt';
        const [results] = await db.promise().query(sql, params);
        
        res.json(results);
    } catch (err) {
        console.error('Error fetching restock list:', err);
        res.status(500).json({ error: err.message });
    }
});

// Lấy danh sách người dùng
app.get('/api/users', async (req, res) => {
    try {
        const sql = 'SELECT id, ten_dang_nhap, quyen FROM NguoiDung';
        const [results] = await db.promise().query(sql);
        
        const users = results.map(user => [
            user.id,
            user.ten_dang_nhap,
            '', // Không trả về mật khẩu
            user.quyen
        ]);
        
        res.json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: err.message });
    }
});

// Thêm người dùng mới
app.post('/api/users', async (req, res) => {
    try {
        const { ten_dang_nhap, mat_khau, quyen } = req.body;
        
        const sql = 'INSERT INTO NguoiDung (ten_dang_nhap, mat_khau, quyen) VALUES ($1, $2, $3)';
        const [result] = await db.promise().query(sql, [ten_dang_nhap, mat_khau, quyen]);
        
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Error adding user:', err);
        
        // Kiểm tra lỗi trùng tên đăng nhập
        if (err.code === '23505') { // PostgreSQL unique violation error code
            return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
        }
        
        res.status(500).json({ error: err.message });
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
        
        const [result] = await db.promise().query(sql, params);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Không tìm thấy người dùng' });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating user:', err);
        
        // Kiểm tra lỗi trùng tên đăng nhập
        if (err.code === '23505') { // PostgreSQL unique violation error code
            return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
        }
        
        res.status(500).json({ error: err.message });
    }
});

// Xóa người dùng
app.delete('/api/users/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const sql = 'DELETE FROM NguoiDung WHERE id = $1';
        const [result] = await db.promise().query(sql, [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Không tìm thấy người dùng' });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ error: err.message });
    }
});

// Kiểm tra tồn kho
app.post('/api/inventory/check', async (req, res) => {
    try {
        const { ngay, id_san_pham } = req.body;
        
        const sql = "SELECT id FROM TonKho WHERE ngay = to_date($1, 'DD/MM/YYYY') AND id_san_pham = $2";
        const [results] = await db.promise().query(sql, [ngay, id_san_pham]);
        
        res.json({ exists: results.length > 0 });
    } catch (err) {
        console.error('Error checking inventory:', err);
        res.status(500).json({ error: err.message });
    }
});

// API endpoint cho xóa dữ liệu
app.delete('/api/delete-data', async (req, res) => {
    try {
        const { option, ncc } = req.body;

        if (!option || !['all', 'ncc', 'products', 'inventory'].includes(option)) {
            return res.status(400).json({ error: 'Tùy chọn xóa không hợp lệ' });
        }

        let result = { deletedProducts: 0, deletedInventory: 0 };

        if (option === 'all') {
            // Xóa toàn bộ dữ liệu tồn kho
            const [deleteInventoryResult] = await db.promise().query('DELETE FROM tonkho');
            result.deletedInventory = deleteInventoryResult.affectedRows;

            // Xóa toàn bộ sản phẩm
            const [deleteProductsResult] = await db.promise().query('DELETE FROM sanpham');
            result.deletedProducts = deleteProductsResult.affectedRows;

            return res.json({
                message: `Đã xóa ${result.deletedProducts} sản phẩm và ${result.deletedInventory} bản ghi tồn kho`,
                result
            });
        } else if (option === 'ncc') {
            if (!ncc) {
                return res.status(400).json({ error: 'Thiếu thông tin NCC' });
            }

            // Lấy ID của các sản phẩm thuộc NCC này
            const [products] = await db.promise().query('SELECT id FROM sanpham WHERE ncc = $1', [ncc]);
            const productIds = products.map(p => p.id);

            if (productIds.length > 0) {
                // Xóa dữ liệu tồn kho của các sản phẩm này
                const [deleteInventoryResult] = await db.promise().query(
                    'DELETE FROM tonkho WHERE id_san_pham = ANY($1)', [productIds]
                );
                result.deletedInventory = deleteInventoryResult.affectedRows;

                // Xóa các sản phẩm thuộc NCC này
                const [deleteProductsResult] = await db.promise().query(
                    'DELETE FROM sanpham WHERE ncc = $1', [ncc]
                );
                result.deletedProducts = deleteProductsResult.affectedRows;
            }

            return res.json({
                message: `Đã xóa ${result.deletedProducts} sản phẩm và ${result.deletedInventory} bản ghi tồn kho của NCC "${ncc}"`,
                result
            });
        } else if (option === 'products') {
            // Chỉ xóa sản phẩm, giữ lại dữ liệu tồn kho
            const [deleteProductsResult] = await db.promise().query('DELETE FROM sanpham');
            result.deletedProducts = deleteProductsResult.affectedRows;

            return res.json({
                message: `Đã xóa ${result.deletedProducts} sản phẩm (giữ lại dữ liệu tồn kho)`,
                result
            });
        } else if (option === 'inventory') {
            // Chỉ xóa dữ liệu tồn kho, giữ lại sản phẩm
            const [deleteInventoryResult] = await db.promise().query('DELETE FROM tonkho');
            result.deletedInventory = deleteInventoryResult.affectedRows;

            return res.json({
                message: `Đã xóa ${result.deletedInventory} bản ghi tồn kho (giữ lại sản phẩm)`,
                result
            });
        }
    } catch (error) {
        console.error('Error deleting data:', error);
        res.status(500).json({ error: 'Lỗi khi xóa dữ liệu' });
    }
});

// Cập nhật tồn kho
app.put('/api/inventory', async (req, res) => {
    try {
        const { ngay, id_san_pham, so_luong } = req.body;
        
        const sql = "UPDATE TonKho SET so_luong = $1 WHERE ngay = to_date($2, 'DD/MM/YYYY') AND id_san_pham = $3";
        const [result] = await db.promise().query(sql, [so_luong, ngay, id_san_pham]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Không tìm thấy dữ liệu tồn kho' });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating inventory:', err);
        res.status(500).json({ error: err.message });
    }
});

// Cập nhật tồn kho theo ID
app.put('/api/inventory/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const { ngay, id_san_pham, so_luong } = req.body;
        
        const sql = 'UPDATE TonKho SET ngay = $1, id_san_pham = $2, so_luong = $3 WHERE id = $4';
        await db.promise().query(sql, [ngay, id_san_pham, so_luong, id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating inventory by ID:', error);
        res.status(500).json({ error: error.message });
    }
});

// API đăng nhập (Tối ưu)
app.post('/api/login', async (req, res) => {
    try {
        console.time('login');
        const { ten_dang_nhap, mat_khau } = req.body;
        
        if (!ten_dang_nhap || !mat_khau) {
            return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
        }
        
        // Chỉ chọn các cột cần thiết, không lấy mật khẩu
        const sql = 'SELECT id, ten_dang_nhap, quyen FROM NguoiDung WHERE ten_dang_nhap = $1 AND mat_khau = $2';
        
        console.time('query');
        const [result] = await db.promise().query(sql, [ten_dang_nhap, mat_khau]);
        console.timeEnd('query');
        
        if (result.length === 0) {
            return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
        }
        
        const user = result[0];
        console.timeEnd('login');
        res.json(user);
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Lấy dữ liệu nhập hàng từ tồn kho
app.get('/api/inventory-imports', async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Thiếu tham số date' });
        }

        // Tính ngày trước đó
        const dateParts = date.split('/');
        const day = parseInt(dateParts[0]);
        const month = parseInt(dateParts[1]) - 1; // Tháng trong JS bắt đầu từ 0
        const year = parseInt(dateParts[2]);

        const currentDate = new Date(year, month, day);
        const prevDate = new Date(year, month, day - 1);

        // Định dạng lại ngày cho database
        const currentDateStr = `${String(currentDate.getDate()).padStart(2, '0')}/${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
        const prevDateStr = `${String(prevDate.getDate()).padStart(2, '0')}/${String(prevDate.getMonth() + 1).padStart(2, '0')}/${prevDate.getFullYear()}`;

        // Lấy dữ liệu tồn kho
        const [currentInventory, prevInventory] = await Promise.all([
            getInventoryByDate(currentDateStr),
            getInventoryByDate(prevDateStr)
        ]);

        // Lấy tất cả sản phẩm
        const [allProducts] = await db.promise().query('SELECT * FROM SanPham');

        // Tính toán dữ liệu nhập hàng
        const importData = [];

        for (const product of allProducts) {
            const productName = product.ten_hang;

            const currentInv = currentInventory.find(item => item.ten_hang === productName);
            const prevInv = prevInventory.find(item => item.ten_hang === productName);

            const currentQuantity = currentInv ? currentInv.so_luong : 0;
            const prevQuantity = prevInv ? prevInv.so_luong : 0;

            // Tính toán lượng nhập hàng
            const inventoryChange = currentQuantity - prevQuantity;
            let importQuantity = 0;

            if (inventoryChange > 0) {
                importQuantity = inventoryChange;
            }

            if (importQuantity > 0) {
                importData.push({
                    1: currentDateStr,
                    2: productName,
                    3: importQuantity
                });
            }
        }

        res.json(importData);
    } catch (error) {
        console.error('Error getting inventory imports:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// Hàm hỗ trợ lấy tồn kho theo ngày
async function getInventoryByDate(date) {
    try {
        const sql = `
            SELECT s.ten_hang, t.so_luong
            FROM TonKho t
            JOIN SanPham s ON t.id_san_pham = s.id
            WHERE to_char(t.ngay, 'DD/MM/YYYY') = $1
        `;
        const [result] = await db.promise().query(sql, [date]);
        return result;
    } catch (error) {
        console.error('Error getting inventory by date:', error);
        return [];
    }
}

// Hàm định dạng ngày thành dd/mm/yyyy
function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// Khởi động server
app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});

