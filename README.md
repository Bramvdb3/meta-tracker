# Meta Tracker

Privé Meta Ads tracking platform voor Shopify met server-side Conversions API forwarding.
Zie `meta-tracker-architecture.md` voor het volledige plan.

## Lokaal opzetten

```bash
npm install
cp .env.example .env
# Vul env vars in. Genereer de geheimen:
#   openssl rand -base64 32        → ENCRYPTION_KEY
#   openssl rand -base64 32        → NEXTAUTH_SECRET
#   openssl rand -hex 32           → CRON_SECRET
#   npm run hash:password -- "yourpassword"  → ADMIN_PASSWORD_HASH

npm run prisma:generate
npm run prisma:migrate -- --name init
npm run seed:admin

npm run dev
```

## Deployment op Railway

1. **Maak een nieuw Railway project.**
2. **Voeg een PostgreSQL plugin toe** — Railway zet automatisch `DATABASE_URL` als env var.
3. **Voeg een service toe vanuit GitHub** met deze repo.
4. **Stel env vars in** in de service:
   - `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (= deployment URL)
   - `ENCRYPTION_KEY`, `CRON_SECRET`
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`
   - `APP_BASE_URL`, `META_GRAPH_API_VERSION=v25.0`
5. **Build command:** `npm run prisma:generate && npm run build`
6. **Start command:** `npm run prisma:deploy && npm run seed:admin && npm start`
7. **Voeg een Cron service toe** in hetzelfde project:
   - Cron schedule: `*/5 * * * *` (elke 5 min)
   - Command: `curl -X POST -H "x-cron-secret: $CRON_SECRET" $APP_BASE_URL/api/cron/retry-failed-events`

## Shopify configuratie per store

In Shopify Admin → Settings → Notifications → Webhooks, voeg toe:

- Event: **Order creation** + **Order paid**
- Format: JSON
- URL: `https://<your-tracker>/api/webhooks/shopify/orders`
- Webhook secret: kopieer naar de Store record in het dashboard (versleuteld opgeslagen)

Plaats `tracker.js` (komt in stap 4) in `Online Store → Themes → theme.liquid` net vóór `</head>`.

## API endpoints

| Method | Path                                    | Auth        |
|--------|-----------------------------------------|-------------|
| POST   | `/api/collect`                          | publiek (rate-limited, origin-checked) |
| POST   | `/api/webhooks/shopify/orders`          | HMAC        |
| POST   | `/api/cron/retry-failed-events`         | `x-cron-secret` |
| POST   | `/api/events/:logId/retry`              | session     |
| GET/POST | `/api/stores`                         | session     |
| PATCH/DELETE | `/api/stores/:id`                 | session     |
| GET    | `/api/stats?store_id=&days=14`          | session     |
| GET    | `/api/events?store_id=&event_name=&success=` | session |
| POST   | `/api/test-event`                       | session     |
