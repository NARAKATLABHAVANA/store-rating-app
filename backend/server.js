const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// ---------- Settings (edit them in config.js) ----------
const config = require('./config');
const PORT = config.port;
const SECRET = config.jwtSecret;
const DB_CONFIG = {
  host: config.dbHost,
  user: config.dbUser,
  password: config.dbPassword,
};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

let db;

// ---------- Small helpers ----------
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function checkPassword(p = '') {
  if (!/^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,16}$/.test(p)) {
    return 'Password must be 8-16 characters with one uppercase letter and one special character';
  }
}

// Returns an error message, or nothing if everything is valid
function checkDetails({ name, email, address }) {
  if (!name || name.length < 20 || name.length > 60) return 'Name must be 20-60 characters';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) return 'Enter a valid email address';
  if (address && address.length > 400) return 'Address can be at most 400 characters';
}

function auth(...roles) {
  return (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      req.user = jwt.verify(token, SECRET);
    } catch {
      return res.status(401).json({ error: 'Please log in again' });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this' });
    }
    next();
  };
}

// Builds a safe ORDER BY (only allows the column names we list)
function orderBy(query, allowed, fallback) {
  const column = allowed.includes(query.sort) ? query.sort : fallback;
  return `ORDER BY ${column} ${query.order === 'desc' ? 'DESC' : 'ASC'}`;
}

const like = (value) => `%${value || ''}%`;

// ---------- Login, signup, password ----------
app.post('/api/signup', wrap(async (req, res) => {
  const { name, email, address, password } = req.body;
  const error = checkDetails(req.body) || checkPassword(password);
  if (error) return res.status(400).json({ error });
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (name, email, password, address, role) VALUES (?, ?, ?, ?, "user")',
    [name, email, hash, address || '']);
  res.json({ message: 'Account created. You can log in now.' });
}));

app.post('/api/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const [[user]] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(password || '', user.password))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  const info = { id: user.id, name: user.name, role: user.role };
  res.json({ token: jwt.sign(info, SECRET, { expiresIn: '8h' }), user: info });
}));

app.put('/api/password', auth(), wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const [[user]] = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(oldPassword || '', user.password))) {
    return res.status(400).json({ error: 'Current password is wrong' });
  }
  const error = checkPassword(newPassword);
  if (error) return res.status(400).json({ error });
  await db.query('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(newPassword, 10), req.user.id]);
  res.json({ message: 'Password updated' });
}));

