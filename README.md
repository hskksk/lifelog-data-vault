# lifelog-data-vault

Personal lifelog data platform using **Data Vault 2.0** patterns: Bronze object storage, PostgreSQL Raw/Business Vault, dbt transforms, Python ingest on OCI (or local Docker).

## Stack

| Layer | Technology |
|-------|------------|
| Bronze | Cloudflare R2 (S3-compatible) |
| Vault DB | PostgreSQL |
| Transform | dbt Core |
| Ingest | TypeScript (`pnpm`, `@lifelog/ingest`) |
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
pnpm install
export BRONZE_LOCAL_DIR=var/bronze DATABASE_URL=postgresql://lifelog:lifelog@localhost:5432/lifelog
pnpm --filter @lifelog/ingest dev serve owntracks --port 8080   # terminal 2
make demo-owntracks
pnpm --filter @lifelog/ingest dev materialize owntracks
make dbt-owntracks
```

## License

MIT
