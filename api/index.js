/*
  Minimal bug-report intake bot.

  Required Supabase tables (SQL):

  -- Stores in-progress user wizards
  create table if not exists bug_sessions (
    user_id bigint primary key,
    step text not null,
    payload jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  );

  -- Stores submitted bug reports
  create table if not exists bug_reports (
    id uuid primary key default gen_random_uuid(),
    short_id text unique not null,
    user_id bigint not null,
    username text,
    full_name text,
    project text,
    severity text,
    title text not null,
    steps text,
    expected text,
    actual text,
    environment text,
    attachments jsonb not null default '[]'::jsonb,
    status text not null default 'new',
    dev_chat_id bigint,
    dev_message_id bigint,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists bug_reports_user_id_idx on bug_reports(user_id);
  create index if not exists bug_reports_status_idx on bug_reports(status);

  -- (Optional) If you want to keep an audit log
  create table if not exists bug_events (
    id bigserial primary key,
    bug_id uuid not null references bug_reports(id) on delete cascade,
    by_user_id bigint,
    event text not null,
    meta jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
*/

const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// ====== CONFIG ======
const must = (key) => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

const bot = new Telegraf(must('BOT_TOKEN'));
const supabase = createClient(must('SUPABASE_URL'), must('SUPABASE_SERVICE_KEY'));

const DEV_GROUP_ID = (() => {
  const n = Number(process.env.DEV_GROUP_ID);
  if (!Number.isFinite(n)) throw new Error('DEV_GROUP_ID must be a number');
  return n;
})();

const BUG_PROJECTS = (process.env.BUG_PROJECTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DEV_ADMIN_IDS = (process.env.DEV_ADMIN_IDS || '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

// ====== HELPERS ======
const escapeHTML = (s) => {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const nowShortId = () => {
  // BR-YYYYMMDD-HHMM-rand
  const d = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const r = Math.floor(Math.random() * 9000) + 1000;
  return `BR-${y}${m}${day}-${hh}${mm}-${r}`;
};

const isPrivate = (ctx) => ctx.chat && ctx.chat.type === 'private';

const isDevAdmin = (telegramUserId) => {
  if (!DEV_ADMIN_IDS.length) return true; // allow all dev group members if not restricted
  return DEV_ADMIN_IDS.includes(Number(telegramUserId));
};

const getHeader = (req, name) => {
  const k = name.toLowerCase();
  return req?.headers?.[k] || req?.headers?.[name] || null;
};

const verifyTelegramSecret = (req) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const strict = process.env.TELEGRAM_WEBHOOK_VERIFY === 'true';
  if (!secret) return true;
  const token = getHeader(req, 'x-telegram-bot-api-secret-token');
  if (!token) return !strict;
  return token === secret;
};

// ====== DB: sessions ======
const getSession = async (userId) => {
  const { data, error } = await supabase
    .from('bug_sessions')
    .select('user_id, step, payload')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error('bug_sessions select error:', error.message);
  }
  return data || null;
};

const upsertSession = async (userId, step, payload) => {
  const { error } = await supabase
    .from('bug_sessions')
    .upsert({
      user_id: userId,
      step,
      payload: payload || {},
      updated_at: new Date().toISOString(),
    });
  if (error) console.error('bug_sessions upsert error:', error.message);
};

const clearSession = async (userId) => {
  const { error } = await supabase.from('bug_sessions').delete().eq('user_id', userId);
  if (error) console.error('bug_sessions delete error:', error.message);
};

// ====== UI builders ======
const severityKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🟢 Low', 'sev_low'), Markup.button.callback('🟡 Medium', 'sev_medium')],
    [Markup.button.callback('🟠 High', 'sev_high'), Markup.button.callback('🔴 Critical', 'sev_critical')],
  ]);

const projectsKeyboard = () => {
  const rows = [];
  for (let i = 0; i < BUG_PROJECTS.length; i += 2) {
    const row = [
      Markup.button.callback(BUG_PROJECTS[i], `proj_${BUG_PROJECTS[i]}`),
    ];
    if (BUG_PROJECTS[i + 1]) row.push(Markup.button.callback(BUG_PROJECTS[i + 1], `proj_${BUG_PROJECTS[i + 1]}`));
    rows.push(row);
  }
  rows.push([Markup.button.callback('O‘tkazib yuborish', 'proj_skip')]);
  return Markup.inlineKeyboard(rows);
};

