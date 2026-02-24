require('dotenv').config({ path: ['.env.local', '.env'] });
const { GoogleGenAI } = require('@google/genai');

async function run() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY });
    const response = await ai.models.list();
    for await (const model of response) {
      if (model.name.includes("imagen") || model.name.includes("image")) {
        console.log(model.name);
      }
    }
  } catch (e) {
    console.error(e);
  }
}
run();
