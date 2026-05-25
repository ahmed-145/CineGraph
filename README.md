# CineGraph

> Discover films through semantic intersection. Find the exact point in cinema that sits between *Whiplash*, *Parasite*, and *Amélie* — simultaneously.

![status](https://img.shields.io/badge/status-v1-blueviolet?style=flat-square)
![axes](https://img.shields.io/badge/embedding-3--axis%20(text%20%2B%20vibe%20%2B%20visual)-00FFD1?style=flat-square)
![films](https://img.shields.io/badge/films-10%2C003-FF00A8?style=flat-square)
![stack](https://img.shields.io/badge/stack-React%20%2B%20FastAPI%20%2B%20Qdrant-0080ff?style=flat-square)
![cost](https://img.shields.io/badge/AI%20API%20cost-%240%2Fmo-22c55e?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)

---

## The pitch

Every film platform suffers from the same two failures:

1. **List-based interfaces.** Film relationships are spatial, not sequential. A ranked list destroys the topology.
2. **OR-based, single-seed recommendations.** You can't ask Letterboxd for "something like Whiplash *and* Parasite *and* Amélie." Their filters aggregate; they never intersect.

CineGraph is an **Obsidian-style canvas of cinema**. You summon a film as a star. You expand it — semantically similar films bloom radially around it. You point at two stars, and the canvas computes the true semantic **AND** of both — a late-fusion vector intersection across three independent embedding axes (**metadata + vibe + visual**) — and renders the films that live in the dark space between them.

It's not a feed. It's not a list. It's a living graph you navigate with your curiosity.

---

## Three-axis embedding

Every film is embedded along three independent semantic axes, then concatenated into one 2048-dim vector stored in Qdrant.

| Axis | Captures | Model | Dim |
|---|---|---|---|
| **1. Metadata** | *What* the film is about — plot, genres, director, cast, keywords | `BAAI/bge-base-en-v1.5` | 768 |
| **2. Vibe** | *How* the film feels — slow-burn, hallucinatory, cozy, claustrophobic | `BAAI/bge-base-en-v1.5` on cleaned reviews | 768 |
| **3. Visual** | Color palette, cinematographic mood — dark/desaturated vs warm/vibrant | `clip-ViT-B-32` on poster | 512 |
| **Combined** | | | **2048** |

The vibe axis is the secret sauce. A pure metadata engine flags both *Blade Runner 2049* and *The Matrix* as "Sci-Fi Action" and calls it a day. The vibe axis sees that one is a melancholic slow-burn and the other is a kinetic mind-bender. Genre tags are topology-blind — vibe captures what they can't.

**Vibe pipeline (per film):**
```
TMDB reviews → NER scrubbing (spaCy) → cinematic stopword strip →
~512-token chunking → BGE embed → mean-pool → L2-normalize
```

NER scrubbing matters: without it, "James Bond" and "Marvel" act as gravitational black holes in vector space, clustering films by franchise instead of feel. Stripping proper nouns forces the model to cluster on pure atmosphere.

Films with thin reviews (< 80 cleaned tokens) fall back to a zero-vector for that slice and a `confident: false` flag — graceful degradation rather than misleading clustering.

---

## What you can do

### Explore Canvas
- **Summon** any film by name with autocomplete-search across 10,003 indexed films + lazy-embed for the long tail
- **Expand** a film → 10 nearest neighbors bloom radially around it; expand them too; walk through the graph node by node
- **Add as seed** → mode shifts to intersection: the canvas re-centers between your seeds, dims context films, draws cyan/magenta flowing edges, and converges result films in the midpoint zone with a conic-gradient ring (matching the squint test — you can tell intersect from expand from across the room)
- **Up to 5 seeds** with rate-limited weight sliders (drag to bias the AND toward one film over another)
- **Why it's here** — Groq-generated one-sentence explanation per intersection result, cached after first generation
- **Soft cap protection** — at 75 nodes a save-prompt toast appears; at 100 the oldest non-seed, non-recent node fades out (restorable from an archive pill)

### Personalization
- **Watchlist** — bookmark films for later; gold star appears on the canvas node
- **Never show again** — permanent per-film exclusion; the film won't return in any future expand or intersect, regardless of how strong the similarity. Reset from a counter pill.
- **Per-seed weight slider** — drag to bias intersection toward one seed
- **3-step onboarding tooltips** — gently guide you from first summon → first expand → first intersect → save

### Sessions
- **Constellation save / load / share** — a constellation is a named canvas state (nodes, positions, seeds, results). Save as many as you want; load instantly; share a read-only frozen-view link without auth.
- **Auto-resume** — last active constellation reloads on sign-in
- **Auth** — Supabase email + Google OAuth, JWT-protected backend routes

### Visual language
- True OLED black canvas with ambient deterministic starfield + intersection-mode radial fog
- Dark ember orb nodes (mood-tinted radial gradients) with optional poster overlay
- Curved bezier intersect edges with flowing dash animation in seed color (cyan to seed 1, magenta to seed 2)
- 64-segment conic-gradient ring on intersection results
- Hover-intent (700ms) reveals a 140×210 poster card with affordances and metadata; cancels on drag
- Spring-locked physics — drag a seed/root and it re-anchors; drag a result and it floats free for neighbors to react to
- Inter + JetBrains Mono throughout; no glow that doesn't earn its keep

---

## Tech stack

| Layer | Tech | Cost |
|---|---|---|
| Frontend | React 18 + Vite, `react-force-graph-2d`, d3-force | $0 |
| Backend | FastAPI (Python) | $0 |
| Vector DB | Qdrant (10k vectors × 2048d, cosine similarity) | $0 free tier |
| Auth + Postgres | Supabase | $0 free tier |
| Metadata embed | `BAAI/bge-base-en-v1.5` via `fastembed` | $0 |
| Vibe embed | `BAAI/bge-base-en-v1.5` on review text | $0 |
| Visual embed | `Qdrant/clip-ViT-B-32-vision` | $0 |
| NER scrubbing | spaCy `en_core_web_lg` (optional, regex fallback) | $0 |
| Film metadata | TMDB API | $0 |
| Review data | TMDB reviews (RT Kaggle / HuggingFace / Stanford / Ebert pluggable) | $0 |
| LLM explanations | Groq `llama-3.3-70b-versatile` (cached) | $0 |

**Total recurring AI cost: $0/month.** All models self-hosted, all datasets free, Groq cached. Infrastructure cost is ~$5–20/mo at V1 scale.

---

## Getting started

### Prerequisites
- Python 3.11+
- Node 18+
- [Qdrant](https://qdrant.tech/documentation/quick-start/) running locally: `docker run -p 6333:6333 qdrant/qdrant`
- TMDB API key — [free](https://www.themoviedb.org/settings/api)
- Groq API key — [free](https://console.groq.com)
- Supabase project — [free tier](https://supabase.com)

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Fill in TMDB_API_KEY, GROQ_API_KEY, SUPABASE_JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY

# 1. Build the Phase-1 collection (text + visual, ~10k films, ~30 min)
python ingest.py

# 2. (Optional but recommended) Install spaCy for proper NER scrubbing
pip install spacy
python -m spacy download en_core_web_lg

# 3. Build the Phase-2 vibe axis on top of Phase-1 (~3h for 10k films, resumable)
python ingest_vibe.py

# 4. Start the API
uvicorn main:app --reload --port 8000
```

On startup, the backend auto-detects which collection is available:
- `films_v2` present → 3-axis runtime (`text + vibe + visual`)
- only `films_phase1` → 2-axis fallback (`text + visual`)

The `/health` endpoint reports the active mode.

### Frontend

```bash
cd frontend
npm install

cp .env.example .env.local
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Database schema (Supabase)

```sql
create table constellations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  name        text not null,
  data        jsonb not null,
  share_token text unique,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table constellations enable row level security;

create policy "owner access" on constellations
  for all using (auth.uid() = user_id);

create policy "share read" on constellations
  for select using (share_token is not null);
```

---

## Project structure

```
CineGraph/
├── backend/
│   ├── main.py             # FastAPI app, all endpoints
│   ├── ingest.py           # TMDB → bge text + CLIP visual → Qdrant v1
│   ├── ingest_vibe.py      # v1 → v2 backfill with vibe axis (idempotent)
│   ├── vibe.py             # TMDB review fetch + NER scrub + chunk + embed
│   ├── config.py           # Settings from .env
│   ├── auth.py             # Supabase JWT verification
│   ├── constellations.py   # Save / load / share endpoints
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.jsx                    # Root layout, hover card, onboarding
│       ├── App.css                    # Single-file styles
│       ├── api.js                     # Backend fetch wrapper
│       ├── components/
│       │   ├── Canvas.jsx             # react-force-graph-2d renderer
│       │   ├── SearchBar.jsx          # Film search + lazy embed
│       │   ├── DetailPanel.jsx        # Node detail + watchlist + exclude
│       │   ├── HUD.jsx                # Mode chip + seed pills + weight sliders
│       │   ├── SaveBar.jsx            # Single-icon avatar menu
│       │   ├── AuthModal.jsx          # Sign in / sign up
│       │   └── FrozenView.jsx         # Read-only shared constellation render
│       └── hooks/
│           ├── useGraph.js            # All graph state + CRUD + intersect
│           ├── useAuth.js             # Supabase auth
│           ├── useConstellations.js   # Save/load/share
│           └── usePreferences.js      # localStorage: watchlist, excluded, onboarding
└── docker-compose.yml      # Qdrant + backend together
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Active collection, embedding dim, axes |
| GET | `/search?q=` | Search films (indexed + TMDB fallback) |
| POST | `/expand` | N nearest neighbors of a film (with exclusion list) |
| POST | `/intersect` | Multi-seed semantic AND with per-seed weights and exclusion list |
| POST | `/explain` | Groq-generated "why this film is here" sentence (cached) |
| GET | `/film/{tmdb_id}` | Full payload for a single film |
| GET | `/watch_providers/{tmdb_id}` | Streaming availability (TMDB) |
| POST | `/lazy_embed/{tmdb_id}` | Embed a cold-miss film on demand (~2s) |
| GET / POST / DELETE | `/constellations` | Save / list / delete constellations |
| GET | `/constellations/share/{token}` | Read-only frozen-view public link |

---

## Design system

Built with the **OLED dark + glassmorphism + neon intersection** language:
- True dark base `#0a0a0a` with a subtle deterministic starfield (110 stars, fixed seed)
- Teal `#00FFD1` and magenta `#FF00A8` as the two-seed signature; gold `#FFD66B` reserved for watchlist accents
- Inter for body and UI, JetBrains Mono for telemetry / metadata / counters
- Backdrop-blurred glass on chrome surfaces (`rgba(20,20,20,0.75)` + `backdrop-filter: blur(10px)`)
- Canvas-2D rendering with `ctx.shadowBlur` for mood-color halos and conic-gradient ring approximation via 64 arc segments
- 700ms hover-intent before the poster card materializes; cancels instantly on drag

---

## Roadmap

**Shipped (V1 core):**
- Three-axis embeddings (text + vibe + visual)
- 10k film index with lazy-embed for the long tail
- Multi-seed intersection, expand, snapshot share
- Watchlist + permanent exclusion + per-seed weight sliders
- Onboarding tooltips, auto-load last constellation
- Supabase email + Google auth, constellation save/load/share

**Next (V1 finishing):**
- Upgrade to `bge-large-en-v1.5` for both text and vibe (1024d × 2 → 2560d combined per PRD)
- TF-IDF amplification in the vibe pipeline
- Add cascading review sources: RT Kaggle, HuggingFace `frankier/processed_multiscale_rt_critics`, Stanford IMDB, Roger Ebert archive
- Scale to 50k films
- Letterboxd CSV import + scraping pipeline (watched markers, rating-weighted seeds)
- Library View (Leiden two-pass clustering, pre-computed positions, LOD rendering)
- Taste Profile Dashboard (top clusters, blind-spot detection, Twitter-card export)

**V2:**
- Social graph overlay, taste compatibility index between users
- Mobile-optimized view
- Live collaborative constellations
- Taste drift tracker, user archetype clustering
- Sparse Autoencoder vibe disentanglement (turn off "genre" dimensions, isolate pure style)

---

## License

MIT — use it, fork it, build on it.
