require('dotenv').config({ path: ['.env.local', '.env'] });
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');
const multer = require('multer');
const sharp = require('sharp');
const QRCode = require('qrcode');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || 'SET_YOUR_API_KEY_HERE' });

const app = express();
const port = process.env.PORT || 3000;
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();

const dbPath = path.join(__dirname, 'db', 'quiz.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(dbPath);

// Ensure image generation directory exists
const genImagesDir = path.join(__dirname, 'public', 'images', 'gen');
if (!fs.existsSync(genImagesDir)) {
  fs.mkdirSync(genImagesDir, { recursive: true });
}

// Memory storage for multer (we process with sharp before saving)
const upload = multer({ storage: multer.memoryStorage() });

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

function requireAdminAuth(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ message: '管理者認証が未設定です。ADMIN_TOKEN を設定してください。' });
  }
  if (!isAuthorizedAdmin(req)) {
    return res.status(401).json({ message: '管理者認証に失敗しました。' });
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
      return res.status(429).json({ message: 'リクエストが多すぎます。しばらく待って再試行してください。' });
    }
    return next();
  };
}

const aiRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10 });
const uploadRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

db.exec(`
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
`);

app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lp.html')); // Fallback LP if we rename it, but let's just make it redirect to admin for now, or LP. Let's just do LP.
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

app.get('/api/quizzes', requireAdminAuth, (_req, res) => {
  const rows = db
    .prepare('SELECT id, title, questions_json, created_at FROM quizzes ORDER BY created_at DESC')
    .all();

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
});

app.get('/api/quizzes/:id', (req, res) => {
  const row = db
    .prepare('SELECT id, title, questions_json, created_at FROM quizzes WHERE id = ?')
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({ message: 'クイズが見つかりません。' });
  }

  return res.json({
    id: row.id,
    title: row.title,
    questions: JSON.parse(row.questions_json),
    createdAt: row.created_at
  });
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

    const questions = rawQuestions.map((q, i) => normalizeQuestion(q, i));
    const id = crypto.randomUUID().slice(0, 8);
    const createdAt = new Date().toISOString();

    db.prepare(
      'INSERT INTO quizzes (id, title, questions_json, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, title, JSON.stringify(questions), createdAt);

    const { quizUrl, qrDataUrl } = await buildQuizSharePayload(req, id);

    return res.status(201).json({ id, quizUrl, qrDataUrl });
  } catch (error) {
    return res.status(400).json({ message: error.message || '保存に失敗しました。' });
  }
});

app.put('/api/quizzes/:id', requireAdminAuth, async (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM quizzes WHERE id = ?').get(req.params.id);
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

    const questions = rawQuestions.map((q, i) => normalizeQuestion(q, i));

    db.prepare('UPDATE quizzes SET title = ?, questions_json = ? WHERE id = ?').run(
      title,
      JSON.stringify(questions),
      req.params.id
    );

    const { quizUrl, qrDataUrl } = await buildQuizSharePayload(req, req.params.id);
    return res.status(200).json({ id: req.params.id, quizUrl, qrDataUrl });
  } catch (error) {
    return res.status(400).json({ message: error.message || '更新に失敗しました。' });
  }
});

app.delete('/api/quizzes/:id', requireAdminAuth, (req, res) => {
  const result = db.prepare('DELETE FROM quizzes WHERE id = ?').run(req.params.id);

  if (!result.changes) {
    return res.status(404).json({ message: '削除対象が見つかりません。' });
  }

  return res.status(204).send();
});

