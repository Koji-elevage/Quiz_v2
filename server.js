require('dotenv').config({ path: ['.env.local', '.env'] });
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
const multer = require('multer');
const sharp = require('sharp');
const QRCode = require('qrcode');
const { GoogleGenAI } = require('@google/genai');
const { OAuth2Client } = require('google-auth-library');
const yaml = require('js-yaml');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'SET_YOUR_API_KEY_HERE' });

const app = express();
const port = process.env.PORT || 3000;
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();
const AUTH_MODE = String(process.env.ADMIN_AUTH_MODE || 'token').trim().toLowerCase();
const GOOGLE_CLIENT_ID = String(process.env.ADMIN_GOOGLE_CLIENT_ID || '').trim();
const ADMIN_GOOGLE_EMAILS = String(process.env.ADMIN_GOOGLE_EMAILS || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);
const DEFAULT_OWNER_EMAILS = ['kojitani3@gmail.com', 'okantani@gmail.com'];
const ADMIN_OWNER_EMAILS = (() => {
  const fromEnv = String(process.env.ADMIN_OWNER_EMAILS || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_OWNER_EMAILS;
})();
const ADMIN_GOOGLE_DOMAIN = String(process.env.ADMIN_GOOGLE_DOMAIN || '').trim().toLowerCase();
const DB_DRIVER = String(process.env.DB_DRIVER || (process.env.CLOUD_SQL_CONNECTION_NAME ? 'mysql' : 'sqlite')).trim();
const googleAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const ADMIN_SESSION_SECRET = String(process.env.ADMIN_SESSION_SECRET || ADMIN_TOKEN || 'dev-admin-session-secret').trim();
const ADMIN_SESSION_TTL_MS = Math.max(3 * 60 * 60 * 1000, Number(process.env.ADMIN_SESSION_TTL_MS || 0) || 0);

const dbPath = path.join(__dirname, 'db', 'quiz.sqlite');
let sqliteDb = null;
let mysqlPool = null;
const PROMPT_CONFIG_TYPES = ['question', 'image'];
const IMAGE_GEN_MAX_ATTEMPTS = 3;
const IMAGE_BORDER_CHECK_SIZE = 256;
const IMAGE_BORDER_STRIP = 8;
const QUESTION_AI_RATE_MAX = Math.max(30, Number(process.env.QUESTION_AI_RATE_MAX || 60) || 60);
const IMAGE_AI_RATE_MAX = Math.max(10, Number(process.env.IMAGE_AI_RATE_MAX || 20) || 20);
const AI_RATE_WINDOW_MS = Math.max(10_000, Number(process.env.AI_RATE_WINDOW_MS || 60_000) || 60_000);

const DEFAULT_PROMPT_YAML = {
  question: [
    'type: question',
    'name: 設問生成システムプロンプト',
    'version: 1',
    'template: |',
    '  あなたは日本語教師向けクイズ作成アシスタントです。',
    '  以下の日本語（またはオノマトペ）を正解とする、日本語学習者向けの穴埋めクイズを作成してください。',
    '  出力は必ずJSONのみ（Markdownや説明文は不要）。',
    '',
    '  ターゲット単語: {{word}}',
    '',
    '  【現在の入力状況（Context）】',
    '  {{context_json}}',
    '',
    '  【重要ルール】',
    '  - 既に値が入っている項目は維持し、空欄（null/空文字）の部分だけを補完すること。',
    '  - sentence には必ず「（　　）」を含め、そこに「{{word}}」が入る文にすること。',
    '  - choices は「未入力の不正解枠を埋める語のみ」を返すこと。',
    '  - 既入力の不正解語は再提案しない。正解語「{{word}}」とも重複しないこと。',
    '  - choices は重複禁止。sentence / explanation と意味的に整合すること。',
    '  - others は choices と同順で対応させ、usage/example はその語の意味に合う内容にすること。',
    '',
    '  【出力JSONフォーマット】',
    '  {',
    '    "prompt": "【この状況に合う言葉は？】などの短い設問文",',
    '    "sentence": "ターゲット単語の位置を（　　）とした例文",',
    '    "choices": ["不正解の選択肢1", "不正解の選択肢2"],',
    '    "explanation": "なぜその単語が正解なのかのわかりやすい解説",',
    '    "others": [',
    '      { "usage": "不正解1の使われる状況", "example": "不正解1の例文" },',
    '      { "usage": "不正解2の使われる状況", "example": "不正解2の例文" }',
    '    ]',
    '  }'
  ].join('\n'),
  image: [
    'type: image',
    'name: 画像生成システムプロンプト',
    'version: 1',
    'template: |',
    '  あなたは日本語学習用イラストの制作アシスタントです。',
    '  以下を画像として実現してください。説明文は不要です。',
    '',
    '  【優先順位】',
    '  A) 文字なし・枠なし・余白なし',
    '  B) サンプル画像に画風を合わせる（線の太さ、色調、塗り、構図密度）',
    '  C) 場面コンテキストの意味を自然に描く',
    '',
    '  【重要ルール】',
    '  1) 学習対象語の意味が一目で伝わる場面にする。',
    '  2) 画風はシンプルな手描き風。茶/濃灰のやや不規則な太線、淡いパステル水彩、低彩度。',
    '  3) 構図・重力・天候は現実的にする。',
    '  4) 雨/雪では人物保護を自然に描く（傘・雨具・屋内/窓越し）。',
    '  5) 装飾枠、白フチ、額縁、余白を作らない。',
    '  6) 文字・記号・ロゴを入れない。',
    '',
    '  【場面コンテキスト】',
    '  - 場面説明: {{scene_description}}',
    '  - 解説/ニュアンス: {{explanation}}',
    '  - 重要語（文字としては描かない）: {{key_concept}}',
    '  - 追加要望: {{additional_prompt}}',
    '',
    '  最終出力は、上記条件を満たす1枚の全面イラスト。'
  ].join('\n')
};

if (DB_DRIVER === 'sqlite') {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  sqliteDb = new Database(dbPath);
}

// Ensure image generation directory exists
const genImagesDir = path.join(__dirname, 'public', 'images', 'gen');
if (!fs.existsSync(genImagesDir)) {
  fs.mkdirSync(genImagesDir, { recursive: true });
}

// Memory storage for multer (we process with sharp before saving)
const upload = multer({ storage: multer.memoryStorage() });

process.on('uncaughtException', (error) => {
  console.error('[fatal] uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection', reason);
});

async function initDb() {
  if (DB_DRIVER === 'mysql') {
    const connectionName = String(process.env.CLOUD_SQL_CONNECTION_NAME || '').trim();
    const dbName = String(process.env.MYSQL_DB || 'quizv2').trim();
    const user = String(process.env.MYSQL_USER || '').trim();
    const password = String(process.env.MYSQL_PASSWORD || '').trim();
    const host = String(process.env.MYSQL_HOST || '').trim();
    const port = Number(process.env.MYSQL_PORT || 3306);

    const mysqlConfig = {
      user,
      password,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4'
    };
    if (connectionName) {
      mysqlConfig.socketPath = `/cloudsql/${connectionName}`;
    } else {
      mysqlConfig.host = host || '127.0.0.1';
      mysqlConfig.port = port;
    }
    mysqlPool = mysql.createPool(mysqlConfig);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id VARCHAR(64) PRIMARY KEY,
        title TEXT NOT NULL,
        questions_json LONGTEXT NOT NULL,
        created_at VARCHAR(40) NOT NULL
      )
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS quiz_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        quiz_id VARCHAR(64) NOT NULL,
        learner_name VARCHAR(255) NOT NULL,
        play_count INT DEFAULT 1,
        latest_correct INT DEFAULT 0,
        latest_total_attempts INT DEFAULT 0,
        updated_at VARCHAR(40) NOT NULL,
        UNIQUE KEY uq_quiz_learner (quiz_id, learner_name)
      )
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS prompt_configs (
        type VARCHAR(32) PRIMARY KEY,
        yaml_text LONGTEXT NOT NULL,
        updated_at VARCHAR(40) NOT NULL
      )
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS admin_users (
        email VARCHAR(255) PRIMARY KEY,
        created_at VARCHAR(40) NOT NULL,
        created_by VARCHAR(255) NOT NULL
      )
    `);
    return;
  }

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      questions_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quiz_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id TEXT NOT NULL,
      learner_name TEXT NOT NULL,
      play_count INTEGER DEFAULT 1,
      latest_correct INTEGER DEFAULT 0,
      latest_total_attempts INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(quiz_id, learner_name)
    );

    CREATE TABLE IF NOT EXISTS prompt_configs (
      type TEXT PRIMARY KEY,
      yaml_text TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      email TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
  `);
}

