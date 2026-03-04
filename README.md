# Support Log Bot (Telegram + Supabase)

Bu versiya **ClickUpsiz** va **boss_idsiz** ishlaydi.

## Nima qiladi
- User botga oddiy log yozadi (matn yoki media + caption)
- Bot logni avtomatik tahlil qiladi: `support / bug / taklif / feature / so'rov`
- Guruhga yuborishdan oldin preview ko'rsatadi
- Previewda:
  - `Tahrirlash`
  - `Yuborish`
  - `Bekor qilish`
  - log turini qo'lda almashtirish
- Guruhga tushunarli formatda yuboradi:
  - obyekt
  - tur
  - log matni
  - yuboruvchi
  - sana/vaqt (`dd.mm.yyyy HH:mm`)
- Guruhdagi postda:
  - `CEO o'qidi`
  - `PM o'qidi`
  - kerak bo'lsa `Qabul qilish`
- `Qabul qilish` bosilganda postdagi holat `Qabul qilindi` bo'ladi va qabul qilish tugmasi yo'qoladi
- `/status LOG_ID` bilan holat tekshiriladi

## Kerakli env o'zgaruvchilar
### Majburiy
- `BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `TARGET_GROUP_ID` — log tushadigan guruh chat id (`-100...`)

### Ixtiyoriy
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_VERIFY=true`
- `CEO_READER_IDS` — vergul bilan ajratilgan Telegram user ID lar
- `PM_READER_IDS` — vergul bilan ajratilgan Telegram user ID lar

Agar `CEO_READER_IDS` yoki `PM_READER_IDS` berilmasa, guruhdagi istalgan odam shu rol tugmasini bosishi mumkin.

## Supabase SQL
```sql
create extension if not exists pgcrypto;

create table if not exists log_sessions (
  user_id bigint primary key,
  step text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists support_logs (
  id uuid primary key default gen_random_uuid(),
  short_id text unique not null,
  user_id bigint not null,
  username text,
  full_name text,
  raw_text text not null,
  client_name text,
  type text not null,
  normalized_text text not null,
  keywords jsonb not null default '[]'::jsonb,
  needs_accept boolean not null default false,
  is_accepted boolean not null default false,
  accepted_by bigint,
  accepted_at timestamptz,
  target_chat_id bigint,
  target_message_id bigint,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_logs_user_id_idx on support_logs(user_id);
create index if not exists support_logs_type_idx on support_logs(type);
create index if not exists support_logs_short_id_idx on support_logs(short_id);

create table if not exists log_reads (
  id bigserial primary key,
  log_id uuid not null references support_logs(id) on delete cascade,
  role text not null,
  reader_id bigint not null,
  reader_name text,
  read_at timestamptz not null default now(),
  unique (log_id, role)
);
```

## Ishlatish
1. Vercelga deploy qiling
2. Env larni kiriting
3. Supabase SQL ni ishga tushiring
4. Botni guruhga admin qilib qo'ying
5. Telegram webhook ni Vercel endpoint ga ulang (`/api/telegram` yoki istalgan `/api/*` yo'l)

## Foydali komandalar
- `/start` — yangi log boshlash
- `/newlog` — yangi log boshlash
- `/cancel` — draftni bekor qilish
- `/send` — preview tayyor bo'lsa yuborish
- `/status LG-...` — log holatini tekshirish
