// ============================================================
// ADCET PORTAL - INGESTION PIPELINE
//
// scrape portal pages (Firecrawl) -> chunk by markdown headings
//   -> embed (gemini-embedding-001, 3072 dims) -> api/vectors.json
//
// Usage:
//   node scripts/ingest.mjs
//
// Required env (or a .env file in the repo root):
//   GEMINI_API_KEY    - Google Gemini API key
//   FIRECRAWL_API_KEY - Firecrawl API key
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_VECTORS = path.join(ROOT, "api", "vectors.json");
const OUTPUT_CHUNKS = path.join(DATA_DIR, "chunks.json");
const OUTPUT_RAW = path.join(DATA_DIR, "website_content.md");

// ---- env --------------------------------------------------

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // no .env file - rely on process env
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY is not set.");
  process.exit(1);
}
if (!FIRECRAWL_API_KEY) {
  console.error("ERROR: FIRECRAWL_API_KEY is not set.");
  process.exit(1);
}

const BASE_URL = "https://adcetportal.vercel.app";
const PAGES = [
  "/",
  "/about",
  "/faculty",
  "/courses",
  "/notices",
  "/admissions",
  "/contact",
  "/faq",
];

const EMBED_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// 1. SCRAPE (Firecrawl)
// ============================================================

async function scrapePage(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });

    const data = await res.json();
    if (data.success && data.data && data.data.markdown) {
      return data.data.markdown;
    }

    lastError = JSON.stringify(data).slice(0, 300);
    await sleep(1000 * attempt);
  }

  throw new Error(`Firecrawl scrape failed for ${url}: ${lastError}`);
}

async function scrape() {
  console.log(`[1/3] Scraping ${PAGES.length} portal pages with Firecrawl...`);

  const pages = [];
  for (const p of PAGES) {
    const url = BASE_URL + p;
    const markdown = await scrapePage(url);
    pages.push({ path: p, url, markdown });
    console.log(`      ${url} -> ${markdown.length} chars`);
    await sleep(300);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(
    OUTPUT_RAW,
    pages.map((pg) => `<!-- ${pg.url} -->\n${pg.markdown}`).join("\n\n"),
    "utf-8"
  );

  return pages;
}

// ============================================================
// 2. CHUNK (split each page on markdown headings, same style as
//    the original portal knowledge index: page_N_chunk_M)
// ============================================================

function chunkPages(pages) {
  console.log("[2/3] Chunking by headings...");

  const chunks = [];

  pages.forEach((pg, pageIndex) => {
    const lines = pg.markdown.split("\n");
    const sections = [];
    let current = [];

    for (const line of lines) {
      if (/^#{1,6}\s+/.test(line)) {
        if (current.length) sections.push(current);
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length) sections.push(current);

    // Pack sections into ~1100-char knowledge blocks so lists
    // (branches, faculty of a department, placement stats, notices)
    // stay together in one retrievable chunk - same granularity as
    // the original portal knowledge index.
    const merged = [];
    let block = "";
    for (const raw of sections) {
      const s = raw.join("\n").trim();
      if (!s) continue;
      if (block && block.length >= 1100) {
        merged.push(block);
        block = "";
      }
      block = block ? block + "\n\n" + s : s;
    }
    if (block) merged.push(block);

    let chunkIndex = 0;
    for (const text of merged) {
      if (!text.trim()) continue;

      // keep the index readable: skip micro-fragments (single emoji /
      // stray symbols) but keep everything with real content
      const letters = (text.match(/[a-zA-Z]/g) || []).length;
      if (letters < 3 && !/https?:\/\//.test(text)) continue;

      // very large sections: split on blank lines so embeddings stay
      // well within the model's input limit
      const pieces =
        text.length > 6000
          ? text.split(/\n\s*\n(?=(?:#|[^*]))/g).filter(Boolean)
          : [text];

      for (const piece of pieces) {
        if (!piece.trim()) continue;
        chunks.push({
          id: `page_${pageIndex + 1}_chunk_${chunkIndex}`,
          text: piece.trim(),
          source_url: pg.url,
        });
        chunkIndex++;
      }
    }
  });

  writeFileSync(OUTPUT_CHUNKS, JSON.stringify(chunks, null, 2), "utf-8");
  console.log(`      ${chunks.length} chunks -> data/chunks.json`);

  return chunks;
}

// ============================================================
// 3. EMBED (gemini-embedding-001, 3072 dims)
// ============================================================

async function embed(text, taskType) {
  const res = await fetch(EMBED_URL + GEMINI_API_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: 3072,
    }),
  });

  if (!res.ok) {
    throw new Error(`embedContent HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.embedding.values;
}

async function embedAll(chunks) {
  console.log("[3/3] Embedding with gemini-embedding-001 (3072 dims)...");

  const out = [];

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    let attempts = 0;
    let values = null;

    while (!values && attempts < 3) {
      try {
        values = await embed(c.text, "RETRIEVAL_DOCUMENT");
      } catch (e) {
        attempts++;
        console.warn(`      retry ${attempts} for ${c.id}: ${e.message}`);
        await sleep(1000 * attempts);
      }
    }

    if (!values) throw new Error(`Failed to embed ${c.id}`);

    out.push({
      ...c,
      // round to 6 decimals - cosine similarity unaffected in practice,
      // file stays small
      embedding: values.map((v) => Number(v.toFixed(6))),
    });

    if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
      console.log(`      embedded ${i + 1}/${chunks.length}`);
    }
    await sleep(120); // stay well under rate limits
  }

  return out;
}

// ============================================================
// MAIN
// ============================================================

console.log("================================================");
console.log("   ADCET PORTAL - INGESTION PIPELINE");
console.log("================================================\n");

try {
  const pages = await scrape();
  const chunks = chunkPages(pages);
  const vectors = await embedAll(chunks);

  writeFileSync(OUTPUT_VECTORS, JSON.stringify(vectors), "utf-8");

  const size = readFileSync(OUTPUT_VECTORS).length;
  console.log(`\nWrote api/vectors.json (${(size / 1024).toFixed(0)} KB)`);
  console.log("\nStatus: INGESTION COMPLETE");
  console.log("================================================");
} catch (e) {
  console.error("\nINGESTION FAILED:", e.message || e);
  process.exit(1);
}
