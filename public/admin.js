const questionBody = document.getElementById('questionBody');
const addRowBtn = document.getElementById('addRowBtn');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const saveQuizBtn = document.getElementById('saveQuizBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const backToLpBtn = document.getElementById('backToLpBtn');
const formMessage = document.getElementById('formMessage');
const editStatus = document.getElementById('editStatus');
const quizListBody = document.getElementById('quizListBody');
const titleInput = document.getElementById('titleInput');
const titleWorkStatus = document.getElementById('titleWorkStatus');
const promptConfigTypeSelect = document.getElementById('promptConfigType');
const promptConfigEditorPanel = document.getElementById('promptConfigEditorPanel');
const promptConfigEditorTitle = document.getElementById('promptConfigEditorTitle');
const promptConfigYaml = document.getElementById('promptConfigYaml');
const promptConfigStatus = document.getElementById('promptConfigStatus');
const savePromptConfigBtn = document.getElementById('savePromptConfigBtn');
const resetPromptConfigBtn = document.getElementById('resetPromptConfigBtn');
const reloadPromptConfigBtn = document.getElementById('reloadPromptConfigBtn');
const closePromptConfigEditorBtn = document.getElementById('closePromptConfigEditorBtn');
const copyQrBtn = document.getElementById('copyQrBtn');
const authStatus = document.getElementById('authStatus');
const googleLoginBtn = document.getElementById('googleLoginBtn');
const ADMIN_TOKEN_KEY = 'adminToken';
const ADMIN_GOOGLE_TOKEN_KEY = 'adminGoogleIdToken';
const ADMIN_DRAFT_KEY = 'adminDraftV1';
const DEFAULT_FORM_MESSAGE = '5問以上入力して保存してください。';
const LOGIN_WAIT_MESSAGE = 'Googleログイン後にクイズ一覧を読み込みます。';
const DRAFT_SAVE_DEBOUNCE_MS = 1200;
const SAMPLE_IMAGE_URL = '/images/gen/sample_cleaned.png';
const PASTE_COLUMNS = [
    'prompt',
    'sentence',
    'choice0',
    'choice1',
    'choice2',
    'correctIndex',
    'explanation',
    'o0Usage',
    'o0Example',
    'o1Usage',
    'o1Example',
    'imageUrl'
];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeImageUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (url.startsWith('/images/gen/')) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return '';
}

function attachBrokenImageFallback(row, previewImg, hiddenUrlInput) {
    if (!previewImg || !hiddenUrlInput) return;
    previewImg.addEventListener('error', () => {
        if (previewImg.dataset.fallbackApplied === '1') return;
        previewImg.dataset.fallbackApplied = '1';
        hiddenUrlInput.value = '';
        previewImg.src = SAMPLE_IMAGE_URL;
        clearRowPreviousAiImage(row);
        if (state.imageModal?.row === row) {
            updateImageModalRestoreButton();
        }
        hiddenUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
        setMessage('表示できない画像を検出したため、サンプル画像に切り替えました。必要ならAI生成またはUPで再設定してください。', 'notice');
    });
}

function getAdminToken() {
    return String(localStorage.getItem(ADMIN_TOKEN_KEY) || '').trim();
}

function getGoogleIdToken() {
    return String(localStorage.getItem(ADMIN_GOOGLE_TOKEN_KEY) || '').trim();
}

function isAppSessionToken(token) {
    return String(token || '').startsWith('app.');
}

function applyTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    const tokenFromUrl = String(
        params.get('token')
        || params.get('adminToken')
        || hashParams.get('token')
        || hashParams.get('adminToken')
        || ''
    ).trim();
    if (!tokenFromUrl) return;
    localStorage.setItem(ADMIN_TOKEN_KEY, tokenFromUrl);
    window.history.replaceState({}, document.title, '/admin');
}

function ensureAdminToken(force = false) {
    let token = getAdminToken();
    if (!token || force) {
        token = String(window.prompt('管理者トークンを入力してください') || '').trim();
        if (!token) {
            throw new Error('管理者トークンが必要です。');
        }
        localStorage.setItem(ADMIN_TOKEN_KEY, token);
    }
    return token;
}

function decodeJwtPayload(token) {
    try {
        const parts = String(token || '').split('.');
        if (parts.length !== 3) return null;
        const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = raw.padEnd(Math.ceil(raw.length / 4) * 4, '=');
        return JSON.parse(atob(padded));
    } catch {
        return null;
    }
}

function setAuthStatus(message, type = 'notice') {
    if (!authStatus) return;
    authStatus.textContent = message;
    authStatus.className = `auth-status auth-status-top ${type}`;
}

function refreshAuthUi() {
    if (!googleLoginBtn) return;
    if (state.auth.mode !== 'google') {
        googleLoginBtn.classList.add('hidden');
        return;
    }
    if (state.auth.loggedIn) {
        googleLoginBtn.classList.add('hidden');
    } else {
        googleLoginBtn.classList.remove('hidden');
    }
}