const statusKeyboard = (shortId, status) => {
  // status: new | triage | in_progress | done
  const s = String(status || 'new');
  const row1 = [
    Markup.button.callback('🧪 Triage', `bug_triage_${shortId}`),
    Markup.button.callback('🧑‍💻 In progress', `bug_progress_${shortId}`),
    Markup.button.callback('✅ Done', `bug_done_${shortId}`),
  ];
  const row2 = [Markup.button.callback('🗑 Close (Done)', `bug_done_${shortId}`)];
  // If already done, remove buttons
  if (s === 'done') return Markup.inlineKeyboard([]);
  return Markup.inlineKeyboard([row1, row2]);
};

const formatBugForDev = (bug) => {
  const lines = [];
  lines.push(`🪲 <b>BUG</b> <code>${escapeHTML(bug.short_id)}</code>  •  <b>${escapeHTML(bug.status)}</b>`);
  lines.push(`👤 <b>Mijoz:</b> ${escapeHTML(bug.full_name || '')} ${bug.username ? `(@${escapeHTML(bug.username)})` : ''}  •  <code>${escapeHTML(bug.user_id)}</code>`);
  if (bug.project) lines.push(`📦 <b>Project:</b> ${escapeHTML(bug.project)}`);
  if (bug.severity) lines.push(`⚠️ <b>Severity:</b> ${escapeHTML(bug.severity)}`);
  lines.push(`📝 <b>Title:</b> ${escapeHTML(bug.title)}`);
  if (bug.steps) lines.push(`\n<b>Steps:</b>\n${escapeHTML(bug.steps)}`);
  if (bug.expected) lines.push(`\n<b>Expected:</b>\n${escapeHTML(bug.expected)}`);
  if (bug.actual) lines.push(`\n<b>Actual:</b>\n${escapeHTML(bug.actual)}`);
  if (bug.environment) lines.push(`\n<b>Environment:</b>\n${escapeHTML(bug.environment)}`);
  if (Array.isArray(bug.attachments) && bug.attachments.length) {
    lines.push(`\n📎 <b>Attachments:</b> ${bug.attachments.length} ta (quyida alohida yuborilgan)`);
  }
  return lines.join('\n');
};

// ====== FLOW ======
const startBugFlow = async (ctx) => {
  const payload = { attachments: [] };
  if (BUG_PROJECTS.length) {
    await upsertSession(ctx.from.id, 'project', payload);
    return ctx.reply('Qaysi loyiha/bo‘lim bo‘yicha bug?', { parse_mode: 'HTML', ...projectsKeyboard() });
  }
  await upsertSession(ctx.from.id, 'severity', payload);
  return ctx.reply('Bug jiddiyligi (severity)ni tanlang:', { parse_mode: 'HTML', ...severityKeyboard() });
};

const promptForStep = async (ctx, step) => {
  switch (step) {
    case 'title':
      return ctx.reply('Bug nomi (qisqa sarlavha)ni yozing:');
    case 'steps':
      return ctx.reply('Qadamlar (Steps to reproduce)ni yozing. Iloji bo‘lsa raqamlab yuboring:');
    case 'expected':
      return ctx.reply('Kutilgan natija (Expected):');
    case 'actual':
      return ctx.reply('Hozirgi natija (Actual):');
    case 'environment':
      return ctx.reply('Muhit (device/OS/browser/app versiya) — ixtiyoriy. O‘tkazish uchun /skip yozing.');
    case 'attachments':
      return ctx.reply('Screenshot/video/fayl yuboring (ixtiyoriy). Tugatish uchun /done yozing.');
    default:
      return ctx.reply('Davom etamiz…');
  }
};

