const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// ===== CONFIG =====
const must = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env: ${key}`);
  return value;
};

const BOT_TOKEN = must('BOT_TOKEN');
const SUPABASE_URL = must('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = must('SUPABASE_SERVICE_KEY');
const TARGET_GROUP_ID = (() => {
  const value = Number(process.env.TARGET_GROUP_ID);
  if (!Number.isFinite(value)) throw new Error('TARGET_GROUP_ID must be a number');
  return value;
})();

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const UZ_TZ = 'Asia/Tashkent';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const STRICT_WEBHOOK_VERIFY = process.env.TELEGRAM_WEBHOOK_VERIFY === 'true';
const CEO_READER_IDS = parseIdList(process.env.CEO_READER_IDS);
const PM_READER_IDS = parseIdList(process.env.PM_READER_IDS);

function parseIdList(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isFinite(num));
}

// ===== GENERAL HELPERS =====
const isPrivate = (ctx) => ctx.chat && ctx.chat.type === 'private';
const isTargetGroup = (ctx) => Number(ctx.chat?.id) === TARGET_GROUP_ID;

const escapeHTML = (value) => {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const cleanText = (value) =>
  String(value || '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();

const getHeader = (req, name) => {
  const lower = name.toLowerCase();
  return req?.headers?.[lower] || req?.headers?.[name] || null;
};

const verifyTelegramSecret = (req) => {
  if (!WEBHOOK_SECRET) return true;
  const token = getHeader(req, 'x-telegram-bot-api-secret-token');
  if (!token) return !STRICT_WEBHOOK_VERIFY;
  return token === WEBHOOK_SECRET;
};

const formatDateTime = (value) => {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UZ_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  return `${map.day}.${map.month}.${map.year} ${map.hour}:${map.minute}`;
};

const nowShortId = () => {
  const date = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UZ_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `LG-${map.year}${map.month}${map.day}-${map.hour}${map.minute}-${rand}`;
};

const getUserDisplayName = (user) => {
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  if (user?.username) return `@${user.username}`;
  return String(user?.id || 'Unknown');
};

const capitalizeFirst = (text) => {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const unique = (items) => [...new Set((items || []).filter(Boolean))];

// ===== TYPE / ANALYSIS =====
const TYPE_META = {
  support: {
    label: 'Support log',
    icon: '🛠',
    needsAccept: false,
  },
  bug: {
    label: 'Bug',
    icon: '🐞',
    needsAccept: true,
  },
  proposal: {
    label: 'Taklif',
    icon: '💡',
    needsAccept: true,
  },
  feature: {
    label: 'Feature',
    icon: '✨',
    needsAccept: true,
  },
  request: {
    label: 'So‘rov',
    icon: '📥',
    needsAccept: true,
  },
};

const HASHTAG_TO_TYPE = {
  '#support': 'support',
  '#bug': 'bug',
  '#issue': 'bug',
  '#problem': 'bug',
  '#taklif': 'proposal',
  '#proposal': 'proposal',
  '#feature': 'feature',
  '#featura': 'feature',
  '#request': 'request',
  '#sorov': 'request',
  '#so\'rov': 'request',
  '#so‘rov': 'request',
};

const TYPE_KEYWORDS = {
  bug: [
    'bug', 'xatolik', 'ошибка', 'error', 'muammo', 'problem', 'issue', 'ishlamayap', 'ishlamadi', 'не работает',
    'ochilmayap', 'ochilmadi', 'crash', 'сломалось', 'noto‘g‘ri', "noto'g'ri", 'wrong', '404', '500', 'fails', 'fail'
  ],
  proposal: [
    'taklif', 'предложение', 'suggestion', 'idea', 'fikr', 'maslahat', 'takomillashtirish', 'yaxshilansa',
    'qulay bo‘lar edi', "qulay bo'lar edi", 'bo‘lsa yaxshi', "bo'lsa yaxshi"
  ],
  feature: [
    'feature', 'featura', 'new function', 'yangi funksiya', 'qo‘shilsin', "qo'shilsin", 'imkoniyat', 'function kerak',
    'modul kerak', 'add button', 'yangi bo‘lim', "yangi bo'lim"
  ],
  request: [
    'so‘radi', "so'radi", 'iltimos', 'ruxsat', 'доступ', 'dostup', 'kirish kerak', 'access', 'permission', 'authorize',
    'berib qo‘ying', "berib qo'ying", 'yaratib bering'
  ],
  support: [
    'meeting', 'митинг', 'uchrashuv', 'tushuntirildi', 'o‘rgatildi', "o'rgatildi", 'kelishildi', 'yakunlandi',
    'parol', 'login', 'yangilik yetkazildi', 'yetkazildi', 'ko‘rsatildi', "ko'rsatildi", 'amalda qilindi', 'hal qilindi',
    'bog‘lanildi', "bog'lanildi", 'telefon qilindi'
  ],
};

function extractHashtagType(lines) {
  for (const rawLine of lines) {
    const tag = String(rawLine || '').trim().toLowerCase();
    if (HASHTAG_TO_TYPE[tag]) return HASHTAG_TO_TYPE[tag];
  }
  return null;
}

function scoreType(textLower) {
  const scores = {
    support: 0,
    bug: 0,
    proposal: 0,
    feature: 0,
    request: 0,
  };
  const matched = [];

  const hasWord = (word) => textLower.includes(word.toLowerCase());

  for (const [type, words] of Object.entries(TYPE_KEYWORDS)) {
    for (const word of words) {
      if (hasWord(word)) {
        scores[type] += type === 'support' ? 1 : 2;
        matched.push(word);
      }
    }
  }

  if (scores.feature > 0 && scores.proposal > 0) {
    scores.feature += 1;
  }
  if (scores.bug > 0 && hasWord('urgent')) scores.bug += 1;
  if (scores.request > 0 && hasWord('dostup')) scores.request += 1;

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestType, bestScore] = sorted[0];
  const secondScore = sorted[1]?.[1] || 0;

  let confidence = 'low';
  if (bestScore >= 4 && bestScore - secondScore >= 2) confidence = 'high';
  else if (bestScore >= 2) confidence = 'medium';

  return {
    type: bestScore > 0 ? bestType : 'support',
    scores,
    confidence,
    matched: unique(matched),
  };
}

function analyzeLogInput(rawInput) {
  const rawText = cleanText(rawInput);
  const rawLines = rawText.split('\n').map((line) => line.trim()).filter(Boolean);
  const explicitType = extractHashtagType(rawLines);

  let workingLines = [...rawLines];
  let clientName = '';

  if (workingLines.length >= 2 && !workingLines[0].startsWith('#')) {
    clientName = workingLines[0];
    workingLines = workingLines.slice(1);
  }

  if (workingLines[0] && workingLines[0].startsWith('#')) {
    workingLines = workingLines.slice(1);
  }

  const normalizedText = capitalizeFirst(workingLines.join('\n') || rawText);
  const scoreResult = scoreType(rawText.toLowerCase());
  const type = explicitType || scoreResult.type || 'support';
  const meta = TYPE_META[type] || TYPE_META.support;

  return {
    rawText,
    clientName: clientName || 'Ko‘rsatilmagan',
    type,
    normalizedText,
    keywords: unique(scoreResult.matched),
    needsAccept: meta.needsAccept,
    detectedBy: explicitType ? 'hashtag' : 'keyword-analysis',
    confidence: explicitType ? 'high' : scoreResult.confidence,
    scores: scoreResult.scores,
  };
}

// ===== DB: SESSIONS =====
async function getSession(userId) {
  const { data, error } = await supabase
    .from('log_sessions')
    .select('user_id, step, payload')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('log_sessions select error:', error.message);
  }

  return data || null;
}

async function upsertSession(userId, step, payload) {
  const { error } = await supabase
    .from('log_sessions')
    .upsert({
      user_id: userId,
      step,
      payload: payload || {},
      updated_at: new Date().toISOString(),
    });

  if (error) console.error('log_sessions upsert error:', error.message);
}

async function clearSession(userId) {
  const { error } = await supabase.from('log_sessions').delete().eq('user_id', userId);
  if (error) console.error('log_sessions delete error:', error.message);
}

async function getLogByShortId(shortId) {
  const { data, error } = await supabase
    .from('support_logs')
    .select('*')
    .eq('short_id', shortId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('support_logs select error:', error.message);
  }

  return data || null;
}

async function getReads(logId) {
  const { data, error } = await supabase
    .from('log_reads')
    .select('role, reader_id, reader_name, read_at')
    .eq('log_id', logId)
    .order('read_at', { ascending: true });

  if (error) {
    console.error('log_reads select error:', error.message);
    return [];
  }

  return data || [];
}

// ===== MEDIA =====
function extractAttachment(ctx) {
  if (!ctx.message) return null;

  if (ctx.message.photo?.length) {
    const lastPhoto = ctx.message.photo[ctx.message.photo.length - 1];
    return {
      kind: 'photo',
      file_id: lastPhoto.file_id,
    };
  }

  if (ctx.message.document) {
    return {
      kind: 'document',
      file_id: ctx.message.document.file_id,
      file_name: ctx.message.document.file_name || null,
    };
  }

  if (ctx.message.video) {
    return {
      kind: 'video',
      file_id: ctx.message.video.file_id,
      file_name: ctx.message.video.file_name || null,
    };
  }

  return null;
}

async function sendAttachmentToGroup(ctx, attachment) {
  if (!attachment?.file_id) return;

  try {
    if (attachment.kind === 'photo') {
      await ctx.telegram.sendPhoto(TARGET_GROUP_ID, attachment.file_id);
      return;
    }

    if (attachment.kind === 'document') {
      await ctx.telegram.sendDocument(TARGET_GROUP_ID, attachment.file_id);
      return;
    }

    if (attachment.kind === 'video') {
      await ctx.telegram.sendVideo(TARGET_GROUP_ID, attachment.file_id);
      return;
    }
  } catch (error) {
    console.warn('attachment send failed:', error?.response?.description || error?.message || error);
  }
}

function getIncomingText(ctx) {
  if (ctx.message?.text) return ctx.message.text;
  if (ctx.message?.caption) return ctx.message.caption;
  return '';
}

// ===== UI =====
function buildDraftKeyboard(selectedType) {
  const typeButtonsRow1 = [
    Markup.button.callback(selectedType === 'support' ? '✅ Support' : 'Support', 'draft_type_support'),
    Markup.button.callback(selectedType === 'bug' ? '✅ Bug' : 'Bug', 'draft_type_bug'),
    Markup.button.callback(selectedType === 'proposal' ? '✅ Taklif' : 'Taklif', 'draft_type_proposal'),
  ];

  const typeButtonsRow2 = [
    Markup.button.callback(selectedType === 'feature' ? '✅ Feature' : 'Feature', 'draft_type_feature'),
    Markup.button.callback(selectedType === 'request' ? '✅ So‘rov' : 'So‘rov', 'draft_type_request'),
  ];

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✏️ Tahrirlash', 'draft_edit'),
      Markup.button.callback('🚀 Yuborish', 'draft_send'),
    ],
    [Markup.button.callback('🗑 Bekor qilish', 'draft_cancel')],
    typeButtonsRow1,
    typeButtonsRow2,
  ]);
}

function formatDraftPreview(payload, user) {
  const typeMeta = TYPE_META[payload.type] || TYPE_META.support;
  const lines = [];
  lines.push('📋 <b>Yuborishdan oldingi ko‘rinish</b>');
  lines.push('');
  lines.push(`${typeMeta.icon} <b>Turi:</b> ${escapeHTML(typeMeta.label)}`);
  lines.push(`🏢 <b>Obyekt:</b> ${escapeHTML(payload.clientName || 'Ko‘rsatilmagan')}`);
  lines.push(`📝 <b>Izoh:</b> ${escapeHTML(payload.normalizedText || '')}\n`);
  lines.push(`👤 <b>Yuboruvchi:</b> ${escapeHTML(getUserDisplayName(user))}${user?.username ? ` (@${escapeHTML(user.username)})` : ''}`);
  lines.push(`🕒 <b>Sana:</b> ${escapeHTML(formatDateTime())}`);

  if (Array.isArray(payload.attachments) && payload.attachments.length) {
    lines.push(`📎 <b>Ilovalar:</b> ${payload.attachments.length} ta`);
  }

  lines.push(`🤖 <b>Bot aniqladi:</b> ${escapeHTML(typeMeta.label)} (${escapeHTML(payload.confidence || 'low')})`);

  if (Array.isArray(payload.keywords) && payload.keywords.length) {
    lines.push(`🔎 <b>Signal so‘zlar:</b> ${escapeHTML(payload.keywords.slice(0, 6).join(', '))}`);
  }

  lines.push('');
  lines.push('Pastdagi tugmalar orqali tahrirlang yoki yuboring.');

  return lines.join('\n');
}

function buildReadsText(reads) {
  const hasCEO = reads.some((item) => item.role === 'CEO');
  const hasPM = reads.some((item) => item.role === 'PM');

  const labels = [];
  if (hasCEO) labels.push('CEO');
  if (hasPM) labels.push('PM');

  return labels.length ? labels.join(', ') : 'Hali belgilanmagan';
}

function buildTargetKeyboard(log, reads) {
  const hasCEO = reads.some((item) => item.role === 'CEO');
  const hasPM = reads.some((item) => item.role === 'PM');

  const rows = [
    [
      Markup.button.callback(hasCEO ? '✅ CEO o‘qidi' : 'CEO o‘qidi👀', `log_read_ceo_${log.short_id}`),
      Markup.button.callback(hasPM ? '✅ PM o‘qidi' : 'PM o‘qidi👀', `log_read_pm_${log.short_id}`),
    ],
  ];

  if (log.needs_accept && !log.is_accepted) {
    rows.push([Markup.button.callback('✅ Qabul qilish', `log_accept_${log.short_id}`)]);
  }

  return Markup.inlineKeyboard(rows);
}

function formatGroupLog(log, reads) {
  const typeMeta = TYPE_META[log.type] || TYPE_META.support;
  const senderLine = log.username
    ? `${escapeHTML(log.full_name || '')} (@${escapeHTML(log.username)})`
    : `${escapeHTML(log.full_name || '')} • <code>${escapeHTML(log.user_id)}</code>`;

  const lines = [];
  lines.push(`${typeMeta.icon} <b>${escapeHTML(typeMeta.label)}</b> <code>${escapeHTML(log.short_id)}</code>`);
  lines.push(`🏢 <b>Obyekt:</b> ${escapeHTML(log.client_name || 'Ko‘rsatilmagan')}`);
  lines.push(`📝 <b>Izoh:</b> ${escapeHTML(log.normalized_text || '')}\n`);
  lines.push(`👤 <b>Yubordi:</b> ${senderLine}`);
  lines.push(`🕒 <b>Sana:</b> ${escapeHTML(formatDateTime(log.created_at))}`);

  if (Array.isArray(log.attachments) && log.attachments.length) {
    lines.push(`📎 <b>Ilovalar:</b> ${log.attachments.length} ta`);
  }

  if (log.needs_accept) {
    const status = log.is_accepted ? 'Qabul qilindi' : 'Kutilmoqda';
    lines.push(`📌 <b>Holat:</b> ${escapeHTML(status)}`);
  }

  lines.push(`👀 <b>O‘qiganlar:</b> ${escapeHTML(buildReadsText(reads))}`);

  if (log.is_accepted && log.accepted_at) {
    lines.push(`🗓 <b>Qabul qilingan vaqt:</b> ${escapeHTML(formatDateTime(log.accepted_at))}`);
  }

  return lines.join('\n');
}

async function refreshDraftPreview(ctx, payload) {
  await ctx.editMessageText(formatDraftPreview(payload, ctx.from), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...buildDraftKeyboard(payload.type),
  });
}

async function refreshGroupMessage(ctx, log) {
  const reads = await getReads(log.id);
  await ctx.editMessageText(formatGroupLog(log, reads), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...buildTargetKeyboard(log, reads),
  });
}

function canMarkRole(userId, role) {
  const numericUserId = Number(userId);
  if (role === 'CEO') {
    if (!CEO_READER_IDS.length) return true;
    return CEO_READER_IDS.includes(numericUserId);
  }

  if (role === 'PM') {
    if (!PM_READER_IDS.length) return true;
    return PM_READER_IDS.includes(numericUserId);
  }

  return true;
}

// ===== FLOW =====
async function startNewDraft(ctx) {
  await upsertSession(ctx.from.id, 'awaiting_input', { attachments: [] });
  return ctx.reply(
    'Yangi log yuboring.\n\n' +
    'Tavsiya etiladigan format:\n' +
    '1-qator: obyekt nomi\n' +
    '2-qator: ixtiyoriy #support / #bug / #taklif / #feature\n' +
    'Keyin: batafsil izoh qoldiring\n\n' +
    'Rasm/video/fayl yuborsangiz, caption ichiga logni yozing. Caption bo‘lmasa ham media saqlanadi, keyin matn yuborasiz.',
    { disable_web_page_preview: true }
  );
}

async function finalizeAndSend(ctx, payload) {
  const row = {
    short_id: nowShortId(),
    user_id: ctx.from.id,
    username: ctx.from.username || null,
    full_name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ').trim() || getUserDisplayName(ctx.from),
    raw_text: payload.rawText || '',
    client_name: payload.clientName || 'Ko‘rsatilmagan',
    type: payload.type || 'support',
    normalized_text: payload.normalizedText || '',
    keywords: payload.keywords || [],
    needs_accept: Boolean(payload.needsAccept),
    is_accepted: false,
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    updated_at: new Date().toISOString(),
  };

  const { data: savedLog, error } = await supabase
    .from('support_logs')
    .insert([row])
    .select('*')
    .single();

  if (error || !savedLog) {
    console.error('support_logs insert error:', error?.message);
    await ctx.reply('❌ Log saqlanmadi. Supabase jadvallarini va env sozlamalarni tekshirib qayta urinib ko‘ring.');
    return;
  }

  let targetMessage = null;

  try {
    targetMessage = await ctx.telegram.sendMessage(TARGET_GROUP_ID, formatGroupLog(savedLog, []), {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...buildTargetKeyboard(savedLog, []),
    });
  } catch (sendError) {
    console.error('sendMessage to target group failed:', sendError?.response?.description || sendError?.message || sendError);
    await ctx.reply('❌ Guruhga yuborilmadi. Bot guruhda admin ekanini va TARGET_GROUP_ID to‘g‘ri ekanini tekshiring.');
    return;
  }

  if (targetMessage?.message_id) {
    await supabase
      .from('support_logs')
      .update({
        target_chat_id: TARGET_GROUP_ID,
        target_message_id: targetMessage.message_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', savedLog.id);
  }

  const attachments = Array.isArray(savedLog.attachments) ? savedLog.attachments : [];
  for (const attachment of attachments) {
    await sendAttachmentToGroup(ctx, attachment);
  }

  await clearSession(ctx.from.id);

  return ctx.reply(
    `✅ Log guruhga yuborildi.\nID: <code>${escapeHTML(savedLog.short_id)}</code>`,
    { parse_mode: 'HTML' }
  );
}

async function consumeMessageAsDraft(ctx, existingSession) {
  const session = existingSession || { step: 'awaiting_input', payload: { attachments: [] } };
  const incomingText = cleanText(getIncomingText(ctx));
  const attachment = extractAttachment(ctx);
  const payload = {
    ...(session.payload || {}),
    attachments: Array.isArray(session.payload?.attachments) ? [...session.payload.attachments] : [],
  };

  if (attachment) {
    payload.attachments.push(attachment);
  }

  if (!incomingText) {
    if (attachment) {
      await upsertSession(ctx.from.id, session.step === 'preview' ? 'preview' : 'awaiting_input', payload);
      return ctx.reply('📎 Media saqlandi. Endi log matnini yuboring yoki caption bilan qayta yuboring.');
    }

    return ctx.reply('Iltimos, log matnini yuboring. Rasm/video bo‘lsa caption ichiga izoh yozing.');
  }

  const analysis = analyzeLogInput(incomingText);
  const nextPayload = {
    ...payload,
    rawText: analysis.rawText,
    clientName: analysis.clientName,
    type: payload.manualType ? payload.type : analysis.type,
    normalizedText: analysis.normalizedText,
    keywords: analysis.keywords,
    needsAccept: TYPE_META[payload.manualType ? payload.type : analysis.type]?.needsAccept || false,
    detectedBy: analysis.detectedBy,
    confidence: analysis.confidence,
    scores: analysis.scores,
  };

  await upsertSession(ctx.from.id, 'preview', nextPayload);
  return ctx.reply(formatDraftPreview(nextPayload, ctx.from), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...buildDraftKeyboard(nextPayload.type),
  });
}

// ===== COMMANDS =====
bot.start(async (ctx) => {
  if (!isPrivate(ctx)) return;
  return startNewDraft(ctx);
});

bot.command('newlog', async (ctx) => {
  if (!isPrivate(ctx)) return;
  return startNewDraft(ctx);
});

bot.command('cancel', async (ctx) => {
  if (!isPrivate(ctx)) return;
  await clearSession(ctx.from.id);
  return ctx.reply('✅ Joriy draft bekor qilindi. Yangi log uchun /start yoki /newlog bosing.');
});

bot.command('send', async (ctx) => {
  if (!isPrivate(ctx)) return;
  const session = await getSession(ctx.from.id);
  if (!session || session.step !== 'preview') {
    return ctx.reply('Yuborishga tayyor draft topilmadi. /start bosing va log yuboring.');
  }

  return finalizeAndSend(ctx, session.payload || {});
});

bot.command('status', async (ctx) => {
  const shortId = String(ctx.message?.text || '')
    .split(' ')
    .slice(1)
    .join(' ')
    .trim();

  if (!shortId) {
    return ctx.reply('Masalan: /status LG-20260304-1045-1234');
  }

  const log = await getLogByShortId(shortId);
  if (!log) return ctx.reply('Topilmadi. ID ni tekshirib qayta urinib ko‘ring.');

  const reads = await getReads(log.id);
  const typeMeta = TYPE_META[log.type] || TYPE_META.support;
  const statusText = log.needs_accept ? (log.is_accepted ? 'Qabul qilindi' : 'Kutilmoqda') : 'Ma’lumot sifatida yuborilgan';

  return ctx.reply(
    `${typeMeta.icon} <b>${escapeHTML(typeMeta.label)}</b> <code>${escapeHTML(log.short_id)}</code>\n` +
    `📌 <b>Holat:</b> ${escapeHTML(statusText)}\n` +
    `👀 <b>O‘qiganlar:</b> ${escapeHTML(buildReadsText(reads))}`,
    { parse_mode: 'HTML' }
  );
});

// ===== PRIVATE CALLBACKS =====
bot.action('draft_edit', async (ctx) => {
  if (!isPrivate(ctx)) return ctx.answerCbQuery();

  const session = await getSession(ctx.from.id);
  if (!session) return ctx.answerCbQuery('Draft topilmadi');

  await upsertSession(ctx.from.id, 'editing_text', session.payload || {});
  await ctx.answerCbQuery('✏️');
  return ctx.reply('Yangi matn yuboring. Ilova fayllar saqlanadi, faqat matn yangilanadi.');
});

bot.action('draft_cancel', async (ctx) => {
  if (!isPrivate(ctx)) return ctx.answerCbQuery();
  await clearSession(ctx.from.id);
  await ctx.answerCbQuery('Bekor qilindi');
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch (_) {
    // ignore
  }
  return ctx.reply('✅ Draft bekor qilindi.');
});

bot.action('draft_send', async (ctx) => {
  if (!isPrivate(ctx)) return ctx.answerCbQuery();

  const session = await getSession(ctx.from.id);
  if (!session || session.step !== 'preview') {
    return ctx.answerCbQuery('Draft tayyor emas');
  }

  await ctx.answerCbQuery('Yuborilmoqda...');
  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch (_) {
    // ignore
  }
  return finalizeAndSend(ctx, session.payload || {});
});

bot.action(/draft_type_(support|bug|proposal|feature|request)/, async (ctx) => {
  if (!isPrivate(ctx)) return ctx.answerCbQuery();

  const session = await getSession(ctx.from.id);
  if (!session || session.step !== 'preview') return ctx.answerCbQuery('Draft topilmadi');

  const selectedType = ctx.match[1];
  const nextPayload = {
    ...(session.payload || {}),
    type: selectedType,
    manualType: true,
    needsAccept: TYPE_META[selectedType]?.needsAccept || false,
  };

  await upsertSession(ctx.from.id, 'preview', nextPayload);
  await ctx.answerCbQuery(`Turi: ${TYPE_META[selectedType]?.label || selectedType}`);
  return refreshDraftPreview(ctx, nextPayload);
});

// ===== GROUP CALLBACKS =====
bot.action(/log_read_(ceo|pm)_(LG-[A-Za-z0-9-]+)/, async (ctx) => {
  if (!isTargetGroup(ctx)) return ctx.answerCbQuery('Bu tugma faqat guruhda ishlaydi');

  const role = ctx.match[1] === 'ceo' ? 'CEO' : 'PM';
  const shortId = ctx.match[2];

  if (!canMarkRole(ctx.from.id, role)) {
    return ctx.answerCbQuery(`${role} sifatida belgilashga ruxsat yo‘q`);
  }

  const log = await getLogByShortId(shortId);
  if (!log) return ctx.answerCbQuery('Log topilmadi');

  const { error } = await supabase
    .from('log_reads')
    .upsert(
      {
        log_id: log.id,
        role,
        reader_id: ctx.from.id,
        reader_name: getUserDisplayName(ctx.from),
        read_at: new Date().toISOString(),
      },
      { onConflict: 'log_id,role' }
    );

  if (error) {
    console.error('log_reads upsert error:', error.message);
    return ctx.answerCbQuery('Xatolik');
  }

  await ctx.answerCbQuery(`${role} o‘qidi deb belgilandi`);
  return refreshGroupMessage(ctx, log);
});

bot.action(/log_accept_(LG-[A-Za-z0-9-]+)/, async (ctx) => {
  if (!isTargetGroup(ctx)) return ctx.answerCbQuery('Bu tugma faqat guruhda ishlaydi');

  const shortId = ctx.match[1];
  const log = await getLogByShortId(shortId);

  if (!log) return ctx.answerCbQuery('Log topilmadi');
  if (!log.needs_accept) return ctx.answerCbQuery('Bu log qabul qilinadigan turga kirmaydi');
  if (log.is_accepted) return ctx.answerCbQuery('Allaqachon qabul qilingan');

  const { data: updatedLog, error } = await supabase
    .from('support_logs')
    .update({
      is_accepted: true,
      accepted_by: ctx.from.id,
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', log.id)
    .select('*')
    .single();

  if (error || !updatedLog) {
    console.error('support_logs accept update error:', error?.message);
    return ctx.answerCbQuery('Xatolik');
  }

  await ctx.answerCbQuery('Qabul qilindi');

  try {
    await ctx.telegram.sendMessage(
      updatedLog.user_id,
      `✅ Siz yuborgan <code>${escapeHTML(updatedLog.short_id)}</code> logi qabul qilindi.`,
      { parse_mode: 'HTML' }
    );
  } catch (_) {
    // user may block the bot
  }

  return refreshGroupMessage(ctx, updatedLog);
});

// ===== INCOMING TEXT / MEDIA =====
bot.on(['text', 'photo', 'document', 'video'], async (ctx) => {
  if (!isPrivate(ctx)) return;

  if (ctx.message?.text && ctx.message.text.startsWith('/')) return;

  const session = await getSession(ctx.from.id);

  if (!session) {
    return consumeMessageAsDraft(ctx, null);
  }

  if (session.step === 'awaiting_input' || session.step === 'editing_text' || session.step === 'preview') {
    return consumeMessageAsDraft(ctx, session);
  }

  return ctx.reply('Noma’lum holat. /cancel bosing va qayta boshlang.');
});

// ===== VERCEL HANDLER =====
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const secretOk = verifyTelegramSecret(req);
      if (!secretOk) return res.status(401).send('Invalid telegram secret');

      await bot.handleUpdate(req.body);
      return res.status(200).send('OK');
    }

    return res.status(200).send('Bot is running tree clean');
  } catch (error) {
    console.error('handler error:', error);
    return res.status(200).send('OK');
  }
};