async function dbAll(sql, params = []) {
  if (DB_DRIVER === 'mysql') {
    const [rows] = await mysqlPool.execute(sql, params);
    return rows;
  }
  return sqliteDb.prepare(sql).all(...params);
}

async function dbGet(sql, params = []) {
  if (DB_DRIVER === 'mysql') {
    const [rows] = await mysqlPool.execute(sql, params);
    return rows[0] || null;
  }
  return sqliteDb.prepare(sql).get(...params);
}

async function dbRun(sql, params = []) {
  if (DB_DRIVER === 'mysql') {
    const [result] = await mysqlPool.execute(sql, params);
    return { changes: Number(result.affectedRows || 0), lastInsertRowid: Number(result.insertId || 0) };
  }
  const result = sqliteDb.prepare(sql).run(...params);
  return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
}

function isAuthorizedAdmin(req) {
  if (!ADMIN_TOKEN) {
    return false;
  }
  const authHeader = String(req.get('authorization') || '');
  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.slice(7).trim();
  const expected = Buffer.from(ADMIN_TOKEN, 'utf8');
  const actual = Buffer.from(token, 'utf8');
  if (expected.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

function parseBearerToken(req) {
  const authHeader = String(req.get('authorization') || '');
  if (!authHeader.startsWith('Bearer ')) {
    return '';
  }
  return authHeader.slice(7).trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function base64UrlEncode(input) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input) {
  return Buffer.from(String(input || ''), 'base64url').toString('utf8');
}

function signAdminSessionPayload(payloadB64) {
  return crypto
    .createHmac('sha256', ADMIN_SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');
}

function createAdminSessionToken(adminUser) {
  const now = Date.now();
  const payload = {
    email: normalizeEmail(adminUser?.email || ''),
    name: String(adminUser?.name || ''),
    role: String(adminUser?.role || 'user'),
    provider: 'google',
    iat: now,
    exp: now + ADMIN_SESSION_TTL_MS
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = signAdminSessionPayload(payloadB64);
  return `app.${payloadB64}.${sig}`;
}

function verifyAdminSessionToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'app') {
    return { ok: false, reason: 'format' };
  }
  const payloadB64 = parts[1];
  const sig = parts[2];
  const expectedSig = signAdminSessionPayload(payloadB64);
  const expected = Buffer.from(expectedSig, 'utf8');
  const actual = Buffer.from(sig, 'utf8');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'signature' };
  }
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch (_error) {
    return { ok: false, reason: 'payload' };
  }
  const exp = Number(payload?.exp || 0);
  if (!exp || Date.now() > exp) {
    return { ok: false, reason: 'expired' };
  }
  const email = normalizeEmail(payload?.email || '');
  if (!email) {
    return { ok: false, reason: 'email' };
  }
  return {
    ok: true,
    adminUser: {
      email,
      name: String(payload?.name || ''),
      provider: 'google',
      role: String(payload?.role || 'user')
    }
  };
}

function isOwnerEmail(email) {
  const normalized = normalizeEmail(email);
  return ADMIN_OWNER_EMAILS.includes(normalized);
}

async function isDynamicAdminEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const row = await dbGet('SELECT email FROM admin_users WHERE email = ?', [normalized]);
  return Boolean(row?.email);
}

async function resolveGoogleAdminUser(email, name = '') {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { ok: false, status: 401, message: 'Googleアカウント情報を確認できませんでした。' };
  }
  const owner = isOwnerEmail(normalizedEmail);
  if (!owner) {
    const allowListed = ADMIN_GOOGLE_EMAILS.includes(normalizedEmail);
    const dynamicAllowed = await isDynamicAdminEmail(normalizedEmail);
    if (!allowListed && !dynamicAllowed) {
      return { ok: false, status: 403, message: 'このGoogleアカウントには管理権限がありません。' };
    }
  }
  return {
    ok: true,
    adminUser: {
      email: normalizedEmail,
      name: String(name || ''),
      provider: 'google',
      role: owner ? 'owner' : 'user'
    }
  };
}

async function verifyGoogleAdminToken(req) {
  if (!GOOGLE_CLIENT_ID || !googleAuthClient) {
    return { ok: false, status: 503, message: 'Google管理者認証が未設定です。ADMIN_GOOGLE_CLIENT_ID を設定してください。' };
  }

  const token = parseBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, message: 'Googleログインが必要です。' };
  }

  const appSession = verifyAdminSessionToken(token);
  if (appSession.ok) {
    req.adminUser = appSession.adminUser;
    return { ok: true };
  }

  try {
    const ticket = await googleAuthClient.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload() || {};
    const email = String(payload.email || '').trim().toLowerCase();
    const emailVerified = Boolean(payload.email_verified);
    const domain = String(payload.hd || '').trim().toLowerCase();

    if (!email || !emailVerified) {
      return { ok: false, status: 401, message: 'Googleアカウント情報を確認できませんでした。' };
    }

    if (ADMIN_GOOGLE_DOMAIN) {
      const domainAllowed = ADMIN_GOOGLE_DOMAIN === domain || email.endsWith(`@${ADMIN_GOOGLE_DOMAIN}`);
      if (!domainAllowed) {
        return { ok: false, status: 403, message: 'このGoogleアカウントには管理権限がありません。' };
      }
    }

    const resolved = await resolveGoogleAdminUser(email, String(payload.name || ''));
    if (!resolved.ok) {
      return { ok: false, status: resolved.status, message: resolved.message };
    }
    req.adminUser = resolved.adminUser;
    return { ok: true };
  } catch (error) {
    return { ok: false, status: 401, message: 'Google認証トークンが無効です。再ログインしてください。' };
  }
}

async function requireAdminAuth(req, res, next) {
  if (AUTH_MODE === 'google') {
    const verified = await verifyGoogleAdminToken(req);
    if (!verified.ok) {
      return res.status(verified.status).json({ message: verified.message });
    }
    return next();
  }

  if (!ADMIN_TOKEN) {
    return res.status(503).json({ message: '管理者認証が未設定です。ADMIN_TOKEN を設定してください。' });
  }
  if (!isAuthorizedAdmin(req)) {
    return res.status(401).json({ message: '管理者認証に失敗しました。' });
  }
  return next();
}

async function requireOwnerAuth(req, res, next) {
  if (AUTH_MODE !== 'google') {
    return res.status(403).json({ message: 'この機能はGoogle認証モードでのみ利用できます。' });
  }
  const verified = await verifyGoogleAdminToken(req);
  if (!verified.ok) {
    return res.status(verified.status).json({ message: verified.message });
  }
  if (!isOwnerEmail(req.adminUser?.email)) {
    return res.status(403).json({ message: 'この操作はオーナー管理者のみ実行できます。' });
  }
  return next();
}

function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const bucket = buckets.get(key) || [];
    const fresh = bucket.filter((ts) => ts > cutoff);
    fresh.push(now);
    buckets.set(key, fresh);
    if (fresh.length > max) {
      return res.status(429).json({
        message: '生成AIがちょっと疲れました。しばらくしてもう一度お試しください。'
      });
    }
    return next();
  };
}

const questionAiRateLimiter = createRateLimiter({ windowMs: AI_RATE_WINDOW_MS, max: QUESTION_AI_RATE_MAX });
const imageAiRateLimiter = createRateLimiter({ windowMs: AI_RATE_WINDOW_MS, max: IMAGE_AI_RATE_MAX });
const uploadRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/auth/config', (_req, res) => {
  if (AUTH_MODE === 'google') {
    return res.status(200).json({
      mode: 'google',
      googleClientId: GOOGLE_CLIENT_ID || '',
      googleDomain: ADMIN_GOOGLE_DOMAIN || '',
      ownerEmails: ADMIN_OWNER_EMAILS,
      sessionTtlMinutes: Math.floor(ADMIN_SESSION_TTL_MS / 60000),
      hint: '教師・管理者はGoogleでログインしてください。'
    });
  }
  return res.status(200).json({
    mode: 'token',
    hint: '管理者トークンを入力してください。'
  });
});

