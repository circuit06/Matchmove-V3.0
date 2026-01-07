// app.js
const express = require('express');
const path = require('path');
const XLSX = require('xlsx');
const db = require('./db');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');

const app = express();

// ========== FILE UPLOAD (PROFILE PICTURE) SETUP ==========

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir); // store inside /public/uploads
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

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

// 🔒 Disable cache so back button can't reopen protected pages after logout
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

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

// REGISTER PAGE (public – anyone can open)
app.get('/register', (req, res) => {
  res.render('register', { messages: [] });
});

// DASHBOARD PAGE (must be logged in)
app.get('/dashboard', requireLogin, (req, res) => {
  // dashboard.ejs will fetch data from /api/audit-records
  res.render('dashboard', { data: [] });
});

// EXCEPTIONS PAGE (must be logged in)
app.get('/exception', requireLogin, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM audit_records WHERE LOWER(status) = 'returned to sender'"
    );

    res.render('exception', { data: rows });
  } catch (err) {
    console.error("Error loading exception:", err);
    res.render('exception', { data: [] });
  }
});

// LOGOUT
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ============= AUTH ROUTES (With DB) =============

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
      role: user.role,
      profile_picture: user.profile_picture || 'default.png'
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

// POST /register (public signup) + optional profile picture
app.post('/register', upload.single('profilePic'), async (req, res) => {
  const { userName, userPassword, userRole, userEmail } = req.body;
  let messages = [];

  try {
    if (!userName || !userPassword || !userEmail) {
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

    // Handle profile picture (optional)
    let profilePic = 'default.png';
    if (req.file) {
      profilePic = req.file.filename;
    }

    await db.query(
      'INSERT INTO users (username, email, password_hash, role, profile_picture) VALUES (?, ?, ?, ?, ?)',
      [userName, userEmail, userPassword, 'user', profilePic] // force role to 'user'
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

// ===================== PROFILE ROUTES =====================

// VIEW PROFILE PAGE
app.get('/profile', requireLogin, (req, res) => {
  const user = req.session.user;

  const messages = req.session.messages || [];
  const errors = req.session.errors || [];

  // clear stored messages once displayed
  req.session.messages = [];
  req.session.errors = [];

  return res.render('profile', {
    user,
    messages,
    errors
  });
});


// UPDATE PROFILE (EDIT & SAVE) + optional profile picture
app.post('/profile', requireLogin, upload.single('profilePic'), async (req, res) => {
  const { userName, userEmail, userPassword } = req.body;
  const userId = req.session.user.id;

  let messages = [];
  let errors = [];

  try {
    // 🛑 Validate fields
    if (!userName || !userEmail) {
      errors.push("Username and Email cannot be empty.");
      return res.render("profile", {
        user: req.session.user,
        messages,
        errors
      });
    }

    // Determine profile picture
    let profilePic = req.session.user.profile_picture || 'default.png';
    if (req.file) {
      profilePic = req.file.filename;
    }

    //Update username + email + profile picture
    await db.query(
      `UPDATE users SET username = ?, email = ?, profile_picture = ? WHERE id = ?`,
      [userName, userEmail, profilePic, userId]
    );

    //Update password only if user entered one
    if (userPassword && userPassword.trim() !== "") {
      await db.query(
        `UPDATE users SET password_hash = ? WHERE id = ?`,
        [userPassword, userId]
      );
    }

    // 🔄 Update session so changes appear immediately
    req.session.user.username = userName;
    req.session.user.email = userEmail;
    req.session.user.profile_picture = profilePic;

    messages.push("Profile updated successfully!");

    return res.render("profile", {
      user: req.session.user,
      messages,
      errors
    });

  } catch (err) {
    console.error("Profile update error:", err);
    errors.push("Something went wrong while updating your profile.");

    return res.render("profile", {
      user: req.session.user,
      messages,
      errors
    });
  }
});

// ===================== START SERVER =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
// ===================== UPLOAD HISTORY PAGE =====================
app.get('/files', requireLogin, async (req, res) => {
  try {
    const [files] = await db.query(`
      SELECT 
        uf.id,
        uf.filename,
        uf.row_count,
        uf.uploaded_at,
        u.username
      FROM uploaded_files uf
      JOIN users u ON uf.user_id = u.id
      ORDER BY uf.uploaded_at DESC
    `);

    res.render('files', { files });

  } catch (err) {
    console.error("Upload history error:", err);
    res.render('files', { files: [] });
  }
});

// ===================== DASHBOARD FILE VIEW =====================
// Optional: load dashboard data for a specific file if fileId is in query
app.get('/dashboard', requireLogin, async (req, res) => {
  const fileId = req.query.fileId;

  if (fileId) {
    try {
      const [rows] = await db.query(
        'SELECT * FROM audit_records WHERE file_id = ?',
        [fileId]
      );
      return res.render('dashboard', { data: rows });
    } catch (err) {
      console.error("Error fetching file data for dashboard:", err);
      return res.render('dashboard', { data: [] });
    }
  }

  // Default dashboard (all records or empty)
  res.render('dashboard', { data: [] });
});
