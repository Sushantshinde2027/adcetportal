# ADCET Portal — Simple AI Assistant (RAG)

The **ADCET portal** (React + Vite) with a **simple RAG chatbot** as its AI
assistant: scrape → chunk → embed → hybrid retrieve → grounded answer.

| Stage | How it works |
| --- | --- |
| Scrape | **Firecrawl** scrapes the 8 portal pages (`scripts/ingest.mjs`) |
| Chunk | Markdown sections packed into ~1100-char knowledge blocks (`page_N_chunk_M`) |
| Embeddings | **`gemini-embedding-001` — 3072 dimensions** (query + documents) |
| Retrieval | Hybrid: `semantic×0.45 + keyword×0.25 + category×0.30`, top 5 |
| Generation | **Gemini flash** (`gemini-3.6-flash`, automatic fallback `gemini-3.5-flash-lite`) |
| Web app | Vercel serverless function `POST /api/ask` |

The React frontend (ADCET pages, navbar, chat widget) is unchanged — the widget
calls `POST /api/ask` with `{ "question": "..." }` and receives
`{ "answer": "...", "sources": [...] }`.

## Setup

```bash
npm install
cp .env.example .env    # then fill in your keys
```

`.env`:

```
GEMINI_API_KEY=your-gemini-key
FIRECRAWL_API_KEY=your-firecrawl-key
```

Both keys are read **only** from environment variables / `.env` (gitignored) —
never from committed source.

## Build the knowledge index

```bash
npm run ingest
```

Scrapes `https://adcetportal.vercel.app/` (home, about, faculty, courses,
notices, admissions, contact, faq) with Firecrawl, chunks the markdown,
embeds every chunk with `gemini-embedding-001` @ 3072 dims, and writes
`api/vectors.json`. Rerun whenever the portal content changes.

## Run

```bash
npm run dev           # local dev server (Vite)
npm run test:bot      # end-to-end test of api/ask.js with sample questions
npm run build         # production build
node scripts/debug-scores.mjs "your query"   # inspect retrieval rankings
```

## Deploy (Vercel)

1. This repo is on GitHub: `Sushantshinde2027/adcetportal`
2. Import it in Vercel — the Vite build + `api/` serverless functions are
   detected automatically (`vercel.json` handles the SPA rewrites).
3. In **Project Settings → Environment Variables** add:
   - `GEMINI_API_KEY`
   - `FIRECRAWL_API_KEY` (only needed if you rerun `npm run ingest`)
4. Deploy. The chat widget calls `POST /api/ask` on the same origin.

## API

`POST /api/ask`

```json
{ "question": "Where is ADCET located?" }
```

```json
{
  "answer": "ADCET is located in Ashta, Dist. Sangli, Maharashtra - 416 301.",
  "sources": [
    { "chunk_id": "page_7_chunk_0", "source_url": "https://adcetportal.vercel.app/contact", "score": 0.845 }
  ]
}
```

Answering rules: use only retrieved context, never invent fees/dates/contact
details, decline with "I don't have that information in the college knowledge
base." when the index lacks the answer, and never mention chunks/embeddings/RAG.

## Project structure

```
api/ask.js           # RAG handler: Gemini embed -> hybrid retrieve -> Gemini answer
api/vectors.json     # portal knowledge index (gemini-embedding-001, 3072-dim)
scripts/ingest.mjs   # Firecrawl scrape -> chunk -> Gemini embed
scripts/test-ask.mjs # end-to-end test of the handler
scripts/debug-scores.mjs # retrieval ranking inspector
data/                # raw page markdown + chunked knowledge blocks
src/                 # React frontend (ADCET portal, unchanged)
vercel.json          # SPA + API rewrites
```
