# CineGraph — Phase 0 Setup

## Prerequisites
- Docker + Docker Compose
- Python 3.11+
- Node.js 20+
- API keys: OpenAI, Anthropic, TMDB (free at themoviedb.org)

---

## 1. Environment

```bash
cp .env.example backend/.env
# Fill in OPENAI_API_KEY, ANTHROPIC_API_KEY, TMDB_API_KEY
```

---

## 2. Start Qdrant

```bash
docker compose up -d
# Qdrant UI: http://localhost:6333/dashboard
```

---

## 3. Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# One-time: embed 100 films (~2 min, ~$0.05)
python ingest.py

# Start API
uvicorn main:app --reload --port 8000
# Docs: http://localhost:8000/docs
```

---

## 4. Frontend

```bash
cd frontend
npm install
npm run dev
# Open: http://localhost:5173
```

---

## Gate question (Phase 0)

Search "Whiplash", expand it, add it as a seed.
Search "Parasite", add it as a seed.
Do the intersection results make someone say *"oh, yes"*?

If yes → Phase 1.
If no → re-examine the embedding text construction in `ingest.py`.
