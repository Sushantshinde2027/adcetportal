# Chougule Dental AI — RAG Chatbot Portal

The **ADCET portal frontend** (React + Vite) with the **Chougule Multispeciality
Dental Clinic RAG chatbot** running as the AI assistant. The original
`Chougule-RAG` project (Flask + Ollama + sentence-transformers) has been ported
to a serverless stack:

| Stage | Original (Chougule-RAG) | This app |
| --- | --- | --- |
| Scrape | Playwright + BeautifulSoup | **Firecrawl** (`FIRECRAWL_API_KEY`) |
| Clean | `clean_data.py` (structured KB) | `scripts/ingest.mjs` (same curated KB) |
| Chunk | `chunk_data.py` | `scripts/ingest.mjs` (same section split, same chunk IDs) |
| Embeddings | `all-MiniLM-L6-v2` (384-dim) | **`gemini-embedding-001` (3072-dim)** |
| Retrieval | hybrid semantic 0.45 + keyword 0.25 + category 0.30 | identical (ported to JS) |
| Generation | Ollama `llama3.2` | **Gemini flash** (`gemini-3.6-flash`, fallback `gemini-3.5-flash-lite`) |
| Web app | Flask `/ask` | Vercel serverless `POST /api/ask` |

The React frontend (ADCET pages, navbar, chat widget) is unchanged — it calls
`POST /api/ask` with `{ "question": "..." }` and receives
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

## Build the knowledge base

```bash
npm run ingest
```

This scrapes `https://chouguledentalclinic1.pages.dev/` with Firecrawl
(reference copy saved to `data/website_content.md`), builds the structured
knowledge base, chunks it (`data/chunks.json`), embeds every chunk with
`gemini-embedding-001` at 3072 dimensions, and writes `api/vectors.json`.

## Run

```bash
npm run dev        # local dev server (Vite)
npm run test:bot   # end-to-end test of api/ask.js with sample questions
npm run build      # production build
```

## Deploy (Vercel)

1. Push this repo to GitHub.
2. Import the repo in Vercel → the Vite build + `api/` serverless functions are
   detected automatically (`vercel.json` handles the SPA rewrites).
3. In **Project Settings → Environment Variables** add:
   - `GEMINI_API_KEY`
   - `FIRECRAWL_API_KEY` (only needed if you rerun `npm run ingest` in CI)
4. Deploy. The chat widget calls `POST /api/ask` on the same origin.

## API

`POST /api/ask`

```json
{ "question": "What are the working hours?" }
```

Response:

```json
{
  "answer": "Monday to Saturday: 9:30 AM - 2:00 PM, 4:30 PM - 9:00 PM. Sunday: Closed.",
  "sources": [
    { "chunk_id": "chunk_006", "title": "WORKING HOURS", "score": 0.773 }
  ]
}
```

## Project structure

```
api/ask.js          # RAG handler: Gemini embed -> hybrid retrieve -> Gemini answer
api/vectors.json    # 13 chunks with gemini-embedding-001 (3072-dim) vectors
scripts/ingest.mjs  # Firecrawl scrape -> clean -> chunk -> Gemini embed
scripts/test-ask.mjs# local end-to-end test of the handler
data/               # raw scrape + chunked knowledge base
src/                # React frontend (ADCET portal)
vercel.json         # SPA + API rewrites
```
