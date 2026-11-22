-- ============================================================
-- 024 — Fast place-filtered interest matching (fixes 023's match_interest_items)
-- With a place, 023 walked the HNSW index and checked each candidate's place
-- through an unindexable "type:id" concatenation, timing out on selective places
-- (e.g. state:CA, which has no items yet). Now a place first collects its
-- candidate items through content_item_places' (place_type, place_id) index,
-- then scores just those exactly. No place → the HNSW path, unchanged.
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

create or replace function match_interest_items(
  p_phrase text,
  p_model text,
  p_count integer,
  p_min_similarity double precision,
  p_levels text[] default null,
  p_place_type text default null,
  p_place_id text default null
)
returns table (
  id uuid, item_type text, title text, jurisdiction_level text, stage text,
  url text, legislation_id uuid, last_activity_at timestamptz, next_event_at timestamptz,
  similarity double precision
)
language plpgsql
volatile  -- set_config below
set search_path = public, extensions
as $$
declare
  query_embedding extensions.vector;
  place_keys text[];
  levels text[] := p_levels;
begin
  select ip.embedding into query_embedding
  from interest_phrases ip
  where ip.normalized_phrase = p_phrase and ip.model = p_model;

  if query_embedding is null then
    return;
  end if;

  if p_place_type = 'federal' then
    levels := array['federal'];
  elsif p_place_type is not null then
    place_keys := expand_place(p_place_type, p_place_id);
  end if;

  -- Place: exact search over the place's items (thousands at most for NYC)
  if place_keys is not null then
    return query
      with keys as (
        select split_part(k, ':', 1) as place_type, substr(k, strpos(k, ':') + 1) as place_id
        from unnest(place_keys) k
      ),
      candidates as materialized (
        select cip.content_item_id
        from content_item_places cip
        join keys on keys.place_type = cip.place_type and keys.place_id = cip.place_id
      ),
      -- Materialized so each distance is computed once (~200 ms for all of NYC)
      scored as materialized (
        select ce.content_item_id, 1 - (ce.embedding <=> query_embedding) as similarity
        from content_embeddings ce
        where ce.model = p_model and ce.content_item_id in (select content_item_id from candidates)
      )
      select ci.id, ci.item_type, ci.title, ci.jurisdiction_level, ci.stage, ci.url, ci.legislation_id,
             ci.last_activity_at, ci.next_event_at, s.similarity
      from scored s
      join content_items ci on ci.id = s.content_item_id
      where not ci.is_dead
        and (levels is null or ci.jurisdiction_level = any(levels))
        and s.similarity >= p_min_similarity
      order by s.similarity desc
      limit p_count;
    return;
  end if;

  -- No place: HNSW, with the model as a literal so the partial index applies
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '100', true);

  return query execute format($q$
    select * from (
      select ci.id, ci.item_type, ci.title, ci.jurisdiction_level, ci.stage, ci.url, ci.legislation_id,
             ci.last_activity_at, ci.next_event_at,
             1 - (ce.embedding <=> $1) as similarity
      from content_embeddings ce
      join content_items ci on ci.id = ce.content_item_id
      where ce.model = %L
        and not ci.is_dead
        and ($2::text[] is null or ci.jurisdiction_level = any($2))
      order by ce.embedding <=> $1
      limit $3
    ) nearest
    where nearest.similarity >= $4
    order by nearest.similarity desc
  $q$, p_model)
  using query_embedding, levels, p_count, p_min_similarity;
end;
$$;

revoke all on function match_interest_items(text, text, integer, double precision, text[], text, text) from public, anon, authenticated;
grant execute on function match_interest_items(text, text, integer, double precision, text[], text, text) to service_role;
