const { chromium } = require('playwright');

async function main() {
  const appUrl = String(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  if (!adminToken) {
    throw new Error('ADMIN_TOKEN is required for e2e smoke test');
  }

  const createPayload = {
    title: `E2E Smoke ${Date.now()}`,
    questions: Array.from({ length: 5 }, (_, i) => ({
      prompt: `E2E 問題 ${i + 1}`,
      sentence: '今日は（　　）と学習する。',
      choices: ['しっかり', 'のんびり', 'こっそり'],
      correctIndex: 0,
      explanation: '文脈上「しっかり」が自然です。',
      others: [
        { usage: 'ゆったり', example: 'のんびり歩く' },
        { usage: 'ひそかに', example: 'こっそり見る' }
      ]
    }))
  };

  const createRes = await fetch(`${appUrl}/api/quizzes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify(createPayload)
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`create quiz failed: ${createRes.status} ${body}`);
  }
  const created = await createRes.json();
  if (!created.id) {
    throw new Error('create quiz response does not contain id');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`${appUrl}/admin?token=${encodeURIComponent(adminToken)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#titleInput');

  await page.goto(`${appUrl}/quiz/${created.id}`, { waitUntil: 'domcontentloaded' });
  await page.fill('#learnerName', 'e2e-user');
  await page.click('button:has-text("クイズを始める")');
  await page.waitForSelector('#quizScreen.active');
  const questionText = await page.textContent('#questionText');
  if (!questionText || !questionText.trim()) {
    throw new Error('question text not rendered');
  }

  await browser.close();
  console.log(`E2E smoke passed: ${created.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
