# Dashboard Operacional Gontijo

Dashboard operacional com:

- `Acompanhamento Diario`
- `Acumulado Semanal`
- `Analises Operacionais`
- `Admin` com vinculo `IMEI -> maquina -> obra` e metas diaria/semanal

## Stack

- Backend: Node + Express
- Frontend: HTML/CSS/JS em `public/`
- Persistencia admin:
  - preferencial: Supabase
  - fallback local: JSON em desenvolvimento, quando o Supabase nao estiver configurado

## Variaveis de ambiente

Veja [.env.example](c:/Users/Gontijo/Desktop/extraido/.env.example).

Principais:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `S3_PREFIX_BASE`
- `S3_CLIENT_LOGIN`
- `ADMIN_PASSWORD`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGIN`
- `TV_ROTATION_SECONDS`
- `TV_SECONDARY_ROTATION_SECONDS`
- `TV_AUTO_REFRESH_SECONDS`

## Rodando localmente

```bash
npm install
npm run dev
```

Abra:

- `http://localhost:3000`
- `http://localhost:3000/?screen=primary-tv`
- `http://localhost:3000/?screen=secondary-tv`

## Deploy separado: Vercel + Netlify

- Backend no Vercel: publique o app Node/Express com as mesmas variaveis do `.env`.
- Frontend no Netlify: publique a pasta `public/`.
- Se frontend e backend ficarem em dominios diferentes:
  - configure `CORS_ORIGIN` no backend com a URL exata do Netlify
  - configure `window.__APP_CONFIG__.apiBaseUrl` no HTML para apontar para a URL do backend no Vercel
- O frontend usa `credentials: include`, entao o admin funciona cross-origin desde que `CORS_ORIGIN` esteja configurado corretamente.

## Supabase

Execute o schema em [supabase/machine_mappings.sql](c:/Users/Gontijo/Desktop/extraido/supabase/machine_mappings.sql).

O backend usa:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Se essas variaveis nao estiverem configuradas, o backend cai no modo local para facilitar validacao.

## Endpoints novos

- `POST /api/admin/session`
- `POST /api/admin/logout`
- `GET /api/admin/status`
- `GET /api/admin/machines`
- `GET /api/admin/mappings`
- `POST /api/admin/mappings`
- `PUT /api/admin/mappings/:id`
- `POST /api/admin/mappings/:id/activate`
- `POST /api/admin/mappings/:id/archive`
- `GET /api/dashboard/daily`
- `GET /api/dashboard/weekly`
- `GET /api/dashboard/secondary`
- `GET /api/display/config`
