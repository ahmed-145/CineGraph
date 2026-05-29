-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Creates the table that stores users' Letterboxd import data.

CREATE TABLE IF NOT EXISTS public.letterboxd_films (
    id           bigserial PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tmdb_id      integer NOT NULL,
    rating       numeric(3,1),          -- 0.5–5.0, null = no rating
    rewatch      boolean  DEFAULT false,
    watched_date date,
    created_at   timestamptz DEFAULT now(),
    UNIQUE (user_id, tmdb_id)
);

ALTER TABLE public.letterboxd_films ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON public.letterboxd_films
    FOR ALL
    USING  (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS letterboxd_films_user_idx
    ON public.letterboxd_films (user_id);
