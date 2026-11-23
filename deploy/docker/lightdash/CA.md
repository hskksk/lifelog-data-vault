# Supabase CA (`certs/supabase-ca.pem`) — optional

**Default local production** uses `NODE_TLS_REJECT_UNAUTHORIZED=0` in `hosted-warehouse.env` (no CA file).

To switch to strict CA verify later:

```bash
export SUPABASE_DB_SSLROOTCERT=~/path/from-dashboard.crt
make lightdash-install-ca
```

See [lightdash-setup.md](../../../docs/operations/lightdash-setup.md) §2.3.