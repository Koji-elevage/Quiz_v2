let questions = [];
let quizId = new URLSearchParams(window.location.search).get('quiz');
if (!quizId) {
    quizId = window.location.pathname.split('/').pop();
}

function sanitizeImageSrc(value) {
    const src = String(value || '').trim();
    if (src.startsWith('/images/gen/')) return src;
    if (/^https?:\/\//i.test(src)) return src;
    return '/images/gen/sample_cleaned.png';
}

function renderTitleWithBreaks(element, title) {
    element.textContent = '';
    element.append(document.createTextNode('穴埋め問題で'));
    element.append(document.createElement('br'));
    element.append(document.createTextNode(`${String(title || '')}を`));
    element.append(document.createElement('br'));
    element.append(document.createTextNode('マスター！'));
}

function renderSentence(container, sentence, tokenClass, tokenText) {
    container.textContent = '';
    const raw = String(sentence || '');
    const marker = '（　　）';
    const idx = raw.indexOf(marker);
    if (idx === -1) {
        container.textContent = raw;
        return;
    }
    container.append(document.createTextNode(raw.slice(0, idx)));
    const span = document.createElement('span');
    span.className = tokenClass;
    span.textContent = tokenText;
    container.append(span);
    container.append(document.createTextNode(raw.slice(idx + marker.length)));
}

async function initQuiz() {
    try {
        if (!quizId) {
            console.error("No quiz ID provided");
            return;
        }
        const res = await fetch(`/api/quizzes/${quizId}`);
        if (!res.ok) {
            alert('クイズの読み込みに失敗しました。');
            return;
        }
        const data = await res.json();

        questions = data.questions.map(q => ({
            id: q.id,
            image: q.imageUrl || '/images/gen/sample_cleaned.png',
            question: q.prompt,
            correct: q.choices[q.correctIndex],
            options: q.choices,
            sentence: q.sentence || '（　　）',
            sentenceHint: q.sentenceHint || '',
            why: q.explanation || '',
            others: q.others || []
        }));

        const missionText = document.getElementById('missionText');
        if (missionText) {
            missionText.textContent = `「${data.title}」を全問正解しよう！`;
        }
        const heroTitle = document.getElementById('heroTitle');
        if (heroTitle) {
            renderTitleWithBreaks(heroTitle, data.title);
        }

        const nameInput = document.getElementById('learnerName');
        if (nameInput) {
            const savedName = localStorage.getItem('learnerName');
            if (savedName) nameInput.value = savedName;
        }

        // Initialize browser history state for SPA navigation
        history.replaceState({ screenId: 'homeScreen', qIndex: 0 }, '', '');
    } catch (e) {
        console.error(e);
        alert('読み込みエラーが発生しました。');
    }
}

document.addEventListener('DOMContentLoaded', initQuiz);

let currentIsCorrect = null;

window.addEventListener('popstate', (e) => {
    if (e.state && e.state.screenId) {
        if (e.state.gameState) {
            const st = JSON.parse(e.state.gameState);
            solvedCount = st.solvedCount;
            queue = (st.queue || []).map(id => questions.find(q => q.id === id)).filter(Boolean);
            currentQuestion = questions.find(q => q.id === st.currentQuestionId) || null;
            currentIsCorrect = st.currentIsCorrect;
            userAnswers = st.userAnswers || [];
            totalAttempts = st.totalAttempts || 0;
        }

        const targetScreen = e.state.screenId;

        if (targetScreen === 'quizScreen') {
            goToScreen('quizScreen', false);
            loadQuestionUI();
        } else if (targetScreen === 'feedbackScreen') {
            showFeedback(currentIsCorrect, false);
        } else if (targetScreen === 'resultsScreen') {
            showResults(false);
        } else {
            goToScreen('homeScreen', false);
        }
    } else {
        goToScreen('homeScreen', false);
    }
});

// Game State
let queue = [];
let solvedCount = 0;
let currentQuestion = null;
let userAnswers = []; // Array of { isCorrect: false, word: string, questionId: string }
let totalAttempts = 0;
let isReplayMode = false;
let timeLeft = 30;
let timerInterval = null;

function goToScreen(screenId, pushToHistory = true) {
    if (pushToHistory) {
        const gameState = JSON.stringify({
            solvedCount,
            queue: queue.map(q => q ? q.id : null),
            currentQuestionId: currentQuestion ? currentQuestion.id : null,
            currentIsCorrect,
            userAnswers,
            totalAttempts,
            isReplayMode
        });
        history.pushState({ screenId: screenId, gameState }, '', '');
    }

    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');

    const screenOrder = ['homeScreen', 'quizScreen', 'feedbackScreen', 'resultsScreen'];
    const screenIndex = screenOrder.indexOf(screenId);

    document.querySelectorAll('.nav-dot').forEach((dot, index) => {
        dot.classList.toggle('active', index === screenIndex);
    });

    document.getElementById('screenIndicator').textContent = `${screenIndex + 1}/4`;
}

function startQuizWithValidation() {
    const nameInput = document.getElementById('learnerName');
    const alertMsg = document.getElementById('nameAlert');

    if (nameInput) {
        const name = nameInput.value.trim();
        if (!name) {
            alertMsg.style.display = 'block';
            nameInput.focus();
            return;
        }
        alertMsg.style.display = 'none';
        localStorage.setItem('learnerName', name);
    }
    startQuiz();
}

function startQuiz() {
    queue = [...questions].sort(() => Math.random() - 0.5);
    solvedCount = 0;
    userAnswers = [];
    totalAttempts = 0;
    isReplayMode = false;
    currentQuestion = queue.shift();
    goToScreen('quizScreen');
    loadQuestionUI();
}

function loadQuestionUI() {
    if (!currentQuestion) return;
    const q = currentQuestion;

    document.getElementById('quizProgress').textContent = `Q${solvedCount + 1}/${questions.length}`;
    document.getElementById('quizProgressText').textContent = `${solvedCount + 1}/${questions.length}`;
    document.getElementById('quizProgressBar').style.width = `${((solvedCount + 1) / questions.length) * 100}%`;
    document.getElementById('questionText').textContent = q.question;
    document.getElementById('questionImage').src = sanitizeImageSrc(q.image);
    renderSentence(document.getElementById('sentenceText'), q.sentence, 'blank-space', '？');

    const optionsContainer = document.getElementById('optionsContainer');
    optionsContainer.innerHTML = '';

    const letters = ['A', 'B', 'C', 'D'];
    q.options.forEach((opt, index) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        const letter = document.createElement('span');
        letter.className = 'option-letter';
        letter.textContent = `${letters[index]}.`;
        const word = document.createElement('span');
        word.className = 'option-word';
        word.textContent = String(opt || '');
        btn.append(letter, word);
        btn.onclick = () => selectOption(btn, opt === q.correct);
        optionsContainer.appendChild(btn);
    });

    timeLeft = 30;
    updateTimer();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimer();
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            autoFail();
        }
    }, 1000);
}

