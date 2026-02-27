const ownerStatus = document.getElementById('ownerStatus');
const teacherEmailInput = document.getElementById('teacherEmailInput');
const addTeacherBtn = document.getElementById('addTeacherBtn');
const adminUsersList = document.getElementById('adminUsersList');
const backToPreviousBtn = document.getElementById('backToPreviousBtn');

const ADMIN_GOOGLE_TOKEN_KEY = 'adminGoogleIdToken';

function setOwnerStatus(message, isError = false) {
  if (!ownerStatus) return;
  ownerStatus.textContent = message;
  ownerStatus.className = isError ? 'lpv2-help error' : 'lpv2-help';
}

function getToken() {
  return String(localStorage.getItem(ADMIN_GOOGLE_TOKEN_KEY) || '').trim();
}

function setToken(token) {
  localStorage.setItem(ADMIN_GOOGLE_TOKEN_KEY, String(token || '').trim());
}

function isAppSessionToken(token) {
  return String(token || '').startsWith('app.');
}

async function ensureSessionToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return '';
  if (isAppSessionToken(raw)) return raw;
  const res = await fetch('/api/auth/google-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: raw })
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data?.message || `認証に失敗しました (${res.status})`);
  }
  const appToken = String(data?.appToken || '').trim();
  if (!appToken) {
    throw new Error('認証に失敗しました。');
  }
  setToken(appToken);
  return appToken;
}

async function apiFetch(url, options = {}) {
  const token = await ensureSessionToken(getToken());
  if (!token) {
    throw new Error('ログインが必要です。');
  }
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...options, headers });
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    throw new Error(data?.message || `APIエラー (${res.status})`);
  }
  return data;
}

function renderAdminUsers(items) {
  adminUsersList.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = '管理者がまだ登録されていません。';
    adminUsersList.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'lpv2-admin-user-item';

    const left = document.createElement('div');
    left.className = 'lpv2-admin-user-meta';
    const email = document.createElement('strong');
    email.textContent = item.email;
    const role = document.createElement('span');
    role.textContent = item.role === 'owner' ? '管理者' : '教師';
    left.append(email, role);
    li.appendChild(left);

    if (item.role !== 'owner') {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'lpv2-remove-btn';
      removeBtn.textContent = '削除';
      removeBtn.addEventListener('click', async () => {
        removeBtn.disabled = true;
        try {
          await apiFetch(`/api/admin-users/${encodeURIComponent(item.email)}`, { method: 'DELETE' });
          await loadAdminUsers();
          setOwnerStatus('教師を削除しました。');
        } catch (error) {
          setOwnerStatus(error.message, true);
        } finally {
          removeBtn.disabled = false;
        }
      });
      li.appendChild(removeBtn);
    }
    adminUsersList.appendChild(li);
  }
}

async function loadAdminUsers() {
  const data = await apiFetch('/api/admin-users', { cache: 'no-store' });
  renderAdminUsers(Array.isArray(data.items) ? data.items : []);
}

async function init() {
  try {
    const session = await apiFetch('/api/auth/session', { cache: 'no-store' });
    if (session.role !== 'owner') {
      location.href = '/admin';
      return;
    }
    setOwnerStatus(`ログイン済み: ${session.email}`);
    await loadAdminUsers();
  } catch (error) {
    setOwnerStatus(error.message, true);
  }

  addTeacherBtn.addEventListener('click', async () => {
    const email = String(teacherEmailInput?.value || '').trim().toLowerCase();
    if (!email) {
      setOwnerStatus('追加する教師メールを入力してください。', true);
      return;
    }
    addTeacherBtn.disabled = true;
    try {
      await apiFetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      teacherEmailInput.value = '';
      await loadAdminUsers();
      setOwnerStatus('教師を追加しました。');
    } catch (error) {
      setOwnerStatus(error.message, true);
    } finally {
      addTeacherBtn.disabled = false;
    }
  });

  if (backToPreviousBtn) {
    backToPreviousBtn.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        location.href = '/teacher-login';
      }
    });
  }
}

init();
