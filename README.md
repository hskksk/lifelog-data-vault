# lifelog-data-vault

Personal lifelog data platform using **Data Vault 2.0** patterns: Bronze object storage, PostgreSQL Raw/Business Vault, dbt transforms, Python ingest on OCI (or local Docker).

> **Repository name:** GitHub 上は暫定 [`hskksk/estimate_test_story`](https://github.com/hskksk/estimate_test_story) です。Settings → General → **Repository name** を `lifelog-data-vault` に変更してください（Issue・clone URL がそのまま引き継がれます）。

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

## License

MIT