const finalizeBug = async (ctx, session) => {
  const p = session.payload || {};
  const short_id = nowShortId();

  const bugRow = {
    short_id,
    user_id: ctx.from.id,
    username: ctx.from.username || null,
    full_name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '),
    project: p.project || null,
    severity: p.severity || null,
    title: p.title || '(no title)',
    steps: p.steps || null,
    expected: p.expected || null,
    actual: p.actual || null,
    environment: p.environment || null,
    attachments: p.attachments || [],
    status: 'new',
    updated_at: new Date().toISOString(),
  };

  const { data: bug, error } = await supabase
    .from('bug_reports')
    .insert([bugRow])
    .select('*')
    .single();

  if (error || !bug) {
    console.error('bug_reports insert error:', error?.message);
    await ctx.reply('❌ Xatolik: bug saqlanmadi. Qayta urinib ko‘ring.');
    return;
  }

  // Send to dev group
  const devText = formatBugForDev(bug);
  let devMsg;
  try {
    devMsg = await ctx.telegram.sendMessage(DEV_GROUP_ID, devText, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...statusKeyboard(bug.short_id, bug.status),
    });
  } catch (e) {
    console.error('sendMessage to dev group failed:', e?.response?.description || e?.message || e);
  }

  if (devMsg?.message_id) {
    await supabase
      .from('bug_reports')
      .update({ dev_chat_id: DEV_GROUP_ID, dev_message_id: devMsg.message_id, updated_at: new Date().toISOString() })
      .eq('id', bug.id);

    // Copy attachments right after the main message
    const atts = Array.isArray(bug.attachments) ? bug.attachments : [];
    for (const a of atts) {
      if (!a || !a.chat_id || !a.message_id) continue;
      try {
        await ctx.telegram.copyMessage(DEV_GROUP_ID, a.chat_id, a.message_id);
      } catch (e) {
        console.warn('copyMessage attachment failed:', e?.response?.description || e?.message || e);
      }
    }
  }

  await clearSession(ctx.from.id);

  return ctx.reply(
    `✅ Qabul qilindi! Bug ID: <code>${escapeHTML(bug.short_id)}</code>\n\nStatusni tekshirish: <b>/status ${escapeHTML(bug.short_id)}</b>`,
    { parse_mode: 'HTML' }
  );
};

// ====== COMMANDS ======
bot.start(async (ctx) => {
  if (!isPrivate(ctx)) return;
  const text =
    `Assalomu alaykum! Men bug/report qabul qiluvchi botman.\n\n` +
    `🪲 Yangi bug yuborish: /bug\n` +
    `📌 Status tekshirish: /status BR-...\n` +
    `🚫 Bekor qilish: /cancel`;
  return ctx.reply(text);
});

bot.command('bug', async (ctx) => {
  if (!isPrivate(ctx)) return;
  return startBugFlow(ctx);
});

bot.command('cancel', async (ctx) => {
  if (!isPrivate(ctx)) return;
  await clearSession(ctx.from.id);
  return ctx.reply('✅ Bekor qilindi. Yangi bug uchun: /bug');
});

bot.command('skip', async (ctx) => {
  if (!isPrivate(ctx)) return;
  const sess = await getSession(ctx.from.id);
  if (!sess) return;
  if (sess.step !== 'environment') return;

  await upsertSession(ctx.from.id, 'attachments', sess.payload);
  return promptForStep(ctx, 'attachments');
});

bot.command('done', async (ctx) => {
  if (!isPrivate(ctx)) return;
  const sess = await getSession(ctx.from.id);
  if (!sess) return;
  if (sess.step !== 'attachments') return;
  return finalizeBug(ctx, sess);
});

bot.command('status', async (ctx) => {
  const arg = (ctx.message.text.split(' ').slice(1).join(' ') || '').trim();
  if (!arg) return ctx.reply('Masalan: /status BR-20260304-1200-1234');

  const { data, error } = await supabase
    .from('bug_reports')
    .select('short_id, status, created_at, updated_at')
    .eq('short_id', arg)
    .single();

  if (error || !data) return ctx.reply('Topilmadi. ID ni tekshirib ko‘ring.');

  return ctx.reply(
    `🪲 <code>${escapeHTML(data.short_id)}</code>\nStatus: <b>${escapeHTML(data.status)}</b>`,
    { parse_mode: 'HTML' }
  );
});

// ====== CALLBACKS (project, severity, status) ======
bot.action(/proj_(.+)/, async (ctx) => {
  if (!isPrivate(ctx)) return;
  const sess = await getSession(ctx.from.id);
  if (!sess || sess.step !== 'project') return ctx.answerCbQuery();

  const val = ctx.match[1];
  if (val !== 'skip') sess.payload.project = val;

  await upsertSession(ctx.from.id, 'severity', sess.payload);
  await ctx.editMessageText('Bug jiddiyligi (severity)ni tanlang:');
  return ctx.editMessageReplyMarkup(severityKeyboard().reply_markup);
});

bot.action(/sev_(low|medium|high|critical)/, async (ctx) => {
  if (!isPrivate(ctx)) return;
  const sess = await getSession(ctx.from.id);
  if (!sess || sess.step !== 'severity') return ctx.answerCbQuery();

  const m = ctx.match[1];
  sess.payload.severity = m;

  await upsertSession(ctx.from.id, 'title', sess.payload);
  await ctx.answerCbQuery('✅');
  return promptForStep(ctx, 'title');
});

