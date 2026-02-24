const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function asBool(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

async function main() {
  const appUrl = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  const sqlitePath = String(process.env.SQLITE_PATH || path.join(process.cwd(), 'db', 'quiz.sqlite'));
  const skipPrefix = String(process.env.SKIP_TITLE_PREFIX || 'E2E Smoke');
  const force = asBool(process.env.FORCE);

  if (!appUrl) throw new Error('APP_URL is required');
  if (!adminToken) throw new Error('ADMIN_TOKEN is required');
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite file not found: ${sqlitePath}`);

  const db = new Database(sqlitePath, { readonly: true });
  const rows = db.prepare('SELECT id, title, questions_json, created_at FROM quizzes ORDER BY created_at DESC').all();

  const authHeaders = { Authorization: `Bearer ${adminToken}` };
  const listRes = await fetch(`${appUrl}/api/quizzes`, { headers: authHeaders });
  if (!listRes.ok) throw new Error(`Failed to fetch remote quizzes: ${listRes.status} ${await listRes.text()}`);
  const listJson = await listRes.json();
  const remoteTitles = new Set((listJson.items || []).map((x) => String(x.title || '')));

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const title = String(row.title || '').trim();
    if (!title) {
      skipped++;
      continue;
    }
    if (skipPrefix && title.startsWith(skipPrefix)) {
      skipped++;
      continue;
    }
    if (!force && remoteTitles.has(title)) {
      skipped++;
      continue;
    }

    let questions;
    try {
      questions = JSON.parse(row.questions_json);
    } catch {
      failed++;
      console.error(`FAILED: invalid JSON in local row: ${title}`);
      continue;
    }

    const body = { title, questions };
    const res = await fetch(`${appUrl}/api/quizzes`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      failed++;
      console.error(`FAILED: ${title} -> ${res.status} ${await res.text()}`);
      continue;
    }

    migrated++;
    remoteTitles.add(title);
  }

  console.log(`migrate done: migrated=${migrated} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(2);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