async function exchangeGoogleTokenForSession(idToken) {
    const token = String(idToken || '').trim();
    if (!token) {
        throw new Error('Google認証トークンが見つかりません。');
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
    return {
        appToken,
        email: String(data?.user?.email || '').trim()
    };
}

async function setGoogleTokenFromCredential(credential) {
    const idToken = String(credential || '').trim();
    if (!idToken) return false;
    const exchanged = await exchangeGoogleTokenForSession(idToken);
    localStorage.setItem(ADMIN_GOOGLE_TOKEN_KEY, exchanged.appToken);
    const email = exchanged.email || (decodeJwtPayload(idToken)?.email || '');
    state.auth.loggedIn = true;
    setAuthStatus(`Googleログイン済み\n${email}`, 'success');
    refreshAuthUi();
    await loadProtectedData();
    return true;
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

async function openGoogleLoginPrompt() {
    if (!state.auth.googleClientId) {
        setAuthStatus('Google認証の設定が未完了です。', 'error');
        return;
    }
    const loaded = await waitForGoogleLibrary(6000);
    if (!loaded) {
        setAuthStatus('GoogleログインAPIを読み込めませんでした。再読み込みしてください。', 'error');
        return;
    }
    setAuthStatus('Googleログイン画面を開いています...', 'notice');
    let loginSucceeded = false;
    window.google.accounts.id.initialize({
        client_id: state.auth.googleClientId,
        callback: async (response) => {
            try {
                const ok = await setGoogleTokenFromCredential(response?.credential);
                if (!ok) {
                    state.auth.loggedIn = false;
                    refreshAuthUi();
                    setAuthStatus('Googleログインに失敗しました。', 'error');
                    return;
                }
                loginSucceeded = true;
            } catch (error) {
                state.auth.loggedIn = false;
                refreshAuthUi();
                setAuthStatus(error.message || 'Googleログインに失敗しました。', 'error');
            }
        }
    });
    window.google.accounts.id.prompt((notification) => {
        if (!notification) return;
        if (notification.isNotDisplayed && notification.isNotDisplayed()) {
            const reason = notification.getNotDisplayedReason ? notification.getNotDisplayedReason() : 'unknown';
            setAuthStatus(`Googleログイン画面を表示できませんでした: ${reason}`, 'error');
            return;
        }
        if (notification.isSkippedMoment && notification.isSkippedMoment()) {
            const reason = notification.getSkippedReason ? notification.getSkippedReason() : 'unknown';
            setAuthStatus(`Googleログインがスキップされました: ${reason}`, 'error');
            return;
        }
        if (notification.isDismissedMoment && notification.isDismissedMoment()) {
            if (!loginSucceeded) {
                setAuthStatus('Googleログインがキャンセルされました。', 'notice');
            }
        }
    });
}

async function loadAuthConfig() {
    const res = await fetch('/api/auth/config', { cache: 'no-store' });
    if (!res.ok) {
        throw new Error('認証設定の取得に失敗しました。');
    }
    const config = await res.json();
    state.auth.mode = config.mode === 'google' ? 'google' : 'token';
    state.auth.googleClientId = String(config.googleClientId || '').trim();

    if (state.auth.mode === 'google') {
        if (googleLoginBtn) googleLoginBtn.onclick = openGoogleLoginPrompt;
        if (!state.auth.googleClientId) {
            state.auth.loggedIn = false;
            refreshAuthUi();
            setAuthStatus('Google認証の設定が未完了です（ADMIN_GOOGLE_CLIENT_ID）。', 'error');
            return;
        }
        const existing = getGoogleIdToken();
        if (existing) {
            try {
                if (!isAppSessionToken(existing)) {
                    const exchanged = await exchangeGoogleTokenForSession(existing);
                    localStorage.setItem(ADMIN_GOOGLE_TOKEN_KEY, exchanged.appToken);
                    state.auth.loggedIn = true;
                    setAuthStatus(`Googleログイン済み\n${exchanged.email || ''}`, 'success');
                } else {
                    state.auth.loggedIn = true;
                    setAuthStatus('Googleログイン済み', 'success');
                }
            } catch (_error) {
                localStorage.removeItem(ADMIN_GOOGLE_TOKEN_KEY);
                state.auth.loggedIn = false;
                setAuthStatus('Googleでログインしてください。', 'notice');
            }
        } else {
            state.auth.loggedIn = false;
            setAuthStatus('Googleでログインしてください。', 'notice');
            setMessage('Googleログイン後にクイズ一覧を読み込みます。', 'notice');
            setPromptConfigStatusMessage('Googleログイン後に読み込みます。', 'notice');
        }
        refreshAuthUi();
    } else {
        state.auth.loggedIn = true;
        if (googleLoginBtn) googleLoginBtn.onclick = null;
        refreshAuthUi();
        setAuthStatus('トークン認証モード', 'notice');
    }
}

function getAuthorizationValue(force = false) {
    if (state.auth.mode === 'google') {
        const token = getGoogleIdToken();
        if (!token) {
            throw new Error('Googleでログインしてください。');
        }
        return token;
    }
    return ensureAdminToken(force);
}

async function adminFetch(url, options = {}, allowRetry = true) {
    const token = getAuthorizationValue(false);
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 && allowRetry) {
        if (state.auth.mode === 'google') {
            localStorage.removeItem(ADMIN_GOOGLE_TOKEN_KEY);
            state.auth.loggedIn = false;
            refreshAuthUi();
            setAuthStatus('セッションが切れました。Googleで再ログインしてください。', 'error');
            throw new Error('Googleセッションの有効期限が切れました。右上の「Googleでログイン」を押してください。');
        }
        const refreshed = getAuthorizationValue(true);
        const retryHeaders = new Headers(options.headers || {});
        retryHeaders.set('Authorization', `Bearer ${refreshed}`);
        return fetch(url, { ...options, headers: retryHeaders });
    }
    return response;
}

// Image Modal Logic
function getRowPreviousAiImageUrl(row) {
    if (!row) return '';
    return sanitizeImageUrl(row.dataset.prevAiImageUrl || '');
}

function clearRowPreviousAiImage(row) {
    if (!row) return;
    delete row.dataset.prevAiImageUrl;
}

function updateImageModalRestoreButton() {
    const restoreBtn = document.getElementById('restore-prev-image-btn');
    if (!restoreBtn) return;
    const row = state.imageModal?.row || null;
    const canRestore = Boolean(getRowPreviousAiImageUrl(row));
    restoreBtn.classList.toggle('hidden', !canRestore);
    restoreBtn.disabled = !canRestore;
}

function openImageModal(row, src) {
    const overlay = document.getElementById('image-modal-overlay');
    const img = document.getElementById('modal-full-image');
    if (!overlay || !img) return;
    state.imageModal.row = row || null;
    img.src = src;
    updateImageModalRestoreButton();
    overlay.classList.add('active');
}

function closeImageModal() {
    const overlay = document.getElementById('image-modal-overlay');
    const img = document.getElementById('modal-full-image');
    if (!overlay) return;
    state.imageModal.row = null;
    updateImageModalRestoreButton();
    overlay.classList.remove('active');
    setTimeout(() => { if (img) img.src = ''; }, 300);
}

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('image-modal-overlay');
    const closeBtn = document.getElementById('close-image-modal');
    const restoreBtn = document.getElementById('restore-prev-image-btn');

    if (closeBtn) closeBtn.addEventListener('click', closeImageModal);
    if (restoreBtn) {
        restoreBtn.addEventListener('click', () => {
            const row = state.imageModal?.row;
            if (!row) return;
            const previousUrl = getRowPreviousAiImageUrl(row);
            if (!previousUrl) return;
            const hiddenUrlInput = row.querySelector('.imageUrl');
            const previewImg = row.querySelector('.image-preview');
            if (!hiddenUrlInput || !previewImg) return;
            hiddenUrlInput.value = previousUrl;
            previewImg.src = previousUrl;
            clearRowPreviousAiImage(row);
            hiddenUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
            setMessage('1つ前の画像に戻しました。', 'notice');
            openImageModal(row, previousUrl);
        });
    }
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeImageModal();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay && overlay.classList.contains('active')) {
            closeImageModal();
        }
    });

    // Custom Prompt Modal logic
    const promptOverlay = document.getElementById('prompt-modal-overlay');
    const promptInput = document.getElementById('prompt-modal-input');
    const promptCancel = document.getElementById('prompt-modal-cancel');
    const promptOk = document.getElementById('prompt-modal-ok');

    window.askCustomPrompt = function () {
        return new Promise((resolve) => {
            promptInput.value = '';
            promptOverlay.classList.add('active');
            setTimeout(() => promptInput.focus(), 50);

            const cleanup = () => {
                promptOverlay.classList.remove('active');
                promptOk.removeEventListener('click', onOk);
                promptCancel.removeEventListener('click', onCancel);
            };

            const onOk = () => {
                cleanup();
                resolve(promptInput.value);
            };

            const onCancel = () => {
                cleanup();
                resolve(null);
            };

            promptOk.addEventListener('click', onOk);
            promptCancel.addEventListener('click', onCancel);
        });
    };
});

const SAMPLE_QUESTIONS = [
    {
        prompt: '【この雨の状況に合う言葉は？】',
        sentence: '梅雨の朝、窓の外では雨が（　　）と降り続けていた。',
        choices: ['ざあざあ', 'しとしと', 'ぽつぽつ'],
        correctIndex: 1,
        explanation: '「しとしと」は、雨音があまり大きくなく、穏やかに継続的に降る雨を表現します。',


        others: [
            { word: '', usage: '大雨が激しく降っている時', example: '「突然、雨がざあざあ降り始めた」' },
            { word: '', usage: '雨が降り始めた瞬間', example: '「あ、ぽつぽつ降ってきたね」' }
        ],

        imageUrl: '/images/gen/sample_cleaned.png'
    },
    {
        prompt: '【猫の歩き方は？】',
        sentence: '大きな黒猫が庭を（　　）と歩いていた。',
        choices: ['のしのし', 'てくてく', 'すいすい'],
        correctIndex: 0,
        explanation: '「のしのし」は、大きく堂々と歩く様子を表します。',


        others: [
            { word: '', usage: 'コツコツと歩く様子', example: '「てくてく歩いて帰る」' },
            { word: '', usage: '軽やかに進む', example: '「水の中をすいすい泳ぐ」' }
        ],

        imageUrl: '/images/gen/sample_cleaned.png'
    },
    {
        prompt: '【笑顔の表情は？】',
        sentence: '太郎は大好きなケーキの前で思わず（　　）してしまう。',
        choices: ['にこにこ', 'にやにや', 'しかめっ面'],
        correctIndex: 0,
        explanation: '「にこにこ」は、楽しそうに笑っている様子を表します。',


        others: [
            { word: '', usage: '不気味に笑う', example: '「にやにや笑っている」' },
            { word: '', usage: '不満な顔', example: '「しかめっ面をする」' }
        ],

        imageUrl: '/images/gen/sample_cleaned.png'
    },
    {
        prompt: '【光る様子を表す言葉は？】',
        sentence: '夜空の星が（　　）と輝いていた。',
        choices: ['ぴかぴか', 'きらきら', 'ぎらぎら'],
        correctIndex: 1,
        explanation: '「きらきら」は、小さな光が美しく輝く様子を表します。',


        others: [
            { word: '', usage: '新品で光っている', example: '「ぴかぴかの靴」' },
            { word: '', usage: '強すぎる光', example: '「太陽がぎらぎらしている」' }
        ],

        imageUrl: '/images/gen/sample_cleaned.png'
    },
    {
        prompt: '【心臓の音は？】',
        sentence: '試験の結果を待つ間、心が（　　）した。',
        choices: ['わくわく', 'じんじん', 'どきどき'],
        correctIndex: 2,
        explanation: '「どきどき」は、心臓が速く鳴る様子を表します。',


        others: [
            { word: '', usage: '期待で興奮', example: '「旅行がわくわくする」' },
            { word: '', usage: '痺れる感じ', example: '「足がじんじんする」' }
        ],

        imageUrl: '/images/gen/sample_cleaned.png'
    }
];

