const express = require('express');
const path = require('path');
const XLSX = require('xlsx');
const session = require('express-session');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: 'supersecretkey',
    resave: false,
    saveUninitialized: true,
  })
);

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { errors: [], messages: [] });
});

app.get('/register', (req, res) => {
  res.render('register', { messages: [] });
});

app.get('/dashboard', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'dummy_data1.xlsx');
    console.log('Trying to read:', filePath);

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    console.log('Sheet Names:', workbook.SheetNames);

    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log('Data loaded:', data.length, 'rows');

    res.render('dashboard', { data });
  } catch (err) {
    console.error('Error reading Excel file:', err);
    res.send('Error reading Excel file');
  }
});

app.get('/exception', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'dummy_data1.xlsx');
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    const exceptionData = data.filter(row => {
      const statusColumn = Object.keys(row).find(key =>
        key.toLowerCase().includes('status')
      );
      if (!statusColumn) return false;

      return String(row[statusColumn]).trim().toLowerCase() === 'returned to sender';
    });

    res.render('exception', { data: exceptionData });
  } catch (error) {
    console.error('Error loading exception data:', error);
    res.send('Error loading exception page.');
  }
});

app.post('/login', (req, res) => {
  const { userEmail, userPassword } = req.body;
  let errors = [];
  let messages = [];

  if (!userEmail || !userPassword) {
    errors.push('Please enter both email and password');
    return res.render('login', { errors, messages });
  }

  req.session.user = {
    email: userEmail,
  };

  messages.push('Login successful!');
  res.render('login', { errors, messages });
});

app.post('/register', (req, res) => {
  const { userName, userPassword, userEmail } = req.body;
  const userRole = 'user';
  let messages = [];

  if (!userName || !userPassword || !userEmail) {
    messages.push('All fields are required.');
    return res.render('register', { messages });
  }

  app.get('/profile', (req, res) => {
    const user = req.session.user;

    if (!user) return res.redirect('/login');

    res.render('profile', {
      userName: user.userName,
      userEmail: user.userEmail
    });
  });

  const errors = [];
  messages.push(`User "${userName}" registered successfully! You can now log in.`);
  return res.render('login', { errors, messages });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