app.post('/api/auth/google-exchange', async (req, res) => {
  if (AUTH_MODE !== 'google') {
    return res.status(400).json({ message: 'この環境はGoogle認証モードではありません。' });
  }
  if (!GOOGLE_CLIENT_ID || !googleAuthClient) {
    return res.status(503).json({ message: 'Google管理者認証が未設定です。ADMIN_GOOGLE_CLIENT_ID を設定してください。' });
  }

  const idToken = String(req.body?.idToken || '').trim();
  if (!idToken) {
    return res.status(400).json({ message: 'idToken が必要です。' });
  }

  try {
    const ticket = await googleAuthClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload() || {};
    const email = String(payload.email || '').trim().toLowerCase();
    const emailVerified = Boolean(payload.email_verified);
    const domain = String(payload.hd || '').trim().toLowerCase();
    if (!email || !emailVerified) {
      return res.status(401).json({ message: 'Googleアカウント情報を確認できませんでした。' });
    }
    if (ADMIN_GOOGLE_DOMAIN) {
      const domainAllowed = ADMIN_GOOGLE_DOMAIN === domain || email.endsWith(`@${ADMIN_GOOGLE_DOMAIN}`);
      if (!domainAllowed) {
        return res.status(403).json({ message: 'このGoogleアカウントには管理権限がありません。' });
      }
    }
    const resolved = await resolveGoogleAdminUser(email, String(payload.name || ''));
    if (!resolved.ok) {
      return res.status(resolved.status).json({ message: resolved.message });
    }
    const appToken = createAdminSessionToken(resolved.adminUser);
    return res.status(200).json({
      appToken,
      expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString(),
      sessionTtlMinutes: Math.floor(ADMIN_SESSION_TTL_MS / 60000),
      user: resolved.adminUser
    });
  } catch (error) {
    return res.status(401).json({ message: 'Google認証トークンが無効です。再ログインしてください。' });
  }
});

app.get('/api/auth/session', requireAdminAuth, async (req, res) => {
  if (AUTH_MODE === 'google') {
    return res.status(200).json({
      mode: 'google',
      email: req.adminUser?.email || '',
      name: req.adminUser?.name || '',
      role: req.adminUser?.role || 'teacher'
    });
  }
  return res.status(200).json({
    mode: 'token',
    role: 'owner'
  });
});

app.get('/api/docs/:key', requireAdminAuth, async (req, res) => {
  const key = String(req.params.key || '').trim();
  const docsMap = {
    readme: path.join(__dirname, 'README.md'),
    teacher_manual: path.join(__dirname, '教師向け簡易マニュアル.md')
  };
  const filePath = docsMap[key];
  if (!filePath) {
    return res.status(404).json({ message: 'ドキュメントが見つかりません。' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'ドキュメントファイルが存在しません。' });
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return res.status(200).json({
      key,
      title: key === 'readme' ? 'README.md' : '教師向け簡易マニュアル.md',
      content
    });
  } catch (error) {
    return res.status(500).json({ message: 'ドキュメントの読み込みに失敗しました。' });
  }
});

app.get('/api/admin-users', requireOwnerAuth, async (_req, res) => {
  try {
    const rows = await dbAll('SELECT email, created_at, created_by FROM admin_users ORDER BY created_at DESC');
    const merged = new Map();

    for (const ownerEmail of ADMIN_OWNER_EMAILS) {
      merged.set(ownerEmail, {
        email: ownerEmail,
        role: 'owner',
        createdAt: null,
        createdBy: 'system'
      });
    }
    for (const row of rows) {
      const email = normalizeEmail(row.email);
      if (!email || merged.has(email)) continue;
      merged.set(email, {
        email,
        role: 'user',
        createdAt: row.created_at,
        createdBy: row.created_by
      });
    }

    return res.status(200).json({ items: Array.from(merged.values()) });
  } catch (error) {
    return res.status(500).json({ message: '教師アカウント一覧の取得に失敗しました。' });
  }
});

app.post('/api/admin-users', requireOwnerAuth, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: '有効なメールアドレスを入力してください。' });
    }
    if (isOwnerEmail(email)) {
      return res.status(200).json({ message: 'このメールは既にオーナー管理者です。' });
    }

    const now = new Date().toISOString();
    const createdBy = normalizeEmail(req.adminUser?.email || 'owner');
    if (DB_DRIVER === 'mysql') {
      await dbRun(
        `INSERT INTO admin_users (email, created_at, created_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE created_at = created_at`,
        [email, now, createdBy]
      );
    } else {
      await dbRun(
        `INSERT INTO admin_users (email, created_at, created_by)
         VALUES (?, ?, ?)
         ON CONFLICT(email) DO NOTHING`,
        [email, now, createdBy]
      );
    }
    return res.status(200).json({ success: true, email });
  } catch (error) {
    return res.status(500).json({ message: '教師アカウントの追加に失敗しました。' });
  }
});

app.delete('/api/admin-users/:email', requireOwnerAuth, async (req, res) => {
  try {
    const email = normalizeEmail(decodeURIComponent(req.params.email || ''));
    if (!email) {
      return res.status(400).json({ message: 'メールアドレスが必要です。' });
    }
    if (isOwnerEmail(email)) {
      return res.status(400).json({ message: 'オーナー管理者は削除できません。' });
    }
    await dbRun('DELETE FROM admin_users WHERE email = ?', [email]);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: '教師アカウントの削除に失敗しました。' });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lp.html')); // Fallback LP if we rename it, but let's just make it redirect to admin for now, or LP. Let's just do LP.
});

app.get('/teacher-login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher-login.html'));
});

app.get('/teacher-manual-v2', (_req, res) => {
  res.sendFile(path.join(__dirname, 'Teacher_Manual_v2.html'));
});

app.get('/owner-admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'owner-admin.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});



app.get('/quiz/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
});



function normalizeQuestion(raw, index) {
  const prompt = String(raw?.prompt || raw?.question || '').trim();
  const sentence = String(raw?.sentence || '').trim();
  const choices = Array.isArray(raw?.choices) ? raw.choices.map((v) => String(v || '').trim()) : [];
  const correctIndex = Number(raw?.correctIndex);
  const explanation = String(raw?.explanation || raw?.why || '').trim();

  const othersRaw = Array.isArray(raw?.others) ? raw.others : [];
  const others = [0, 1].map((i) => {
    const o = othersRaw[i] || {};
    return {
      word: String(o.word || '').trim(),
      usage: String(o.usage || '').trim(),
      example: String(o.example || '').trim()
    };
  });

  const whyCorrect = String(raw?.whyCorrect || '').trim();
  const keyPoint = String(raw?.keyPoint || '').trim();
  const choiceNotesRaw = Array.isArray(raw?.choiceNotes) ? raw.choiceNotes : [];
  const choiceNotes = [0, 1, 2].map((i) => String(choiceNotesRaw[i] || '').trim());

  const imageUrl = String(raw?.imageUrl || raw?.image || '').trim();

  if (!prompt) {
    throw new Error(`問題${index + 1}: 設問文は必須です。`);
  }
  if (choices.length !== 3 || choices.some((c) => !c)) {
    throw new Error(`問題${index + 1}: 選択肢は3件すべて必須です。`);
  }
  if (![0, 1, 2].includes(correctIndex)) {
    throw new Error(`問題${index + 1}: 正解は1〜3から選択してください。`);
  }
  if (!explanation) {
    throw new Error(`問題${index + 1}: 解説は必須です。`);
  }

  return {
    id: raw?.id ? String(raw.id) : crypto.randomUUID(),
    prompt,
    sentence,
    choices,
    correctIndex,
    explanation,
    others,
    whyCorrect,
    keyPoint,
    choiceNotes,
    imageUrl
  };
}

function isPromptConfigType(type) {
  return PROMPT_CONFIG_TYPES.includes(type);
}

function renderPromptTemplate(template, variables) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key) => {
    const value = variables[key];
    if (value === undefined || value === null) {
      return '';
    }
    return String(value);
  });
}

function normalizeOneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function mentionsRainOrSnow(text) {
  const value = String(text || '').toLowerCase();
  return /(雨|雪|rain|snow|storm|shower|降って|降り)/i.test(value);
}

function mentionsIndoorOrWindow(text) {
  const value = String(text || '').toLowerCase();
  return /(室内|屋内|部屋|窓|window|indoors|inside)/i.test(value);
}

function buildDeterministicImageFallbackPrompt(context) {
  const scene = normalizeOneLine(context?.sentence ? String(context.sentence).replace('（　　）', String(context.correct || '')) : '');
  const nuance = normalizeOneLine(context?.explanation || '');
  const concept = normalizeOneLine(context?.correct || '');
  const additional = normalizeOneLine(context?.additionalPrompt || '');
  const rainOrSnow = mentionsRainOrSnow(`${scene} ${nuance}`);
  const indoorWindow = mentionsIndoorOrWindow(`${scene} ${nuance}`);
  const weatherRule = rainOrSnow
    ? (indoorWindow
      ? '雨や雪は窓の外側のみにし、屋内へ降り込ませない。'
      : '雨や雪の場面では、人物に傘・雨具などの自然な保護を与える。')
    : '天候と環境の整合性を自然に保つ。';
  return normalizeOneLine([
    '日本語学習向けの安全で穏やかな日常イラストを作成する。',
    scene ? `場面: ${scene}。` : '',
    nuance ? `解説ニュアンス: ${nuance}。` : '',
    concept ? `重要語（文字として描かない）: ${concept}。` : '',
    additional ? `追加要望: ${additional}。` : '',
    '意味はモチーフと行動で表現し、文字情報は入れない。',
    '構図・重力・天候挙動などの物理整合性を保つ。',
    weatherRule,
    '画風は淡いパステル水彩、茶または濃いグレーのやや太い輪郭、落ち着いた配色。',
    '仕上がりは枠なし・余白なしの全面イラスト（フルブリード）。'
  ].filter(Boolean).join(' '));
}