app.post('/api/quizzes/:id/log', (req, res) => {
  const quizId = req.params.id;
  const learnerName = String(req.body?.learnerName || '').trim();
  const correctCount = Number(req.body?.correctCount || 0);
  const totalAttempts = Number(req.body?.totalAttempts || 0);

  if (!learnerName) {
    return res.status(400).json({ message: '学習者名が必要です。' });
  }

  try {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id, play_count FROM quiz_logs WHERE quiz_id = ? AND learner_name = ?').get(quizId, learnerName);

    if (existing) {
      db.prepare(`
        UPDATE quiz_logs 
        SET play_count = ?, latest_correct = ?, latest_total_attempts = ?, updated_at = ?
        WHERE id = ?
      `).run(existing.play_count + 1, correctCount, totalAttempts, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO quiz_logs (quiz_id, learner_name, play_count, latest_correct, latest_total_attempts, updated_at)
        VALUES (?, ?, 1, ?, ?, ?)
      `).run(quizId, learnerName, correctCount, totalAttempts, now);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Failed to save quiz log:', error);
    return res.status(500).json({ message: 'ログの保存に失敗しました。' });
  }
});

app.get('/api/quizzes/:id/logs', requireAdminAuth, (req, res) => {
  try {
    const logs = db.prepare('SELECT * FROM quiz_logs WHERE quiz_id = ? ORDER BY updated_at DESC').all(req.params.id);
    return res.status(200).json(logs);
  } catch (error) {
    console.error('Failed to fetch quiz logs:', error);
    return res.status(500).json({ message: 'ログの取得に失敗しました。' });
  }
});

app.post('/api/generate-question', requireAdminAuth, aiRateLimiter, async (req, res) => {
  try {
    const word = String(req.body?.word || '').trim();
    const context = req.body?.context || {};

    if (!word) {
      return res.status(400).json({ message: '正解の単語(word)が必要です。' });
    }

    const promptText = `
    以下の日本語（またはオノマトペ）を正解とする、日本語学習者向けの穴埋めクイズを作成してください。
    出力は必ず以下のJSONフォーマットのみにしてください（Markdownブロックや余計なテキストは不要です）。
    
    ターゲット単語: ${word}

    【現在の入力状況（Context）】
    以下のデータはユーザーが既に入力済みの内容です。
    この内容を維持・活かしつつ、全体の整合性が取れるように**空欄（nullまたは空文字列）の部分のみ**を生成して埋めてください。
    既に値が入っている項目は、そのまま同じ内容を出力するか、あるいは出力から省略しても構いません。
    
    ${JSON.stringify(context, null, 2)}
    
    【期待する出力JSONフォーマット】
    {
      "prompt": "【この状況に合う言葉は？】などの短い設問文",
      "sentence": "ターゲット単語の位置を（　　）とした例文",
      "choices": ["不正解の選択肢1", "不正解の選択肢2"],
      "explanation": "なぜその単語が正解なのかのわかりやすい解説",
      "others": [
        { "usage": "不正解の選択肢1の意味や使われる状況", "example": "不正解の選択肢1の例文" },
        { "usage": "不正解の選択肢2の意味や使われる状況", "example": "不正解の選択肢2の例文" }
      ]
    }
    
     ध्यान：
    - sentence には必ず「（　　）」を含め、そこに入るのが「${word}」であること。
    - choices には、「${word}」とは異なるが、似たような品詞や状況の単語を2つ用意すること。
    `;

    let text = '';
    const provider = req.body?.provider || 'gemini';

    if (provider === 'qwen') {
      const dashscopeKey = process.env.DASHSCOPE_API_KEY;
      if (!dashscopeKey) throw new Error('DASHSCOPE_API_KEYが設定されていません。');

      // Node.js 18+ built-in fetch
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
      text = data.choices?.[0]?.message?.content || '';

    } else {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: promptText,
      });
      text = response.text || '';
    }

    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const generated = JSON.parse(text);
      return res.status(200).json(generated);
    } catch (e) {
      console.error("Failed to parse Gemini response", text);
      return res.status(500).json({ message: 'AIの応答の解析に失敗しました。' });
    }

  } catch (error) {
    console.error("AI Generation Error", error);
    return res.status(500).json({ message: 'AIの生成に失敗しました。', error: error.message });
  }
});

app.post('/api/generate-image', requireAdminAuth, aiRateLimiter, async (req, res) => {
  try {
    const context = req.body?.context || {};

    // 1. Text to Text prompt engineering
    const textPrompt = `
You are an expert prompt engineer for an image generation AI.
Your task is to write a short, highly-detailed English visual description to generate an image for a Japanese language quiz.
The style must strictly be a "simple illustration with soft, slightly irregular thick outlines (drawn with brown or dark gray colored pencil/crayon - NEVER stark black), colored with a very light, thin pastel watercolor wash and muted colors".

CRITICAL RULES:
1. NO TEXT OR TYPOGRAPHY: The image must absolutely NOT contain any words, letters, characters, alphabets, or text of any kind.
2. AESTHETIC STYLE: Force the aesthetic to be exactly: "thick but soft-colored (brown or gray) slightly broken outlines, thin pastel watercolor wash, muted pastel colors, simple background". absolutely NO harsh black outlines.
3. STRICT REALISTIC PHYSICS & LOGIC: You must strictly obey ALL natural physical laws. Gravity exists (objects cannot float in mid-air unless they are balloons). Light, shadow, and environment interaction must be logical.
4. PROPORTIONS & WEATHER LOGIC: Ensure relative sizes of objects and animals are natural (a cat MUST be smaller than a human). If it is raining/snowing, characters MUST rationally react: either OUTSIDE using an umbrella/raincoat, OR INDOORS viewing from a window. NEVER draw a character standing dry in the rain without an umbrella.
5. NO BORDERS OR FRAMES: You must explicitly append the exact keywords "borderless, no frame, full bleed canvas, edge-to-edge" to the end of your generated prompt. The illustration must fill the entire image naturally without any decorative frames, colored borders, polaroid edges, white canvas margins, or sketchbook rings.
6. ENGLISH OUTPUT ONLY: Output ONLY the final English prompt, nothing else. Do not use markdown blocks.

Context for the scene:
${context.sentence ? `Scene description: ${context.sentence.replace('（　　）', context.correct || '')}` : ''}
${context.explanation ? `Explanation/Nuance: ${context.explanation}` : ''}
${context.correct ? `Key concept to illustrate the mood (do not write this word in the image): ${context.correct}` : ''}
${context.additionalPrompt ? `\nUSER'S SPECIAL REFINEMENT REQUEST: "${context.additionalPrompt}"\n=> You MUST strictly incorporate this specific request into the final image prompt while still obeying all previously mentioned critical rules.` : ''}

Write the image generation prompt in English now:
`;

    let optimizedPrompt = '';
    const provider = req.body?.provider || 'gemini';

    if (provider === 'qwen') {
      const dashscopeKey = process.env.DASHSCOPE_API_KEY;
      if (!dashscopeKey) throw new Error('DASHSCOPE_API_KEYが設定されていません。');

      // Prompt Engineering via Qwen
      const qwenTextRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${dashscopeKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'qwen-plus',
          messages: [{ role: 'user', content: textPrompt }]
        })
      });
      if (!qwenTextRes.ok) throw new Error(`Qwen Text API Error: ${qwenTextRes.status}`);
      const textData = await qwenTextRes.json();
      optimizedPrompt = textData.choices?.[0]?.message?.content || '';
      optimizedPrompt = optimizedPrompt.replace(/```[a-z]*\n?/g, '').replace(/```\n?/g, '').trim();
      if (!optimizedPrompt) optimizedPrompt = "A cute watercolor illustration of a child holding an umbrella in the rain. No text.";

      // Text to Image via Wanx
      const wanxRes = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
        method: 'POST',
        headers: {
          'X-DashScope-Async': 'enable',
          'Authorization': `Bearer ${dashscopeKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'wanx2.0-t2i-turbo',
          input: { prompt: optimizedPrompt },
          parameters: {
            size: '1024*768',
            n: 1
          }
        })
      });

      if (!wanxRes.ok) {
        const errText = await wanxRes.text();
        throw new Error(`Wanx API Request Error: ${errText}`);
      }
      const wanxInitData = await wanxRes.json();
      const taskId = wanxInitData.output?.task_id;
      if (!taskId) throw new Error('Failed to get Wanx task ID');

      // Poll for completion
      let taskUrl = '';
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        const pollRes = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
          headers: { 'Authorization': `Bearer ${dashscopeKey}` }
        });
        const pollData = await pollRes.json();
        const status = pollData.output?.task_status;
        if (status === 'SUCCEEDED') {
          taskUrl = pollData.output?.results?.[0]?.url;
          break;
        } else if (status === 'FAILED' || status === 'UNKNOWN') {
          throw new Error(`Wanx API Task Failed: ${pollData.output?.message || 'Unknown error'}`);
        }
      }

      if (!taskUrl) throw new Error("Wanx Timeout");

      // Download the image buffer
      const imgRes = await fetch(taskUrl);
      const imgBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(imgBuffer);

      // Save to public/images/gen/
      const filename = `${crypto.randomUUID()}.jpeg`;
      const filepath = path.join(genImagesDir, filename);
      fs.writeFileSync(filepath, buffer);

      return res.status(200).json({ imageUrl: `/images/gen/${filename}` });

    } else {
      // GEMINI PROVIDER
      const textResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: textPrompt
      });

      optimizedPrompt = textResponse.text || '';
      optimizedPrompt = optimizedPrompt.replace(/```[a-z]*\n?/g, '').replace(/```\n?/g, '').trim();

      if (!optimizedPrompt) {
        optimizedPrompt = "A cute watercolor illustration of a child holding an umbrella in the rain. No text.";
      }

      // 2. Text to Image
      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: optimizedPrompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: '4:3'
        }
      });

      if (!response || !response.generatedImages || response.generatedImages.length === 0) {
        throw new Error("画像が生成されませんでした。");
      }

      const base64Image = response.generatedImages[0].image.imageBytes;
      const buffer = Buffer.from(base64Image, 'base64');

      // Save to public/images/gen/
      const filename = `${crypto.randomUUID()}.jpeg`;
      const filepath = path.join(genImagesDir, filename);
      fs.writeFileSync(filepath, buffer);

      const imageUrl = `/images/gen/${filename}`;
      return res.status(200).json({ imageUrl });
    }

  } catch (error) {
    console.error("AI Image Generation Error", error);
    return res.status(500).json({ message: '画像生成に失敗しました。', error: error.message });
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

app.listen(port, () => {
  console.log(`日本語クイズ app listening on http://localhost:${port}`);
});
