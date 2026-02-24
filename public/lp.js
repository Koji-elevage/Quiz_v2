const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const message = document.getElementById('lpMessage');
const params = new URLSearchParams(window.location.search);
const quizId = params.get('quiz');

const savedName = localStorage.getItem('learnerName');
if (savedName) {
  nameInput.value = savedName;
}

if (!quizId) {
  message.textContent = 'クイズ情報がありません。管理者のQRから開いてください。';
  message.className = 'lpv2-help error';
}

startBtn.addEventListener('click', () => {
  const name = String(nameInput.value || '').trim();
  if (!name) {
    message.textContent = '表示名を入力してください。';
    message.className = 'lpv2-help error';
    return;
  }

  if (!quizId) {
    message.textContent = 'クイズ情報がないため開始できません。';
    message.className = 'lpv2-help error';
    return;
  }

  localStorage.setItem('learnerName', name);
  location.href = `/quiz/${quizId}`;
});
