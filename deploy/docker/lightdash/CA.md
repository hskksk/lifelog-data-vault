# Supabase CA (`certs/supabase-ca.pem`)

`certs/` contents are gitignored. Install with:

```bash
export SUPABASE_DB_SSLROOTCERT=~/path/from-dashboard.crt
make lightdash-install-ca
```

See [docs/operations/lightdash-local-production.md](../../../docs/operations/lightdash-local-production.md).