const state = {
    editingQuizId: null,
    suppressDraftSave: false,
    draftTimer: null,
    lastCommittedSnapshot: '',
    imageModal: {
        row: null
    },
    auth: {
        mode: 'token',
        googleClientId: '',
        loggedIn: false
    },
    promptConfigs: {
        question: null,
        image: null
    }
};

async function parseApiResponse(res) {
    const rawText = await res.text();
    let data = null;
    if (rawText) {
        try { data = JSON.parse(rawText); } catch { data = null; }
    }
    if (!res.ok) {
        throw new Error(data?.message || `APIエラー (${res.status})`);
    }
    if (!data) {
        throw new Error('APIの応答形式が不正です。');
    }
    return data;
}

function createQuestionRow(index, question = null) {
    const row = document.createElement('tr');
    row.dataset.questionId = question?.id || '';

    const others = question?.others || [];
    const moreExamples = '';
    const promptValue = escapeHtml(question?.prompt || question?.question || '');
    const sentenceValue = escapeHtml(question?.sentence || '');
    const choice0Value = escapeHtml(question?.choices?.[0] || '');
    const choice1Value = escapeHtml(question?.choices?.[1] || '');
    const choice2Value = escapeHtml(question?.choices?.[2] || '');
    const explanationValue = escapeHtml(question?.explanation || question?.why || '');
    const o0UsageValue = escapeHtml(others[0]?.usage || '');
    const o0ExampleValue = escapeHtml(others[0]?.example || '');
    const o1UsageValue = escapeHtml(others[1]?.usage || '');
    const o1ExampleValue = escapeHtml(others[1]?.example || '');
    const safeImageUrl = sanitizeImageUrl(question?.imageUrl) || SAMPLE_IMAGE_URL;
    const hiddenImageUrl = sanitizeImageUrl(question?.imageUrl);

    row.innerHTML = `
    <td class="td-center">${index + 1}</td>
    <td><textarea rows="2" class="prompt" data-col="prompt">${promptValue}</textarea></td>
    <td><textarea rows="2" class="sentence" data-col="sentence">${sentenceValue}</textarea></td>
    <td><input type="text" class="choice0" data-col="choice0" value="${choice0Value}" /></td>
    <td><input type="text" class="choice1" data-col="choice1" value="${choice1Value}" /></td>
    <td><input type="text" class="choice2" data-col="choice2" value="${choice2Value}" /></td>
    <td>
      <select class="correctIndex" data-col="correctIndex">
        <option value="0" ${Number(question?.correctIndex) === 0 ? 'selected' : ''}>1</option>
        <option value="1" ${Number(question?.correctIndex) === 1 ? 'selected' : ''}>2</option>
        <option value="2" ${Number(question?.correctIndex) === 2 ? 'selected' : ''}>3</option>
      </select>
    </td>
    <td class="td-center"><button type="button" class="secondary ai-generate" title="正解からAI生成">✨</button></td>
    <td><textarea rows="2" class="explanation" data-col="explanation">${explanationValue}</textarea></td>
    
    
    
    
    
    
    
    <td><textarea rows="2" class="o0Usage" data-col="o0Usage">${o0UsageValue}</textarea></td>
    <td><textarea rows="2" class="o0Example" data-col="o0Example">${o0ExampleValue}</textarea></td>
    
    
    <td><textarea rows="2" class="o1Usage" data-col="o1Usage">${o1UsageValue}</textarea></td>
    <td><textarea rows="2" class="o1Example" data-col="o1Example">${o1ExampleValue}</textarea></td>
    
    
    <td class="td-center">
        <div class="image-cell-wrap">
            <div class="image-preview-container">
                <img src="${escapeHtml(safeImageUrl)}" class="image-preview" tabindex="0" title="クリックで拡大 / Deleteキーで削除" />
                <button type="button" class="clear-image-btn" aria-label="画像を削除" title="画像を削除">×</button>
            </div>
            <input type="hidden" class="imageUrl" data-col="imageUrl" value="${escapeHtml(hiddenImageUrl)}" />
            
            <button type="button" class="secondary ai-image-btn" title="AIで画像を生成">AI生成</button>
            <button type="button" class="secondary upload-image-btn" title="画像をアップロード">UP</button>
            <input type="file" class="image-upload-input" accept="image/*" tabindex="-1" />
        </div>
    </td>
    <td class="td-center"><button type="button" class="secondary remove-row">×</button></td>
  `;

    // 2. Bold the correct choice dynamically
    const updateBoldChoice = () => {
        const selectedIndex = parseInt(row.querySelector('.correctIndex').value, 10);
        [0, 1, 2].forEach(i => {
            const input = row.querySelector(`.choice${i}`);
            if (input) {
                input.style.fontWeight = i === selectedIndex ? 'bold' : 'normal';
                // Also give it a subtle background tint to stand out more if desired, but bolding was specifically requested Let's stick to bolding
            }
        });
    };

    // Run bolding logic on initialization
    updateBoldChoice();

    // Re-run bolding logic whenever the select changes
    row.querySelector('.correctIndex').addEventListener('change', updateBoldChoice);
    row.querySelector('.remove-row').addEventListener('click', () => {
        row.remove();
        while (questionBody.querySelectorAll('tr').length < 5) {
            addRow();
        }
        renumberRows();
    });

    // Image Preview & Delete Logic
    const previewContainer = row.querySelector('.image-preview-container');
    const previewImg = row.querySelector('.image-preview');
    const hiddenUrlInput = row.querySelector('.imageUrl');
    const clearBtn = row.querySelector('.clear-image-btn');
    attachBrokenImageFallback(row, previewImg, hiddenUrlInput);

    const clearImage = () => {
        hiddenUrlInput.value = '';
        previewImg.src = SAMPLE_IMAGE_URL;
        clearRowPreviousAiImage(row);
        if (state.imageModal?.row === row) {
            updateImageModalRestoreButton();
        }
        hiddenUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
    };

    previewImg.addEventListener('click', () => {
        openImageModal(row, previewImg.src);
    });

    previewImg.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            clearImage();
        }
    });

    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearImage();
    });

    // Image Upload Logic
    const uploadBtn = row.querySelector('.upload-image-btn');
    const uploadInput = row.querySelector('.image-upload-input');

    uploadBtn.addEventListener('click', () => {
        uploadInput.click();
    });

    uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        uploadBtn.disabled = true;
        const oldUploadText = uploadBtn.textContent;
        uploadBtn.textContent = '⏳';

        try {
            const formData = new FormData();
            formData.append('image', file);

            const res = await adminFetch('/api/upload-image', {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const baseMessage = String(errJson.message || '画像のアップロードに失敗しました。');
                if (res.status === 429 || isRateLimitErrorMessage(baseMessage)) {
                    throw new Error('生成AIがちょっと疲れました。しばらくしてもう一度お試しください。');
                }
                throw new Error(baseMessage);
            }

            const data = await res.json();
            if (data.imageUrl) {
                hiddenUrlInput.value = data.imageUrl;
                previewImg.src = data.imageUrl;
                clearRowPreviousAiImage(row);
                if (state.imageModal?.row === row) {
                    updateImageModalRestoreButton();
                }
                hiddenUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } catch (error) {
            const message = String(error?.message || '画像生成に失敗しました。');
            if (isRateLimitErrorMessage(message)) {
                setMessage('生成AIがちょっと疲れました。しばらくしてもう一度お試しください。', 'notice');
            } else {
                console.error(error);
                setMessage(message, 'error');
            }
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.textContent = oldUploadText;
            uploadInput.value = ''; // Reset input to allow re-uploading the same file
        }
    });

    row.querySelector('.ai-generate').addEventListener('click', async (e) => {
        const btn = e.target;

        // Find correct index
        const correctIndexSelect = row.querySelector('.correctIndex');
        if (!correctIndexSelect) return;
        const correctIdx = correctIndexSelect.value;
        const correctChoiceInput = row.querySelector(`.choice${correctIdx}`);
        const word = correctChoiceInput?.value?.trim();

        if (!word) {
            // Use inline error styling instead of alert
            const oldBg = btn.style.backgroundColor;
            const oldColor = btn.style.color;
            const oldText = btn.textContent;
            btn.style.backgroundColor = '#fee2e2';
            btn.style.color = '#b91c1c';
            btn.textContent = '正解を入力してください';
            setTimeout(() => {
                btn.style.backgroundColor = oldBg;
                btn.style.color = oldColor;
                btn.textContent = oldText;
            }, 2500);
            return;
        }

        // Fill-only mode: if nothing is empty, do not call API and explain why.
        const hasEmptyPrompt = !String(row.querySelector('.prompt')?.value || '').trim();
        const hasEmptySentence = !String(row.querySelector('.sentence')?.value || '').trim();
        const hasEmptyExplanation = !String(row.querySelector('.explanation')?.value || '').trim();
        const hasEmptyIncorrectChoice = [0, 1, 2].some((i) => {
            if (i.toString() === correctIdx) return false;
            return !String(row.querySelector(`.choice${i}`)?.value || '').trim();
        });
        const hasEmptyOthers = !String(row.querySelector('.o0Usage')?.value || '').trim()
            || !String(row.querySelector('.o0Example')?.value || '').trim()
            || !String(row.querySelector('.o1Usage')?.value || '').trim()
            || !String(row.querySelector('.o1Example')?.value || '').trim();
        const hasAnyEmptyField = hasEmptyPrompt || hasEmptySentence || hasEmptyExplanation || hasEmptyIncorrectChoice || hasEmptyOthers;
        if (!hasAnyEmptyField) {
            setMessage('未入力欄がありません。正解番号と選択肢の整合を確認してください。', 'notice');
            return;
        }

        btn.disabled = true;
        btn.textContent = '⏳...';

        // Gather existing context to guide the AI
        const context = {
            prompt: row.querySelector('.prompt')?.value?.trim() || null,
            sentence: row.querySelector('.sentence')?.value?.trim() || null,
            explanation: row.querySelector('.explanation')?.value?.trim() || null,
            correctIndex: Number(correctIdx),
            choices: [],
            choiceSlots: [],
            others: []
        };

        // Gather existing choices / slots
        for (let i = 0; i <= 2; i += 1) {
            const choiceVal = row.querySelector(`.choice${i}`)?.value?.trim() || null;
            context.choiceSlots.push({
                index: i,
                isCorrect: i.toString() === correctIdx,
                value: choiceVal
            });
            if (i.toString() !== correctIdx) {
                context.choices.push(choiceVal || null);
            }
        }

        // Gather existing others (usage/example)
        context.others.push({
            usage: row.querySelector('.o0Usage')?.value?.trim() || null,
            example: row.querySelector('.o0Example')?.value?.trim() || null
        });
        context.others.push({
            usage: row.querySelector('.o1Usage')?.value?.trim() || null,
            example: row.querySelector('.o1Example')?.value?.trim() || null
        });

        try {
            const res = await adminFetch('/api/generate-question', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    word,
                    context,
                    provider: document.getElementById('aiProvider')?.value || 'gemini'
                }),
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const baseMessage = String(errJson.message || 'AI生成に失敗しました。');
                if (res.status === 429 || isRateLimitErrorMessage(baseMessage)) {
                    throw new Error('生成AIがちょっと疲れました。しばらくしてもう一度お試しください。');
                }
                throw new Error(baseMessage);
            }

            const data = await res.json();
            if (data.warning) {
                setMessage(String(data.warning), 'notice');
            }

            // Populate fields only if they are returned by AI (AI won't return fields we already gave it)
            if (data.prompt) row.querySelector('.prompt').value = data.prompt;
            if (data.sentence) row.querySelector('.sentence').value = data.sentence;
            if (data.explanation) row.querySelector('.explanation').value = data.explanation;

            // Populate incorrect choices
            if (data.choices && data.choices.length > 0) {
                let generatedIdx = 0;
                const usedChoices = new Set();
                for (let i = 0; i <= 2; i += 1) {
                    const existing = row.querySelector(`.choice${i}`)?.value?.trim();
                    if (existing) usedChoices.add(existing);
                }
                for (let i = 0; i <= 2; i++) {
                    if (i.toString() !== correctIdx) {
                        const input = row.querySelector(`.choice${i}`);
                        // If input was empty, fill it with the next generated choice
                        if (input && !input.value.trim() && generatedIdx < data.choices.length) {
                            while (generatedIdx < data.choices.length) {
                                const candidate = String(data.choices[generatedIdx] || '').trim();
                                generatedIdx++;
                                if (!candidate || usedChoices.has(candidate)) continue;
                                input.value = candidate;
                                usedChoices.add(candidate);
                                break;
                            }
                        }
                    }
                }
            }

            // Populate others based on the generated array
            if (data.others) {
                if (data.others[0]) {
                    if (data.others[0].usage && !row.querySelector('.o0Usage').value.trim()) row.querySelector('.o0Usage').value = data.others[0].usage;
                    if (data.others[0].example && !row.querySelector('.o0Example').value.trim()) row.querySelector('.o0Example').value = data.others[0].example;
                }
                if (data.others[1]) {
                    if (data.others[1].usage && !row.querySelector('.o1Usage').value.trim()) row.querySelector('.o1Usage').value = data.others[1].usage;
                    if (data.others[1].example && !row.querySelector('.o1Example').value.trim()) row.querySelector('.o1Example').value = data.others[1].example;
                }
            }

            btn.disabled = false;
            btn.textContent = '✨';

        } catch (error) {
            const message = String(error?.message || 'AI生成に失敗しました。');
            if (isRateLimitErrorMessage(message)) {
                setMessage('生成AIがちょっと疲れました。しばらくしてもう一度お試しください。', 'notice');
                btn.disabled = false;
                btn.textContent = '✨';
                return;
            }
            console.error(error);
            setMessage(message, 'error');
            btn.disabled = false;
            btn.textContent = '✨';
        }
    });

    row.querySelector('.ai-image-btn').addEventListener('click', async (e) => {
        const btn = e.target;

        let additionalPrompt = null;
        const currentImageUrl = row.querySelector('.imageUrl')?.value;
        if (currentImageUrl && currentImageUrl.trim() !== '') {
            additionalPrompt = await window.askCustomPrompt();
            if (additionalPrompt === null) {
                return; // User cancelled
            }
        }

        btn.disabled = true;
        const oldText = btn.textContent;
        btn.textContent = '⏳...';

        // Gather context
        const previewImg = row.querySelector('.image-preview');
        const currentPreviewSrc = previewImg?.currentSrc || previewImg?.src || '';
        const currentImageUrlValue = String(row.querySelector('.imageUrl')?.value || '').trim();
        const context = {
            sentence: row.querySelector('.sentence')?.value?.trim() || null,
            correct: null,
            explanation: row.querySelector('.explanation')?.value?.trim() || null,
            additionalPrompt: additionalPrompt?.trim() || null,
            currentImageUrl: currentImageUrlValue || null,
            sampleImageUrl: '/images/gen/sample_cleaned.png',
        };
        const correctIdx = row.querySelector('.correctIndex')?.value;
        if (correctIdx) {
            context.correct = row.querySelector(`.choice${correctIdx}`)?.value?.trim() || null;
        }

        try {
            const previousImageUrl = String(row.querySelector('.imageUrl')?.value || '').trim();
            const res = await adminFetch('/api/generate-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    context,
                    provider: document.getElementById('aiProvider')?.value || 'gemini'
                }),
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                const detail = String(errJson.error || '').trim();
                const base = String(errJson.message || '画像生成に失敗しました。').trim();
                if (res.status === 429 || isRateLimitErrorMessage(base) || isRateLimitErrorMessage(detail)) {
                    throw new Error('生成AIがちょっと疲れました。しばらくしてもう一度お試しください。');
                }
                throw new Error(detail ? `${base}\n詳細: ${detail}` : base);
            }

            const data = await res.json();
            if (data.imageUrl) {
                row.querySelector('.imageUrl').value = data.imageUrl;
                const preview = row.querySelector('.image-preview');
                preview.src = data.imageUrl;
                if (previousImageUrl && previousImageUrl !== data.imageUrl) {
                    row.dataset.prevAiImageUrl = previousImageUrl;
                } else {
                    clearRowPreviousAiImage(row);
                }
                if (state.imageModal?.row === row) {
                    updateImageModalRestoreButton();
                }
                // Trigger change event just in case
                row.querySelector('.imageUrl').dispatchEvent(new Event('change', { bubbles: true }));
                if (data.warning) {
                    setMessage(String(data.warning), 'notice');
                }
            }
        } catch (error) {
            const message = String(error?.message || '画像生成に失敗しました。');
            if (isRateLimitErrorMessage(message)) {
                setMessage('生成AIがちょっと疲れました。しばらくしてもう一度お試しください。', 'notice');
            } else {
                console.error(error);
                setMessage(message, 'error');
            }
        } finally {
            btn.disabled = false;
            btn.textContent = oldText;
        }
    });

    return row;
}

