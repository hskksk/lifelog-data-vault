COMPOSE = docker compose -f deploy/docker/docker-compose.yml

.PHONY: up down migrate dbt-parse lint

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

migrate:
	psql "$${DATABASE_URL:-postgresql://lifelog:lifelog@localhost:5432/lifelog}" \
		-v ON_ERROR_STOP=1 -f deploy/sql/migrations/V001__schemas.sql

dbt-parse:
	cd packages/dbt && dbt parse --profiles-dir .

lint:
	uv run ruff check packages/lifelog_core packages/ingest
