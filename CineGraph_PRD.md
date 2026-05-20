# CineGraph — Product Requirements Document
**Version:** 1.0  
**Status:** Draft  
**Author:** [Your Name]  
**Last Updated:** May 2026

---

## 1. Executive Summary

CineGraph is a web-based film discovery tool built around an **Obsidian-style exploration canvas**. The user starts with a blank, dark canvas and a search bar. They type a film, it lands as a single node. They click "expand" and similar films bloom around it. They add a second seed and the canvas shifts into **intersection mode** — finding films that sit at the semantic AND of both seeds. The user builds their own constellation, one node at a time, in any direction their curiosity pulls.

This solves the fundamental problem no existing platform has cracked: *"What film sits exactly between Whiplash, Parasite, and a rom-com simultaneously?"* — without forcing the user through a CSV import gate or burying them under 1,200 pre-rendered nodes.

Unlike Letterboxd, IMDb, or any existing recommendation engine, CineGraph does not return items similar to one film. It computes the true semantic AND of multiple inputs — not a Boolean OR filter, not a simple average, but a late-fusion vector intersection across multimodal embeddings — and renders that math as a living, spatial graph.

**V1 scope:** Open the site, search any film, expand it, intersect it with others. Optional Letterboxd import enriches the experience (marks watched films, weights rankings by your ratings, unlocks a secondary "Library View" of your full taste map) but is never required to use the product.

---

## 2. Problem Statement

### 2.1 What Existing Tools Fail At

Every major platform — Letterboxd, IMDb, Taste.io, Reelgood — suffers from the same two architectural failures:

**Failure 1: List-based, linear interfaces.**  
Film relationships are fundamentally non-linear. A film connects to others through director, mood, pacing, cinematography, theme, era, and a dozen other axes simultaneously. Forcing this into a ranked list destroys the topology. Users cannot see, feel, or explore the actual shape of cinema.

**Failure 2: Single-seed, OR-based recommendations.**  
Every existing recommendation says: "You liked X, here are things like X." Users cannot say "I want something like X *and* Y *and* Z." Letterboxd's filters are Boolean OR — they aggregate all dramas and all comedies, never isolating the intersection. No platform computes multi-seed semantic AND.

### 2.2 The User's Actual Mental Model

When a dedicated film watcher tries to find something new, their mental model is spatial, not sequential. They think: *"I'm in the mood for something with Whiplash's intensity, Parasite's dark social commentary, and just enough warmth to not crush me."* They are describing a **point in a high-dimensional taste space**. No tool gives them this. CineGraph does.

### 2.3 Validated Market Gap

Community analysis across r/Letterboxd, r/movies, and r/trakt confirms:
- Users are deeply frustrated that filters act as OR, not AND
- Users want to exclude entire genres/tropes permanently ("I will never watch this")  
- Users want to *see* their taste profile visually, not just receive a list
- No tool with a graph/node visualization of film similarity exists in the consumer market
- The closest analog (Movie-Map / Gnoosic) is text-only, single-seed, and completely lacks rich metadata or interaction

---

## 3. Target Users

### Primary: The Dedicated Cinephile
- Maintains a meticulous Letterboxd diary (100–2000+ films logged)
- Actively seeks films outside algorithmic mainstream bubbles
- Frustrated by "If you liked Monsters Inc., you'll like Grave of the Fireflies" absurdities
- High technical literacy; will tolerate a CSV import step for the payoff
- Shares taste profiles, lists, and discoveries publicly

