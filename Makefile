COMPOSE = docker compose -f deploy/docker/docker-compose.yml
SUPABASE ?= npx --yes supabase@2.122.0

.PHONY: up down migrate supabase-start supabase-stop supabase-reset dbt-parse dbt-owntracks lint test demo-owntracks

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

migrate:
	psql "$${DATABASE_URL:-postgresql://lifelog:lifelog@localhost:5432/lifelog}" \
		-v ON_ERROR_STOP=1 -f deploy/sql/migrations/V001__schemas.sql
	psql "$${DATABASE_URL:-postgresql://lifelog:lifelog@localhost:5432/lifelog}" \
		-v ON_ERROR_STOP=1 -f deploy/sql/migrations/V002__owntracks_staging.sql

supabase-start:
	$(SUPABASE) start

supabase-stop:
	$(SUPABASE) stop --no-backup

supabase-reset:
	$(SUPABASE) db reset

dbt-parse:
	cd packages/dbt && dbt parse --profiles-dir .

dbt-owntracks:
	cd packages/dbt && dbt build --select tag:owntracks --profiles-dir .

lint:
	pnpm --filter @lifelog/ingest typecheck

test:
	pnpm --filter @lifelog/ingest test

demo-owntracks:
	curl -sS -X POST http://127.0.0.1:8080/ingest/owntracks \
		-H "Authorization: Bearer $${INGEST_BEARER_TOKEN:-change-me}" \
		-H "Content-Type: application/json" \
		-d '{"_type":"location","topic":"owntracks/me/iphone","tid":"ip","tst":1700000000,"lat":35.6812,"lon":139.7671,"t":"u","acc":10}'
