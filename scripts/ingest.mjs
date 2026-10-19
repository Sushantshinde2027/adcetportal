// ============================================================
// CHOUGULE DENTAL - INGESTION PIPELINE
//
// scrape (Firecrawl) -> clean (structured knowledge base)
//   -> chunk -> embed (gemini-embedding-001, 3072 dims)
//   -> api/vectors.json
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

const SITE_URL = "https://chouguledentalclinic1.pages.dev/";
const EMBED_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=";

// ============================================================
// 1. SCRAPE (Firecrawl replaces the original Playwright scrape)
// ============================================================

function fixMojibake(text) {
  // utf-8 bytes misdecoded as cp1252 ("â€“" style) and as latin/greek
  // ("ΓÇö" style, seen in Firecrawl output), same idea as clean_data.py
  const replacements = [
    ["â€“", "–"],
    ["â€”", "—"],
    ["â€˜", "‘"],
    ["â€™", "’"],
    ["â€œ", "“"],
    ["â€", "”"],
    ["Â©", "©"],
    ["Â", ""],
    ["ΓÇô", "–"],
    ["ΓÇö", "–"],
    ["ΓÇÖ", "—"],
    ["ΓÇ¢", "—"],
    ["ΓÇÖ", "”"],
    ["ΓÇù", "’"],
    ["ΓÇ£", "‘"],
    ["ΓÇ¥", "”"],
    ["ΓÇØ", "‘"],
  ];

  let out = text;
  for (const [old, next] of replacements) {
    out = out.split(old).join(next);
  }
  return out;
}

async function scrape() {
  console.log("[1/4] Scraping site with Firecrawl...");
  console.log("      " + SITE_URL);

  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url: SITE_URL,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  });

  const data = await res.json();
  if (!data.success) {
    throw new Error(
      "Firecrawl scrape failed: " + JSON.stringify(data).slice(0, 300)
    );
  }

  const markdown = fixMojibake(data.data.markdown || "");
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(OUTPUT_RAW, markdown, "utf-8");
  console.log(`      saved ${markdown.length} chars -> data/website_content.md`);

  return markdown;
}

// ============================================================
// 2. CLEAN - structured knowledge base
//    (ported verbatim from Chougule-RAG/clean_data.py; the
//    original also ignores the raw scrape and uses this
//    curated text, so the knowledge base stays identical)
// ============================================================

function clean() {
  console.log("[2/4] Building structured knowledge base...");

  const cleanedText = `
CHOUGULE MULTISPECIALITY DENTAL CLINIC

CLINIC OVERVIEW

Chougule Multispeciality Dental Clinic is a dental clinic located in Ashta, Sangli, Maharashtra.
The clinic provides advanced, painless and affordable dental care.
The clinic focuses on modern technology, hygiene and compassionate patient care.
The clinic provides dental treatment for children, teenagers and adults.

DOCTORS

Dr. Rohit Chougule
Qualification: BDS, MDS (Orthodontics)
Specialization: Orthodontics and Dentofacial Orthopaedics
He provides advanced teeth alignment, braces and bite correction treatments.

Dr. Pranagha Chougule
Qualification: BDS, MDS (Endodontics)
Specialization: Endodontics
She provides root canal treatments and comprehensive restorative dental care.

SERVICES

1. Root Canal Treatment

Advanced root canal therapy using modern rotary techniques and digital apex locators.
Treatment duration: approximately 60-90 minutes.
Treatment is performed under local anaesthesia.
Rotary endodontics is used for precision and speed.
A digital apex locator is used for accuracy.
Same-day crown placement may be available.
The treatment aims to preserve the natural tooth structure.
Root canal treatment is performed by Dr. Pranagha Chougule, MDS Endodontics.

2. Dental Implants

Dental implants provide permanent, natural-looking tooth replacement using titanium precision implants.
Patients can consult the clinic regarding implant treatment and replacement options.

3. Braces and Orthodontics

The clinic provides metal braces, ceramic braces and clear aligner options.
Treatment duration is approximately 12-24 months.
Invisible clear aligners are available.
Damon self-ligating braces are available as an option.
Retainers are provided after treatment.
Treatment plans are available for children, teenagers and adults.
Braces and orthodontic treatment are performed by Dr. Rohit Chougule, MDS Orthodontics.

4. Teeth Cleaning and Whitening

The clinic provides professional scaling, polishing and teeth whitening.
The treatment is intended to improve dental hygiene and provide a brighter smile.

5. Tooth Extraction

The clinic provides safe and comfortable tooth extraction procedures.
Treatment duration is approximately 20-45 minutes.
Both simple and surgical extractions are performed.
Wisdom tooth removal is available.
Advanced anaesthesia is used to minimize discomfort.
Post-operative care and recovery guidance are provided.
Same-day replacement options may be discussed.

6. Smile Designing

The clinic provides cosmetic smile designing using veneers and composite materials.

ABOUT THE CLINIC

The clinic emphasizes:
- Painless procedures
- Affordable pricing
- ISO hygienic standards
- Emergency care
- Modern dental technology
- Digital X-ray
- Rotary endodontics
- Autoclave sterilization
- Compassionate patient care

The clinic states that it has more than 5 years of experience.

WORKING HOURS

Monday to Saturday:
9:30 AM - 2:00 PM
4:30 PM - 9:00 PM

Sunday:
Closed

APPOINTMENT INFORMATION

Appointments are available for dental services including:
- Root Canal Treatment
- Dental Implants
- Braces and Orthodontics
- Teeth Cleaning and Whitening
- Tooth Extraction
- Smile Designing
- General Checkup
- Other dental services

Available appointment slots include morning and evening timings between 9:30 AM and 8:30 PM, subject to availability.

CONTACT INFORMATION

Phone: +91 73500 75545
Email: chouguledentalclinic5@gmail.com

CLINIC ADDRESS

Chougule Multispeciality Dental Clinic
First Floor, above DCC Bank (Jilha Madhyawarti Bank),
near Chandu Wadapav, Amruta Awati,
Ashta, Sangli, Maharashtra - 416301.

The clinic is located above DCC Bank in Ashta, Sangli.

CERTIFICATIONS

Dr. Rohit Chougule:
Master of Dental Surgery (MDS)
Orthodontics and Dentofacial Orthopaedics - MUHS, Nashik
Certified 2021

Dr. Pranagha Chougule:
Master of Dental Surgery (MDS)
Endodontics - specialized training in advanced root canal procedures
Certified 2021

CLINIC FACILITIES

The website describes:
- Doctor consultation area
- Advanced dental treatment setup
- Modern dental equipment
- Reception and welcome area
- Clinic interior and hygiene
- Premium treatment room

WHY CHOOSE THE CLINIC

The clinic highlights:
- MDS specialist doctors
- Modern dental facility
- Digital X-ray
- Rotary endodontics
- Autoclave sterilization
- Affordable dental care
- Painless treatment
- Flexible morning and evening hours

PATIENT REVIEWS

The website displays patient reviews describing:
- Professional and caring doctors
- Clean and modern clinic
- Painless root canal treatment
- Friendly staff
- Teeth whitening results
- Dental implant treatment
- Braces treatment
- Modern equipment
- Good hygiene standards
- Affordable treatment

Important:
Patient reviews are website-provided testimonials and should not be treated as independent medical evidence.

IMPORTANT DATA NOTE

The raw website contains some inconsistent or corrupted numerical statistics.
Examples include different Google review counts and broken zero-value counters.
These inconsistent values have intentionally been excluded from this cleaned knowledge base rather than guessing which value is correct.
`;

  const cleaned = cleanedText.trim();
  console.log(`      ${cleaned.length} chars of curated knowledge`);
  return cleaned;
}