function updateTimer() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    document.getElementById('timer').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function selectOption(btn, isCorrect) {
    if (timerInterval) clearInterval(timerInterval);
    totalAttempts++;

    document.querySelectorAll('.option-btn').forEach(option => {
        option.style.pointerEvents = 'none';
    });

    const q = currentQuestion;

    if (isCorrect) {
        btn.classList.add('correct');
    } else {
        btn.classList.add('incorrect');
        document.querySelectorAll('.option-btn').forEach(option => {
            if (option.querySelector('.option-word').textContent === q.correct) {
                option.classList.add('correct');
            }
        });

        if (!userAnswers.some(a => a.word === q.correct)) {
            userAnswers.push({ isCorrect: false, word: q.correct, questionId: q.id });
        }
    }

    setTimeout(() => {
        showFeedback(isCorrect);
    }, 1000);
}

function autoFail() {
    totalAttempts++;
    document.querySelectorAll('.option-btn').forEach(option => {
        option.style.pointerEvents = 'none';
        option.classList.add('incorrect');
    });

    const q = currentQuestion;
    document.querySelectorAll('.option-btn').forEach(option => {
        if (option.querySelector('.option-word').textContent === q.correct) {
            option.classList.add('correct');
        }
    });

    if (!userAnswers.some(a => a.word === q.correct)) {
        userAnswers.push({ isCorrect: false, word: q.correct, questionId: q.id });
    }

    setTimeout(() => {
        showFeedback(false);
    }, 1500);
}

