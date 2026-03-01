const loginBtn = document.getElementById('teacherGoogleLoginBtn');
const loginMount = document.getElementById('teacherGoogleLoginMount');
const statusEl = document.getElementById('teacherLoginStatus');
const titleEl = document.getElementById('teacherLoginTitle');
const subtitleEl = document.getElementById('teacherLoginSubtitle');
const ownerChoiceSection = document.getElementById('ownerChoiceSection');
const loginPanel = document.getElementById('loginPanel');
const openTeacherManualBtn = document.getElementById('openTeacherManualBtn');
const docModalOverlay = document.getElementById('docModalOverlay');
const docModalTitle = document.getElementById('docModalTitle');
const docModalFrame = document.getElementById('docModalFrame');
const closeDocModalBtn = document.getElementById('closeDocModalBtn');

const ADMIN_GOOGLE_TOKEN_KEY = 'adminGoogleIdToken';

const state = {
  googleClientId: ''
};

function setPageCopy(title, subtitle) {
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = isError ? 'lpv2-help error' : 'lpv2-help';
}

function setGoogleToken(token) {
  localStorage.setItem(ADMIN_GOOGLE_TOKEN_KEY, String(token || '').trim());
}

function getGoogleToken() {
  return String(localStorage.getItem(ADMIN_GOOGLE_TOKEN_KEY) || '').trim();
}

function isAppSessionToken(token) {
  return String(token || '').startsWith('app.');
}

async function exchangeGoogleTokenForSession(idToken) {
  const token = String(idToken || '').trim();
  if (!token) {
    throw new Error('Google認証トークンが見つかりません。');
  }
  if (isAppSessionToken(token)) {
    return { appToken: token };
  }
  const res = await fetch('/api/auth/google-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token })
  });
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    throw new Error(data?.message || `Googleセッション作成に失敗しました (${res.status})`);
  }
  const appToken = String(data?.appToken || '').trim();
  if (!appToken) {
    throw new Error('Googleセッション作成に失敗しました。');
  }
  return { appToken };
}

function openDocModal(title, frameSrc) {
  if (!docModalOverlay || !docModalTitle || !docModalFrame) return;
  docModalTitle.textContent = title;
  docModalFrame.src = frameSrc;
  docModalOverlay.classList.add('active');
}

function closeDocModal() {
  if (!docModalOverlay) return;
  docModalOverlay.classList.remove('active');
  if (docModalFrame) docModalFrame.src = '';
}

async function waitForGoogleLibrary(maxWaitMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function fetchSession(token) {
  const res = await fetch('/api/auth/session', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data?.message || `認証に失敗しました (${res.status})`);
  }
  return data;
}

async function handleSuccessfulLogin(credential) {
  const exchanged = await exchangeGoogleTokenForSession(credential);
  setGoogleToken(exchanged.appToken);
  setStatus('認証確認中...');
  const session = await fetchSession(exchanged.appToken);

  if (session.role === 'owner') {
    if (loginPanel) loginPanel.classList.add('hidden');
    ownerChoiceSection.classList.remove('hidden');
    setPageCopy('教師・管理者メニュー', 'ログイン済みです。進む画面を選択してください。');
    setStatus(`ログイン済み: ${session.email}`);
    return;
  }

  setPageCopy('教師・管理者ログイン', '教師画面へ移動しています。');
  setStatus('ログイン成功。教師画面へ移動します。');
  location.href = '/admin';
}

async function startGoogleLogin() {
    if (!state.googleClientId) {
      setStatus('Google認証設定が未完了です。', true);
      return;
  }
  const loaded = await waitForGoogleLibrary(6000);
  if (!loaded) {
    setStatus('GoogleログインAPIを読み込めませんでした。', true);
    return;
  }
  initializeExplicitGoogleButton();
  setStatus('Googleボタンからログインしてください。');
}

function initializeExplicitGoogleButton() {
  if (!loginMount || !state.googleClientId) return;
  if (!(window.google && window.google.accounts && window.google.accounts.id)) {
    setStatus('GoogleログインAPIを読み込めませんでした。', true);
    return;
  }
  loginMount.innerHTML = '';
  window.google.accounts.id.initialize({
    client_id: state.googleClientId,
    callback: async (response) => {
      const credential = String(response?.credential || '').trim();
      if (!credential) {
        setStatus('Googleログインに失敗しました。', true);
        return;
      }
      try {
        await handleSuccessfulLogin(credential);
      } catch (error) {
        setStatus(error.message, true);
      }
    }
  });
  window.google.accounts.id.renderButton(loginMount, {
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text: 'signin_with',
    locale: 'ja',
    width: 220
  });
}

async function init() {
  setPageCopy('教師・管理者ログイン', 'Googleアカウントで認証すると、教師画面または管理者画面へ進めます。');
  try {
    const res = await fetch('/api/auth/config', { cache: 'no-store' });
    const config = await res.json();
    if (config.mode !== 'google') {
      setStatus('この環境はGoogle認証モードではありません。', true);
      if (loginBtn) loginBtn.disabled = true;
      return;
    }
    state.googleClientId = String(config.googleClientId || '').trim();
    if (!state.googleClientId) {
      setStatus('GoogleクライアントIDが未設定です。', true);
      if (loginBtn) loginBtn.disabled = true;
      return;
    }
  } catch (error) {
    setStatus('認証設定の取得に失敗しました。', true);
    if (loginBtn) loginBtn.disabled = true;
    return;
  }

  const loaded = await waitForGoogleLibrary(6000);
  if (!loaded) {
    setStatus('GoogleログインAPIを読み込めませんでした。', true);
    if (loginBtn) {
      loginBtn.classList.remove('hidden');
      loginBtn.disabled = true;
    }
  } else {
    initializeExplicitGoogleButton();
    if (loginBtn) {
      loginBtn.addEventListener('click', startGoogleLogin);
    }
  }
  if (openTeacherManualBtn) {
    openTeacherManualBtn.addEventListener('click', () => {
      openDocModal('教師向け簡易マニュアル', '/teacher-manual-v2');
    });
  }
  if (closeDocModalBtn) {
    closeDocModalBtn.addEventListener('click', closeDocModal);
  }
  if (docModalOverlay) {
    docModalOverlay.addEventListener('click', (e) => {
      if (e.target === docModalOverlay) closeDocModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDocModal();
  });

  const existingToken = getGoogleToken();
  if (!existingToken) {
    return;
  }

  try {
    await handleSuccessfulLogin(existingToken);
  } catch (_error) {
    localStorage.removeItem(ADMIN_GOOGLE_TOKEN_KEY);
    setPageCopy('教師・管理者ログイン', 'Googleアカウントで認証すると、教師画面または管理者画面へ進めます。');
    setStatus('ログイン待ち');
  }
}

init();