function clearQuestionRow(row) {
    row.dataset.questionId = '';
    const inputs = row.querySelectorAll('input, textarea');
    inputs.forEach(input => input.value = '');
    const correctIndex = row.querySelector('.correctIndex');
    if (correctIndex) correctIndex.value = '0';
}

function renumberRows() {
    Array.from(questionBody.querySelectorAll('tr')).forEach((row, i) => {
        row.children[0].textContent = String(i + 1);
    });
}

function addRow(question = null) {
    const row = createQuestionRow(questionBody.querySelectorAll('tr').length, question);
    questionBody.appendChild(row);
}

function resetQuestionRows(minRows = 5) {
    questionBody.innerHTML = '';
    for (let i = 0; i < minRows; i += 1) {
        addRow();
    }
}

function readQuestions() {
    return Array.from(questionBody.querySelectorAll('tr')).map((row) => {
        const id = row.dataset.questionId ? row.dataset.questionId : undefined;

        const choice0 = row.querySelector('.choice0').value;
        const choice1 = row.querySelector('.choice1').value;
        const choice2 = row.querySelector('.choice2').value;
        const choices = [choice0, choice1, choice2];
        const correctIndex = Number(row.querySelector('.correctIndex').value);

        const incorrectWords = choices.filter((_, i) => i !== correctIndex);

        return {
            id,
            prompt: row.querySelector('.prompt').value,
            sentence: row.querySelector('.sentence').value,
            choices,
            correctIndex,
            explanation: row.querySelector('.explanation').value,

            others: [
                {
                    word: incorrectWords[0] || '',
                    usage: row.querySelector('.o0Usage').value,
                    example: row.querySelector('.o0Example').value
                },
                {
                    word: incorrectWords[1] || '',
                    usage: row.querySelector('.o1Usage').value,
                    example: row.querySelector('.o1Example').value
                }
            ],
            imageUrl: row.querySelector('.imageUrl').value
        };
    });
}

