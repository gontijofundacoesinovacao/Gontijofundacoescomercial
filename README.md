# Dashboard Operacional Gontijo

Dashboard operacional com:

- `Acompanhamento Diario`
- `Acumulado Semanal`
- `Analises Operacionais`
- `Admin` com vinculo `IMEI -> maquina -> obra` e metas diaria/semanal
- `Admin` com importacao de metas semanais por foto via Tesseract OCR, revisao e confirmacao manual

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
- `TESSERACT_PATH`
- `TESSDATA_PREFIX`
- `TESSERACT_LANG`
- `TESSERACT_PSM`
- `CORS_ORIGIN`
- `TV_ROTATION_SECONDS`
- `TV_SECONDARY_ROTATION_SECONDS`
- `TV_AUTO_REFRESH_SECONDS`

## Rodando localmente

```bash
npm install
npm run dev
```

Para a importacao de metas por imagem, instale o Tesseract no ambiente local.

- Windows: instale o Tesseract OCR e, se necessario, configure `TESSERACT_PATH` apontando para `tesseract.exe`
- Se o idioma `por` estiver fora da instalacao padrao, configure `TESSDATA_PREFIX` para a pasta que contem `por.traineddata`
- Linux/Docker: o `Dockerfile` ja instala `tesseract-ocr` com idioma `por`

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

## Deploy no Render

- Para este projeto, prefira **Render com Docker** em vez do runtime Node nativo.
- Motivo: o backend depende do conversor nativo `tools/sacibin2txt`, que eh um binario Linux 32-bit, e do Tesseract OCR para leitura de imagens.
- O repositorio agora inclui:
  - [Dockerfile](c:/Users/Gontijo/Desktop/extraido/Dockerfile)
  - [.dockerignore](c:/Users/Gontijo/Desktop/extraido/.dockerignore)
  - [render.yaml](c:/Users/Gontijo/Desktop/extraido/render.yaml)
- Fluxo recomendado:
  - suba este repositorio diretamente no Render como **Blueprint** ou **Web Service com Docker**
  - mantenha backend e frontend juntos no mesmo servico
  - nesse modo, nao precisa configurar `window.__APP_CONFIG__.apiBaseUrl`
  - `CORS_ORIGIN` pode ficar vazio se tudo rodar no mesmo dominio do Render
- Se usar Blueprint:
  - o Render vai ler [render.yaml](c:/Users/Gontijo/Desktop/extraido/render.yaml)
  - depois preencha no painel apenas as variaveis com `sync: false`
- O `Dockerfile` instala as bibliotecas 32-bit necessarias para o `sacibin2txt` e o Tesseract com idioma `por`.

## Supabase

Execute o schema em [supabase/machine_mappings.sql](c:/Users/Gontijo/Desktop/extraido/supabase/machine_mappings.sql).

Para metas importadas por foto, execute tambem:

- [supabase/daily_goal_targets.sql](c:/Users/Gontijo/Desktop/extraido/supabase/daily_goal_targets.sql)

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
- `GET /api/admin/goal-targets`
- `POST /api/admin/goal-imports/parse`
- `POST /api/admin/goal-imports/confirm`
- `GET /api/dashboard/daily`
- `GET /api/dashboard/weekly`
- `GET /api/dashboard/secondary`
- `GET /api/display/config`