function enforceImagePromptRules(candidatePrompt, context) {
  const base = normalizeOneLine(candidatePrompt);
  const deterministic = buildDeterministicImageFallbackPrompt(context);
  const source = base || deterministic;
  const rainOrSnow = mentionsRainOrSnow(`${source} ${context?.sentence || ''} ${context?.explanation || ''}`);
  const indoorWindow = mentionsIndoorOrWindow(`${source} ${context?.sentence || ''} ${context?.explanation || ''}`);
  const weatherRule = rainOrSnow
    ? (indoorWindow
      ? '雨や雪は窓の外側に限定し、室内へ降り込ませない。'
      : '雨や雪の場面では人物を傘・雨具などで自然に保護する。')
    : '天候挙動は物理的に自然に保つ。';

  return normalizeOneLine([
    source,
    '意味は視覚的モチーフで伝え、文字情報は入れない。',
    '現実的な構図・重力・天候挙動を保つ。',
    weatherRule,
    '装飾枠・余白・額縁のないフルブリード構図で描写する。'
  ].join(' '));
}

function isGeminiSafetyFilterError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('responsible ai practices')
    || message.includes('filtered out')
    || message.includes('invalid_argument');
}

function buildGeminiSafetyRetryPrompt(basePrompt, context, attempt = 1) {
  const base = normalizeOneLine(basePrompt);
  const scene = normalizeOneLine(context?.sentence ? String(context.sentence).replace('（　　）', String(context.correct || '')) : '');
  const concept = normalizeOneLine(context?.correct || '');
  const nuance = normalizeOneLine(context?.explanation || '');
  const additional = normalizeOneLine(context?.additionalPrompt || '');
  return normalizeOneLine([
    base,
    '（安全配慮で言い換え）暴力・成人向け・危険物を含まない、教室で扱える穏やかな日常場面として描写する。',
    scene ? `場面: ${scene}。` : '',
    concept ? `重要語（文字として描かない）: ${concept}。` : '',
    nuance ? `解説ニュアンス: ${nuance}。` : '',
    additional ? `追加要望: ${additional}。` : '',
    '文字情報は入れない。枠線や余白は作らない。物理法則に沿って描く。',
    `安全リトライレベル: ${attempt}`
  ].filter(Boolean).join(' '));
}

function toUserFriendlyImageError(error) {
  const raw = String(error?.message || '').trim();
  if (!raw) return '画像生成に失敗しました。';
  if (raw.includes('Responsible AI practices') || raw.includes('filtered out')) {
    return '画像生成に失敗しました: 安全フィルタにより除外されました。穏やかな日常場面に言い換えて再試行してください。';
  }
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      const nested = String(parsed?.error?.message || '').trim();
      if (nested) return `画像生成に失敗しました: ${nested}`;
    } catch (_ignore) {
      // keep raw
    }
  }
  return `画像生成に失敗しました: ${raw}`;
}

async function isLikelyBorderedImage(buffer) {
  try {
    const { data, info } = await sharp(buffer)
      .resize(IMAGE_BORDER_CHECK_SIZE, IMAGE_BORDER_CHECK_SIZE, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const width = info.width;
    const height = info.height;
    if (!channels || width < 40 || height < 40) return false;

    const pixelAt = (x, y) => {
      const idx = (y * width + x) * channels;
      return [data[idx], data[idx + 1], data[idx + 2]];
    };
    const luminance = ([r, g, b]) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    const regionStats = (x0, y0, x1, y1) => {
      let count = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumL = 0;
      let sumL2 = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const rgb = pixelAt(x, y);
          const l = luminance(rgb);
          count += 1;
          sumR += rgb[0];
          sumG += rgb[1];
          sumB += rgb[2];
          sumL += l;
          sumL2 += (l * l);
        }
      }
      if (!count) return null;
      const meanL = sumL / count;
      const variance = Math.max(0, (sumL2 / count) - (meanL * meanL));
      return {
        mean: [sumR / count, sumG / count, sumB / count],
        stdL: Math.sqrt(variance)
      };
    };
    const colorDistance = (a, b) => Math.sqrt(
      ((a[0] - b[0]) ** 2) +
      ((a[1] - b[1]) ** 2) +
      ((a[2] - b[2]) ** 2)
    );

    const strip = IMAGE_BORDER_STRIP;
    const top = regionStats(0, 0, width, strip);
    const bottom = regionStats(0, height - strip, width, height);
    const left = regionStats(0, 0, strip, height);
    const right = regionStats(width - strip, 0, width, height);
    const center = regionStats(strip * 2, strip * 2, width - (strip * 2), height - (strip * 2));
    if (!top || !bottom || !left || !right || !center) return false;

    const edges = [top, bottom, left, right];
    const uniformEdges = edges.filter((edge) => edge.stdL < 7);
    const farFromCenterEdges = edges.filter((edge) => colorDistance(edge.mean, center.mean) > 22);
    return uniformEdges.length >= 3 && farFromCenterEdges.length >= 2;
  } catch (_error) {
    return false;
  }
}