function getRowByIndex(index) {
    while (questionBody.querySelectorAll('tr').length <= index) {
        addRow();
    }
    return questionBody.querySelectorAll('tr')[index];
}

function parseCorrectIndex(text) {
    const trimmed = String(text || '').trim();
    if (trimmed === '1' || trimmed === '2' || trimmed === '3') {
        return String(Number(trimmed) - 1);
    }
    if (trimmed === '0' || trimmed === '1' || trimmed === '2') {
        return trimmed;
    }
    return null;
}

function writeCellValue(row, colKey, rawValue) {
    const value = String(rawValue ?? '');
    const cell = row.querySelector(`[data-col="${colKey}"]`);
    if (!cell) return;

    if (colKey === 'correctIndex') {
        const parsed = parseCorrectIndex(value);
        if (parsed !== null) {
            cell.value = parsed;
            cell.dispatchEvent(new Event('change')); // Trigger bolding logic
        }
        return;
    }
    cell.value = value;
}

function getPasteStartContext(target) {
    const input = target.closest('[data-col]');
    const row = target.closest('tr');
    if (!input || !row) return null;

    const rowIndex = Array.from(questionBody.querySelectorAll('tr')).indexOf(row);
    const colKey = input.dataset.col;
    const colIndex = PASTE_COLUMNS.indexOf(colKey);
    if (rowIndex < 0 || colIndex < 0) return null;

    return { rowIndex, colIndex };
}

function parseClipboardGrid(text) {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    if (lines.length && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines.map((line) => line.split('\\t'));
}

function handleSheetPaste(event) {
    const start = getPasteStartContext(event.target);
    if (!start) return;

    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text) return;

    const hasTab = text.includes('\\t');
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n').filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''));
    const hasMultipleRows = lines.length > 1;

    if (!hasTab && !hasMultipleRows) {
        return;
    }

    event.preventDefault();
    const grid = parseClipboardGrid(text);

    grid.forEach((cells, r) => {
        const row = getRowByIndex(start.rowIndex + r);
        cells.forEach((cellValue, c) => {
            const colKey = PASTE_COLUMNS[start.colIndex + c];
            if (!colKey) return;
            writeCellValue(row, colKey, cellValue);
        });
    });
}

function setMessage(message, type = 'notice') {
    formMessage.textContent = message;
    formMessage.className = type;
}

// Keep admin UX non-blocking: route legacy alert popups to inline message area.
window.alert = (message) => {
    setMessage(String(message || ''), 'error');
};

function isRateLimitErrorMessage(message) {
    const text = String(message || '');
    return text.includes('生成AIがちょっと疲れました')
        || text.includes('リクエストが多すぎます')
        || text.includes('429');
}

function getEditorSnapshot() {
    const draft = collectDraftFromDom();
    return JSON.stringify({
        title: String(draft.title || ''),
        editingQuizId: state.editingQuizId || null,
        questions: Array.isArray(draft.questions) ? draft.questions : []
    });
}

function markEditorCommitted() {
    state.lastCommittedSnapshot = getEditorSnapshot();
    refreshTitleWorkStatus();
}

function hasUnsavedEditorChanges() {
    return getEditorSnapshot() !== state.lastCommittedSnapshot;
}

function clearAllImageUndoHistory() {
    Array.from(questionBody.querySelectorAll('tr')).forEach((row) => clearRowPreviousAiImage(row));
    if (state.imageModal?.row) {
        updateImageModalRestoreButton();
    }
}

function collectDraftFromDom() {
    const rows = Array.from(questionBody.querySelectorAll('tr'));
    const questions = rows.map((row) => ({
        prompt: row.querySelector('.prompt')?.value || '',
        sentence: row.querySelector('.sentence')?.value || '',
        choice0: row.querySelector('.choice0')?.value || '',
        choice1: row.querySelector('.choice1')?.value || '',
        choice2: row.querySelector('.choice2')?.value || '',
        correctIndex: row.querySelector('.correctIndex')?.value || '0',
        explanation: row.querySelector('.explanation')?.value || '',
        o0Usage: row.querySelector('.o0Usage')?.value || '',
        o0Example: row.querySelector('.o0Example')?.value || '',
        o1Usage: row.querySelector('.o1Usage')?.value || '',
        o1Example: row.querySelector('.o1Example')?.value || '',
        imageUrl: row.querySelector('.imageUrl')?.value || ''
    }));
    return {
        savedAt: new Date().toISOString(),
        title: titleInput?.value || '',
        editingQuizId: state.editingQuizId || null,
        questions
    };
}

