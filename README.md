# lifelog-data-vault

Personal lifelog data platform using **Data Vault 2.0** patterns: Bronze object storage, PostgreSQL Raw/Business Vault, dbt transforms, Python ingest on OCI (or local Docker).

## Stack

| Layer | Technology |
|-------|------------|
| Bronze | Cloudflare R2 (S3-compatible) |
| Vault DB | PostgreSQL |
| Transform | dbt Core |
| Ingest | Python (`uv`), CLI per source |
| Compute (prod) | OCI Always Free Ampere A1 |
| CI | GitHub Actions |

## Quick start (local)

```bash
cp .env.example .env
make up
make migrate
cd packages/dbt && dbt deps && dbt parse
```

See [docs/architecture/overview.md](docs/architecture/overview.md) for monorepo layout and pipeline design.

### OwnTracks (location)

Design: [docs/architecture/owntracks.md](docs/architecture/owntracks.md).

```bash
make up && make migrate
export BRONZE_LOCAL_DIR=var/bronze DATABASE_URL=postgresql://lifelog:lifelog@localhost:5432/lifelog
uv sync --all-packages
uv run lifelog-ingest serve owntracks --port 8080   # terminal 2
make demo-owntracks                                  # POST sample location
uv run lifelog-ingest materialize owntracks
make dbt-owntracks
```

## License

MIT