// ---------- Admin ----------
app.get('/api/admin/stats', auth('admin'), wrap(async (req, res) => {
  const [[row]] = await db.query(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM stores) AS stores,
            (SELECT COUNT(*) FROM ratings) AS ratings`);
  res.json(row);
}));

app.post('/api/admin/users', auth('admin'), wrap(async (req, res) => {
  const { name, email, address, password, role } = req.body;
  const error = checkDetails(req.body) || checkPassword(password);
  if (error) return res.status(400).json({ error });
  if (!['admin', 'user', 'owner'].includes(role)) return res.status(400).json({ error: 'Choose a role' });
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (name, email, password, address, role) VALUES (?, ?, ?, ?, ?)',
    [name, email, hash, address || '', role]);
  res.json({ message: 'User added' });
}));

app.get('/api/admin/users', auth('admin'), wrap(async (req, res) => {
  const q = req.query;
  const [rows] = await db.query(
    `SELECT id, name, email, address, role FROM users
     WHERE name LIKE ? AND email LIKE ? AND address LIKE ? AND (? = '' OR role = ?)
     ${orderBy(q, ['name', 'email', 'address', 'role'], 'name')}`,
    [like(q.name), like(q.email), like(q.address), q.role || '', q.role || '']);
  res.json(rows);
}));

app.get('/api/admin/users/:id', auth('admin'), wrap(async (req, res) => {
  const [[user]] = await db.query('SELECT id, name, email, address, role FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'owner') {
    const [[row]] = await db.query(
      `SELECT ROUND(AVG(r.rating), 1) AS rating FROM stores s
       LEFT JOIN ratings r ON r.store_id = s.id WHERE s.owner_id = ?`, [user.id]);
    user.rating = row.rating;
  }
  res.json(user);
}));

app.post('/api/admin/stores', auth('admin'), wrap(async (req, res) => {
  const { name, email, address, owner_id } = req.body;
  const error = checkDetails(req.body);
  if (error) return res.status(400).json({ error });
  await db.query('INSERT INTO stores (name, email, address, owner_id) VALUES (?, ?, ?, ?)',
    [name, email, address || '', owner_id || null]);
  res.json({ message: 'Store added' });
}));

app.get('/api/admin/stores', auth('admin'), wrap(async (req, res) => {
  const q = req.query;
  const [rows] = await db.query(
    `SELECT s.id, s.name, s.email, s.address, ROUND(AVG(r.rating), 1) AS rating
     FROM stores s LEFT JOIN ratings r ON r.store_id = s.id
     WHERE s.name LIKE ? AND s.email LIKE ? AND s.address LIKE ?
     GROUP BY s.id
     ${orderBy(q, ['name', 'email', 'address', 'rating'], 'name')}`,
    [like(q.name), like(q.email), like(q.address)]);
  res.json(rows);
}));

// ---------- Normal user ----------
app.get('/api/stores', auth('user'), wrap(async (req, res) => {
  const q = req.query;
  const [rows] = await db.query(
    `SELECT s.id, s.name, s.address,
            ROUND(AVG(r.rating), 1) AS rating,
            MAX(CASE WHEN r.user_id = ? THEN r.rating END) AS myRating
     FROM stores s LEFT JOIN ratings r ON r.store_id = s.id
     WHERE s.name LIKE ? AND s.address LIKE ?
     GROUP BY s.id
     ${orderBy(q, ['name', 'address', 'rating'], 'name')}`,
    [req.user.id, like(q.name), like(q.address)]);
  res.json(rows);
}));

app.post('/api/stores/:id/rate', auth('user'), wrap(async (req, res) => {
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5' });
  }
  // If the user already rated this store, update the old rating
  await db.query(
    `INSERT INTO ratings (user_id, store_id, rating) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE rating = ?`,
    [req.user.id, req.params.id, rating, rating]);
  res.json({ message: 'Rating saved' });
}));

// ---------- Store owner ----------
app.get('/api/owner/dashboard', auth('owner'), wrap(async (req, res) => {
  const [[store]] = await db.query('SELECT id, name, address FROM stores WHERE owner_id = ?', [req.user.id]);
  if (!store) return res.json({ store: null, average: null, raters: [] });
  const [[avg]] = await db.query('SELECT ROUND(AVG(rating), 1) AS average FROM ratings WHERE store_id = ?', [store.id]);
  const [raters] = await db.query(
    `SELECT u.name, u.email, r.rating, r.updated_at FROM ratings r
     JOIN users u ON u.id = r.user_id WHERE r.store_id = ?
     ${orderBy(req.query, ['name', 'email', 'rating', 'updated_at'], 'updated_at')}`, [store.id]);
  res.json({ store, average: avg.average, raters });
}));

// ---------- Errors ----------
app.use((err, req, res, next) => {
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That email is already in use' });
  if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'Store not found' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

// ---------- Start: create tables, add a first admin, run server ----------
async function start() {
  const setup = await mysql.createConnection({ ...DB_CONFIG, multipleStatements: true });
  await setup.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await setup.end();

  db = mysql.createPool({ ...DB_CONFIG, database: 'store_rating' });

  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM users WHERE role = "admin"');
  if (!total) {
    const hash = await bcrypt.hash('Admin@123', 10);
    await db.query('INSERT INTO users (name, email, password, address, role) VALUES (?, ?, ?, ?, "admin")',
      ['System Administrator Account', 'admin@example.com', hash, 'Head Office']);
    console.log('First admin created: admin@example.com / Admin@123');
  }

  app.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error('Could not start. Is MySQL running and are the DB settings correct?\n', err.message);
});
