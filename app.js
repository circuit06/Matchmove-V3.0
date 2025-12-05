// app.js
const express = require('express');
const path = require('path');
const XLSX = require('xlsx');
const session = require('express-session');
const db = require('./db'); // MySQL connection

const app = express();

// Body parsers (with larger limit for Excel JSON)
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ========== SESSION SETUP ==========
app.use(
  session({
    secret: 'super-secret-key-change-this', // change to something random
    resave: false,
    saveUninitialized: false,
  })
);

// Make user available in all EJS views if needed
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// ========== AUTH MIDDLEWARES ==========
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

// ===================== ROUTES =====================

// Default route -> login
app.get('/', (req, res) => {
  res.redirect('/login');
});

// LOGIN PAGE
app.get('/login', (req, res) => {
  res.render('login', { errors: [], messages: [] });
});

// REGISTER PAGE (admin only)
app.get('/register', requireAdmin, (req, res) => {
  res.render('register', { messages: [] });
});

// DASHBOARD PAGE (must be logged in)
app.get('/dashboard', requireLogin, (req, res) => {
  // dashboard.ejs will fetch data from /api/audit-records
  res.render('dashboard', { data: [] });
});

// LOGOUT
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ============= AUTH ROUTES (With DB) =============

// POST /login (check credentials in DB)
// POST /login (check credentials in DB)
app.post('/login', async (req, res) => {
  const { userEmail, userPassword } = req.body;
  let errors = [];
  let messages = [];

  try {
    if (!userEmail || !userPassword) {
      errors.push('Please enter both email and password');
      return res.render('login', { errors, messages });
    }

    // Look up user
    const [rows] = await db.query(
      'SELECT * FROM users WHERE email = ?',
      [userEmail]
    );

    if (rows.length === 0) {
      errors.push('Invalid email or password');
      return res.render('login', { errors, messages });
    }

    const user = rows[0];

    // Plain text password check
    if (user.password_hash !== userPassword) {
      errors.push('Invalid email or password');
      return res.render('login', { errors, messages });
    }

    // ✅ SAVE USER IN SESSION SO requireLogin WORKS
    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    };

    console.log("LOGIN SUCCESS — Redirecting user:", req.session.user);

    // 🎉 SUCCESS — redirect to dashboard
    return res.redirect('/dashboard');

  } catch (err) {
    console.error('Login error:', err);
    errors.push('Something went wrong.');
    return res.render('login', { errors, messages });
  }
});





// POST /register (admin creates new users)
app.post('/register', async (req, res) => {
  const { userName, userPassword, userRole, userEmail } = req.body;
  let messages = [];

  try {
    if (!userName || !userPassword || !userRole || !userEmail) {
      messages.push('All fields are required.');
      return res.render('register', { messages });
    }

    // Check if email or username exist
    const [existing] = await db.query(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [userEmail, userName]
    );

    if (existing.length > 0) {
      messages.push('Email or username already exists.');
      return res.render('register', { messages });
    }

    await db.query(
      'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [userName, userEmail, userPassword, userRole || 'user']
    );

    // Show success on login page
    const errors = [];
    messages.push('Registration successful! Please log in.');
    return res.render('login', { errors, messages });

  } catch (err) {
    console.error('Register error:', err);
    messages.push('Something went wrong during registration.');
    return res.render('register', { messages });
  }
});


// ============= API ROUTES FOR EXCEL + DB =============

// Save Excel data from frontend into DB
// Expect body: { rows: [...], filename: 'xxx.xlsx', userId: 1 }
app.post('/api/upload-excel', requireLogin, async (req, res) => {
  const { rows, filename } = req.body;
  const userId = req.session.user?.id;

  if (!rows || !rows.length || !filename || !userId) {
    return res
      .status(400)
      .json({ error: 'Missing rows/filename or not logged in' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Save upload metadata
    const [fileResult] = await conn.query(
      'INSERT INTO uploaded_files (user_id, filename, row_count) VALUES (?, ?, ?)',
      [userId, filename, rows.length]
    );
    const fileId = fileResult.insertId;

    // Map Excel headers to DB columns
    const values = rows.map((r) => [
      fileId,
      r['No.'] || null,
      r['NAME'] || null,
      r['PAN'] || null,
      r['ADDRESS 1'] || null,
      r['ADDRESS 2'] || null,
      r['ADDRESS 3'] || null,
      r['ADDRESS 4'] || null,
      r['CITY'] || null,
      r['STATE'] || null,
      r['COUNTRY'] || null,
      r['ZIP CODE'] || null,
      r['MOBILE NO.'] || null,
      r['PRODUCT'] || null,
      r['REFERENCE NUMBER'] || null,
      r['FILE NAME'] || null,
      r['AWB NUMBER'] || null,
      r['DISPATCH NUMBER'] || null,
      r['Status'] || r['Status '] || null,
    ]);

    const insertSql = `
      INSERT INTO audit_records (
        file_id, record_no, name, pan,
        address1, address2, address3, address4,
        city, state, country,
        zip_code, mobile_no,
        product, reference_number, file_name,
        awb_number, dispatch_date, status
      ) VALUES ?
    `;

    await conn.query(insertSql, [values]);

    await conn.commit();
    res.json({ success: true, fileId, inserted: rows.length });
  } catch (err) {
    await conn.rollback();
    console.error('Upload Excel error:', err);
    res.status(500).json({ error: 'Failed to save Excel data' });
  } finally {
    conn.release();
  }
});

// Return ALL audit records from DB (for dashboard AJAX)
app.get('/api/audit-records', requireLogin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM audit_records');
    res.json(rows);
  } catch (err) {
    console.error('Fetch audit records error:', err);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Optional: Clear all records (for testing)
app.delete('/api/audit-records', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM audit_records');
    await db.query('DELETE FROM uploaded_files');
    res.json({ success: true });
  } catch (err) {
    console.error('Clear data error:', err);
    res.status(500).json({ error: 'Failed to clear data' });
  }
});

// ===================== START SERVER =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
