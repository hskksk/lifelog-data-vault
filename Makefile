COMPOSE = docker compose -f deploy/docker/docker-compose.yml
SUPABASE ?= npx --yes supabase@2.122.0
# Services not needed for Bronze ingest / Vault (also avoids Realtime DB_HOST nxdomain).
SUPABASE_START_EXCLUDE ?= logflare,vector,realtime

COMPOSE_METABASE = docker compose -f deploy/docker/docker-compose.metabase.yml

.PHONY: up down migrate ingest-core-build supabase-start supabase-stop supabase-reset supabase-functions-serve dbt-parse dbt-owntracks lint test demo-owntracks demo-owntracks-edge demo-materialize-edge metabase-up metabase-down metabase-logs metabase-connect-remote

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

migrate:
	psql "$${DATABASE_URL:-postgresql://lifelog:lifelog@localhost:5432/lifelog}" \
		-v ON_ERROR_STOP=1 -f deploy/sql/migrations/V001__schemas.sql
	psql "$${DATABASE_URL:-postgresql://lifelog:lifelog@localhost:5432/lifelog}" \
		-v ON_ERROR_STOP=1 -f deploy/sql/migrations/V002__owntracks_staging.sql

ingest-core-build:
	pnpm --filter @lifelog/ingest-core build

supabase-start: ingest-core-build
	$(SUPABASE) start -x $(SUPABASE_START_EXCLUDE)

supabase-stop:
	$(SUPABASE) stop --no-backup

supabase-reset:
	$(SUPABASE) db reset

supabase-functions-serve: ingest-core-build
	$(SUPABASE) functions serve owntracks-ingest owntracks-materialize --env-file .env --no-verify-jwt

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

demo-owntracks-edge:
	bash -lc 'set -a; [ -f .env ] && . ./.env; set +a; \
	  curl -sS -X POST "http://127.0.0.1:54421/functions/v1/owntracks-ingest" \
	    -H "Authorization: Bearer $${INGEST_BEARER_TOKEN:-change-me}" \
	    -H "Content-Type: application/json" \
	    -d "{\"_type\":\"location\",\"topic\":\"owntracks/me/iphone\",\"tid\":\"ip\",\"tst\":1700000000,\"lat\":35.6812,\"lon\":139.7671,\"t\":\"u\",\"acc\":10}"'

metabase-up:
	$(COMPOSE_METABASE) up -d

metabase-down:
	$(COMPOSE_METABASE) down

metabase-logs:
	$(COMPOSE_METABASE) logs -f metabase

metabase-connect-remote:
	pnpm metabase-connect-remote

demo-materialize-edge:
	bash -lc 'set -a; [ -f .env ] && . ./.env; set +a; \
	  test -n "$$SUPABASE_SECRET_KEY" || { echo "Missing SUPABASE_SECRET_KEY in .env (Dashboard secret key sb_secret_...)" >&2; exit 1; }; \
	  curl -sS -X POST "http://127.0.0.1:54421/functions/v1/owntracks-materialize" \
	    -H "apikey: $$SUPABASE_SECRET_KEY" \
	    -H "Content-Type: application/json" \
	    -d "{}"'
