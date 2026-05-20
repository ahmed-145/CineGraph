# CineGraph

> Discover films through semantic intersection. Find the exact point in cinema that sits between *Whiplash*, *Parasite*, and *Amélie* — simultaneously.

![CineGraph](https://img.shields.io/badge/status-v1--beta-blueviolet?style=flat-square) ![Stack](https://img.shields.io/badge/stack-React%20%2B%20FastAPI%20%2B%20Qdrant-0080ff?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

---

## What is it?

CineGraph is an Obsidian-style film discovery canvas. You start with a blank dark space and a search bar. You drop a film, expand it, watch semantically similar films bloom around it. Add a second seed — the canvas shifts into **intersection mode**, computing the true semantic AND of both seeds and highlighting films that live at that exact crossover.

No lists. No star filters. No "because you watched X". A **living graph** you navigate with your curiosity.

---

## Why it's different

Every major platform (Letterboxd, IMDb, Taste.io) has the same two failures:

1. **List-based, linear interfaces** — film relationships are spatial, not sequential. Forcing them into a ranked list destroys the topology.
2. **Single-seed OR-based recommendations** — you can't say "I want something like X *and* Y *and* Z". No platform computes multi-seed semantic AND.

CineGraph solves both. It uses late-fusion vector intersection across multimodal embeddings to find the exact point in taste-space you're describing.

---

## Features

- **Semantic graph canvas** — nodes are films, edges are similarity. Drag, explore, rearrange.
- **Multi-seed intersection** — add up to 5 seeds, see their semantic AND highlighted on the canvas.
- **One-click expand** — any node blooms 12 similar films around it with physics-based layout.
- **Elastic group drag** — dragging a seed pulls its expanded cluster along with spring physics.
- **AI explanations** — "Why is this film here?" answered by Groq LLM for any intersection result.
- **Streaming availability** — TMDB watch providers shown in the detail panel.
- **Genre filter** — click any genre tag to dim everything else on the canvas.
- **Constellation save/load/share** — save your exploration graphs, load them back, share a link.
- **Auth** — Supabase email + Google OAuth.

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite, `react-force-graph-2d`, d3-force |
| Backend | FastAPI (Python), fastembed, Qdrant |
| Database | Supabase (Postgres + Auth) |
| Embeddings | `BAAI/bge-small-en-v1.5` via fastembed |
| Vector store | Qdrant (local or cloud) |
| Film data | TMDB API |
| AI explanations | Groq (llama-3) |

---

## Getting started

### Prerequisites

- Python 3.11+
- Node 18+
- [Qdrant](https://qdrant.tech/documentation/quick-start/) running locally (`docker run -p 6333:6333 qdrant/qdrant`)
- TMDB API key — [get one free](https://www.themoviedb.org/settings/api)
- Groq API key — [get one free](https://console.groq.com)
- Supabase project — [free tier](https://supabase.com)

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Fill in TMDB_API_KEY, GROQ_API_KEY, SUPABASE_JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY

# Ingest films into Qdrant (seeds ~500 films, takes a few minutes)
python ingest.py

uvicorn main:app --reload --port 8000
```

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

Run this in your Supabase SQL editor:

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
│   ├── main.py          # FastAPI app, all endpoints
│   ├── ingest.py        # TMDB → fastembed → Qdrant pipeline
│   ├── config.py        # Settings from .env
│   ├── auth.py          # Supabase JWT verification
│   ├── constellations.py# Save/load/share logic
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.jsx          # Root layout + state
│       ├── App.css          # All styles (OLED dark + glassmorphism + aurora)
│       ├── api.js           # Backend fetch wrapper
│       ├── components/
│       │   ├── Canvas.jsx       # react-force-graph-2d renderer
│       │   ├── SearchBar.jsx    # Film search + lazy embed
│       │   ├── DetailPanel.jsx  # Node detail + AI explain
│       │   ├── HUD.jsx          # Mode chip + seed pills
│       │   ├── SaveBar.jsx      # Constellation save/load/share
│       │   └── AuthModal.jsx    # Sign in / sign up
│       └── hooks/
│           ├── useGraph.js      # All graph state + CRUD
│           ├── useAuth.js       # Supabase auth
│           └── useConstellations.js
└── docker-compose.yml   # Qdrant + backend together
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/search?q=` | Search films (indexed + TMDB fallback) |
| GET | `/expand/{tmdb_id}` | Get N similar films for a node |
| POST | `/intersect` | Multi-seed semantic AND |
| GET | `/explain/{tmdb_id}?seeds=` | Groq explanation |
| GET | `/watch-providers/{tmdb_id}` | Streaming availability |
| POST | `/lazy-embed/{tmdb_id}` | Index a film on demand |
| GET/POST/DELETE | `/constellations` | Save/load/delete graphs |
| GET | `/constellations/share/{token}` | Public share link |

---

## Design

Built with the **OLED Dark + Glassmorphism + Aurora UI** design system:
- True OLED black base (`#000005`)
- Electric blue (`#0080ff`) + plasma purple (`#bf00ff`) + magenta (`#ff00aa`) neon palette
- Playfair Display serif for film titles and logo
- Animated aurora mesh gradients in background
- `backdrop-filter: blur(20px)` frosted glass on all chrome surfaces
- Canvas seed nodes with neon `shadowBlur` glow rings

---

## License

MIT — use it, fork it, build on it.
