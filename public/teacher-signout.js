const signoutStatus = document.getElementById('signoutStatus');
const bugReportInput = document.getElementById('bugReportInput');
const v3RequestInput = document.getElementById('v3RequestInput');
const otherCommentInput = document.getElementById('otherCommentInput');
const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');

const logoutEmail = String(sessionStorage.getItem('logoutFeedbackEmail') || '').trim();

function setStatus(message, isError = false) {
  if (!signoutStatus) return;
  signoutStatus.textContent = message;
  signoutStatus.className = isError ? 'lpv2-help error' : 'lpv2-help';
}

if (logoutEmail) {
  setStatus(`ログオフしました（${logoutEmail}）。`);
}

async function submitFeedback() {
  const bugReport = String(bugReportInput?.value || '').trim();
  const v3Request = String(v3RequestInput?.value || '').trim();
  const otherComment = String(otherCommentInput?.value || '').trim();

  if (!bugReport && !v3Request && !otherComment) {
    setStatus('いずれか1つは入力してください。', true);
    return;
  }

  submitFeedbackBtn.disabled = true;
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submittedBy: logoutEmail || '匿名',
        bugReport,
        v3Request,
        otherComment
      })
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(data?.message || `送信に失敗しました (${res.status})`);
    }
    setStatus('コメントを保存しました。ありがとうございました。');
    if (bugReportInput) bugReportInput.value = '';
    if (v3RequestInput) v3RequestInput.value = '';
    if (otherCommentInput) otherCommentInput.value = '';
    sessionStorage.removeItem('logoutFeedbackEmail');
  } catch (error) {
    setStatus(error.message || '送信に失敗しました。', true);
  } finally {
    submitFeedbackBtn.disabled = false;
  }
}

if (submitFeedbackBtn) {
  submitFeedbackBtn.addEventListener('click', submitFeedback);
}