function saveDraftNow() {
    if (!questionBody || state.suppressDraftSave) return;
    try {
        const draft = collectDraftFromDom();
        localStorage.setItem(ADMIN_DRAFT_KEY, JSON.stringify(draft));
    } catch (_error) {
        // ignore localStorage write errors
    }
}

function scheduleDraftSave() {
    if (state.suppressDraftSave) return;
    refreshTitleWorkStatus();
    if (state.draftTimer) {
        clearTimeout(state.draftTimer);
    }
    state.draftTimer = setTimeout(() => {
        saveDraftNow();
        state.draftTimer = null;
    }, DRAFT_SAVE_DEBOUNCE_MS);
}

function clearDraft() {
    localStorage.removeItem(ADMIN_DRAFT_KEY);
}

function applyDraftToDom(draft) {
    if (!draft || typeof draft !== 'object') return false;
    const questions = Array.isArray(draft.questions) ? draft.questions : [];
    state.suppressDraftSave = true;
    try {
        setEditMode(null);
        titleInput.value = String(draft.title || '');
        const rowCount = Math.max(5, questions.length || 0);
        resetQuestionRows(rowCount);
        const rows = Array.from(questionBody.querySelectorAll('tr'));
        questions.forEach((q, idx) => {
            const row = rows[idx];
            if (!row) return;
            row.querySelector('.prompt').value = String(q.prompt || '');
            row.querySelector('.sentence').value = String(q.sentence || '');
            row.querySelector('.choice0').value = String(q.choice0 || '');
            row.querySelector('.choice1').value = String(q.choice1 || '');
            row.querySelector('.choice2').value = String(q.choice2 || '');
            row.querySelector('.correctIndex').value = String(q.correctIndex || '0');
            row.querySelector('.explanation').value = String(q.explanation || '');
            row.querySelector('.o0Usage').value = String(q.o0Usage || '');
            row.querySelector('.o0Example').value = String(q.o0Example || '');
            row.querySelector('.o1Usage').value = String(q.o1Usage || '');
            row.querySelector('.o1Example').value = String(q.o1Example || '');
            const imageUrl = sanitizeImageUrl(q.imageUrl);
            row.querySelector('.imageUrl').value = imageUrl;
            const preview = row.querySelector('.image-preview');
            preview.src = imageUrl || '/images/gen/sample_cleaned.png';
            row.querySelector('.correctIndex').dispatchEvent(new Event('change'));
        });
        clearAllImageUndoHistory();
        setMessage('未保存の下書きを復元しました。', 'notice');
        return true;
    } finally {
        state.suppressDraftSave = false;
    }
}

function restoreDraftIfAny() {
    const raw = String(localStorage.getItem(ADMIN_DRAFT_KEY) || '').trim();
    if (!raw) return false;
    let draft;
    try {
        draft = JSON.parse(raw);
    } catch (_error) {
        return false;
    }
    const savedAt = String(draft?.savedAt || '');
    const label = savedAt ? new Date(savedAt).toLocaleString('ja-JP') : '不明';
    const shouldRestore = window.confirm(`未保存の下書きがあります（${label}）。復元しますか？`);
    if (shouldRestore) {
        applyDraftToDom(draft);
        return true;
    }
    return false;
}

function setPromptConfigStatusMessage(message, type = 'notice') {
    if (!promptConfigStatus) return;
    promptConfigStatus.textContent = message;
    promptConfigStatus.className = type;
}

function getPromptConfigLabel(type) {
    return type === 'image' ? '画像生成用' : '設問生成用';
}

function openPromptConfigEditor(type) {
    if (!promptConfigEditorPanel || !promptConfigTypeSelect) return;
    if (!type) {
        promptConfigEditorPanel.classList.add('hidden');
        promptConfigTypeSelect.value = '';
        return;
    }
    promptConfigTypeSelect.value = type;
    promptConfigEditorPanel.classList.remove('hidden');
    if (promptConfigEditorTitle) {
        promptConfigEditorTitle.textContent = `${getPromptConfigLabel(type)} YAML編集`;
    }
}

function renderPromptConfigEditor() {
    if (!promptConfigTypeSelect || !promptConfigYaml) return;
    const type = promptConfigTypeSelect.value;
    if (!type) {
        openPromptConfigEditor('');
        setPromptConfigStatusMessage('対象を選択してください。', 'notice');
        return;
    }
    openPromptConfigEditor(type);
    const record = state.promptConfigs[type];
    if (!record) {
        promptConfigYaml.value = '';
        setPromptConfigStatusMessage('設定が見つかりません。', 'error');
        return;
    }
    promptConfigYaml.value = record.yamlText || '';
    const suffix = record.isDefault ? '（初期値）' : `（最終更新: ${new Date(record.updatedAt).toLocaleString('ja-JP')}）`;
    setPromptConfigStatusMessage(`${getPromptConfigLabel(type)}を表示中 ${suffix}`, 'notice');
}

async function loadPromptConfigs() {
    if (!promptConfigTypeSelect || !promptConfigYaml) return;
    const selectedType = promptConfigTypeSelect.value;
    if (selectedType) {
        setPromptConfigStatusMessage('プロンプト設定を読み込み中...', 'notice');
    }
    try {
        const res = await adminFetch('/api/prompt-configs', { cache: 'no-store' });
        const data = await parseApiResponse(res);
        state.promptConfigs.question = data.question;
        state.promptConfigs.image = data.image;
        if (selectedType) {
            renderPromptConfigEditor();
        }
    } catch (error) {
        if (selectedType) {
            setPromptConfigStatusMessage(error.message, 'error');
        }
    }
}

