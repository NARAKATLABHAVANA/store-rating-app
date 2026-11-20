// ---------- Basics ----------
const view = document.getElementById('view');
const nav = document.getElementById('nav');
const messageBox = document.getElementById('message');

let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user') || 'null');

// Talks to the backend. Throws an Error with a readable message if something fails.
async function api(url, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch('/api' + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) logout();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function showMessage(text, ok = false) {
  messageBox.textContent = text;
  messageBox.className = ok ? 'ok' : 'error';
  messageBox.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => (messageBox.hidden = true), 4000);
}

// Stops user-typed text from being treated as HTML
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const show = (value) => (value === null || value === undefined ? '-' : esc(value));

// ---------- Validation (same rules as the backend) ----------
function checkName(name) {
  if (name.length < 20 || name.length > 60) return 'Name must be 20-60 characters';
}
function checkEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address';
}
function checkAddress(address) {
  if (address.length > 400) return 'Address can be at most 400 characters';
}
function checkPassword(password) {
  if (!/^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{8,16}$/.test(password)) {
    return 'Password must be 8-16 characters with one uppercase letter and one special character';
  }
}

// Reads a form into an object, e.g. { name: '...', email: '...' }
const formData = (form) => Object.fromEntries(new FormData(form));

// Runs a list of checks and shows the first error
function firstError(...errors) {
  const error = errors.find(Boolean);
  if (error) showMessage(error);
  return error;
}

// ---------- Login and signup ----------
function showLogin() {
  nav.innerHTML = '';
  view.innerHTML = `
    <div class="card narrow">
      <h2>Log in</h2>
      <form id="loginForm">
        <label>Email</label><input name="email" type="email" required>
        <label>Password</label><input name="password" type="password" required>
        <div class="actions"><button>Log in</button></div>
      </form>
      <p class="switch">New here? <button class="link" id="goSignup">Create an account</button></p>
    </div>`;

  document.getElementById('goSignup').onclick = showSignup;
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await api('/login', 'POST', formData(e.target));
      token = data.token;
      user = data.user;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      showApp();
    } catch (err) {
      showMessage(err.message);
    }
  };
}

function showSignup() {
  view.innerHTML = `
    <div class="card narrow">
      <h2>Create an account</h2>
      <form id="signupForm">
        <label>Full name (20-60 characters)</label><input name="name" required>
        <label>Email</label><input name="email" type="email" required>
        <label>Address</label><textarea name="address" rows="2"></textarea>
        <label>Password</label><input name="password" type="password" required>
        <div class="actions"><button>Sign up</button></div>
      </form>
      <p class="switch">Already have an account? <button class="link" id="goLogin">Log in</button></p>
    </div>`;

  document.getElementById('goLogin').onclick = showLogin;
  document.getElementById('signupForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (firstError(checkName(d.name), checkEmail(d.email), checkAddress(d.address), checkPassword(d.password))) return;
    try {
      const data = await api('/signup', 'POST', d);
      showLogin();
      showMessage(data.message, true);
    } catch (err) {
      showMessage(err.message);
    }
  };
}

function logout() {
  token = null;
  user = null;
  localStorage.clear();
  showLogin();
}

// ---------- App shell: menu depends on the role ----------
const menus = {
  admin: [
    ['Dashboard', adminDashboard],
    ['Stores', adminStores],
    ['Users', adminUsers],
    ['Add store', addStoreForm],
    ['Add user', addUserForm],
    ['Password', passwordForm],
  ],
  user: [
    ['Stores', userStores],
    ['Password', passwordForm],
  ],
  owner: [
    ['Dashboard', ownerDashboard],
    ['Password', passwordForm],
  ],
};

function showApp() {
  const items = menus[user.role];
  nav.innerHTML = '';
  items.forEach(([label, page], i) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.onclick = () => {
      nav.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
      page();
    };
    nav.appendChild(button);
  });
  const out = document.createElement('button');
  out.textContent = 'Log out';
  out.onclick = logout;
  nav.appendChild(out);

  nav.querySelector('button').click(); // open the first page
}

