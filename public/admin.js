const questionBody = document.getElementById('questionBody');
const addRowBtn = document.getElementById('addRowBtn');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const saveQuizBtn = document.getElementById('saveQuizBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const formMessage = document.getElementById('formMessage');
const editStatus = document.getElementById('editStatus');
const quizListBody = document.getElementById('quizListBody');
const titleInput = document.getElementById('titleInput');
const ADMIN_TOKEN_KEY = 'adminToken';
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

function getAdminToken() {
    return String(localStorage.getItem(ADMIN_TOKEN_KEY) || '').trim();
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

async function adminFetch(url, options = {}, allowRetry = true) {
    const token = ensureAdminToken(false);
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 && allowRetry) {
        const refreshed = ensureAdminToken(true);
        const retryHeaders = new Headers(options.headers || {});
        retryHeaders.set('Authorization', `Bearer ${refreshed}`);
        return fetch(url, { ...options, headers: retryHeaders });
    }
    return response;
}

// Image Modal Logic
function openImageModal(src) {
    const overlay = document.getElementById('image-modal-overlay');
    const img = document.getElementById('modal-full-image');
    if (!overlay || !img) return;
    img.src = src;
    overlay.classList.add('active');
}

function closeImageModal() {
    const overlay = document.getElementById('image-modal-overlay');
    const img = document.getElementById('modal-full-image');
    if (!overlay) return;
    overlay.classList.remove('active');
    setTimeout(() => { if (img) img.src = ''; }, 300);
}

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('image-modal-overlay');
    const closeBtn = document.getElementById('close-image-modal');

    if (closeBtn) closeBtn.addEventListener('click', closeImageModal);
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
    editingQuizId: null
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
    const safeImageUrl = sanitizeImageUrl(question?.imageUrl) || '/images/gen/sample_cleaned.png';
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
        const rowCount = questionBody.querySelectorAll('tr').length;
        if (rowCount <= 5) {
            clearQuestionRow(row);
            return;
        }
        row.remove();
        renumberRows();
    });

    // Image Preview & Delete Logic
    const previewContainer = row.querySelector('.image-preview-container');
    const previewImg = row.querySelector('.image-preview');
    const hiddenUrlInput = row.querySelector('.imageUrl');
    const clearBtn = row.querySelector('.clear-image-btn');

    const clearImage = () => {
        hiddenUrlInput.value = '';
        previewImg.src = '/images/gen/sample_cleaned.png';
        hiddenUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
    };

    previewImg.addEventListener('click', () => {
        openImageModal(previewImg.src);
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
                throw new Error(errJson.message || '画像のアップロードに失敗しました。');
            }

            const data = await res.json();
            if (data.imageUrl) {
                hiddenUrlInput.value = data.imageUrl;
                previewImg.src = data.imageUrl;
                hiddenUrlInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } catch (error) {
            console.error(error);
            alert(error.message);
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

        btn.disabled = true;
        btn.textContent = '⏳...';

        // Gather existing context to guide the AI
        const context = {
            prompt: row.querySelector('.prompt')?.value?.trim() || null,
            sentence: row.querySelector('.sentence')?.value?.trim() || null,
            explanation: row.querySelector('.explanation')?.value?.trim() || null,
            choices: [],
            others: []
        };

        // Gather existing choices
        for (let i = 0; i <= 2; i++) {
            if (i.toString() !== correctIdx) {
                const choiceVal = row.querySelector(`.choice${i}`)?.value?.trim();
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
                throw new Error(errJson.message || 'AI生成に失敗しました。');
            }

            const data = await res.json();

            // Populate fields only if they are returned by AI (AI won't return fields we already gave it)
            if (data.prompt) row.querySelector('.prompt').value = data.prompt;
            if (data.sentence) row.querySelector('.sentence').value = data.sentence;
            if (data.explanation) row.querySelector('.explanation').value = data.explanation;

            // Populate incorrect choices
            if (data.choices && data.choices.length > 0) {
                let generatedIdx = 0;
                for (let i = 0; i <= 2; i++) {
                    if (i.toString() !== correctIdx) {
                        const input = row.querySelector(`.choice${i}`);
                        // If input was empty, fill it with the next generated choice
                        if (input && !input.value.trim() && generatedIdx < data.choices.length) {
                            input.value = data.choices[generatedIdx];
                            generatedIdx++;
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
            console.error(error);
            const oldBg = btn.style.backgroundColor;
            const oldColor = btn.style.color;
            btn.style.backgroundColor = '#fee2e2';
            btn.style.color = '#b91c1c';
            btn.textContent = 'エラー';
            setTimeout(() => {
                btn.style.backgroundColor = oldBg;
                btn.style.color = oldColor;
                btn.textContent = '✨';
                btn.disabled = false;
            }, 3000);
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
        const context = {
            sentence: row.querySelector('.sentence')?.value?.trim() || null,
            correct: null,
            explanation: row.querySelector('.explanation')?.value?.trim() || null,
            additionalPrompt: additionalPrompt?.trim() || null,
        };
        const correctIdx = row.querySelector('.correctIndex')?.value;
        if (correctIdx) {
            context.correct = row.querySelector(`.choice${correctIdx}`)?.value?.trim() || null;
        }

        try {
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
                throw new Error(errJson.message || '画像生成に失敗しました。');
            }

            const data = await res.json();
            if (data.imageUrl) {
                row.querySelector('.imageUrl').value = data.imageUrl;
                const preview = row.querySelector('.image-preview');
                preview.src = data.imageUrl;
                // Trigger change event just in case
                row.querySelector('.imageUrl').dispatchEvent(new Event('change', { bubbles: true }));
            }
        } catch (error) {
            console.error(error);
            alert(error.message);
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

function setEditMode(quiz = null) {
    if (!quiz) {
        state.editingQuizId = null;
        saveQuizBtn.textContent = '保存してQRを生成';
        cancelEditBtn.disabled = true;
        editStatus.classList.add('hidden');
        editStatus.textContent = '';
        return;
    }

    state.editingQuizId = quiz.id;
    saveQuizBtn.textContent = '更新してQRを再生成';
    cancelEditBtn.disabled = false;
    editStatus.classList.remove('hidden');
    editStatus.textContent = `編集中: ${quiz.title}（ID: ${quiz.id}）`;
}

function renderShareResult(data) {
    const resultWrap = document.getElementById('saveResult');
    const link = document.getElementById('quizUrlLink');
    const qrImage = document.getElementById('qrImage');
    const v2Url = data.quizUrl;
    link.href = v2Url;
    link.textContent = v2Url;
    qrImage.src = data.qrDataUrl;
    resultWrap.classList.remove('hidden');
}

async function saveQuiz() {
    saveQuizBtn.disabled = true;
    setMessage('保存中...');

    try {
        const title = titleInput.value.trim();
        const questions = readQuestions();
        const isEdit = Boolean(state.editingQuizId);
        const endpoint = isEdit ? `/api/quizzes/${state.editingQuizId}` : '/api/quizzes';
        const method = isEdit ? 'PUT' : 'POST';

        const res = await adminFetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, questions })
        });
        const data = await parseApiResponse(res);

        if (isEdit) {
            setMessage('更新しました。QRコードを再表示しています。', 'success');
        } else {
            setMessage('保存しました。QRコードを表示しています。', 'success');
        }

        renderShareResult(data);
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
        setEditMode(data);
        setMessage('クイズを読み込みました。内容を編集して更新してください。', 'notice');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        setMessage(error.message, 'error');
    }
}

function cancelEdit() {
    setEditMode(null);
    titleInput.value = '';
    resetQuestionRows(5);
    setMessage('編集中の内容を破棄し、新規作成モードに戻りました。', 'notice');
}

function loadSampleQuestions() {
    setEditMode(null);
    titleInput.value = 'オノマトペ v2（サンプル）';
    questionBody.innerHTML = '';
    SAMPLE_QUESTIONS.forEach((q) => addRow(q));
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
                        cancelEdit();
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

addRowBtn.addEventListener('click', () => addRow());
loadSampleBtn.addEventListener('click', loadSampleQuestions);
saveQuizBtn.addEventListener('click', saveQuiz);
cancelEditBtn.addEventListener('click', cancelEdit);
questionBody.addEventListener('paste', handleSheetPaste);

applyTokenFromUrl();
resetQuestionRows(5);
loadQuizList();

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
