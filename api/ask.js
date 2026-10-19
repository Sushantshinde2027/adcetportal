import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// ============================================================
// CHOUGULE DENTAL RAG BOT
// Ported from the Chougule-RAG project (rag_chatbot.py +
// retriever.py) to a Vercel serverless function.
// - Embeddings: gemini-embedding-001 (3072 dimensions)
// - Generation: Gemini flash models (Ollama replaced)
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(path.join(__dirname, "vectors.json"), "utf-8")
);

const EMBED_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=";
const EMBED_MODEL = "models/gemini-embedding-001";

// Primary first; automatic fallback when the primary is unavailable.
const GEN_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite"];
const GEN_TIMEOUT_MS = 20000;

// Normalized document embeddings (same as rag_chatbot.py's
// embedding_matrix / np.linalg.norm(..., axis=1)).
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function normalize(v) {
  const n = norm(v) || 1;
  return v.map((x) => x / n);
}

const docVectors = vectors.map((v) => ({
  ...v,
  normalized: normalize(v.embedding),
}));

// ============================================================
// KEYWORD SCORE (rag_chatbot.py)
// ============================================================

function words(text) {
  return new Set(text.toLowerCase().match(/[a-zA-Z0-9]+/g) || []);
}

function keywordScore(query, content) {
  const queryWords = words(query);
  if (queryWords.size === 0) return 0.0;

  const contentWords = words(content);

  let matched = 0;
  for (const w of queryWords) {
    if (contentWords.has(w)) matched++;
  }

  return matched / queryWords.size;
}

// ============================================================
// CATEGORY DETECTION (rag_chatbot.py)
// ============================================================

const CATEGORY_KEYWORDS = {
  working: [
    "working hours",
    "opening hours",
    "clinic hours",
    "timing",
    "timings",
    "open",
    "close",
  ],
  contact: ["contact", "phone", "mobile", "email", "call"],
  address: ["address", "location", "where", "located"],
  doctor: ["doctor", "orthodontist", "dentist", "specialist"],
  service: [
    "treatment",
    "service",
    "procedure",
    "root canal",
    "implant",
    "braces",
    "extraction",
    "whitening",
  ],
};

const CATEGORY_TITLES = {
  working: "working hours",
  contact: "contact information",
  address: "clinic address",
  doctor: "doctors",
  service: "services",
};

function categoryScore(query, title) {
  const q = query.toLowerCase();
  const t = title.toLowerCase();

  for (const category of Object.keys(CATEGORY_KEYWORDS)) {
    if (CATEGORY_KEYWORDS[category].some((word) => q.includes(word))) {
      if (t.includes(CATEGORY_TITLES[category])) return 1.5;
    }
  }

  return 0.0;
}

// ============================================================
// HYBRID RETRIEVAL (rag_chatbot.py retrieve())
// score = semantic * 0.45 + keyword * 0.25 + category * 0.30
// ============================================================

function retrieve(query, queryNormalized, topK = 3) {
  const results = docVectors.map((v) => {
    const semantic = dot(queryNormalized, v.normalized);
    const keyword = keywordScore(query, v.content);
    const category = categoryScore(query, v.title);

    const score = semantic * 0.45 + keyword * 0.25 + category * 0.3;

    return {
      chunk_id: v.chunk_id,
      title: v.title,
      content: v.content,
      score,
      semantic_score: semantic,
      keyword_score: keyword,
      category_score: category,
    };
  });

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, topK);
}

// ============================================================
// ANSWER GENERATION (rag_chatbot.py generate_answer prompt,
// Gemini replaces Ollama llama3.2)
// ============================================================

const ANSWER_PROMPT = `You are the AI assistant for Chougule Multispeciality Dental Clinic.

Answer the user's question using ONLY the information provided
in the context below.

IMPORTANT RULES:

1. Do not invent information.
2. Do not guess prices, timings, treatments or contact details.
3. If the answer is not available in the context, clearly say:
   "I don't have that information in the clinic knowledge base."
4. Give a direct and concise answer.
5. For medical questions, provide general information from the
   knowledge base and recommend consulting the dentist when
   appropriate.
6. Do not mention "chunks", "embeddings", "retrieval", or RAG.

CONTEXT:
{context}

USER QUESTION:
{question}

ANSWER:`;

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function generateWithFallback(apiKey, prompt) {
  let lastError = new Error("no model attempted");
  for (const model of GEN_MODELS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEN_TIMEOUT_MS);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: controller.signal,
        }
      );
      clearTimeout(timer);
      if (!res.ok) {
        lastError = new Error(`${model} HTTP ${res.status}`);
        console.warn(`generate failed (${lastError.message}), trying fallback`);
        continue;
      }
      const data = await res.json();
      const text =
        (data.candidates &&
          data.candidates[0] &&
          data.candidates[0].content &&
          data.candidates[0].content.parts
            .map((p) => p.text || "")
            .join("")) ||
        "";
      if (text.trim()) return text.trim();
      lastError = new Error(`${model} returned empty text`);
      console.warn(`generate empty (${model}), trying fallback`);
    } catch (e) {
      lastError = e;
      console.warn(`generate error (${model}): ${e.message || e}, trying fallback`);
    }
  }
  throw lastError;
}

// ============================================================
// HANDLER
// ============================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ answer: "Method not allowed", sources: [] });
  }

  const question = ((req.body && req.body.question) || "").toString().trim();
  if (!question) {
    return res
      .status(400)
      .json({ answer: "Please enter a question.", sources: [] });
  }

  try {
    const key = process.env.GEMINI_API_KEY;

    // Query embedding: gemini-embedding-001, 3072 dimensions
    const embedData = await postJSON(EMBED_URL + key, {
      model: EMBED_MODEL,
      content: { parts: [{ text: question }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 3072,
    });
    const q = normalize(embedData.embedding.values);

    // Hybrid retrieval (top 3, same as the original bot)
    const top = retrieve(question, q, 3);

    // Build context exactly like rag_chatbot.py:
    // "[{title}]\n{content}" joined with blank lines
    const context = top
      .map((r) => `[${r.title}]\n${r.content}`)
      .join("\n\n");

    const prompt = ANSWER_PROMPT.replace("{context}", context).replace(
      "{question}",
      question
    );

    const answer = await generateWithFallback(key, prompt);

    return res.status(200).json({
      answer,
      sources: top.map((r) => ({
        chunk_id: r.chunk_id,
        title: r.title,
        score: r.score,
      })),
    });
  } catch (e) {
    console.error("ask error:", e.message || e);
    return res.status(200).json({
      answer:
        "Sorry, the AI service is temporarily unavailable. Please try again later.",
      sources: [],
    });
  }
}
