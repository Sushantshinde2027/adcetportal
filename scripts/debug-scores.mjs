// Debug: print full retrieval rankings for a query (no LLM call)
// Usage: node scripts/debug-scores.mjs "your query"

import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  // no .env
}

const { retrieve, docVectors } = await import("../api/ask.js");

const query =
  process.argv.slice(2).join(" ") || "Which B.Tech branches are available at ADCET?";

const res = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=" +
    process.env.GEMINI_API_KEY,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text: query }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 3072,
    }),
  }
);
const data = await res.json();
if (!data.embedding) {
  console.error("embed failed:", JSON.stringify(data).slice(0, 300));
  process.exit(1);
}
const v = data.embedding.values;
const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
const q = v.map((x) => x / n);

console.log(`Query: ${query}\n`);
const ranked = retrieve(query, q, docVectors.length);
ranked.forEach((r, i) => {
  const mark = i === 5 ? "  <-- top-5 cutoff" : "";
  console.log(
    `${String(i + 1).padStart(2)}. ${r.score.toFixed(4)} ` +
      `(sem ${r.semantic_score.toFixed(3)} kw ${r.keyword_score.toFixed(3)} cat ${r.category_score.toFixed(2)}) ` +
      `${r.chunk_id} ${r.source_url.replace("https://adcetportal.vercel.app", "")}${mark}`
  );
  const first = r.text.split("\n").find((l) => l.trim());
  console.log(`      ${(first || "").slice(0, 80)}`);
});
