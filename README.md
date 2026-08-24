# avaivy.cloud — Ava Energy System Dashboard

## Runtime
- Web origin: `broadcast.py`
- Listen: `0.0.0.0:8080`
- Frontend: `/home/ava-core/Web/Pages/avaivy.cloud/`
- APIs: `/system/api/now`, `/system/api/history`, `/system/api/health`

## Important
The existing EcoFlow data collectors and analytics are not modified. This package only serves the existing data and frontend.

## Cloudflare
The tunnel must route both `avaivy.cloud` and `www.avaivy.cloud` to `http://127.0.0.1:8080`. See `Web/cloudflare-avaivy.ingress.yml`.
