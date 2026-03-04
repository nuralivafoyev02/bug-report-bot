# Uyqur Yordamchi — merged with Smart Intake

Bu versiyada eski bot funksiyalari saqlangan:
- `/bind`, `/message`, `/send`
- ClickUp webhook sync
- `/tasks`, `/report`, planner, leaderboard

Va yangi **single-message Smart Intake** qo'shilgan:
- `/bug <matn>` yoki `/intake <matn>`
- private chatda media + caption bilan yuborish
- `SMART_INTAKE_AUTO=true` bo'lsa, oddiy private text ham avtomatik smart intake bo'ladi
- dev guruhga PM inline tugmalari bilan yuboradi

## Yangi env'lar
- `SMART_INTAKE_ENABLED=true`
- `SMART_INTAKE_AUTO=true` (xohlasangiz false qilib, faqat `/bug` ishlating)
- `DEV_GROUP_ID=-100...`
- `DEV_ADMIN_IDS=111,222`
- `ASSIGNEES=Temur:111,Suxrob:222`
- `BUG_PROJECTS=Sayilgoh,Nuridin Buildings`
- `BUG_REPORTS_TABLE=bug_reports`
- `BUG_REPORT_EVENTS_TABLE=bug_report_events`

## Muhim
Smart intake mavjud eski `reports` jadvaliga tegmaydi. U alohida jadvallardan foydalanadi:
- `bug_reports`
- `bug_report_events`

## Supabase SQL
```sql
create table if not exists public.bug_reports (
  id bigserial primary key,
  report_code text not null unique,
  source_chat_id text,
  source_user_id text,
  source_name text,
  source_username text,
  client_name text,
  project_name text,
  report_type text not null default 'support',
  priority text not null default 'medium',
  tags jsonb not null default '[]'::jsonb,
  summary text,
  details text,
  raw_text text,
  status text not null default 'new',
  attachment_present boolean not null default false,
  pm_user_id text,
  pm_name text,
  assignee_id text,
  assignee_name text,
  group_chat_id text,
  group_message_id text,
  last_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists bug_reports_status_idx on public.bug_reports (status);
create index if not exists bug_reports_priority_idx on public.bug_reports (priority);
create index if not exists bug_reports_created_at_idx on public.bug_reports (created_at desc);

create table if not exists public.bug_report_events (
  id bigserial primary key,
  report_code text not null references public.bug_reports(report_code) on delete cascade,
  event_type text not null,
  actor_user_id text,
  actor_name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bug_report_events_report_code_idx on public.bug_report_events (report_code, created_at desc);
```

## Ishlatish
1. `.env.example` dagi qiymatlarni to'ldiring.
2. Supabase SQL ni ishga tushiring.
3. Vercelga deploy qiling.
4. Webhook'ni ulang.

Webhook URL misol:
`https://your-app.vercel.app/api/telegram/webhook`

## Tavsiya
Agar eski oddiy hisobotni ham saqlamoqchi bo'lsangiz, `SMART_INTAKE_AUTO=false` qiling va faqat `/bug` / `/intake` ishlating.