### Secondary: The Data-Driven Explorer
- Treats their watch history as a personal dataset
- Interested in the *shape* of their own taste (what clusters emerge? what's missing?)
- Wants to understand *why* two films are similar, not just that they are

### Non-Target (V1)
- Users who want a finished, dashboard-style recommendation feed with no interaction
- Mobile-first users who need Library View (the dashboard mode); Explore Canvas works on touch with a degraded HUD, but Library View's 1,000+ node physics requires desktop in V1

---

## 4. Product Vision

> CineGraph is a blank canvas of cinema. You summon a film and it appears as a star. You ask "what's near it?" and a constellation blooms. You point at two stars and CineGraph finds the dark space between them — where unseen films are waiting. The graph is never finished. It grows wherever your curiosity goes.

---

## 5. Core Features — V1

### 5.1 The Explore Canvas (Primary Experience)

**What the user sees on first load:**  
A dark, empty canvas. A single search bar centered, with placeholder text: *"Start with any film."* No CSV upload, no signup wall, no taste-map dashboard. Just an invitation.

**The summoning loop:**
1. User types "Whiplash" → autocomplete dropdown queries the global TMDB-indexed film database
2. User selects → the node materializes in the center of the canvas — circular poster thumbnail with title underneath
3. The node has two affordances on hover: **Expand** (radiating arrow icon) and **Add as seed** (overlapping-circles icon)
4. The search bar persists at the top so the user can summon any film into the canvas at any time
5. Every node the user touches becomes anchored — the canvas remembers everything in this session

**Why this is the entry point, not Library View:**  
Friction-free start. The product is playable in five seconds. The graph stays legible because it only ever contains what the user explicitly summoned or expanded into. This is the Obsidian metaphor: notes (films) appear when you reference them, not before.

**Session persistence:**  
The canvas state (which nodes are present, their positions, which are seeds, which were expanded) is saved per user and per "constellation." A user can have many named constellations ("Late night sci-fi," "Movies I'd show my dad"). Anonymous sessions persist in localStorage; signed-in sessions sync to Postgres.

**Soft cap (canvas drift protection):**
- At **75 nodes** on the canvas, a non-blocking toast appears: *"Canvas is getting busy — save this as a constellation?"* The user can dismiss or save; no nodes are touched.
- At **100 nodes**, the oldest auto-fade-eligible node fades out over 800ms and is removed from the canvas. A small "+1 archived" pill appears in the HUD; clicking it restores the most recently faded node. The pill collapses old archives into a count after 5.
- **Never auto-faded:** active seeds, watched-marked films (for signed-in users with Letterboxd connected), and any node the user has interacted with (clicked, hovered, expanded, or that was returned as an intersection result) in the last 60 seconds.
- Auto-fade order: oldest "last touched" timestamp first.

---

### 5.2 Expand — Single-Seed Neighborhood Bloom

**What it does:**  
Reveals what lives near one film in vector space. This is the "show me more like this" primitive.

**Interaction:**
1. User hovers a node → Expand affordance appears
2. User clicks Expand → backend runs a top-K (default 10) nearest-neighbor query against the global Qdrant index, with the user's exclusion list and (optionally) already-on-canvas films filtered out
3. Results bloom **radially outward** from the parent node — clean spokes, equal angular spacing
4. Each new node is connected to the parent with a thin, solid white-gray edge
5. Animation: 300ms ease-out — fast, "spreading" feel
6. Expanded children can themselves be expanded, allowing the user to walk through the graph node by node

**Re-expanding:** Clicking Expand on the same node a second time fetches the *next* 10 (offset by 10), so the user can drill deeper without duplicates.

**Mental model:** *Gravity around one star.*

---

### 5.3 Intersect — Multi-Seed Semantic AND

**What it does:**  
The core differentiator. User marks 2–5 films as seeds. CineGraph finds films that sit at the semantic AND of all of them.

**Interaction flow:**
1. User clicks "Add as seed" on a node → the node gets a colored pulsing halo (seed 1 = cyan)
2. User clicks "Add as seed" on a second node → halo color 2 = magenta. The canvas re-centers between the two seeds. Mode chip top-left flips from "Exploring [Whiplash]" to "Intersecting [Whiplash] × [Parasite]"
3. Any previously-expanded children of seed 1 fade to ~30% opacity (they remain as context but are no longer the focus)
4. The backend runs the late-fusion intersection algorithm (see Section 6.2)
5. Results fly in and settle in the **geometric midpoint zone between the two seeds**, not radiating from either
6. Each result has **two edges**: one cyan (to seed 1), one magenta (to seed 2). The result node itself has a **gradient ring** (cyan-to-magenta) — instant visual signal "I am a child of multiple parents"
7. Animation: 600ms ease-in-out — slower, "converging" feel
8. User can add seeds 3, 4, 5 (each narrowing further); halo color palette extends to yellow, green, orange
9. User can remove a seed by clicking its halo — intersection recalculates in real time
10. Each result shows: title, poster, per-seed similarity scores, and a one-sentence Claude-generated explanation of *why* it intersects (e.g., "Shares Whiplash's obsessive perfectionism and Parasite's class tension, with enough dark wit to bridge both"). Explanations are cached after first generation.

**Mental model:** *Two (or more) gravity wells meeting in the middle.*

**What the user can do with results:**
- Click "Add as seed" on a result to chain intersections (the result joins the seed set)
- Click "Expand" on a result to bloom *its* neighborhood (drops out of intersection mode back into exploration)
- Save the current canvas state as a named constellation
- Mark result films as "Want to Watch"
- Click "Exclude" on any result to add it to their permanent exclusion list

**Negative filtering (Exclusion Engine):**
- Right-click any node or result → "Never show me films like this"
- Exclusions are stored as Qdrant `Must Not` payload filters — applied globally to all future expand and intersect queries
- **Anonymous sessions:** exclusions persist in `localStorage` and are sent with each query as an inline filter. Migrating to a signed-in account merges localStorage exclusions into the user's Postgres record on first login.
- **Signed-in sessions:** exclusions persist in Postgres, scoped per user
- Exclusion manager in Settings lists all exclusions with the ability to remove them

---

### 5.4 Visual Language — Making Expand and Intersect Unmistakably Different

The two core mechanics (Expand and Intersect) must be perceptually distinct *the instant they happen*, or users will conflate them. This is enforced through a coordinated visual language across geometry, color, ring style, animation, and HUD state.

| Dimension | Expand | Intersect |
|---|---|---|
| Layout | Radial spokes from parent | Convergent — results settle between seeds |
| Edge style | Thin, solid, uniform gray/white | Glowing, two-toned (one edge per seed, colored to that seed's halo) |
| Result node ring | None (plain node) | Gradient ring mixing all seed halo colors |
| Seed marker | None — Expand has no "seed" | Pulsing colored halo per seed (cyan, magenta, yellow, green, orange) |
| Animation | ~300ms ease-out, fast spread | ~600ms ease-in-out, slow converge |
| Mode chip (HUD, top-left) | "Exploring [Title]" | "Intersecting [A] × [B] × …" |
| Canvas color cast | Neutral dark | Subtle radial gradient blending seed halo colors |
| Pre-existing children of seeds | Stay at full opacity | Fade to ~30% opacity |

**The mode-shift transition:**  
When the user adds a second seed (entering intersection mode), a single ~400ms transition runs: canvas re-centers between seeds, seed halos fade in, expanded children of seed 1 dim to 30%, the mode chip slides from "Exploring" to "Intersecting." This transition is the moment the user *learns* the two modes are different — it must always play, even on subsequent intersections.

**Squint test:** From across the room, with eyes squinted, a user must be able to tell which mode the canvas is in. Expand = one colored region. Intersect = two (or more) colored regions with an overlap zone where results live.

**Beyond 3 seeds:** Distinct halo colors cap at 5 (cyan, magenta, yellow, green, orange). Result node rings remain gradients of all active seed colors. Per-seed edges remain individually colored.

---

### 5.5 Film Detail Panel

Appears when clicking any node. Contains:
- High-res poster
- Title, year, director, runtime
- Genre tags (clickable — clicking highlights all similar-genre nodes in graph)
- Plot summary (2–3 sentences)
- User's rating and watch date(s)
- Rewatch count
- "Why it's here" — AI-generated sentence explaining its position in the user's graph
- Top 5 similar films within the user's graph (with similarity score)
- Top 5 similar films from global index the user hasn't seen (flagged as "Undiscovered")
- Streaming availability (via TMDB's watch providers endpoint)
- Link to Letterboxd page

---

### 5.6 Letterboxd Import — Optional Personalization Layer

**Framing:** Import is **not the entry point and not required**. It is offered as "Personalize your canvas" once a user has played with the product and signed up. The pitch is concrete: *"Connect your Letterboxd and CineGraph will mark films you've seen, weight rankings by your ratings, and unlock Library View."*

**Technical flow:**
1. User downloads CSV export from Letterboxd (Settings → Import & Export → Export Your Data)
2. User uploads `ratings.csv`, `watched.csv`, and/or `diary.csv` to CineGraph
3. Backend reads each row's Letterboxd URI field. **Per-file URI behavior:**
   - `ratings.csv` and `watched.csv`: URI points directly to the film page → scrape once
   - `diary.csv`: URI points to the *diary entry* page, not the film page → scraper must follow the diary entry page to find the film page link, then scrape the film page (one extra hop per diary row)
4. On the film page, scraper extracts the TMDB ID via **two independent paths**:
   - **Primary:** the hidden `data-tmdb-id` attribute on film page elements
   - **Fallback:** parse the `data-track-action="TMDb"` anchor and regex the TMDB ID out of its `href` (verify at implementation; treat as the resilience hedge against Letterboxd HTML changes)
   - **Last resort:** TMDB search API fuzzy match on title + year from the CSV
5. TMDB API is called with extracted ID to fetch: title, genres, plot summary, director, cast, release year, runtime, poster image, mood tags, and spoken language
6. Each film is embedded (see Section 6) and stored in Qdrant with full metadata payload, tagged with this user's ID and rating. **Globally cached:** a film's TMDB ID and embedding only need to be scraped/computed once across all users ever — subsequent users importing the same film hit the cache.

**Data integrity rules:**
- If `ratings.csv` and `diary.csv` conflict on a rating, `ratings.csv` wins (it reflects the user's current opinion)
- Films with no resolvable TMDB ID are flagged and shown to the user for manual resolution
- Duplicate diary entries (rewatches) are collapsed into one node; rewatch count stored as a payload field

**What import unlocks (the only behavioral changes):**
- **Watched-marker:** Any film already in the user's library renders with a subtle "watched" indicator (small filled dot in the corner of the poster) anywhere it appears in the canvas
- **Rating-weighted scoring:** When a watched film is used as a seed, its weight in the intersection score is scaled by the user's rating (5★ pulls harder than 2★)
- **Library View access (Section 5.7)**
- **Blind-spot detection** in the Taste Dashboard (Section 5.8)

**UX:**
- Import takes 30–120 seconds depending on library size; progress shown as a live counter ("Enriching 847 of 1,203 films…")
- User is returned to the Explore Canvas afterward (NOT dumped into a 1,200-node graph)
- Import can be re-run to sync new watches

---

### 5.7 Library View (Secondary Mode, Requires Import)

For users who *do* want the dashboard experience the original PRD described: a toggle in the top-right of the canvas flips into **Library View**. This is the full physics-driven render of every film in the user's Letterboxd library, with auto-clustering, the original visual encoding (node size = rating, brightness = recency, cluster halos with auto-generated labels), and pan/zoom/search.

Library View is for *reflection* on existing taste. Explore Canvas is for *discovery* of new films. A clear toggle and a different background tint (deep navy vs. pure black) keep the two modes distinct. Clicking a node in Library View can "send it to Explore" — i.e., drop it into the Explore Canvas as a starting seed.

**Performance strategy (critical at 1,000+ nodes):**
- **Pre-computed layout.** Force simulation runs once on the backend at import time; final node positions are persisted in Postgres. Client renders at fixed positions — no live physics by default. Physics re-engages only when the user adds or removes nodes, scoped to local relaxation, not a full re-simulate.
- **Level-of-detail rendering.** Zoomed out: nodes render as colored dots (cluster color). Zoomed in: poster thumbnails materialize. Avoids 1,000+ image decodes and texture uploads at initial render.
- **Edge culling by zoom.** Only edges above a similarity threshold render at zoom-out; weaker edges fade in as the user zooms in.
- **Target:** Library View initial render < 3 seconds for 1,000 nodes (matches Section 10 metric).

---

### 5.8 Shareable Constellation Snapshots — The Acquisition Loop

**What it does:**  
When a user saves a constellation, they get a public read-only URL (e.g., `cinegraph.app/c/whiplash-parasite-cmbyn-x7k2`). Anyone clicking it sees the exact canvas — same node positions, same seeds, same intersection results, same Claude explanations — in a frozen, non-interactive state. No login, no account, no Qdrant query at view time.

**Why this is V1, not V2:**  
This is the cheapest, highest-leverage viral mechanism the product can have. A user finds an interesting intersection of Whiplash + Parasite + Call Me By Your Name, shares the link in a r/Letterboxd thread, and dozens of cinephiles click through and see a working CineGraph canvas without ever signing up. Every shared constellation is an ad for the product. The implementation cost is small (one endpoint + a read-only renderer); the cost of leaving it out is the entire organic growth loop.

**Technical implementation:**
1. On "Save & Share," the backend serializes the constellation to a static JSON blob: `{nodes: [{tmdb_id, x, y, is_seed, seed_color, watched_marker}], edges: [{from, to, color, weight}], seeds: [...], intersection_results: [{tmdb_id, scores_per_seed, explanation}], metadata: {created_at, creator_handle?}}`
2. Blob is stored in Postgres (or S3 for larger ones) keyed by a short UUID slug
3. Public route `cinegraph.app/c/:slug` fetches the blob and renders the canvas in **frozen mode**: no physics simulation, no expand/intersect affordances, no search bar
4. CTAs on the frozen page: *"Start your own canvas"* (drops the viewer into an empty Explore Canvas) and *"Add this constellation to my account"* (signed-in users can fork it as an editable copy)
5. OpenGraph metadata renders a server-generated PNG of the constellation for rich link previews (Twitter/X, Discord, Reddit, iMessage)

**What snapshots intentionally do not do (V1):**
- No "live" sharing where the recipient sees real-time updates
- No comments or reactions on shared constellations
- No analytics visible to the creator beyond a basic view count

---

### 5.9 Taste Profile Dashboard

A separate view (not the graph, accessed via top-nav, requires Letterboxd import) summarizing the user's cinema fingerprint. Contains:
- Top 5 emergent taste clusters with names and example films
- Favorite directors, actors, cinematographers (by frequency and rating weight)
- Decade distribution chart
- Country of origin breakdown
- Rating curve visualization (the bell curve users love to share on Letterboxd)
- "Blind spots" — genres/eras heavily represented in the global graph but absent from the user's history
- Shareable as a static image (Twitter/X card format)

---

## 6. Technical Architecture

### 6.1 Embedding Pipeline

Each film is embedded along two axes and stored as a combined vector:

**Text embedding (thematic/narrative):**  
Model: `BAAI/bge-base-en-v1.5` (open source, sentence-transformers, runs locally — free)  
Input: Concatenated string of plot summary + genre tags + director name + top cast + mood descriptors + TMDB keywords  
Output: 768-dimensional dense vector  

**Visual embedding (cinematographic/aesthetic):** *(deferred — added in Phase 1+)*  
Model: `clip-ViT-B-32` (open source, HuggingFace)  
Input: Film poster image  
Output: 512-dimensional dense vector  

**Combined vector (Phase 1+):**  
Concatenated: `[text_vector | visual_vector]` = 1280-dimensional payload per film  
Stored in Qdrant with full metadata as filterable JSON payload fields.

**Phase 0 simplification:** Ship text-only (768-d) to validate the intersection math. CLIP visual embeddings join the pipeline once the gate question is answered.

**Why both?**  
A text-only embedding clusters films by narrative theme. A visual-only embedding clusters by aesthetic and color palette. Combining them captures both the *what* (story) and the *how* (look and feel) of a film — which is how humans actually experience cinema.

---

### 6.2 Multi-Seed Intersection Algorithm (Late Fusion)

Late fusion is used over early fusion (centroid averaging) because early fusion risks landing in empty vector space when seeds are stylistically disparate (e.g., Whiplash + a rom-com).

**Algorithm:**
1. For each seed film S₁…Sₙ, execute a parallel nearest-neighbor search in Qdrant, retrieving top K=50 candidates
2. Score every candidate film F against all seeds using cosine similarity:

```
Score(F) = Σ [wᵢ × CosSim(F, Sᵢ)] for i = 1 to n
```

Where weights wᵢ default to:
- **Equal (1.0 each)** for anonymous users and films the user has not rated
- **Rating-scaled** for signed-in users who have imported Letterboxd: `wᵢ = userRating(Sᵢ) / 5.0`, so a 5★ seed pulls full strength and a 2★ seed pulls 0.4× (a user is more interested in finding films like the ones they loved than the ones they merely watched)
- **User-overridable** via a per-seed weight slider in the HUD ("I want it to be MORE like Whiplash than Parasite")

3. Apply Qdrant payload filters: exclude films already watched (unless user opts in), exclude films in the user's exclusion list, optionally filter by decade/language/runtime
4. Sort by Score(F) descending
5. Return top 10–20 results with per-seed similarity breakdown

**LLM Explanation Layer:**  
For each result, a lightweight LLM call generates a one-sentence human-readable explanation of why this film intersects the seeds. Prompt uses the film's metadata + each seed's metadata as context. Cached after first generation.

---

### 6.3 Infrastructure Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | React + react-force-graph (WebGL/Three.js) | 60fps at 10,000+ nodes; stable; well-documented |
| Graph Physics | d3-force-3d | Industry standard force simulation |
| Vector Database | Qdrant (self-hosted via Docker; Qdrant Cloud later) | Lowest p95 latency (30–70ms); scalar quantization for cost; native payload filtering |
| Embedding - Text | `BAAI/bge-base-en-v1.5` via sentence-transformers (local, free) | Top-tier semantic capture (MTEB-leading), zero per-call cost, no rate limits |
| Embedding - Visual *(Phase 1+)* | CLIP ViT-B-32 (HuggingFace, local) | Open source; strong visual clustering; free |
| Backend API | FastAPI (Python) | Async; ideal for parallel Qdrant queries |
| Scraping Layer | Playwright or BeautifulSoup | Extract `data-tmdb-id` from Letterboxd HTML |
| Film Metadata | TMDB API (free tier) | Rich, standardized; used by Letterboxd itself |
| LLM Explanations | Llama 3.3 70B via Groq API (free tier: 30 req/min) | One-sentence intersection explanations; cached; fast inference; no cost |
| Hosting | Railway (backend) + Vercel (frontend) | Fast deployment; matches existing CI/CD setup |
| Auth | Clerk or Supabase Auth (free tiers) | Simple, fast to implement |
| User Data Storage | PostgreSQL (via Supabase free tier) | User accounts, saved lists, exclusions, watch states |

---

### 6.4 Data Flow Diagram

```
User uploads Letterboxd CSV
         │
         ▼
Parse CSV → extract Letterboxd URIs
         │
         ▼
Scraper hits each URI → extract data-tmdb-id from HTML
         │
         ▼
TMDB API → fetch rich metadata + poster image
         │
         ├──► Text embedding (plot + tags + crew)
         │
         └──► Visual embedding (poster via CLIP)
                         │
                         ▼
              Combined vector stored in Qdrant
              with metadata as filterable payload
                         │
                         ▼
              React frontend queries FastAPI
              FastAPI queries Qdrant
              Graph rendered via react-force-graph
```

---

### 6.5 Global Film Index — Scope and Lazy Embedding

**Decision:** Launch with a curated ~50,000-film seed index, and lazy-embed long-tail titles on first search.

**Seed index composition (~50,000 films, embedded pre-launch):**
- All TMDB films above a popularity score threshold (covers the bulk of films any cinephile is likely to summon)
- All films appearing in major festival selections (Cannes, Venice, Berlin, Sundance, TIFF, Locarno) across history
- All films appearing in published critical lists (Sight & Sound, Criterion Collection, BFI, AFI canons)
- All TMDB films with > N user-rating count above a minimum quality floor

**Lazy embed on first search:**
- When a user's search query autocomplete-matches a TMDB film not yet in the index, the result is displayed but flagged "indexing…"
- On selection, the backend synchronously scrapes/fetches metadata, generates both embeddings, and inserts into Qdrant — target end-to-end latency < 4 seconds for a cold-miss film
- Once embedded, the film is permanently in the index for all users
- A background queue handles re-embedding if embedding model versions change

**Why this scoping:**
Using local sentence-transformers (BGE), embedding cost is zero per film — only compute time. Pre-embedding all ~900,000 TMDB titles is still wasteful (most are obscure, and ingestion compute scales linearly with corpus size). ~50,000 covers >95% of expected search volume and embeds in hours on commodity hardware. The lazy-embed path means no user ever hits a dead end on an obscure film — they just wait a few extra seconds the first time.

---

## 7. User Flows

### 7.1 First-Time User Flow (Zero Friction)
1. Land on marketing page → "Start with any film" CTA (no signup gate)
2. Drop straight onto the Explore Canvas — dark canvas, centered search bar
3. Type "Whiplash" → autocomplete from global TMDB index → select
4. Whiplash node appears alone in center. Onboarding tooltip points at the Expand affordance: *"See what's near it."*
5. User clicks Expand → 10 similar films bloom radially
6. Onboarding tooltip points at "Add as seed": *"Pick two films. Find what's between them."*
7. User adds Parasite (via search bar OR by clicking Add-as-seed on a film already on canvas)
8. Mode transitions to Intersection: halos appear, canvas re-centers, results converge between the seeds with gradient rings
9. User reads Claude-generated explanations
10. *Only now* — after the user has experienced the magic — does a soft prompt appear: *"Sign up to save this constellation."* Signup is optional and post-value.

### 7.2 Expand → Intersect → Chain Flow (Core Loop)
1. User on Explore Canvas with Whiplash present
2. Clicks Expand on Whiplash → 10 children bloom radially with thin white edges
3. Adds Parasite as a second seed (via search OR by clicking Add-as-seed on one of the bloomed children)
4. Mode-shift transition plays (400ms): canvas re-centers, halos appear, bloomed children fade to 30%, mode chip flips
5. Intersection results converge in the middle with two-toned edges and gradient rings
6. User clicks Expand on an intersection result → drops out of intersection mode, that result becomes a new exploration anchor and blooms its own neighborhood
7. User can re-add seeds to return to intersection at any time

### 7.3 Personalization Upgrade Flow (Post-Signup, Optional)
1. Signed-in user clicks "Personalize" in nav
2. Instructions: "Go to Letterboxd → Settings → Export → Upload here"
3. Upload CSV → progress screen ("Enriching 847 of 1,203 films…")
4. Returned to the Explore Canvas — same as before, but now watched films display the watched-marker, and Library View is unlocked in the top-right toggle

### 7.4 Returning User Flow
1. Log in → last active constellation re-loads onto the Explore Canvas in its saved state
2. Nav shows a constellation switcher (list of named saved canvases)
3. If Letterboxd is connected and new watches exist on Letterboxd: soft prompt "Sync 14 new watches?" — never blocking

---

## 8. What CineGraph is NOT (V1 Scope Constraints)

- **Not a dashboard-first product.** The default experience is a blank exploration canvas, not a pre-rendered taste map. Library View exists for users who want the dashboard, but it is a secondary mode behind a toggle.
- **Not import-gated.** A user must be able to land on the site and explore films within seconds, with no signup and no CSV upload. Personalization is offered after the user has felt the core value.
- **Not a streaming guide.** Streaming availability is shown but not the primary purpose.
- **Not social.** No following, no friend graphs, no shared feed in V1. (V2 feature: taste compatibility index between two users)
- **Not mobile-first.** Graph physics require desktop. Mobile gets a degraded list view in V2.
- **Not a Letterboxd replacement.** Users still log films on Letterboxd; CineGraph is the discovery and exploration layer on top.
- **Not real-time.** Library View reflects the last import. Auto-sync via Letterboxd scraping is a V2 feature (and legally risky without official API access).

---

## 9. V2 Feature Roadmap

| Feature | Why it's V2 |
|---|---|
| Social graph overlay — see a friend's taste graph overlaid on yours | Requires auth + social graph; adds complexity |
| Taste compatibility index between two users | Needs multi-user vector comparison |
| Auto-sync with Letterboxd (no manual CSV) | Requires scraping user profile, legally sensitive |
| Mobile-optimized view | Needs separate UX paradigm for touch |
| Director/actor nodes mixed into graph | Bipartite graph — significantly more complex rendering |
| "Mood mode" — filter graph by current emotional state | Requires mood taxonomy and tagging layer |
| Live collaborative constellations (real-time multi-user editing of one canvas) | Requires presence/CRDT layer; V1 ships static read-only snapshots only (Section 5.8) |
| Trakt.tv import | Second data source; same pipeline, lower priority |
| Browser extension — CineGraph overlay on Letterboxd | Distribution play |

---

## 10. Success Metrics — V1

| Metric | Target (3 months post-launch) |
|---|---|
| Unique visitors who summon ≥ 1 film | 10,000+ |
| Sessions with ≥ 1 expand or intersect (activation) | ≥ 60% of visitors |
| Signups | 1,000+ |
| Signups who go on to import Letterboxd (personalization conversion) | ≥ 30% of signups |
| Constellations saved per signed-in user | ≥ 2 |
| Intersection queries run per active session | ≥ 3 |
| D7 retention (signed-in users) | ≥ 25% |
| Sharing events (constellation link shared) | ≥ 20% of active users |
| p95 intersection query latency | < 500ms |
| Explore Canvas: node summon-to-render | < 250ms |
| Library View render time (1,000 nodes, pre-computed layout) | < 3 seconds |

---

## 11. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Letterboxd blocks scraper (rate limiting, IP-based throttling) | Medium | High | **Accept scraping is permanent infrastructure** — Letterboxd's API policy explicitly excludes data-analysis, visualization, recommendation, and LLM/GPT projects, so an official partnership is off the table, not slow. Mitigations: aggressive client-side scraping via an opt-in browser extension (shifts load to the user's IP, dramatically reducing centralized footprint); polite server-side scraping with backoff + per-IP rate limiting + respect for robots.txt; cache aggressively (a film's `data-tmdb-id` only needs to be scraped once across all users, ever). |
| TMDB ID extraction breaks (HTML structure change) | Medium | High | Two independent extraction paths: primary = `data-tmdb-id` attribute on film page; fallback = parse the `data-track-action="TMDb"` anchor href and regex the TMDB ID from the URL (verify at implementation). Automated daily test against 10 canary films alerts on either path breaking. Final fallback: title + year fuzzy match against TMDB search API. |
| TMDB API rate limits / cost | ~~Medium~~ Negligible | ~~Medium~~ Low | TMDB removed their explicit rate limit in Dec 2019; soft IP cap ~50 r/s, no daily cap, no developer-vs-commercial tier difference. The 50k seed index batch ingests in hours, not days. No risk in V1. |
| Vector embedding cost at scale | None | None | Both text (BGE) and visual (CLIP) embeddings run locally via sentence-transformers — zero per-call cost. Only compute. Batch on import; cache permanently. |
| Library View performance at 1,000+ nodes (live force simulation jank) | Medium | High | Pre-compute layout server-side at import; persist node positions in Postgres; client renders at fixed positions; physics re-engages only on add/remove (Section 5.7) |
| Explore Canvas drift to >100 nodes if user expands aggressively | Low | Medium | Soft-cap rule (Section 5.1): at 75 nodes a non-blocking toast appears ("Canvas is getting busy — save as a constellation?"). At 100 nodes, the oldest non-seed, non-recently-interacted node fades over 800ms and is removed; a small "+1 archived" pill in the HUD lets the user restore the last fade. Seeds, watched-marked films, and nodes touched in the last 60 seconds are never auto-faded. |
| Graph performance degradation >2,000 nodes (Library View) | Low | Medium | Level-of-detail rendering (dots at zoom-out, posters at zoom-in); edge culling by similarity threshold |
| Groq free-tier rate limits for LLM explanations | Low | Low | Free tier (30 req/min, 6k/day) far exceeds expected demand; cache explanations after first generation; lazy-load (only generate on click). Upgrade to paid Groq or swap to a different OpenAI-compatible provider if usage spikes. |
| Letterboxd pursues legal action for scraping | Low | Very High | Public scraped data is never resold; user-specific scraped data is only used to populate that user's own canvas (no public exposure of others' libraries); favor browser-extension client-side scraping (the user is requesting their own data, not us); pre-prepared legal posture treating scraping as personal-data-portability rather than commercial extraction. Note: an official partnership is not available as a mitigation — Letterboxd's API policy excludes this category of product. |

---

## 12. Open Questions

1. **Embedding model hosting:** Self-host CLIP (free, private) vs. use a managed API? Self-hosting is better for cost and privacy but adds infra complexity.
2. ~~Global film index scope.~~ **Decided** — see Section 6.5.
3. **Weighting in late fusion:** Should seed weights be equal by default, or should the user's personal rating of each seed influence its weight automatically?
4. **Cluster labeling:** Auto-generated cluster names via LLM (e.g., "Slow Burn Psychological Thrillers") or predefined taxonomy?
5. **Monetization trigger point:** At what user count does a Pro tier (unlimited seeds, export, advanced filters) make sense to introduce?

---

## 13. Appendix

### A. Key Technical References
- Qdrant documentation: https://qdrant.tech/documentation/
- react-force-graph: https://github.com/vasturiano/react-force-graph
- TMDB API: https://developer.themoviedb.org/
- CLIP (HuggingFace): https://huggingface.co/sentence-transformers/clip-ViT-B-32
- Letterboxd CSV export guide: Settings → Import & Export → Export Your Data

### B. Competitive Positioning Summary

| | Letterboxd | IMDb | Taste.io | **CineGraph** |
|---|---|---|---|---|
| Graph UI | ✗ | ✗ | ✗ | **✓** |
| Multi-seed intersection | ✗ | ✗ | ✗ | **✓** |
| Personal taste import | ✓ | ✓ | ✓ | **✓** |
| Semantic (not just collaborative) | ✗ | ✗ | Partial | **✓** |
| Visual/aesthetic similarity | ✗ | ✗ | ✗ | **✓** |
| Negative filtering | ✗ | ✗ | ✗ | **✓** |
| Explanation of why films are similar | ✗ | ✗ | ✗ | **✓** |

### C. Build Phases

The feature specs in Sections 5–6 define *what* CineGraph is. This section defines *when* each piece ships and in what order.

---

#### Phase 0 — Magic Spike (Week 1)
**Scope:** Manually embed 50–100 films. Local Qdrant. Basic react-force-graph render with one node, click-to-expand, click-to-intersect. No auth, no design, no real data pipeline.

**Gate question:** Does the intersection of Whiplash + Parasite + a third seed return films that make someone say "oh, yes"? If the math doesn't produce delight at 100 films, no amount of infrastructure at 50,000 will save it.

**Cut if needed:** Nothing — this phase is the minimum. If you're skipping this you're building blind.

**What it unlocks:** Phase 1. If the spike fails, stop and rethink the embedding strategy before writing any more code.

---

#### Phase 1 — Global Index Ingestion (Weeks 2–4)
**Scope:** Section 6.5 — batch ingestion pipeline for ~50,000 curated films. TMDB fetch → BGE text embedding (768-d) → CLIP visual embedding (512-d) → 1280-d concat → Qdrant insert with full metadata payload. Lazy-embed endpoint for cold-miss searches. Automated canary tests for scraping health.

**Gate question:** Can the index ingest 50k films within reasonable compute time (hours, not days) and serve sub-100ms kNN queries? (Local embeddings = $0 cost, only compute.)

**Cut if needed:** Start with 10k films (highest TMDB popularity) if the 50k batch is slow to curate. Expand retroactively. Defer CLIP visual embeddings until after the text-only intersection ships.

**What it unlocks:** Phase 2 can build against real data.

---

#### Phase 2 — Backend API (Weeks 3–5, overlaps Phase 1)
**Scope:** FastAPI endpoints — `/search` (autocomplete against global index), `/expand` (top-K kNN, Section 5.2), `/intersect` (late fusion with rating weights + exclusion filters, Section 6.2), `/explain` (Llama 3.3 70B via Groq, one-liner with caching, Section 5.3). All endpoints work for anonymous users (no auth required). Exclusions passed as inline Qdrant filters from request body.

**Gate question:** Is p95 intersection latency under 500ms on a real Qdrant instance with 50k vectors?

**Cut if needed:** Skip `/explain` in this phase — ship without LLM explanations, add them in Phase 3 once the canvas is rendering.

**What it unlocks:** Frontend can build against real API responses.

---

#### Phase 3 — Explore Canvas (Weeks 5–8)
**Scope:** The full Sections 5.1–5.4 surface. Search bar → summon → expand (radial bloom, thin edges, 300ms ease-out) → intersect (convergent layout, colored halos, gradient rings, 600ms ease-in-out) → mode-shift transition → mode chip → soft cap (75-node toast, 100-node auto-fade). Film detail panel (Section 5.5).

**Gate question:** Can a first-time user distinguish expand from intersect without being told? Show it to 3–5 cinephiles and watch their faces. They should intuitively understand the two modes — if they don't, iterate the visual language before shipping.

**Cut if needed:** Ship the per-seed weight slider (HUD) in Phase 5. Use rating-scaled defaults for now.

**What it unlocks:** The product is usable end-to-end. Start showing it to people.

---

#### Phase 4 — Auth + Constellations + Snapshots (Weeks 8–9)
**Scope:** Supabase auth (email + Google). Postgres schema for users, constellations (serialized canvas state + node positions), exclusions (migrate from localStorage on first login). Constellation save/load/name. Snapshot endpoint (`/c/:slug` → frozen read-only render, Section 5.8). OG image generation for link previews. Two CTAs on frozen page: "Start your own canvas" + "Fork to my account."

**Gate question:** Does sharing a constellation link on Reddit/Letterboxd/Discord drive click-throughs? Track it from day one — this is the entire organic acquisition loop.

**Cut if needed:** OG image generation can ship as a flat screenshot fallback (HTML Canvas → PNG) before building a proper server-side renderer.

**What it unlocks:** Public launch. The product is shareable.

---

#### Phase 5 — Public Launch (End of Week 9)
**Scope:** Marketing page ("Start with any film"). Deploy FastAPI on Railway, frontend on Vercel. Qdrant Cloud (managed, not self-hosted, to reduce ops burden at launch). Ship it to r/Letterboxd, r/movies, Letterboxd forums with a shared constellation as the hook.

**Gate question:** Do shared snapshots drive sign-ups? Is D7 retention ≥ 25% for signed-in users?

**What it unlocks:** Real user feedback. Phase 6 scope is informed by what users actually do, not what we assumed they'd do.

---

#### Phase 6 — Letterboxd Import + Library View + Taste Dashboard (Weeks 10–13, post-launch)
**Scope:** Sections 5.6 (Letterboxd import with diary.csv extra-hop handling, three-path TMDB ID extraction, global embedding cache), 5.7 (Library View with pre-computed layout, LOD rendering, edge culling), 5.9 (Taste Profile Dashboard). Browser extension for client-side scraping if Letterboxd throttles server-side. Per-seed weight slider HUD.

**Gate question:** Does personalization (watched-markers, rating-weighted seeds) meaningfully change what users do with the canvas? Measure intersection query behavior before/after import.

**Cut if needed:** The Taste Dashboard (5.9) can slip to V1.5 without affecting the core product.

---

#### Phase summary

| Phase | Weeks | What ships | Gate |
|---|---|---|---|
| 0 — Magic Spike | 1 | 100-film local prototype | Does the intersection feel like magic? |
| 1 — Index Ingestion | 2–4 | 50k-film Qdrant index | Latency targets met? (cost is zero w/ local embeddings) |
| 2 — Backend API | 3–5 | FastAPI: search, expand, intersect, explain | p95 < 500ms? |
| 3 — Explore Canvas | 5–8 | Full UI, visual language, film detail | Can users tell expand from intersect? |
| 4 — Auth + Snapshots | 8–9 | Save, share, fork constellations | Do snapshots drive sign-ups? |
| 5 — Launch | 9 | Public ship | D7 retention ≥ 25%? |
| 6 — Personalization | 10–13 | Letterboxd import, Library View, Dashboard | Does import change behavior? |

---

### D. Glossary
- **Late Fusion:** Running separate vector searches per seed, then blending scores — as opposed to averaging seed vectors before searching (Early Fusion)
- **Qdrant Payload Filter:** JSON-based metadata filter applied at query time, e.g., `Must Not: {genre: "Horror"}`
- **TMDB ID:** The Movie Database's unique identifier for each film — the canonical bridge between Letterboxd's data and standardized metadata
- **Cosine Similarity:** Mathematical measure of angle between two vectors in high-dimensional space; 1.0 = identical, 0 = unrelated, -1 = opposite
- **CLIP:** OpenAI's Contrastive Language-Image Pretraining model — encodes images into vectors that can be compared semantically
