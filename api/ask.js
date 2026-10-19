import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// ============================================================
// ADCET PORTAL - SIMPLE RAG BOT
//
// Built the same way as the Chougule-RAG dental bot:
//   embed query -> hybrid retrieval (semantic + keyword + category)
//   -> grounded prompt -> LLM answer
// but with ADCET knowledge, Gemini embeddings/generation, and
// no AKLM system.
//
// - Embeddings: gemini-embedding-001 (3072 dimensions)
// - Generation: Gemini flash models
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

// ============================================================
// VECTOR MATH
// ============================================================

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

// Derive a section title from a chunk: first markdown heading
// in the opening lines, otherwise the page path from the URL.
function deriveTitle(text, sourceUrl) {
  const head = text.slice(0, 800);
  const m = head.match(/^\s*#{1,6}\s+(.+)$/m);
  if (m) return m[1].replace(/[*_`]/g, "").trim();
  try {
    const p = new URL(sourceUrl).pathname;
    if (p && p !== "/") return p.replace(/^\//, "");
  } catch {
    // ignore bad URLs
  }
  return "";
}

const docVectors = vectors.map((v) => ({
  ...v,
  title: deriveTitle(v.text || "", v.source_url || ""),
  normalized: normalize(v.embedding),
}));

// ============================================================
// KEYWORD SCORE (same as rag_chatbot.py)
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
// CATEGORY DETECTION
// (same pattern as the dental bot: query hits a category and
// the chunk's title/heading or page marks that category -> 1.5)
// ============================================================

const CATEGORIES = {
  admission: {
    keywords: [
      "admission",
      "admissions",
      "apply",
      "application",
      "eligibility",
      "cap",
      "cet",
      "entrance",
    ],
    url: "admission",
    headings: ["admission", "apply"],
  },
  courses: {
    keywords: [
      "course",
      "courses",
      "branch",
      "branches",
      "program",
      "programs",
      "department",
      "b.tech",
      "m.tech",
      "syllabus",
    ],
    url: "course",
    headings: ["program", "course", "branch", "department"],
  },
  faculty: {
    keywords: ["faculty", "professor", "prof", "hod", "teacher", "staff"],
    url: "faculty",
    headings: ["faculty", "professor", "head of department"],
  },
  placement: {
    keywords: [
      "placement",
      "placements",
      "recruiter",
      "recruiters",
      "package",
      "job",
      "jobs",
      "campus drive",
      "training",
    ],
    url: "placement",
    headings: ["placement", "recruiter", "training"],
  },
  contact: {
    keywords: ["contact", "phone", "mobile", "email", "call", "number"],
    url: "contact",
    headings: ["contact", "phone", "email"],
  },
  address: {
    keywords: ["address", "location", "located", "where", "directions", "reach"],
    url: "contact",
    headings: ["address", "location", "reach us"],
  },
  facilities: {
    keywords: [
      "hostel",
      "bus",
      "library",
      "lab",
      "laboratory",
      "facilities",
      "facility",
      "gym",
      "canteen",
      "sports",
    ],
    url: "facilit",
    headings: ["facilit", "hostel", "library", "transport", "campus"],
  },
  accreditation: {
    keywords: [
      "naac",
      "nba",
      "aicte",
      "autonomous",
      "accredited",
      "accreditation",
      "affiliated",
      "affiliation",
      "approved",
      "approval",
      "ranking",
    ],
    url: "about",
    headings: ["naac", "aicte", "autonomous", "accredit", "approv", "affiliat"],
  },
};

function categoryScore(query, title, sourceUrl) {
  const q = query.toLowerCase();
  const url = (sourceUrl || "").toLowerCase();
  const t = (title || "").toLowerCase();

  for (const cat of Object.values(CATEGORIES)) {
    if (!cat.keywords.some((k) => q.includes(k))) continue;

    const urlMatch = cat.url && url.includes(cat.url);
    const headingMatch = t && cat.headings.some((h) => t.includes(h));

    if (urlMatch || headingMatch) return 1.5;
  }

  return 0.0;
}

// ============================================================
// HYBRID RETRIEVAL
// score = semantic * 0.45 + keyword * 0.25 + category * 0.30
// (same weights as the dental bot)
// ============================================================

function retrieve(query, queryNormalized, topK = 5) {
  const results = docVectors.map((v) => {
    const semantic = dot(queryNormalized, v.normalized);
    const keyword = keywordScore(query, v.text);
    const category = categoryScore(query, v.title, v.source_url);

    const score = semantic * 0.45 + keyword * 0.25 + category * 0.3;

    return {
      chunk_id: v.id,
      title: v.title,
      source_url: v.source_url,
      text: v.text,
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
// ANSWER GENERATION
// (same simple grounded-prompt style as the dental bot,
// written for ADCET - no AKLM)
// ============================================================

const ANSWER_PROMPT = `You are the AI assistant for ADCET - Annasaheb Dange
College of Engineering and Technology, Ashta.

Answer the user's question using ONLY the information provided
in the context below.

IMPORTANT RULES:

1. Do not invent information.
2. Do not guess fees, dates, cutoffs, timings or contact details.
3. If the answer is not available in the context, clearly say:
   "I don't have that information in the college knowledge base."
4. Give a direct and concise answer.
5. For admission-related questions, answer from the context and
   suggest checking the official college website (www.adcet.ac.in)
   or contacting the college office when appropriate.
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

export { retrieve, docVectors };

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

    // Hybrid retrieval (top 5 across the small page-section chunks)
    const top = retrieve(question, q, 5);

    // Context like the original bot: "[title]\ncontent"
    const context = top
      .map((r) => `[${r.title || r.source_url}]\n${r.text}`)
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
        source_url: r.source_url,
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