async function savePromptConfig() {
    if (!promptConfigTypeSelect || !promptConfigYaml) return;
    const type = promptConfigTypeSelect.value;
    if (!type) {
        setPromptConfigStatusMessage('対象を選択してください。', 'error');
        return false;
    }
    const yaml = promptConfigYaml.value.trim();
    if (!yaml) {
        setPromptConfigStatusMessage('YAMLが空です。', 'error');
        return false;
    }
    savePromptConfigBtn.disabled = true;
    setPromptConfigStatusMessage('保存中...', 'notice');
    try {
        const res = await adminFetch(`/api/prompt-configs/${type}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yaml })
        });
        const record = await parseApiResponse(res);
        state.promptConfigs[type] = record;
        renderPromptConfigEditor();
        setPromptConfigStatusMessage('YAMLを保存しました。次のAI生成から反映されます。', 'success');
        return true;
    } catch (error) {
        setPromptConfigStatusMessage(error.message, 'error');
        return false;
    } finally {
        savePromptConfigBtn.disabled = false;
    }
}

async function resetPromptConfig() {
    if (!promptConfigTypeSelect || !promptConfigYaml) return;
    const type = promptConfigTypeSelect.value;
    if (!type) {
        setPromptConfigStatusMessage('対象を選択してください。', 'error');
        return;
    }
    if (!window.confirm('この設定を初期値に戻します。よろしいですか？')) return;
    resetPromptConfigBtn.disabled = true;
    setPromptConfigStatusMessage('初期値に戻しています...', 'notice');
    try {
        const res = await adminFetch(`/api/prompt-configs/${type}/reset`, { method: 'POST' });
        const record = await parseApiResponse(res);
        state.promptConfigs[type] = record;
        renderPromptConfigEditor();
        setPromptConfigStatusMessage('初期値に戻しました。', 'success');
    } catch (error) {
        setPromptConfigStatusMessage(error.message, 'error');
    } finally {
        resetPromptConfigBtn.disabled = false;
    }
}

function setEditMode(quiz = null) {
    if (!quiz) {
        state.editingQuizId = null;
        saveQuizBtn.textContent = '保存してQRを生成';
        editStatus.classList.add('hidden');
        editStatus.textContent = '';
        refreshTitleWorkStatus();
        return;
    }

    state.editingQuizId = quiz.id;
    saveQuizBtn.textContent = '更新してQRを再生成';
    editStatus.classList.remove('hidden');
    editStatus.textContent = `編集中: ${quiz.title}（ID: ${quiz.id}）`;
    refreshTitleWorkStatus();
}

function refreshTitleWorkStatus() {
    if (!titleWorkStatus) return;
    const dirty = hasUnsavedEditorChanges();
    if (dirty) {
        titleWorkStatus.textContent = '編集中';
        titleWorkStatus.classList.remove('saved');
        titleWorkStatus.classList.add('editing');
        return;
    }
    titleWorkStatus.textContent = '保存済';
    titleWorkStatus.classList.remove('editing');
    titleWorkStatus.classList.add('saved');
}

function renderShareResult(data) {
    const resultWrap = document.getElementById('saveResult');
    const link = document.getElementById('quizUrlLink');
    const qrImage = document.getElementById('qrImage');
    const v2Url = data.quizUrl;
    link.href = v2Url;
    link.textContent = v2Url;
    qrImage.src = data.qrDataUrl;
    if (copyQrBtn) {
        copyQrBtn.disabled = false;
    }
    resultWrap.classList.remove('hidden');
}

async function copyQrCode() {
    const qrImage = document.getElementById('qrImage');
    const link = document.getElementById('quizUrlLink');
    const src = String(qrImage?.src || '').trim();
    if (!src) {
        setMessage('コピー対象のQRコードがありません。', 'error');
        return;
    }
    try {
        if (navigator.clipboard && window.ClipboardItem) {
            const blob = await fetch(src).then((r) => r.blob());
            await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
            setMessage('QRコード画像をコピーしました。', 'success');
            return;
        }
        throw new Error('image clipboard unsupported');
    } catch (_error) {
        const fallbackText = String(link?.href || '').trim();
        if (fallbackText && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(fallbackText);
            setMessage('画像コピーに失敗したため、クイズURLをコピーしました。', 'notice');
            return;
        }
        setMessage('コピーに失敗しました。', 'error');
    }
}

async function submitQuizSaveRequest(endpoint, method, payload, skipAuthRetry = false) {
    return adminFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }, skipAuthRetry);
}

function promptNewQuizTitle(currentTitle, message, sameTitleErrorMessage) {
    const suggested = currentTitle ? `${currentTitle} コピー` : '';
    const nextTitle = String(window.prompt(message, suggested) || '').trim();
    if (!nextTitle) {
        return { canceled: true, title: currentTitle };
    }
    if (nextTitle === currentTitle) {
        throw new Error(sameTitleErrorMessage);
    }
    return { canceled: false, title: nextTitle };
}

async function saveQuiz() {
    saveQuizBtn.disabled = true;
    setMessage('保存中...');

    try {
        let title = titleInput.value.trim();
        const questions = readQuestions();
        const isEdit = Boolean(state.editingQuizId);
        let endpoint = '/api/quizzes';
        let method = 'POST';
        let saveMode = 'new';

        if (isEdit) {
            const overwrite = window.confirm('保存方法を選択してください。\nOK: 上書き保存\nキャンセル: 新規保存（別名）');
            if (overwrite) {
                endpoint = `/api/quizzes/${state.editingQuizId}`;
                method = 'PUT';
                saveMode = 'overwrite';
            } else {
                const prompted = promptNewQuizTitle(
                    title,
                    '新規保存するタイトルを入力してください（同名不可）',
                    '新規保存では、編集中タイトルと同名は使用できません。別名を指定してください。'
                );
                if (prompted.canceled) {
                    setMessage('保存をキャンセルしました。', 'notice');
                    return;
                }
                title = prompted.title;
                titleInput.value = title;
            }
        }

        let res = await submitQuizSaveRequest(endpoint, method, { title, questions }, false);

        if (res.status === 409) {
            const conflictBody = await res.json().catch(() => ({}));
            const conflictQuizId = String(conflictBody?.conflictQuizId || '').trim();
            if (conflictQuizId) {
                const overwrite = window.confirm('同名タイトルのクイズが既にあります。\nOK: 既存を上書き保存\nキャンセル: 別名で新規保存');
                if (overwrite) {
                    saveMode = 'overwrite';
                    endpoint = `/api/quizzes/${conflictQuizId}`;
                    method = 'PUT';
                    res = await submitQuizSaveRequest(endpoint, method, { title, questions });
                } else {
                    const prompted = promptNewQuizTitle(
                        title,
                        '新規保存するタイトルを入力してください（同名不可）',
                        '別名保存では、同名を指定できません。別のタイトルを入力してください。'
                    );
                    if (prompted.canceled) {
                        setMessage('保存をキャンセルしました。', 'notice');
                        return;
                    }
                    title = prompted.title;
                    titleInput.value = title;
                    endpoint = '/api/quizzes';
                    method = 'POST';
                    saveMode = 'new';
                    res = await submitQuizSaveRequest(endpoint, method, { title, questions });
                }
            }
        }

        const data = await parseApiResponse(res);

        if (saveMode === 'overwrite') {
            setMessage('更新しました。QRコードを再表示しています。', 'success');
        } else {
            setMessage('新規保存しました。QRコードを表示しています。', 'success');
            setEditMode(null);
        }

        renderShareResult(data);
        clearAllImageUndoHistory();
        clearDraft();
        markEditorCommitted();
        await loadQuizList();
    } catch (error) {
        setMessage(error.message, 'error');
    } finally {
        saveQuizBtn.disabled = false;
    }
}

async function editQuiz(quizId) {
    try {
        const res = await adminFetch(`/api/quizzes/${quizId}`, { cache: 'no-store' });
        const data = await parseApiResponse(res);

        titleInput.value = data.title;
        questionBody.innerHTML = '';
        data.questions.forEach((q) => addRow(q));
        clearAllImageUndoHistory();
        setEditMode(data);
        markEditorCommitted();
        scheduleDraftSave();
        setMessage('クイズを読み込みました。内容を編集して更新してください。', 'notice');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

function cancelEdit({ skipConfirm = false } = {}) {
    const proceed = skipConfirm || window.confirm('新規作成を開始します。現在編集中のタイトルと内容は破棄されます。よろしいですか？');
    if (!proceed) return;
    setEditMode(null);
    titleInput.value = '';
    resetQuestionRows(5);
    clearAllImageUndoHistory();
    clearDraft();
    markEditorCommitted();
    setMessage('編集中の内容を破棄し、新規作成モードに戻りました。', 'notice');
}

function loadSampleQuestions() {
    setEditMode(null);
    titleInput.value = 'オノマトペ v2（サンプル）';
    questionBody.innerHTML = '';
    SAMPLE_QUESTIONS.forEach((q) => addRow(q));
    clearAllImageUndoHistory();
    scheduleDraftSave();
    setMessage('サンプル問題（全12項目）を読み込みました。', 'notice');
}

async function loadQuizList() {
    const res = await adminFetch('/api/quizzes', { cache: 'no-store' });
    const data = await parseApiResponse(res);

    quizListBody.innerHTML = '';

    if (!data.items.length) {
        const row = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        td.textContent = 'まだクイズはありません。';
        row.appendChild(td);
        quizListBody.appendChild(row);
        return;
    }

    data.items.forEach((item) => {
        const row = document.createElement('tr');
        const created = new Date(item.createdAt).toLocaleString('ja-JP');
        const titleTd = document.createElement('td');
        titleTd.textContent = item.title;
        const countTd = document.createElement('td');
        countTd.textContent = String(item.questionCount);
        const createdTd = document.createElement('td');
        createdTd.textContent = created;
        const actionsTd = document.createElement('td');
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'actions';
        const logBtn = document.createElement('button');
        logBtn.type = 'button';
        logBtn.className = 'secondary log-btn';
        logBtn.textContent = '学習者アクセスログ';
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'secondary edit-btn';
        editBtn.textContent = '編集';
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'secondary delete-btn';
        deleteBtn.textContent = '削除';
        actionsDiv.append(logBtn, editBtn, deleteBtn);
        actionsTd.appendChild(actionsDiv);
        row.append(titleTd, countTd, createdTd, actionsTd);

        editBtn.addEventListener('click', async () => {
            await editQuiz(item.id);
        });

        logBtn.addEventListener('click', () => {
            showAccessLog(item.id, item.title);
        });

        deleteBtn.addEventListener('click', async (e) => {
            const btn = e.target;

            // Step 1: Inline Confirmation (bypasses window.confirm block)
            if (!btn.classList.contains('confirming')) {
                btn.classList.add('confirming');
                btn.textContent = '本当に削除？（もう一度押す）';
                btn.style.backgroundColor = '#b91c1c';
                btn.style.color = '#fff';
                btn.style.borderColor = '#991b1b';

                // Reset after 4 seconds
                setTimeout(() => {
                    if (btn && btn.parentElement) {
                        btn.classList.remove('confirming');
                        btn.textContent = '削除';
                        btn.style.backgroundColor = '';
                        btn.style.color = '';
                        btn.style.borderColor = '';
                    }
                }, 4000);
                return;
            }

            // Step 2: Actually execute delete
            btn.disabled = true;
            btn.textContent = '削除中...';

            try {
                const res = await adminFetch(`/api/quizzes/${item.id}`, { method: 'DELETE' });
                if (res.status === 204) {
                    setMessage(`「${item.title}」を削除しました。`, 'success');
                    row.remove();
                    if (state.editingQuizId === item.id) {
                        cancelEdit({ skipConfirm: true });
                    }
                } else {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.message || '削除に失敗しました。');
                }
            } catch (error) {
                setMessage(error.message, 'error');
                btn.disabled = false;
                btn.textContent = '削除';
            }
        });

        quizListBody.appendChild(row);
    });
}

function hasGoogleSession() {
    return Boolean(getGoogleIdToken());
}

async function loadProtectedData() {
    if (state.auth.mode === 'google' && !hasGoogleSession()) {
        return;
    }
    await loadQuizList();
    await loadPromptConfigs();
    if (formMessage) {
        const current = String(formMessage.textContent || '').trim();
        if (!current || current === LOGIN_WAIT_MESSAGE) {
            setMessage(DEFAULT_FORM_MESSAGE, 'notice');
        }
    }
}

async function handlePromptConfigTypeChange() {
    if (!promptConfigTypeSelect) return;
    const type = promptConfigTypeSelect.value;
    if (!type) {
        openPromptConfigEditor('');
        return;
    }
    openPromptConfigEditor(type);
    if (!state.promptConfigs[type]) {
        await loadPromptConfigs();
    }
    renderPromptConfigEditor();
    if (promptConfigYaml) {
        setTimeout(() => promptConfigYaml.focus(), 0);
    }
}

addRowBtn.addEventListener('click', () => {
    addRow();
    scheduleDraftSave();
});
if (loadSampleBtn) loadSampleBtn.addEventListener('click', loadSampleQuestions);
saveQuizBtn.addEventListener('click', saveQuiz);
cancelEditBtn.addEventListener('click', cancelEdit);
if (backToLpBtn) {
    backToLpBtn.addEventListener('click', () => {
        if (hasUnsavedEditorChanges()) {
            const proceed = window.confirm('未保存の編集中データがあります。保存せずにホーム画面へ戻りますか？');
            if (!proceed) return;
        }
        location.href = '/';
    });
}
questionBody.addEventListener('paste', handleSheetPaste);
questionBody.addEventListener('input', scheduleDraftSave);
questionBody.addEventListener('change', scheduleDraftSave);
if (titleInput) {
    titleInput.addEventListener('input', scheduleDraftSave);
}
if (promptConfigTypeSelect) promptConfigTypeSelect.addEventListener('change', handlePromptConfigTypeChange);
if (savePromptConfigBtn) savePromptConfigBtn.addEventListener('click', savePromptConfig);
if (resetPromptConfigBtn) resetPromptConfigBtn.addEventListener('click', resetPromptConfig);
if (reloadPromptConfigBtn) reloadPromptConfigBtn.addEventListener('click', loadPromptConfigs);
if (copyQrBtn) copyQrBtn.addEventListener('click', copyQrCode);
if (closePromptConfigEditorBtn) {
    closePromptConfigEditorBtn.addEventListener('click', async () => {
        if (!promptConfigTypeSelect) return;
        if (promptConfigTypeSelect.value) {
            const ok = await savePromptConfig();
            if (!ok) return;
        }
        promptConfigTypeSelect.value = '';
        openPromptConfigEditor('');
        setPromptConfigStatusMessage('保存して編集を終了しました。', 'success');
    });
}

applyTokenFromUrl();
resetQuestionRows(5);
const restored = restoreDraftIfAny();
if (!restored) {
    markEditorCommitted();
} else {
    refreshTitleWorkStatus();
}
openPromptConfigEditor('');
window.addEventListener('beforeunload', saveDraftNow);
async function initializeAdminPage() {
    try {
        await loadAuthConfig();
        await loadProtectedData();
    } catch (error) {
        setMessage(error.message, 'error');
        setPromptConfigStatusMessage(error.message, 'error');
    }
}
initializeAdminPage();

// --------------
// Learner Access Log Modal Logic
// --------------
const logModalOverlay = document.getElementById('log-modal-overlay');
const closeLogModalBtn = document.getElementById('closeLogModalBtn');
const logTableBody = document.getElementById('logTableBody');
const logModalTitle = document.getElementById('logModalTitle');

closeLogModalBtn.addEventListener('click', () => {
    logModalOverlay.classList.remove('active');
});

async function showAccessLog(quizId, quizTitle) {
    logModalTitle.textContent = `「${quizTitle}」のアクセスログ`;
    logTableBody.innerHTML = '';
    const loadingRow = document.createElement('tr');
    const loadingTd = document.createElement('td');
    loadingTd.colSpan = 4;
    loadingTd.className = 'td-center';
    loadingTd.textContent = '読み込み中...';
    loadingRow.appendChild(loadingTd);
    logTableBody.appendChild(loadingRow);
    logModalOverlay.classList.add('active');

    try {
        const res = await adminFetch(`/api/quizzes/${quizId}/logs`);
        if (!res.ok) throw new Error('ログの取得に失敗しました');
        const logs = await res.json();

        if (logs.length === 0) {
            logTableBody.innerHTML = '';
            const emptyRow = document.createElement('tr');
            const emptyTd = document.createElement('td');
            emptyTd.colSpan = 4;
            emptyTd.className = 'td-center';
            emptyTd.textContent = 'まだプレイ記録がありません';
            emptyRow.appendChild(emptyTd);
            logTableBody.appendChild(emptyRow);
            return;
        }

        logTableBody.innerHTML = '';
        logs.forEach((log) => {
            const dateStr = new Date(log.updated_at).toLocaleString('ja-JP');
            const tr = document.createElement('tr');
            const learnerTd = document.createElement('td');
            const strong = document.createElement('strong');
            strong.textContent = String(log.learner_name || '');
            learnerTd.appendChild(strong);
            const playTd = document.createElement('td');
            playTd.className = 'td-center';
            playTd.textContent = `${Number(log.play_count || 0)}回`;
            const scoreTd = document.createElement('td');
            scoreTd.className = 'td-center';
            scoreTd.textContent = `${Number(log.latest_correct || 0)} / ${Number(log.latest_total_attempts || 0)}`;
            const dateTd = document.createElement('td');
            dateTd.style.fontSize = '12px';
            dateTd.style.color = '#64748b';
            dateTd.textContent = dateStr;
            tr.append(learnerTd, playTd, scoreTd, dateTd);
            logTableBody.appendChild(tr);
        });
    } catch (err) {
        logTableBody.innerHTML = '';
        const errRow = document.createElement('tr');
        const errTd = document.createElement('td');
        errTd.colSpan = 4;
        errTd.className = 'td-center';
        errTd.style.color = 'red';
        errTd.textContent = err.message;
        errRow.appendChild(errTd);
        logTableBody.appendChild(errRow);
    }
}
