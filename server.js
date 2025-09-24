const express = require('express');
const db = require('./db-pg');       // PG wrapper cho Neon
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
app.get('/api/products', (req, res) => {
    const sql = 'SELECT * FROM SanPham ORDER BY stt';
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
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
    });
});

// Thêm sản phẩm mới
app.post('/api/products', (req, res) => {
    const { ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc } = req.body;
    const getMaxSttSql = 'SELECT MAX(stt) as maxStt FROM SanPham';
    db.query(getMaxSttSql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        const newStt = results[0].maxstt ? results[0].maxstt + 1 : 1;
        const sql = 'INSERT INTO SanPham (stt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc) VALUES (?, ?, ?, ?, ?, ?, ?)';
        db.query(sql, [newStt, ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: result.insertId });
        });
    });
});

// Cập nhật sản phẩm
app.put('/api/products/:id', (req, res) => {
    const id = req.params.id;
    const { ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc } = req.body;
    const sql = 'UPDATE SanPham SET ncc=?, ten_hang=?, dvt=?, ton_toi_thieu=?, gia=?, mau_ncc=? WHERE id=?';
    db.query(sql, [ncc, ten_hang, dvt, ton_toi_thieu, gia, mau_ncc, id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
        res.json({ success: true });
    });
});

// Xóa sản phẩm
app.delete('/api/products/:id', (req, res) => {
    const id = req.params.id;
    const sql = 'DELETE FROM SanPham WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
        res.json({ success: true });
    });
});

// Thay đổi vị trí sản phẩm
app.post('/api/products/reorder', (req, res) => {
    const { products } = req.body;
    if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }
    const promises = products.map(p => new Promise((resolve, reject) => {
        const sql = 'UPDATE SanPham SET stt=? WHERE id=?';
        db.query(sql, [p.stt, p.id], (err, result) => {
            if (err) reject(err); else resolve(result);
        });
    }));
    Promise.all(promises)
        .then(() => res.json({ success: true }))
        .catch(err => res.status(500).json({ error: err.message }));
});

// Lấy dữ liệu tồn kho
app.get('/api/inventory', (req, res) => {
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
    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        const inventory = results.map(item => [item.id, item.ngay, item.ten_hang, item.so_luong]);
        res.json(inventory);
    });
});

// Thêm/cập nhật tồn kho
app.post('/api/inventory', (req, res) => {
    const { ngay, id_san_pham, so_luong } = req.body;
    const [day, month, year] = ngay.split('/');
    const pgDate = `${year}-${month}-${day}`;
    const checkSql = 'SELECT id FROM TonKho WHERE ngay=? AND id_san_pham=?';
    db.query(checkSql, [pgDate, id_san_pham], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            const updateSql = 'UPDATE TonKho SET so_luong=? WHERE id=?';
            db.query(updateSql, [so_luong, results[0].id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
        } else {
            const insertSql = 'INSERT INTO TonKho (ngay, id_san_pham, so_luong) VALUES (?, ?, ?)';
            db.query(insertSql, [pgDate, id_san_pham, so_luong], (err, result) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, id: result.insertId });
            });
        }
    });
});

// Lấy dữ liệu nhập hàng
app.get('/api/import', (req, res) => {
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
    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        const imports = results.map(item => [item.id, item.ngay, item.ten_hang, item.so_luong]);
        res.json(imports);
    });
});

// Thêm dữ liệu nhập hàng
app.post('/api/import', (req, res) => {
    const { ngay, id_san_pham, so_luong } = req.body;
    const sql = 'INSERT INTO NhapHang (ngay, id_san_pham, so_luong) VALUES (?, ?, ?)';
    db.query(sql, [ngay, id_san_pham, so_luong], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: result.insertId });
    });
});