bot.action(/bug_(triage|progress|done)_(BR-[A-Za-z0-9-]+)/, async (ctx) => {
  const shortId = ctx.match[2];
  if (Number(ctx.chat?.id) !== DEV_GROUP_ID) return ctx.answerCbQuery('Bu tugma faqat dev guruhda ishlaydi');
  if (!isDevAdmin(ctx.from.id)) return ctx.answerCbQuery('Ruxsat yo‘q');

  const next = ctx.match[1] === 'triage' ? 'triage' : ctx.match[1] === 'progress' ? 'in_progress' : 'done';

  const { data: bug, error } = await supabase
    .from('bug_reports')
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq('short_id', shortId)
    .select('*')
    .single();

  if (error || !bug) {
    console.error('bug_reports update error:', error?.message);
    return ctx.answerCbQuery('Xatolik');
  }

  // Update the dev message
  try {
    const text = formatBugForDev(bug);
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...statusKeyboard(bug.short_id, bug.status),
    });
  } catch (e) {
    // ignore message edit issues
  }

  // Notify customer
  try {
    await ctx.telegram.sendMessage(
      bug.user_id,
      `🪲 Bug <code>${escapeHTML(bug.short_id)}</code> statusi yangilandi: <b>${escapeHTML(bug.status)}</b>`,
      { parse_mode: 'HTML' }
    );
  } catch {
    // user might have blocked bot
  }

  return ctx.answerCbQuery('✅');
});

// ====== TEXT/ATTACHMENTS HANDLER ======
// Works for the wizard; everything else is ignored (so clients don't accidentally spam dev group)
const extractAttachmentRef = (ctx) => {
  // Keep refs to original message so we can copyMessage to the dev group
  return {
    chat_id: ctx.chat.id,
    message_id: ctx.message.message_id,
    kind: ctx.message.photo ? 'photo' : ctx.message.document ? 'document' : ctx.message.video ? 'video' : 'other',
  };
};

bot.on(['text', 'photo', 'document', 'video'], async (ctx) => {
  if (!isPrivate(ctx)) return;

  // Commands handled elsewhere
  if (ctx.message.text && ctx.message.text.startsWith('/')) return;

  const sess = await getSession(ctx.from.id);
  if (!sess) {
    // No session: gently guide to /bug
    if (ctx.message.text) {
      return ctx.reply('Bug yuborish uchun /bug ni bosing.');
    }
    return;
  }

  const p = sess.payload || {};

  // Attachments step: accept files/photos/videos
  if (sess.step === 'attachments') {
    if (ctx.message.text) {
      return ctx.reply('Fayl yuboring yoki tugatish uchun /done yozing.');
    }
    p.attachments = Array.isArray(p.attachments) ? p.attachments : [];
    p.attachments.push(extractAttachmentRef(ctx));
    await upsertSession(ctx.from.id, 'attachments', p);
    return ctx.reply('📎 Qabul qilindi. Yana yuborishingiz mumkin. Tugatish uchun /done.');
  }

  // From here: text-only steps
  if (!ctx.message.text) {
    return ctx.reply('Iltimos, matn ko‘rinishida yuboring. (Screenshotlar keyinroq bo‘ladi)');
  }

  const text = ctx.message.text.trim();
  if (!text) return;

  if (sess.step === 'title') {
    p.title = text;
    await upsertSession(ctx.from.id, 'steps', p);
    return promptForStep(ctx, 'steps');
  }

  if (sess.step === 'steps') {
    p.steps = text;
    await upsertSession(ctx.from.id, 'expected', p);
    return promptForStep(ctx, 'expected');
  }

  if (sess.step === 'expected') {
    p.expected = text;
    await upsertSession(ctx.from.id, 'actual', p);
    return promptForStep(ctx, 'actual');
  }

  if (sess.step === 'actual') {
    p.actual = text;
    await upsertSession(ctx.from.id, 'environment', p);
    return promptForStep(ctx, 'environment');
  }

  if (sess.step === 'environment') {
    p.environment = text;
    await upsertSession(ctx.from.id, 'attachments', p);
    return promptForStep(ctx, 'attachments');
  }
});

// ====== SERVERLESS HANDLER (Vercel) ======
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const ok = verifyTelegramSecret(req);
      if (!ok) return res.status(401).send('Invalid telegram secret');

      await bot.handleUpdate(req.body);
      return res.status(200).send('OK');
    }

    return res.status(200).send('Bug Report Bot is running');
  } catch (e) {
    console.error('handler error:', e);
    return res.status(200).send('OK');
  }
};
