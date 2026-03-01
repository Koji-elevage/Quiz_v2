const ownerStatus = document.getElementById('ownerStatus');
const teacherEmailInput = document.getElementById('teacherEmailInput');
const addTeacherBtn = document.getElementById('addTeacherBtn');
const adminUsersList = document.getElementById('adminUsersList');
const backToPreviousBtn = document.getElementById('backToPreviousBtn');
const feedbackList = document.getElementById('feedbackList');
const ownerLogoutBtn = document.getElementById('ownerLogoutBtn');

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

function logoutToFeedbackScreen() {
  const currentStatus = String(ownerStatus?.textContent || '').trim();
  const matchedEmail = currentStatus.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (matchedEmail?.[0]) {
    sessionStorage.setItem('logoutFeedbackEmail', matchedEmail[0]);
  } else {
    sessionStorage.removeItem('logoutFeedbackEmail');
  }
  localStorage.removeItem(ADMIN_GOOGLE_TOKEN_KEY);
  location.href = '/teacher-signout';
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderFeedbackItems(items) {
  if (!feedbackList) return;
  feedbackList.innerHTML = '';
  if (!items.length) {
    feedbackList.innerHTML = '<p class="lpv2-help">まだ投稿はありません。</p>';
    return;
  }

  for (const item of items) {
    const article = document.createElement('article');
    article.className = 'lpv2-feedback-item';

    const submittedBy = String(item.submitted_by || item.submittedBy || '匿名').trim() || '匿名';
    const createdAt = String(item.created_at || item.createdAt || '').trim();
    article.innerHTML = `
      <div class="lpv2-feedback-meta">
        <strong>${escapeHtml(submittedBy)}</strong>
        <span>${escapeHtml(createdAt)}</span>
      </div>
      <div class="lpv2-feedback-section">
        <div class="lpv2-feedback-label">V2での不具合報告</div>
        <div class="lpv2-feedback-body">${escapeHtml(item.bug_report || item.bugReport || '（なし）')}</div>
      </div>
      <div class="lpv2-feedback-section">
        <div class="lpv2-feedback-label">バージョン3への要望事項</div>
        <div class="lpv2-feedback-body">${escapeHtml(item.v3_request || item.v3Request || '（なし）')}</div>
      </div>
      <div class="lpv2-feedback-section">
        <div class="lpv2-feedback-label">その他</div>
        <div class="lpv2-feedback-body">${escapeHtml(item.other_comment || item.otherComment || '（なし）')}</div>
      </div>
    `;
    feedbackList.appendChild(article);
  }
}

async function loadAdminUsers() {
  const data = await apiFetch('/api/admin-users', { cache: 'no-store' });
  renderAdminUsers(Array.isArray(data.items) ? data.items : []);
}

async function loadFeedback() {
  const data = await apiFetch('/api/feedback', { cache: 'no-store' });
  renderFeedbackItems(Array.isArray(data.items) ? data.items : []);
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
    await loadFeedback();
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
      await loadFeedback();
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
  if (ownerLogoutBtn) {
    ownerLogoutBtn.addEventListener('click', logoutToFeedbackScreen);
  }
}

init();