// ---------- Reusable list with search boxes and sortable columns ----------
// columns: [{ key, label, sortable, render(row) }]   filters: [{ name, label, options? }]
function listPage({ title, endpoint, filters, columns, defaultSort, onRows }) {
  const state = { sort: defaultSort, order: 'asc' };

  view.innerHTML = `
    <h2>${title}</h2>
    <div id="detail"></div>
    <form id="filters" class="filters">
      ${filters.map((f) => f.options
        ? `<select name="${f.name}"><option value="">All ${f.label}</option>${f.options.map((o) => `<option value="${o}">${o}</option>`).join('')}</select>`
        : `<input name="${f.name}" placeholder="${f.label}">`).join('')}
      <button>Search</button>
    </form>
    <div class="card table-wrap" id="tableBox"></div>`;

  const form = document.getElementById('filters');
  const box = document.getElementById('tableBox');

  async function load() {
    try {
      const params = new URLSearchParams({ ...formData(form), sort: state.sort, order: state.order });
      const rows = await api(`${endpoint}?${params}`);
      draw(rows);
    } catch (err) {
      showMessage(err.message);
    }
  }

  function draw(rows) {
    if (!rows.length) {
      box.innerHTML = '<p class="empty">Nothing found.</p>';
      return;
    }
    const arrow = (key) => (state.sort === key ? (state.order === 'asc' ? ' ▲' : ' ▼') : '');
    box.innerHTML = `<table>
      <thead><tr>${columns.map((c) =>
        `<th ${c.sortable ? `class="sortable" data-key="${c.key}"` : ''}>${c.label}${arrow(c.key)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) =>
        `<tr>${columns.map((c) => `<td>${c.render ? c.render(row) : show(row[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;

    box.querySelectorAll('th.sortable').forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.key;
        state.order = state.sort === key && state.order === 'asc' ? 'desc' : 'asc';
        state.sort = key;
        load();
      };
    });
    if (onRows) onRows(box, load);
  }

  form.onsubmit = (e) => { e.preventDefault(); load(); };
  load();
}

// ---------- Admin pages ----------
async function adminDashboard() {
  try {
    const s = await api('/admin/stats');
    view.innerHTML = `
      <h2>Dashboard</h2>
      <div class="stats">
        <div class="card stat"><strong>${s.users}</strong><span>Total users</span></div>
        <div class="card stat"><strong>${s.stores}</strong><span>Total stores</span></div>
        <div class="card stat"><strong>${s.ratings}</strong><span>Ratings submitted</span></div>
      </div>`;
  } catch (err) {
    showMessage(err.message);
  }
}

function adminStores() {
  listPage({
    title: 'Stores',
    endpoint: '/admin/stores',
    defaultSort: 'name',
    filters: [{ name: 'name', label: 'Name' }, { name: 'email', label: 'Email' }, { name: 'address', label: 'Address' }],
    columns: [
      { key: 'name', label: 'Name', sortable: true },
      { key: 'email', label: 'Email', sortable: true },
      { key: 'address', label: 'Address', sortable: true },
      { key: 'rating', label: 'Rating', sortable: true },
    ],
  });
}

function adminUsers() {
  listPage({
    title: 'Users',
    endpoint: '/admin/users',
    defaultSort: 'name',
    filters: [
      { name: 'name', label: 'Name' },
      { name: 'email', label: 'Email' },
      { name: 'address', label: 'Address' },
      { name: 'role', label: 'roles', options: ['admin', 'user', 'owner'] },
    ],
    columns: [
      { key: 'name', label: 'Name', sortable: true },
      { key: 'email', label: 'Email', sortable: true },
      { key: 'address', label: 'Address', sortable: true },
      { key: 'role', label: 'Role', sortable: true },
      { key: 'id', label: '', render: (r) => `<button class="small" data-view="${r.id}">View</button>` },
    ],
    onRows(box) {
      box.querySelectorAll('[data-view]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            const u = await api('/admin/users/' + btn.dataset.view);
            document.getElementById('detail').innerHTML = `
              <div class="card detail">
                <p><strong>Name:</strong> ${show(u.name)}</p>
                <p><strong>Email:</strong> ${show(u.email)}</p>
                <p><strong>Address:</strong> ${show(u.address)}</p>
                <p><strong>Role:</strong> ${show(u.role)}</p>
                ${u.role === 'owner' ? `<p><strong>Store rating:</strong> ${show(u.rating)}</p>` : ''}
              </div>`;
          } catch (err) {
            showMessage(err.message);
          }
        };
      });
    },
  });
}

async function addUserForm() {
  view.innerHTML = `
    <div class="card narrow">
      <h2>Add user</h2>
      <form id="userForm">
        <label>Full name (20-60 characters)</label><input name="name" required>
        <label>Email</label><input name="email" type="email" required>
        <label>Address</label><textarea name="address" rows="2"></textarea>
        <label>Password</label><input name="password" type="password" required>
        <label>Role</label>
        <select name="role">
          <option value="user">Normal user</option>
          <option value="owner">Store owner</option>
          <option value="admin">Admin</option>
        </select>
        <div class="actions"><button>Add user</button></div>
      </form>
    </div>`;

  document.getElementById('userForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (firstError(checkName(d.name), checkEmail(d.email), checkAddress(d.address), checkPassword(d.password))) return;
    try {
      const data = await api('/admin/users', 'POST', d);
      showMessage(data.message, true);
      e.target.reset();
    } catch (err) {
      showMessage(err.message);
    }
  };
}

