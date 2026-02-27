const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const infoMessage = document.getElementById('lpMessage');
const activeMessage = document.getElementById('lpMessageActive');
const qrOnlySection = document.getElementById('qrOnlySection');
const learnerStartSection = document.getElementById('learnerStartSection');
const params = new URLSearchParams(window.location.search);
const quizId = params.get('quiz');

const savedName = localStorage.getItem('learnerName');
if (savedName && nameInput) {
  nameInput.value = savedName;
}

if (!quizId) {
  if (qrOnlySection) qrOnlySection.classList.remove('hidden');
  if (learnerStartSection) learnerStartSection.classList.add('hidden');
} else {
  if (qrOnlySection) qrOnlySection.classList.add('hidden');
  if (learnerStartSection) learnerStartSection.classList.remove('hidden');
}

if (startBtn) {
  startBtn.addEventListener('click', () => {
    const name = String(nameInput.value || '').trim();
    if (!name) {
      if (activeMessage) {
        activeMessage.textContent = '表示名を入力してください。';
        activeMessage.className = 'lpv2-help error';
      }
      return;
    }

    if (!quizId) {
      if (infoMessage) {
        infoMessage.textContent = 'クイズ情報がないため開始できません。管理者のQRから開いてください。';
        infoMessage.className = 'lpv2-help error';
      }
      return;
    }

    localStorage.setItem('learnerName', name);
    location.href = `/quiz/${quizId}`;
  });
}