async function normalizeGeneratedImage(buffer) {
  try {
    // Trim flat outer whitespace and normalize to full-bleed 4:3.
    return await sharp(buffer)
      .trim({ threshold: 10 })
      .resize({
        width: 1152,
        height: 864,
        fit: sharp.fit.cover,
        position: sharp.strategy.attention
      })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch (_error) {
    return buffer;
  }
}

function parsePromptConfigYaml(type, yamlText) {
  let parsed;
  try {
    parsed = yaml.load(String(yamlText || ''));
  } catch (error) {
    throw new Error(`YAMLの解析に失敗しました: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('YAMLはオブジェクト形式で指定してください。');
  }
  if (typeof parsed.template !== 'string' || !parsed.template.trim()) {
    throw new Error('YAMLの template は必須です。');
  }
  if (parsed.type && String(parsed.type).trim() !== type) {
    throw new Error(`YAMLの type は "${type}" にしてください。`);
  }
  return {
    ...parsed,
    type
  };
}

async function getPromptConfigRecord(type) {
  const row = await dbGet('SELECT type, yaml_text, updated_at FROM prompt_configs WHERE type = ?', [type]);
  if (row) {
    return {
      type: row.type,
      yamlText: String(row.yaml_text || ''),
      updatedAt: row.updated_at,
      isDefault: false
    };
  }
  return {
    type,
    yamlText: DEFAULT_PROMPT_YAML[type],
    updatedAt: null,
    isDefault: true
  };
}

async function savePromptConfig(type, yamlText) {
  const now = new Date().toISOString();
  if (DB_DRIVER === 'mysql') {
    await dbRun(
      `INSERT INTO prompt_configs (type, yaml_text, updated_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE yaml_text = VALUES(yaml_text), updated_at = VALUES(updated_at)`,
      [type, yamlText, now]
    );
  } else {
    await dbRun(
      `INSERT INTO prompt_configs (type, yaml_text, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(type) DO UPDATE SET yaml_text = excluded.yaml_text, updated_at = excluded.updated_at`,
      [type, yamlText, now]
    );
  }
}

async function buildQuestionSystemPrompt({ word, context }) {
  const record = await getPromptConfigRecord('question');
  let config;
  try {
    config = parsePromptConfigYaml('question', record.yamlText);
  } catch (error) {
    console.error('Invalid question prompt config; fallback to default:', error.message);
    config = parsePromptConfigYaml('question', DEFAULT_PROMPT_YAML.question);
  }
  const contextJson = JSON.stringify(context || {}, null, 2);
  const rendered = renderPromptTemplate(config.template, {
    word: String(word || '').trim(),
    context_json: contextJson
  });
  return `${rendered}

【整合性ルール（最優先）】
- Context内で既に値が入っている項目は確定値として扱い、変更しない。
- sentence / prompt / explanation は、正解語と既入力の選択肢・補足文と矛盾しない内容にする。
- choices には「未入力の不正解枠を埋める語だけ」を返す。既入力の不正解語を再提案しない。
- choices の各語は、正解語と重複禁止・choices内で重複禁止。
- others は choices と同じ順序で対応させる。各要素は usage/example をその語の意味に整合させる。
- 出力形式はJSONのみ。`;
}

function sanitizeGeneratedQuestionOutput(generated, { word, context }) {
  const safe = generated && typeof generated === 'object' ? generated : {};
  const normalizedWord = String(word || '').trim();
  const existingChoiceSet = new Set();
  if (Array.isArray(context?.choiceSlots)) {
    for (const slot of context.choiceSlots) {
      const value = String(slot?.value || '').trim();
      if (value) existingChoiceSet.add(value);
    }
  } else if (Array.isArray(context?.choices)) {
    for (const valueRaw of context.choices) {
      const value = String(valueRaw || '').trim();
      if (value) existingChoiceSet.add(value);
    }
  }
  if (normalizedWord) existingChoiceSet.add(normalizedWord);

  const rawChoices = Array.isArray(safe.choices) ? safe.choices : [];
  const rawOthers = Array.isArray(safe.others) ? safe.others : [];
  const filteredChoices = [];
  const filteredOthers = [];

  for (let i = 0; i < rawChoices.length; i += 1) {
    const candidate = String(rawChoices[i] || '').trim();
    if (!candidate) continue;
    if (existingChoiceSet.has(candidate)) continue;
    existingChoiceSet.add(candidate);
    filteredChoices.push(candidate);

    const o = rawOthers[i] || {};
    filteredOthers.push({
      usage: String(o.usage || '').trim(),
      example: String(o.example || '').trim()
    });
    if (filteredChoices.length >= 2) break;
  }

  return {
    prompt: String(safe.prompt || '').trim(),
    sentence: String(safe.sentence || '').trim(),
    explanation: String(safe.explanation || '').trim(),
    choices: filteredChoices,
    others: filteredOthers
  };
}

function getMissingIncorrectChoiceCount(context) {
  if (Array.isArray(context?.choiceSlots) && context.choiceSlots.length) {
    return context.choiceSlots.filter((slot) => !slot?.isCorrect && !String(slot?.value || '').trim()).length;
  }
  if (Array.isArray(context?.choices)) {
    return context.choices.filter((v) => !String(v || '').trim()).length;
  }
  return 2;
}

function buildForbiddenChoiceSet({ word, context, generatedChoices = [] }) {
  const set = new Set();
  const normalizedWord = String(word || '').trim();
  if (normalizedWord) set.add(normalizedWord);
  if (Array.isArray(context?.choiceSlots)) {
    for (const slot of context.choiceSlots) {
      const value = String(slot?.value || '').trim();
      if (value) set.add(value);
    }
  } else if (Array.isArray(context?.choices)) {
    for (const valueRaw of context.choices) {
      const value = String(valueRaw || '').trim();
      if (value) set.add(value);
    }
  }
  for (const choice of generatedChoices) {
    const value = String(choice || '').trim();
    if (value) set.add(value);
  }
  return set;
}

function stripCodeFenceJson(text) {
  return String(text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

function getIncorrectWordsFromContext(context) {
  if (Array.isArray(context?.choiceSlots) && context.choiceSlots.length) {
    return context.choiceSlots
      .filter((slot) => !slot?.isCorrect)
      .map((slot) => String(slot?.value || '').trim());
  }
  if (Array.isArray(context?.choices)) {
    return context.choices.map((v) => String(v || '').trim());
  }
  return ['', ''];
}

function buildMissingOthersTargets(context) {
  const words = getIncorrectWordsFromContext(context);
  const others = Array.isArray(context?.others) ? context.others : [];
  const targets = [];
  for (let i = 0; i < 2; i += 1) {
    const item = others[i] || {};
    const usage = String(item?.usage || '').trim();
    const example = String(item?.example || '').trim();
    const word = String(words[i] || '').trim();
    if (!word) continue;
    if (usage && example) continue;
    targets.push({ index: i, word });
  }
  return targets;
}

async function generateQuestionTextWithProvider(provider, promptText) {
  if (provider === 'qwen') {
    const dashscopeKey = process.env.DASHSCOPE_API_KEY;
    if (!dashscopeKey) throw new Error('DASHSCOPE_API_KEYが設定されていません。');
    const qwenRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${dashscopeKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'user', content: promptText }]
      })
    });
    if (!qwenRes.ok) {
      const errText = await qwenRes.text();
      throw new Error(`Qwen API Error (${qwenRes.status}): ${errText}`);
    }
    const data = await qwenRes.json();
    return String(data.choices?.[0]?.message?.content || '');
  }
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: promptText,
  });
  return String(response.text || '');
}

async function generateMissingDistractorsOnce({ provider, word, context, needed, forbiddenSet }) {
  if (needed <= 0) return { choices: [], others: [] };
  const prompt = [
    'あなたは日本語クイズ作成補助です。',
    `正解語: ${String(word || '').trim()}`,
    `不足している不正解候補数: ${needed}`,
    `使用禁止語: ${Array.from(forbiddenSet).join(' / ') || '(なし)'}`,
    '',
    '次を満たすJSONのみを返してください。',
    '- choices: 不正解語の配列（ちょうど不足数、全て異なる、使用禁止語を含めない）',
    '- others: choicesと同順で usage/example を返す',
    '',
    `Context: ${JSON.stringify(context || {}, null, 2)}`,
    '',
    '出力例:',
    '{"choices":["語1","語2"],"others":[{"usage":"...","example":"..."},{"usage":"...","example":"..."}]}'
  ].join('\n');

  try {
    const text = await generateQuestionTextWithProvider(provider, prompt);
    const parsed = JSON.parse(stripCodeFenceJson(text));
    const rawChoices = Array.isArray(parsed?.choices) ? parsed.choices : [];
    const rawOthers = Array.isArray(parsed?.others) ? parsed.others : [];
    const choices = [];
    const others = [];
    const blocked = new Set(Array.from(forbiddenSet));
    for (let i = 0; i < rawChoices.length; i += 1) {
      const candidate = String(rawChoices[i] || '').trim();
      if (!candidate || blocked.has(candidate)) continue;
      blocked.add(candidate);
      choices.push(candidate);
      const o = rawOthers[i] || {};
      others.push({
        usage: String(o.usage || '').trim(),
        example: String(o.example || '').trim()
      });
      if (choices.length >= needed) break;
    }
    return { choices, others };
  } catch (_error) {
    return { choices: [], others: [] };
  }
}

async function generateMissingDistractors({ provider, word, context, needed, forbiddenSet }) {
  if (needed <= 0) return { choices: [], others: [] };
  const primary = provider === 'qwen' ? 'qwen' : 'gemini';
  const secondary = primary === 'qwen' ? 'gemini' : 'qwen';
  const result = { choices: [], others: [] };
  const blocked = new Set(Array.from(forbiddenSet));
  const providerOrder = [primary, secondary, primary];

  for (const activeProvider of providerOrder) {
    const remain = needed - result.choices.length;
    if (remain <= 0) break;
    const partial = await generateMissingDistractorsOnce({
      provider: activeProvider,
      word,
      context,
      needed: remain,
      forbiddenSet: blocked
    });
    for (let i = 0; i < partial.choices.length; i += 1) {
      const candidate = String(partial.choices[i] || '').trim();
      if (!candidate || blocked.has(candidate)) continue;
      blocked.add(candidate);
      result.choices.push(candidate);
      const o = partial.others[i] || {};
      result.others.push({
        usage: String(o.usage || '').trim(),
        example: String(o.example || '').trim()
      });
      if (result.choices.length >= needed) break;
    }
  }
  return result;
}

async function generateMissingOthers({ provider, context, answerWord }) {
  const targets = buildMissingOthersTargets(context);
  if (!targets.length) return [];
  const primary = provider === 'qwen' ? 'qwen' : 'gemini';
  const secondary = primary === 'qwen' ? 'gemini' : 'qwen';
  const providerOrder = [primary, secondary, primary];
  const filled = new Map();

  for (const activeProvider of providerOrder) {
    const remainTargets = targets.filter((t) => {
      const existing = filled.get(t.index);
      return !(existing?.usage && existing?.example);
    });
    if (!remainTargets.length) break;
    const prompt = [
      'あなたは日本語クイズ作成補助です。',
      `正解語: ${String(answerWord || '').trim()}`,
      '次の不正解語ごとに、使用場面(usage)と例文(example)を作ってください。',
      '出力はJSONのみ。',
      '',
      `targets: ${JSON.stringify(remainTargets, null, 2)}`,
      `context: ${JSON.stringify(context || {}, null, 2)}`,
      '',
      '出力形式:',
      '{"others":[{"index":0,"usage":"...","example":"..."},{"index":1,"usage":"...","example":"..."}]}'
    ].join('\n');
    try {
      const raw = await generateQuestionTextWithProvider(activeProvider, prompt);
      const parsed = JSON.parse(stripCodeFenceJson(raw));
      const rows = Array.isArray(parsed?.others) ? parsed.others : [];
      for (const row of rows) {
        const idx = Number(row?.index);
        if (!Number.isInteger(idx) || idx < 0 || idx > 1) continue;
        const usage = String(row?.usage || '').trim();
        const example = String(row?.example || '').trim();
        if (!usage && !example) continue;
        const prev = filled.get(idx) || { index: idx, usage: '', example: '' };
        filled.set(idx, {
          index: idx,
          usage: prev.usage || usage,
          example: prev.example || example
        });
      }
    } catch (_error) {
      // keep best effort
    }
  }
  return Array.from(filled.values());
}

function normalizeImagePathFromUrl(imageUrl) {
  const raw = String(imageUrl || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/images/')) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.pathname && parsed.pathname.startsWith('/images/')) {
      return parsed.pathname;
    }
  } catch (_error) {
    // ignore parse error
  }
  return '';
}

async function loadReferenceImageBuffer(imageUrl) {
  const imagePath = normalizeImagePathFromUrl(imageUrl);
  if (!imagePath) return null;
  const absolute = path.join(__dirname, 'public', imagePath.replace(/^\//, ''));
  if (!absolute.startsWith(path.join(__dirname, 'public'))) return null;
  if (!fs.existsSync(absolute)) return null;
  const original = fs.readFileSync(absolute);
  return sharp(original)
    .resize({ width: 768, height: 768, fit: sharp.fit.inside })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function buildImageSystemPrompt(context) {
  const record = await getPromptConfigRecord('image');
  let config;
  try {
    config = parsePromptConfigYaml('image', record.yamlText);
  } catch (error) {
    console.error('Invalid image prompt config; fallback to default:', error.message);
    config = parsePromptConfigYaml('image', DEFAULT_PROMPT_YAML.image);
  }

  const sentence = context?.sentence ? String(context.sentence).replace('（　　）', String(context.correct || '')) : '';
  const additionalPrompt = context?.additionalPrompt ? String(context.additionalPrompt).trim() : 'なし';
  const promptText = renderPromptTemplate(config.template, {
    scene_description: sentence,
    explanation: String(context?.explanation || ''),
    key_concept: String(context?.correct || ''),
    additional_prompt: additionalPrompt
  });
  return promptText;
}

async function buildQuizSharePayload(req, id) {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const quizUrl = `${baseUrl}/quiz/${id}`;
  const qrDataUrl = await QRCode.toDataURL(quizUrl, {
    margin: 1,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  });
  return { quizUrl, qrDataUrl };
}

async function findQuizByTitle(title) {
  const normalized = String(title || '').trim();
  if (!normalized) return null;
  if (DB_DRIVER === 'mysql') {
    return dbGet('SELECT id, title FROM quizzes WHERE LOWER(title) = LOWER(?) LIMIT 1', [normalized]);
  }
  return dbGet('SELECT id, title FROM quizzes WHERE lower(title) = lower(?) LIMIT 1', [normalized]);
}

app.get('/api/quizzes', requireAdminAuth, async (_req, res) => {
  try {
    const rows = await dbAll('SELECT id, title, questions_json, created_at FROM quizzes ORDER BY created_at DESC');
    const items = rows.map((row) => {
      const questions = JSON.parse(row.questions_json);
      return {
        id: row.id,
        title: row.title,
        questionCount: questions.length,
        createdAt: row.created_at
      };
    });
    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: 'クイズ一覧の取得に失敗しました。' });
  }
});

app.get('/api/quizzes/:id', async (req, res) => {
  try {
    const row = await dbGet('SELECT id, title, questions_json, created_at FROM quizzes WHERE id = ?', [req.params.id]);
    if (!row) {
      return res.status(404).json({ message: 'クイズが見つかりません。' });
    }
    return res.json({
      id: row.id,
      title: row.title,
      questions: JSON.parse(row.questions_json),
      createdAt: row.created_at
    });
  } catch (error) {
    return res.status(500).json({ message: 'クイズ取得に失敗しました。' });
  }
});

app.post('/api/quizzes', requireAdminAuth, async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const rawQuestions = Array.isArray(req.body?.questions) ? req.body.questions : [];

    if (!title) {
      return res.status(400).json({ message: 'タイトルは必須です。' });
    }

    if (rawQuestions.length < 5) {
      return res.status(400).json({ message: '問題は5問以上必要です。' });
    }

    const titleConflict = await findQuizByTitle(title);
    if (titleConflict) {
      return res.status(409).json({
        message: '同名タイトルが既に存在します。',
        conflictQuizId: String(titleConflict.id || '')
      });
    }

    const questions = rawQuestions.map((q, i) => normalizeQuestion(q, i));
    const id = crypto.randomUUID().slice(0, 8);
    const createdAt = new Date().toISOString();

    await dbRun(
      'INSERT INTO quizzes (id, title, questions_json, created_at) VALUES (?, ?, ?, ?)',
      [id, title, JSON.stringify(questions), createdAt]
    );

    const { quizUrl, qrDataUrl } = await buildQuizSharePayload(req, id);

    return res.status(201).json({ id, quizUrl, qrDataUrl });
  } catch (error) {
    return res.status(400).json({ message: error.message || '保存に失敗しました。' });
  }
});

app.put('/api/quizzes/:id', requireAdminAuth, async (req, res) => {
  try {
    const existing = await dbGet('SELECT id FROM quizzes WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ message: '更新対象が見つかりません。' });
    }

    const title = String(req.body?.title || '').trim();
    const rawQuestions = Array.isArray(req.body?.questions) ? req.body.questions : [];

    if (!title) {
      return res.status(400).json({ message: 'タイトルは必須です。' });
    }

    if (rawQuestions.length < 5) {
      return res.status(400).json({ message: '問題は5問以上必要です。' });
    }

    const titleConflict = await findQuizByTitle(title);
    if (titleConflict && String(titleConflict.id) !== String(req.params.id)) {
      return res.status(409).json({
        message: '同名タイトルが既に存在します。',
        conflictQuizId: String(titleConflict.id || '')
      });
    }

    const questions = rawQuestions.map((q, i) => normalizeQuestion(q, i));

    await dbRun('UPDATE quizzes SET title = ?, questions_json = ? WHERE id = ?', [
      title,
      JSON.stringify(questions),
      req.params.id
    ]);

    const { quizUrl, qrDataUrl } = await buildQuizSharePayload(req, req.params.id);
    return res.status(200).json({ id: req.params.id, quizUrl, qrDataUrl });
  } catch (error) {
    return res.status(400).json({ message: error.message || '更新に失敗しました。' });
  }
});

app.delete('/api/quizzes/:id', requireAdminAuth, async (req, res) => {
  const result = await dbRun('DELETE FROM quizzes WHERE id = ?', [req.params.id]);

  if (!result.changes) {
    return res.status(404).json({ message: '削除対象が見つかりません。' });
  }

  return res.status(204).send();
});

app.post('/api/quizzes/:id/log', async (req, res) => {
  const quizId = req.params.id;
  // V2 keeps Student identity as display name only (no persistent student_id yet).
  const learnerName = String(req.body?.learnerName || '').trim();
  const correctCount = Number(req.body?.correctCount || 0);
  const totalAttempts = Number(req.body?.totalAttempts || 0);

  if (!learnerName) {
    return res.status(400).json({ message: '学習者名が必要です。' });
  }

  try {
    const now = new Date().toISOString();
    if (DB_DRIVER === 'mysql') {
      await dbRun(`
        INSERT INTO quiz_logs (quiz_id, learner_name, play_count, latest_correct, latest_total_attempts, updated_at)
        VALUES (?, ?, 1, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          play_count = play_count + 1,
          latest_correct = VALUES(latest_correct),
          latest_total_attempts = VALUES(latest_total_attempts),
          updated_at = VALUES(updated_at)
      `, [quizId, learnerName, correctCount, totalAttempts, now]);
    } else {
      const existing = await dbGet('SELECT id, play_count FROM quiz_logs WHERE quiz_id = ? AND learner_name = ?', [quizId, learnerName]);
      if (existing) {
        await dbRun(`
          UPDATE quiz_logs
          SET play_count = ?, latest_correct = ?, latest_total_attempts = ?, updated_at = ?
          WHERE id = ?
        `, [existing.play_count + 1, correctCount, totalAttempts, now, existing.id]);
      } else {
        await dbRun(`
        INSERT INTO quiz_logs (quiz_id, learner_name, play_count, latest_correct, latest_total_attempts, updated_at)
        VALUES (?, ?, 1, ?, ?, ?)
      `, [quizId, learnerName, correctCount, totalAttempts, now]);
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Failed to save quiz log:', error);
    return res.status(500).json({ message: 'ログの保存に失敗しました。' });
  }
});

app.get('/api/quizzes/:id/logs', requireAdminAuth, async (req, res) => {
  try {
    const logs = await dbAll('SELECT * FROM quiz_logs WHERE quiz_id = ? ORDER BY updated_at DESC', [req.params.id]);
    return res.status(200).json(logs);
  } catch (error) {
    console.error('Failed to fetch quiz logs:', error);
    return res.status(500).json({ message: 'ログの取得に失敗しました。' });
  }
});

app.get('/api/prompt-configs', requireAdminAuth, async (_req, res) => {
  try {
    const [question, image] = await Promise.all([
      getPromptConfigRecord('question'),
      getPromptConfigRecord('image')
    ]);
    return res.status(200).json({ question, image });
  } catch (error) {
    return res.status(500).json({ message: 'プロンプト設定の取得に失敗しました。' });
  }
});

app.put('/api/prompt-configs/:type', requireAdminAuth, async (req, res) => {
  try {
    const type = String(req.params.type || '').trim();
    if (!isPromptConfigType(type)) {
      return res.status(400).json({ message: 'type は question または image を指定してください。' });
    }

    const yamlText = String(req.body?.yaml || '').trim();
    if (!yamlText) {
      return res.status(400).json({ message: 'yaml は必須です。' });
    }
    parsePromptConfigYaml(type, yamlText);
    await savePromptConfig(type, yamlText);
    const record = await getPromptConfigRecord(type);
    return res.status(200).json(record);
  } catch (error) {
    return res.status(400).json({ message: error.message || 'プロンプト設定の保存に失敗しました。' });
  }
});

app.post('/api/prompt-configs/:type/reset', requireAdminAuth, async (req, res) => {
  try {
    const type = String(req.params.type || '').trim();
    if (!isPromptConfigType(type)) {
      return res.status(400).json({ message: 'type は question または image を指定してください。' });
    }
    await dbRun('DELETE FROM prompt_configs WHERE type = ?', [type]);
    const record = await getPromptConfigRecord(type);
    return res.status(200).json(record);
  } catch (error) {
    return res.status(500).json({ message: 'デフォルトへのリセットに失敗しました。' });
  }
});

app.post('/api/generate-question', requireAdminAuth, questionAiRateLimiter, async (req, res) => {
  try {
    const word = String(req.body?.word || '').trim();
    const context = req.body?.context || {};

    if (!word) {
      return res.status(400).json({ message: '正解の単語(word)が必要です。' });
    }

    const promptText = await buildQuestionSystemPrompt({ word, context });

    const provider = req.body?.provider || 'gemini';
    const text = stripCodeFenceJson(await generateQuestionTextWithProvider(provider, promptText));

    try {
      const generated = JSON.parse(text);
      const sanitized = sanitizeGeneratedQuestionOutput(generated, { word, context });
      const missingCount = Math.max(0, getMissingIncorrectChoiceCount(context) - sanitized.choices.length);
      if (missingCount > 0) {
        const forbiddenSet = buildForbiddenChoiceSet({
          word,
          context,
          generatedChoices: sanitized.choices
        });
        const supplemental = await generateMissingDistractors({
          provider,
          word,
          context,
          needed: missingCount,
          forbiddenSet
        });
        for (let i = 0; i < supplemental.choices.length; i += 1) {
          sanitized.choices.push(String(supplemental.choices[i] || '').trim());
          const o = supplemental.others[i] || {};
          sanitized.others.push({
            usage: String(o.usage || '').trim(),
            example: String(o.example || '').trim()
          });
        }
      }
      const currentOthers = Array.isArray(context?.others) ? context.others : [];
      const needsOthersFill = [0, 1].some((i) => {
        const item = currentOthers[i] || {};
        const usage = String(item?.usage || '').trim();
        const example = String(item?.example || '').trim();
        return !usage || !example;
      });
      if (needsOthersFill) {
        const generatedOthers = await generateMissingOthers({
          provider,
          context,
          answerWord: word
        });
        if (generatedOthers.length) {
          const mergedOthers = [{ usage: '', example: '' }, { usage: '', example: '' }];
          for (let i = 0; i < 2; i += 1) {
            const base = sanitized.others[i] || {};
            mergedOthers[i] = {
              usage: String(base.usage || '').trim(),
              example: String(base.example || '').trim()
            };
          }
          for (const row of generatedOthers) {
            const idx = Number(row.index);
            if (idx < 0 || idx > 1) continue;
            if (!mergedOthers[idx].usage) mergedOthers[idx].usage = String(row.usage || '').trim();
            if (!mergedOthers[idx].example) mergedOthers[idx].example = String(row.example || '').trim();
          }
          sanitized.others = mergedOthers;
        }
      }
      const stillMissing = Math.max(0, getMissingIncorrectChoiceCount(context) - sanitized.choices.length);
      if (stillMissing > 0) {
        return res.status(200).json({
          ...sanitized,
          warning: `重複回避により不正解候補が${stillMissing}件不足しました。再生成してください。`
        });
      }
      return res.status(200).json(sanitized);
    } catch (e) {
      console.error("Failed to parse Gemini response", text);
      return res.status(500).json({ message: 'AIの応答の解析に失敗しました。' });
    }

  } catch (error) {
    console.error("AI Generation Error", error);
    return res.status(500).json({ message: 'AIの生成に失敗しました。', error: error.message });
  }
});

function extractGeminiImageBase64(response) {
  const parts = [];
  if (Array.isArray(response?.parts)) {
    parts.push(...response.parts);
  }
  if (Array.isArray(response?.candidates)) {
    for (const candidate of response.candidates) {
      const candidateParts = candidate?.content?.parts;
      if (Array.isArray(candidateParts)) {
        parts.push(...candidateParts);
      }
    }
  }
  const imagePart = parts.find((part) => part?.inlineData?.data && String(part?.inlineData?.mimeType || '').startsWith('image/'));
  return String(imagePart?.inlineData?.data || '').trim();
}

async function generateImageBufferWithWanx(prompt, dashscopeKey, baseImageBuffer) {
  const base64Image = String(baseImageBuffer?.toString('base64') || '').trim();
  if (!base64Image) {
    throw new Error('Wanx画像編集の元画像がありません。');
  }
  const taskId = await submitWanxTask({
    dashscopeKey,
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
    payload: {
      model: 'wanx2.1-imageedit',
      input: {
        function: 'stylization_all',
        prompt,
        base_image_url: `data:image/jpeg;base64,${base64Image}`
      },
      parameters: { n: 1 }
    }
  });
  const taskUrl = await waitForWanxTaskResultUrl(taskId, dashscopeKey);
  return fetchImageBufferFromUrl(taskUrl);
}

async function submitWanxTask({ dashscopeKey, endpoint, payload }) {
  const wanxRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-DashScope-Async': 'enable',
      'Authorization': `Bearer ${dashscopeKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!wanxRes.ok) {
    const errText = await wanxRes.text();
    throw new Error(`Wanx API Request Error: ${errText}`);
  }
  const wanxInitData = await wanxRes.json();
  const taskId = wanxInitData.output?.task_id;
  if (!taskId) throw new Error('Failed to get Wanx task ID');
  return taskId;
}

async function waitForWanxTaskResultUrl(taskId, dashscopeKey, maxAttempts = 30, intervalMs = 2000) {
  let taskUrl = '';
  for (let i = 0; i < maxAttempts; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const pollRes = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${dashscopeKey}` }
    });
    const pollData = await pollRes.json();
    const status = pollData.output?.task_status;
    if (status === 'SUCCEEDED') {
      taskUrl = pollData.output?.results?.[0]?.url;
      break;
    }
    if (status === 'FAILED' || status === 'UNKNOWN') {
      throw new Error(`Wanx API Task Failed: ${pollData.output?.message || 'Unknown error'}`);
    }
  }
  if (!taskUrl) throw new Error('Wanx Timeout');
  return taskUrl;
}

async function fetchImageBufferFromUrl(taskUrl) {
  const imgRes = await fetch(taskUrl);
  const imgBuffer = await imgRes.arrayBuffer();
  return Buffer.from(imgBuffer);
}

async function generateImageBufferWithWanxText2Image(prompt, dashscopeKey) {
  const taskId = await submitWanxTask({
    dashscopeKey,
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis',
    payload: {
      model: 'wanx2.0-t2i-turbo',
      input: { prompt },
      parameters: {
        size: '1152*864',
        n: 1
      }
    }
  });
  const taskUrl = await waitForWanxTaskResultUrl(taskId, dashscopeKey);
  return fetchImageBufferFromUrl(taskUrl);
}

async function generateImageBufferWithGemini(prompt, baseImageBuffer) {
  const parts = [{ text: prompt }];
  if (baseImageBuffer) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: baseImageBuffer.toString('base64')
      }
    });
  }
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: ['TEXT', 'IMAGE']
    }
  });
  const base64Image = extractGeminiImageBase64(response);
  if (!base64Image) {
    throw new Error('画像が生成されませんでした。');
  }
  return Buffer.from(base64Image, 'base64');
}

async function hasReadableTextInImage(buffer) {
  try {
    // Cheap guardrail: ask a vision model to detect any visible text in the generated image.
    const base64 = buffer.toString('base64');
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'この画像に読める文字（ひらがな・カタカナ・漢字・英字・数字・記号）が少しでも含まれますか。yes か no だけで答えてください。' },
            { inlineData: { mimeType: 'image/jpeg', data: base64 } }
          ]
        }
      ]
    });
    const text = String(response?.text || '').trim().toLowerCase();
    return text.startsWith('yes');
  } catch (_error) {
    // If check fails, do not block generation.
    return false;
  }
}

app.post('/api/generate-image', requireAdminAuth, imageAiRateLimiter, async (req, res) => {
  try {
    const context = req.body?.context || {};
    const provider = req.body?.provider || 'gemini';
    const textPrompt = await buildImageSystemPrompt(context);
    const currentImageBuffer = await loadReferenceImageBuffer(context?.currentImageUrl || '');
    const usingCurrentImage = Boolean(currentImageBuffer);
    const allowSampleReference = provider !== 'qwen';
    const sampleImageBuffer = allowSampleReference && !usingCurrentImage
      ? await loadReferenceImageBuffer(context?.sampleImageUrl || '')
      : null;
    const usingSampleImage = Boolean(sampleImageBuffer);
    const baseImageBuffer = currentImageBuffer || sampleImageBuffer || null;
    let imagePrompt = textPrompt;
    if (usingSampleImage) {
      imagePrompt = `${imagePrompt}

【参照画像の扱い】
- この参照画像は画調（線・塗り・色調・質感）のみ参考にする。
- 参照画像内の人物・建物・天候・小物・構図をそのまま流用しない。
- 場面内容は上記コンテキスト（場面説明・解説・重要語・追加要望）に忠実に描く。`;
    }
    imagePrompt = enforceImagePromptRules(imagePrompt, context);
    let lastGeminiError = null;
    let bestCandidateBuffer = null;
    let bestCandidateReason = '';

    for (let attempt = 1; attempt <= IMAGE_GEN_MAX_ATTEMPTS; attempt += 1) {
      let buffer;
      try {
        if (provider === 'qwen') {
          const dashscopeKey = process.env.DASHSCOPE_API_KEY;
          if (!dashscopeKey) throw new Error('DASHSCOPE_API_KEYが設定されていません。');
          if (usingCurrentImage && currentImageBuffer) {
            buffer = await generateImageBufferWithWanx(imagePrompt, dashscopeKey, currentImageBuffer);
          } else {
            buffer = await generateImageBufferWithWanxText2Image(imagePrompt, dashscopeKey);
          }
        } else {
          buffer = await generateImageBufferWithGemini(imagePrompt, baseImageBuffer);
        }
      } catch (error) {
        if (provider === 'gemini' && isGeminiSafetyFilterError(error)) {
          lastGeminiError = error;
          if (attempt < IMAGE_GEN_MAX_ATTEMPTS) {
            imagePrompt = enforceImagePromptRules(buildGeminiSafetyRetryPrompt(imagePrompt, context, attempt), context);
            continue;
          }
          break;
        }
        throw error;
      }

      const normalizedBuffer = await normalizeGeneratedImage(buffer);
      const hasFrame = await isLikelyBorderedImage(normalizedBuffer);
      const hasText = await hasReadableTextInImage(normalizedBuffer);
      bestCandidateBuffer = normalizedBuffer;
      bestCandidateReason = hasFrame && hasText ? '枠線と文字混入' : (hasFrame ? '枠線' : '文字混入');
      if (!hasFrame && !hasText) {
        const filename = `${crypto.randomUUID()}.jpeg`;
        const filepath = path.join(genImagesDir, filename);
        fs.writeFileSync(filepath, normalizedBuffer);
        return res.status(200).json({ imageUrl: `/images/gen/${filename}` });
      }

      if (attempt < IMAGE_GEN_MAX_ATTEMPTS) {
        imagePrompt = enforceImagePromptRules(`${imagePrompt} 強化指示: 文字情報を使わず、枠や余白のない全面イラストに寄せる。`, context);
        continue;
      }

      if (bestCandidateBuffer) {
        const filename = `${crypto.randomUUID()}.jpeg`;
        const filepath = path.join(genImagesDir, filename);
        fs.writeFileSync(filepath, bestCandidateBuffer);
        return res.status(200).json({
          imageUrl: `/images/gen/${filename}`,
          warning: `自動検査で${bestCandidateReason}を検出しましたが、候補画像を返しました。必要なら再生成してください。`
        });
      }
      throw new Error('枠線または文字混入のない画像を生成できませんでした。YAMLの画像生成プロンプトを見直してください。');
    }

    if (provider === 'gemini' && lastGeminiError) {
      const dashscopeKey = process.env.DASHSCOPE_API_KEY;
      if (dashscopeKey) {
        const fallbackPrompt = enforceImagePromptRules(buildGeminiSafetyRetryPrompt(imagePrompt, context, IMAGE_GEN_MAX_ATTEMPTS + 1), context);
        const buffer = usingCurrentImage && baseImageBuffer
          ? await generateImageBufferWithWanx(fallbackPrompt, dashscopeKey, baseImageBuffer)
          : await generateImageBufferWithWanxText2Image(fallbackPrompt, dashscopeKey);
        const normalizedBuffer = await normalizeGeneratedImage(buffer);
        const hasFrame = await isLikelyBorderedImage(normalizedBuffer);
        const hasText = await hasReadableTextInImage(normalizedBuffer);
        if (hasFrame || hasText) {
          const filename = `${crypto.randomUUID()}.jpeg`;
          const filepath = path.join(genImagesDir, filename);
          fs.writeFileSync(filepath, normalizedBuffer);
          return res.status(200).json({
            imageUrl: `/images/gen/${filename}`,
            warning: 'Gemini安全フィルタ回避後の画像に枠線または文字混入の疑いがあります。必要なら再生成してください。'
          });
        }
        const filename = `${crypto.randomUUID()}.jpeg`;
        const filepath = path.join(genImagesDir, filename);
        fs.writeFileSync(filepath, normalizedBuffer);
        return res.status(200).json({ imageUrl: `/images/gen/${filename}` });
      }
      throw new Error('Geminiの安全フィルタで画像が除外されました。内容を穏やかな日常場面に変更して再試行してください。');
    }

  } catch (error) {
    console.error("AI Image Generation Error", error);
    const friendly = toUserFriendlyImageError(error);
    return res.status(500).json({
      message: friendly,
      error: String(error?.message || '')
    });
  }
});

app.post('/api/upload-image', requireAdminAuth, uploadRateLimiter, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '画像ファイルがアップロードされていません。' });
    }

    const filename = `${crypto.randomUUID()}.jpeg`;
    const filepath = path.join(genImagesDir, filename);

    // Process image using sharp: resize to max width 800, crop to 4:3, convert to JPEG
    await sharp(req.file.buffer)
      .resize({
        width: 800,
        height: 600,
        fit: sharp.fit.cover,
        position: sharp.strategy.entropy
      })
      .jpeg({ quality: 80 })
      .toFile(filepath);

    const imageUrl = `/images/gen/${filename}`;
    return res.status(200).json({ imageUrl });

  } catch (error) {
    console.error("Image Upload Error", error);
    return res.status(500).json({ message: '画像のアップロードと処理に失敗しました。', error: error.message });
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'APIエンドポイントが見つかりません。' });
});

app.use((err, req, res, next) => {
  if (!err) {
    return next();
  }

  if (req.path.startsWith('/api')) {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ message: 'リクエストサイズが大きすぎます。' });
    }
    return res.status(400).json({ message: err.message || 'APIリクエストの処理に失敗しました。' });
  }

  return next(err);
});

async function start() {
  await initDb();
  app.listen(port, () => {
    console.log(`日本語クイズ app listening on http://localhost:${port} (db=${DB_DRIVER}, auth=${AUTH_MODE})`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
