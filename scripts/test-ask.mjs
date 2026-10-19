// Local end-to-end test for api/ask.js
// Runs the real Vercel handler with a mock req/res.
//
// Usage: node scripts/test-ask.mjs ["question" ...]

import { fileURLToPath } from "url";
import path from "path";

// Load repo-root .env (GEMINI_API_KEY, FIRECRAWL_API_KEY) for local runs.
// On Vercel the vars come from the project settings instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  // no .env file - rely on process env
}

const { default: handler } = await import("../api/ask.js");

const defaultQuestions = [
  "What are the working hours of the clinic?",
  "Who are the doctors and what are their specializations?",
  "How does root canal treatment work and how long does it take?",
  "Where is the clinic located?",
  "How much do braces cost?", // not in KB -> should decline
];

const questions = process.argv.slice(2).length
  ? process.argv.slice(2)
  : defaultQuestions;

for (const question of questions) {
  const req = { method: "POST", body: { question } };
  let out = null;
  let code = null;
  const res = {
    status(c) {
      code = c;
      return this;
    },
    json(d) {
      out = d;
      return this;
    },
  };

  const started = Date.now();
  await handler(req, res);
  const ms = Date.now() - started;

  console.log("=".repeat(70));
  console.log(`Q: ${question}`);
  console.log(`[HTTP ${code}, ${ms} ms]`);
  console.log(`A: ${out.answer}`);
  if (out.sources && out.sources.length) {
    console.log(
      "Sources: " +
        out.sources.map((s) => `${s.title} (${s.score.toFixed(3)})`).join(" | ")
    );
  }
  console.log("");
}
