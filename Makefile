COMPOSE = docker compose -f deploy/docker/docker-compose.yml
SUPABASE ?= npx --yes supabase@2.122.0
# Services not needed for Bronze ingest / Vault (also avoids Realtime DB_HOST nxdomain).
SUPABASE_START_EXCLUDE ?= logflare,vector,realtime

COMPOSE_METABASE = docker compose -f deploy/docker/docker-compose.metabase.yml
COMPOSE_LIGHTDASH = docker compose -f deploy/docker/docker-compose.lightdash.yml
COMPOSE_LIGHTDASH_PROD = docker compose -f deploy/docker/docker-compose.lightdash.yml --env-file deploy/docker/lightdash/hosted-warehouse.env
LIGHTDASH_CA = deploy/docker/lightdash/certs/supabase-ca.pem

.PHONY: up down migrate ingest-core-build supabase-start supabase-stop supabase-reset supabase-functions-serve dbt-parse dbt-owntracks dbt lint test demo-owntracks demo-owntracks-edge demo-materialize-edge metabase-up metabase-down metabase-reset metabase-logs metabase-connect-remote lightdash-up lightdash-down lightdash-reset lightdash-logs lightdash-print-warehouse lightdash-deploy-local lightdash-install-ca lightdash-prod-up lightdash-prod-down lightdash-prod-deploy

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

# Whole project. The marts merge OwnTracks and Mac sources, so source-only
# targets leave mart_person_activity_minute stale.
dbt:
	cd packages/dbt && dbt build --profiles-dir .

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

# Deletes the local app database (questions and the Metabase admin user).
metabase-reset:
	$(COMPOSE_METABASE) down -v
	$(COMPOSE_METABASE) up -d

metabase-logs:
	$(COMPOSE_METABASE) logs -f metabase

metabase-connect-remote:
	pnpm metabase-connect-remote

# Lightdash on 127.0.0.1 + local Supabase warehouse (no pooler CA).
lightdash-up:
	$(COMPOSE_LIGHTDASH) up -d

lightdash-down:
	$(COMPOSE_LIGHTDASH) down

# Copy Dashboard CA into deploy/docker/lightdash/certs/supabase-ca.pem (gitignored).
lightdash-install-ca:
	@test -n "$$SUPABASE_DB_SSLROOTCERT" && test -f "$$SUPABASE_DB_SSLROOTCERT" || { \
	  echo "Set SUPABASE_DB_SSLROOTCERT to the Supabase SSL Configuration download path." >&2; exit 1; }
	install -d deploy/docker/lightdash/certs
	install -m 0644 "$$SUPABASE_DB_SSLROOTCERT" "$(LIGHTDASH_CA)"

# Local-only “production”: Lightdash on 127.0.0.1, warehouse = hosted Supabase, NODE_EXTRA_CA_CERTS set.
lightdash-prod-up:
	@test -f "$(LIGHTDASH_CA)" || $(MAKE) lightdash-install-ca
	$(COMPOSE_LIGHTDASH_PROD) up -d

lightdash-prod-down:
	$(COMPOSE_LIGHTDASH_PROD) down

# Deletes the local app database (Lightdash org, users, saved charts).
lightdash-reset:
	$(COMPOSE_LIGHTDASH) down -v
	$(COMPOSE_LIGHTDASH) up -d

lightdash-logs:
	$(COMPOSE_LIGHTDASH) logs -f lightdash

lightdash-print-warehouse:
	pnpm lightdash-print-warehouse

# CLI deploy to local Lightdash (http://127.0.0.1:8081). Run lightdash login once first.
LIGHTDASH_CLI ?= npx --yes @lightdash/cli@3.350.1
lightdash-deploy-local:
	cd packages/dbt && $(LIGHTDASH_CLI) deploy \
	  --profiles-dir . --project-dir . \
	  --target bi_reader_local \
	  --selector lightdash

# Hosted warehouse deploy (use repo CA path). CREATE=1 for first project.
lightdash-prod-deploy:
	bash -lc 'test -f "$(LIGHTDASH_CA)" || { echo "Run make lightdash-install-ca first." >&2; exit 1; }; \
	  CA="$$(pwd)/$(LIGHTDASH_CA)"; \
	  cd packages/dbt && NODE_EXTRA_CA_CERTS="$$CA" $(LIGHTDASH_CLI) deploy \
	    $$(test "$${CREATE:-0}" = "1" && echo --create) \
	    --profiles-dir . --project-dir . \
	    --target bi_reader_hosted \
	    --selector lightdash'

lightdash-deploy-hosted: lightdash-prod-deploy

demo-materialize-edge:
	bash -lc 'set -a; [ -f .env ] && . ./.env; set +a; \
	  test -n "$$SUPABASE_SECRET_KEY" || { echo "Missing SUPABASE_SECRET_KEY in .env (Dashboard secret key sb_secret_...)" >&2; exit 1; }; \
	  curl -sS -X POST "http://127.0.0.1:54421/functions/v1/owntracks-materialize" \
	    -H "apikey: $$SUPABASE_SECRET_KEY" \
	    -H "Content-Type: application/json" \
	    -d "{}"'