// Lấy dữ liệu báo cáo (daily/monthly) – code rút gọn cho Postgres
app.get('/api/report', (req, res) => {
    const { type, date } = req.query;
    if (type === 'daily') {
        const [y, m, d] = date.split('-');
        const reportDate = `${y}-${m}-${d}`;
        const yesterday = new Date(y, m - 1, d - 1);
        const yDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
        const sql = `
            SELECT s.ncc, s.ten_hang as tenHang, s.dvt,
                COALESCE(t1.so_luong,0) as tonTruoc,
                COALESCE(t2.so_luong,0) as tonSau,
                COALESCE(n.so_luong,0) as nhap,
                (COALESCE(t1.so_luong,0)-COALESCE(t2.so_luong,0)+COALESCE(n.so_luong,0)) as suDung,
                (COALESCE(t1.so_luong,0)-COALESCE(t2.so_luong,0)+COALESCE(n.so_luong,0))*s.gia as thanhTien
            FROM SanPham s
            LEFT JOIN TonKho t1 ON s.id=t1.id_san_pham AND t1.ngay=?
            LEFT JOIN TonKho t2 ON s.id=t2.id_san_pham AND t2.ngay=?
            LEFT JOIN NhapHang n ON s.id=n.id_san_pham AND n.ngay=?
            ORDER BY s.stt
        `;
        db.query(sql, [yDate, reportDate, reportDate], (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        });
    } else {
        const [year, month] = date.split('-');
        const firstDay = `${year}-${month}-01`;
        const last = new Date(year, month, 0);
        const lastDay = `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;
        const sql = `
            SELECT s.ncc, s.ten_hang as tenHang, s.dvt,
                COALESCE(t1.so_luong,0) as tonDauThang,
                COALESCE(t2.so_luong,0) as tonCuoiThang,
                COALESCE(n.total,0) as nhapTrongThang,
                (COALESCE(t1.so_luong,0)-COALESCE(t2.so_luong,0)+COALESCE(n.total,0)) as suDungTrongThang,
                (COALESCE(t1.so_luong,0)-COALESCE(t2.so_luong,0)+COALESCE(n.total,0))*s.gia as thanhTien
            FROM SanPham s
            LEFT JOIN TonKho t1 ON s.id=t1.id_san_pham AND t1.ngay=?
            LEFT JOIN TonKho t2 ON s.id=t2.id_san_pham AND t2.ngay=?
            LEFT JOIN (
                SELECT id_san_pham,SUM(so_luong) as total
                FROM NhapHang WHERE EXTRACT(YEAR FROM ngay)=? AND EXTRACT(MONTH FROM ngay)=?
                GROUP BY id_san_pham
            ) n ON s.id=n.id_san_pham
            ORDER BY s.stt
        `;
        db.query(sql, [firstDay, lastDay, year, month], (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        });
    }
});

// Lấy danh sách lên hàng
app.get('/api/restock', (req, res) => {
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
    if (ncc) { sql += ' AND s.ncc = ?'; params.push(ncc); }
    
    
    sql += ' ORDER BY s.stt';
    
    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('Lỗi truy vấn:', err);
            return res.status(500).json({ error: err.message });
        }
        
        res.json(results);
    });
});

// Lấy danh sách người dùng
app.get('/api/users', (req, res) => {
    const sql = 'SELECT * FROM NguoiDung';
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Lỗi truy vấn:', err);
            return res.status(500).json({ error: err.message });
        }
        
        // Chuyển đổi dữ liệu thành định dạng mảng
        const users = results.map(user => [
            user.id,
            user.ten_dang_nhap,
            user.mat_khau,
            user.quyen
        ]);
        
        res.json(users);
    });
});

// Thêm người dùng mới
app.post('/api/users', (req, res) => {
    const { ten_dang_nhap, mat_khau, quyen } = req.body;
    
    const sql = 'INSERT INTO NguoiDung (ten_dang_nhap, mat_khau, quyen) VALUES (?, ?, ?)';
    db.query(sql, [ten_dang_nhap, mat_khau, quyen], (err, result) => {
        if (err) {
            // Kiểm tra lỗi trùng tên đăng nhập
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
            }
            console.error('Lỗi truy vấn:', err);
            return res.status(500).json({ error: err.message });
        }
        
        res.json({ success: true, id: result.insertId });
    });
});

// Cập nhật người dùng
app.put('/api/users/:id', (req, res) => {
    const id = req.params.id;
    const { ten_dang_nhap, mat_khau, quyen } = req.body;
    
    let sql, params;
    
    if (mat_khau) {
        // Cập nhật cả mật khẩu
        sql = 'UPDATE NguoiDung SET ten_dang_nhap = ?, mat_khau = ?, quyen = ? WHERE id = ?';
        params = [ten_dang_nhap, mat_khau, quyen, id];
    } else {
        // Không cập nhật mật khẩu
        sql = 'UPDATE NguoiDung SET ten_dang_nhap = ?, quyen = ? WHERE id = ?';
        params = [ten_dang_nhap, quyen, id];
    }
    
    db.query(sql, params, (err, result) => {
        if (err) {
            // Kiểm tra lỗi trùng tên đăng nhập
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
            }
            console.error('Lỗi truy vấn:', err);
            return res.status(500).json({ error: err.message });
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Không tìm thấy người dùng' });
        }
        
        res.json({ success: true });
    });
});

// Xóa người dùng
app.delete('/api/users/:id', (req, res) => {
    const id = req.params.id;
    
    const sql = 'DELETE FROM NguoiDung WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) {
            console.error('Lỗi truy vấn:', err);
            return res.status(500).json({ error: err.message });
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Không tìm thấy người dùng' });
        }
        
        res.json({ success: true });
    });
});

// Hàm định dạng ngày thành dd/mm/yyyy
function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// Kiểm tra tồn kho
app.post('/api/inventory/check', (req, res) => {
    const { ngay, id_san_pham } = req.body;
    
    console.log('Checking inventory for date:', ngay, 'and product:', id_san_pham); // Debug log
    
    const sql = "SELECT id FROM TonKho WHERE ngay = to_date(?, 'DD/MM/YYYY') AND id_san_pham = ?";
    db.query(sql, [ngay, id_san_pham], (err, results) => {
        if (err) {
            console.error('Lỗi kiểm tra tồn kho:', err);
            return res.status(500).json({ error: err.message });
        }
        
        console.log('Check results:', results); // Debug log
        res.json({ exists: results.length > 0 });
    });
});

// API endpoint cho xóa dữ liệu (Node.js/Express)
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
            const [products] = await db.promise().query('SELECT id FROM san_pham WHERE ncc = ?', [ncc]);
            const productIds = products.map(p => p.id);
            
            if (productIds.length > 0) {
                // Xóa dữ liệu tồn kho của các sản phẩm này
                const [deleteInventoryResult] = await db.promise().query(
                    'DELETE FROM tonkho WHERE id_san_pham = ANY(?)', [productIds]
                );
                result.deletedInventory = deleteInventoryResult.affectedRows;
                
                // Xóa các sản phẩm thuộc NCC này
                const [deleteProductsResult] = await db.promise().query(
                    'DELETE FROM sanpham WHERE ncc = ?', [ncc]
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
app.put('/api/inventory', (req, res) => {
    const { ngay, id_san_pham, so_luong } = req.body;
    
    console.log('Updating inventory:', req.body); // Debug log
    
    const sql = "UPDATE TonKho SET so_luong = ? WHERE ngay = to_date(?, 'DD/MM/YYYY') AND id_san_pham = ?";
    db.query(sql, [so_luong, ngay, id_san_pham], (err, result) => {
        if (err) {
            console.error('Lỗi cập nhật tồn kho:', err);
            return res.status(500).json({ error: err.message });
        }
        
        console.log('Updated inventory, affected rows:', result.affectedRows); // Debug log
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Không tìm thấy dữ liệu tồn kho' });
        }
        
        res.json({ success: true });
    });
});

// Ví dụ cho Node.js với Express
app.put('/api/inventory/:id', (req, res) => {
    const id = req.params.id;
    const { ngay, id_san_pham, so_luong } = req.body;
    
    // Cập nhật bản ghi trong database
    db.query(
        'UPDATE TonKho  SET ngay = ?, id_san_pham = ?, so_luong = ? WHERE id = ?',
        [ngay, id_san_pham, so_luong, id],
        (error, results) => {
            if (error) {
                return res.status(500).json({ error: error.message });
            }
            res.json({ success: true });
        }
    );
});

// API đăng nhập
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
// Thêm vào file server.js
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
        
        // Tính toán dữ liệu nhập hàng
        const importData = [];
        
        for (const product of await getAllProducts()) {
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

// Hàm hỗ trợ
async function getInventoryByDate(date) {
    // Implement your logic to get inventory by date
    // This is just a placeholder
    return [];
}

async function getAllProducts() {
    // Implement your logic to get all products
    // This is just a placeholder
    return [];
}