async function addStoreForm() {
  let owners = [];
  try {
    owners = await api('/admin/users?role=owner&sort=name');
  } catch (err) {
    showMessage(err.message);
  }

  view.innerHTML = `
    <div class="card narrow">
      <h2>Add store</h2>
      <form id="storeForm">
        <label>Store name (20-60 characters)</label><input name="name" required>
        <label>Store email</label><input name="email" type="email" required>
        <label>Address</label><textarea name="address" rows="2"></textarea>
        <label>Store owner</label>
        <select name="owner_id">
          <option value="">No owner yet</option>
          ${owners.map((o) => `<option value="${o.id}">${esc(o.name)} (${esc(o.email)})</option>`).join('')}
        </select>
        <div class="actions"><button>Add store</button></div>
      </form>
    </div>`;

  document.getElementById('storeForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (firstError(checkName(d.name), checkEmail(d.email), checkAddress(d.address))) return;
    try {
      const data = await api('/admin/stores', 'POST', d);
      showMessage(data.message, true);
      e.target.reset();
    } catch (err) {
      showMessage(err.message);
    }
  };
}

// ---------- Normal user: browse and rate stores ----------
function userStores() {
  listPage({
    title: 'Stores',
    endpoint: '/stores',
    defaultSort: 'name',
    filters: [{ name: 'name', label: 'Search by name' }, { name: 'address', label: 'Search by address' }],
    columns: [
      { key: 'name', label: 'Store', sortable: true },
      { key: 'address', label: 'Address', sortable: true },
      { key: 'rating', label: 'Overall rating', sortable: true },
      { key: 'myRating', label: 'Your rating', render: (r) => show(r.myRating) },
      {
        key: 'id',
        label: 'Rate',
        render: (r) => `
          <div class="rate">
            <select id="rate-${r.id}">
              ${[1, 2, 3, 4, 5].map((n) => `<option ${r.myRating === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
            <button class="small" data-rate="${r.id}">${r.myRating ? 'Change' : 'Submit'}</button>
          </div>`,
      },
    ],
    onRows(box, reload) {
      box.querySelectorAll('[data-rate]').forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.dataset.rate;
          try {
            const rating = document.getElementById('rate-' + id).value;
            const data = await api(`/stores/${id}/rate`, 'POST', { rating });
            showMessage(data.message, true);
            reload();
          } catch (err) {
            showMessage(err.message);
          }
        };
      });
    },
  });
}

// ---------- Store owner dashboard ----------
async function ownerDashboard() {
  try {
    const data = await api('/owner/dashboard');
    if (!data.store) {
      view.innerHTML = '<h2>Dashboard</h2><p class="empty">No store is linked to your account yet. Ask an administrator to add one.</p>';
      return;
    }
    view.innerHTML = `
      <h2>${esc(data.store.name)}</h2>
      <div class="card stat"><strong>${show(data.average)}</strong><span>Average rating</span></div>
      <h2>People who rated your store</h2>
      <div class="card table-wrap">
        ${data.raters.length ? `<table>
          <thead><tr><th>Name</th><th>Email</th><th>Rating</th></tr></thead>
          <tbody>${data.raters.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${r.rating}</td></tr>`).join('')}</tbody>
        </table>` : '<p class="empty">No ratings yet.</p>'}
      </div>`;
  } catch (err) {
    showMessage(err.message);
  }
}

// ---------- Change password (all roles) ----------
function passwordForm() {
  view.innerHTML = `
    <div class="card narrow">
      <h2>Change password</h2>
      <form id="passwordForm">
        <label>Current password</label><input name="oldPassword" type="password" required>
        <label>New password</label><input name="newPassword" type="password" required>
        <div class="actions"><button>Update password</button></div>
      </form>
    </div>`;

  document.getElementById('passwordForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (firstError(checkPassword(d.newPassword))) return;
    try {
      const data = await api('/password', 'PUT', d);
      showMessage(data.message, true);
      e.target.reset();
    } catch (err) {
      showMessage(err.message);
    }
  };
}

// ---------- Start ----------
if (token && user) showApp();
else showLogin();
