# Bug Report Bot (Telegram + Supabase)

## Environment variables
- `BOT_TOKEN` (required)
- `SUPABASE_URL` (required)
- `SUPABASE_SERVICE_KEY` (required)  
  Use **service role** key on server (keep it secret). Make sure RLS policies allow inserts/updates as you want.
- `DEV_GROUP_ID` (required) Telegram group/chat id where bug reports go (e.g. `-100...`).

Optional:
- `BUG_PROJECTS` comma-separated (e.g. `App,Admin,Website`) — if empty, project step is skipped.
- `TELEGRAM_WEBHOOK_SECRET` + `TELEGRAM_WEBHOOK_VERIFY=true` to enforce secret-token header.
- `DEV_ADMIN_IDS` comma-separated telegram user ids allowed to change bug statuses (otherwise anyone in dev group can).

## Supabase schema (SQL)
See `api/index.js` comments for the required tables.

## Deploy
Deploy to Vercel as a serverless function.

Set Telegram webhook to your Vercel URL, pointing to `/api/telegram` (any path is fine because Vercel rewrites to the handler).
If you use secret token, set it on Telegram side as well.