// ============================================================
// 3. CHUNK (ported from Chougule-RAG/chunk_data.py)
// ============================================================

function chunk(cleanedText) {
  console.log("[3/4] Chunking...");

  const sections = cleanedText.split(/\n(?=[A-Z][A-Z\s]+(?:\n|$))/);

  const chunks = [];
  let index = 0;

  for (const rawSection of sections) {
    const section = rawSection.trim();
    if (!section) continue;

    index += 1;

    const lines = section.split("\n");
    const title = lines[0].trim();
    const content = lines
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l)
      .join("\n");

    // Skip title-only sections (e.g. the clinic name header)
    if (!content) continue;

    chunks.push({
      chunk_id: `chunk_${String(index).padStart(3, "0")}`,
      title,
      content,
      source: "Chougule Dental Clinic Website",
    });
  }

  writeFileSync(OUTPUT_CHUNKS, JSON.stringify(chunks, null, 4), "utf-8");
  console.log(`      ${chunks.length} chunks -> data/chunks.json`);
  for (const c of chunks) console.log(`      ${c.chunk_id} -> ${c.title}`);

  return chunks;
}

// ============================================================
// 4. EMBED (gemini-embedding-001, 3072 dims)
// ============================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  console.log("[4/4] Embedding with gemini-embedding-001 (3072 dims)...");

  const out = [];

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    let attempts = 0;
    let values = null;

    while (!values && attempts < 3) {
      try {
        values = await embed(c.content, "RETRIEVAL_DOCUMENT");
      } catch (e) {
        attempts++;
        console.warn(`      retry ${attempts} for ${c.chunk_id}: ${e.message}`);
        await sleep(1000 * attempts);
      }
    }

    if (!values) throw new Error(`Failed to embed ${c.chunk_id}`);

    out.push({
      ...c,
      // round to 6 decimals - keeps cosine similarity identical for
      // practical purposes while keeping the file small
      embedding: values.map((v) => Number(v.toFixed(6))),
    });

    console.log(`      embedded ${i + 1}/${chunks.length} (${c.chunk_id})`);
    await sleep(150); // stay well under rate limits
  }

  return out;
}

// ============================================================
// MAIN
// ============================================================

console.log("================================================");
console.log("   CHOUGULE DENTAL - INGESTION PIPELINE");
console.log("================================================\n");

try {
  await scrape();
  const cleaned = clean();
  const chunks = chunk(cleaned);
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