function showFeedback(isCorrect, pushToHistory = true) {
    currentIsCorrect = isCorrect;
    const q = currentQuestion;

    document.getElementById('feedbackProgress').textContent = `Q${solvedCount + 1}/${questions.length}`;
    document.getElementById('feedbackEmoji').textContent = isCorrect ? '🎉' : '😢';
    document.getElementById('feedbackTitle').textContent = isCorrect ? '正解！' : '残念...';
    document.getElementById('feedbackTitle').className = `feedback-title ${isCorrect ? 'correct' : 'incorrect'}`;
    document.getElementById('feedbackSubtitle').textContent = isCorrect ?
        '素晴らしい！この調子で続けましょう' : '解説を読んで覚えましょう！';
    document.getElementById('feedbackWord').textContent = `✨ ${q.correct}`;
    document.getElementById('whyExplanation').textContent = q.why;

    renderSentence(document.getElementById('completeSentence'), q.sentence, 'filled-word', q.correct);

    const otherOptionsContent = document.getElementById('otherOptionsContent');
    otherOptionsContent.textContent = '';
    q.others.forEach((opt) => {
        const card = document.createElement('div');
        card.className = 'option-detail-card';
        const header = document.createElement('div');
        header.className = 'option-detail-header';
        const word = document.createElement('span');
        word.className = 'option-detail-word';
        word.textContent = `❌ ${String(opt?.word || '')}`;
        header.appendChild(word);
        const usage = document.createElement('div');
        usage.className = 'option-detail-usage';
        usage.textContent = String(opt?.usage || '');
        const example = document.createElement('div');
        example.className = 'option-detail-example';
        example.textContent = `💬 ${String(opt?.example || '')}`;
        card.append(header, usage, example);
        otherOptionsContent.appendChild(card);
    });

    if (isCorrect) {
        createConfetti();
    }

    // Reset tabs
    switchTab('why');

    goToScreen('feedbackScreen', pushToHistory);
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    document.querySelector(`.tab-btn[onclick="switchTab('${tabName}')"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

function nextQuestion() {
    if (isReplayMode) {
        // Just return to the result screen after a replay, don't advance the queue
        isReplayMode = false;
        showResults(false);
        return;
    }

    if (currentIsCorrect) {
        solvedCount++;
    } else {
        let insertIndex = 0;
        if (queue.length > 0) {
            insertIndex = 1 + Math.floor(Math.random() * queue.length);
        }
        queue.splice(insertIndex, 0, currentQuestion);
    }

    if (solvedCount >= questions.length || (!currentQuestion && queue.length === 0)) {
        showResults();
    } else {
        currentQuestion = queue.shift();
        goToScreen('quizScreen');
        loadQuestionUI();
    }
}

function showResults(pushToHistory = true) {
    const wrongCount = userAnswers.length;
    const firstTryCorrect = questions.length - wrongCount;
    const percentage = Math.round((firstTryCorrect / questions.length) * 100);

    const learnerName = localStorage.getItem('learnerName') || 'あなた';
    document.getElementById('resultsEmoji').textContent = percentage >= 80 ? '🏆' : percentage >= 50 ? '👍' : '📚';
    const message = percentage >= 80 ? 'お疲れ様でした！' : percentage >= 50 ? 'もう一息！' : '復習しましょう！';
    document.getElementById('resultsTitle').textContent = `${learnerName}さん、${message}`;
    document.getElementById('resultsScore').textContent = `${questions.length}/${totalAttempts}`;
    document.getElementById('resultsSubtitle').textContent = `学習完了！（一発正解率 ${percentage}%）`;
    document.getElementById('statCorrect').textContent = questions.length;

    const reviewListContent = document.getElementById('reviewListContent');
    reviewListContent.textContent = '';
    if (!userAnswers.length) {
        const allCorrect = document.createElement('div');
        allCorrect.className = 'review-item';
        const label = document.createElement('span');
        label.className = 'review-word';
        label.textContent = '🎉 全て一発正解！';
        allCorrect.appendChild(label);
        reviewListContent.appendChild(allCorrect);
    } else {
        userAnswers.forEach((a) => {
            const item = document.createElement('div');
            item.className = 'review-item clickable';
            item.title = 'クリックしてこの問題をやり直す';
            item.addEventListener('click', () => replayQuestion(a.questionId));
            const word = document.createElement('span');
            word.className = 'review-word';
            word.textContent = String(a.word || '');
            const status = document.createElement('span');
            status.className = 'review-status';
            status.textContent = '🔄 再挑戦';
            item.append(word, status);
            reviewListContent.appendChild(item);
        });
    }

    // Fire-and-forget background log submission
    if (localStorage.getItem('learnerName')) {
        fetch(`/api/quizzes/${quizId}/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                learnerName: learnerName,
                correctCount: firstTryCorrect,
                totalAttempts: totalAttempts
            })
        }).catch(err => console.error('Failed to save log:', err));
    }

    goToScreen('resultsScreen', pushToHistory);
}

window.replayQuestion = function (questionId) {
    const q = questions.find(x => x.id === questionId);
    if (!q) return;

    isReplayMode = true;
    currentQuestion = q;
    goToScreen('quizScreen');
    loadQuestionUI();
}

function createConfetti() {
    const colors = ['#2ECC71', '#F39C12', '#E74C3C', '#4A90E2', '#9B59B6', '#F1C40F'];

    for (let i = 0; i < 30; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * 100 + '%';
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.animationDelay = Math.random() * 0.5 + 's';
            document.getElementById('feedbackScreen').appendChild(confetti);

            setTimeout(() => confetti.remove(), 2000);
        }, i * 30);
    }
}

// Initialize
document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', function () {
        const parent = this.parentElement;
        parent.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
    });
});
