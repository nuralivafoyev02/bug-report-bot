const crypto = require('crypto');
const { analyzeMessage, cleanText } = require('./analyze');
const { buildReportMessage, buildMainKeyboard, buildAssignKeyboard } = require('./format');
const { canUsePmActions } = require('./permissions');

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIdList(value) {
  return parseCsv(value).map((item) => String(item));
}

function parseAssignees(value) {
  return parseCsv(value)
    .map((pair) => {
      const [labelRaw, idRaw] = String(pair).split(':');
      const label = String(labelRaw || '').trim();
      const id = String(idRaw || '').trim();
      if (!label || !id) return null;
      return { label, id };
    })
    .filter(Boolean);
}

function getSmartIntakeConfig(env = process.env) {
  return {
    enabled: String(env.SMART_INTAKE_ENABLED || 'true').toLowerCase() !== 'false',
    autoMode: String(env.SMART_INTAKE_AUTO || 'false').toLowerCase() === 'true',
    devGroupId: String(env.DEV_GROUP_ID || env.BUG_DEV_GROUP_ID || env.BOSS_ID || '').trim(),
    devAdminIds: parseIdList(env.DEV_ADMIN_IDS),
    assignees: parseAssignees(env.ASSIGNEES),
    bugProjects: parseCsv(env.BUG_PROJECTS),
    timezone: env.TIMEZONE || 'Asia/Tashkent',
    reportsTable: env.BUG_REPORTS_TABLE || 'bug_reports',
    eventsTable: env.BUG_REPORT_EVENTS_TABLE || 'bug_report_events'
  };
}

function isPrivateChat(ctx) {
  return ctx.chat && ctx.chat.type === 'private';
}

function getSenderName(ctx) {
  const firstName = ctx.from?.first_name || '';
  const lastName = ctx.from?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || ctx.from?.username || 'Unknown';
}

function getIncomingText(ctx) {
  const message = ctx.message;
  if (!message) return '';
  if (typeof message.text === 'string' && message.text.trim()) return message.text.trim();
  if (typeof message.caption === 'string' && message.caption.trim()) return message.caption.trim();
  return '';
}

function hasAttachment(message) {
  if (!message) return false;
  return Boolean(
    message.photo ||
      message.video ||
      message.document ||
      message.audio ||
      message.voice ||
      message.animation ||
      message.sticker
  );
}

function normalizeCommandPayload(text) {
  const value = cleanText(text);
  const match = value.match(/^\/(?:bug|intake)(?:@\w+)?\s+([\s\S]+)/i);
  if (match) return match[1].trim();
  return value;
}

function buildReportCode() {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const random = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `BR-${yy}${mm}${dd}-${random}`;
}

async function insertReport(supabase, tableName, payload) {
  const { data, error } = await supabase.from(tableName).insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function getReportByCode(supabase, tableName, reportCode) {
  const { data, error } = await supabase.from(tableName).select('*').eq('report_code', reportCode).single();
  if (error) throw error;
  return data;
}

async function updateReportByCode(supabase, tableName, reportCode, patch) {
  const { data, error } = await supabase
    .from(tableName)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('report_code', reportCode)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function addEvent(supabase, tableName, reportCode, eventType, actor, payload = {}) {
  const { error } = await supabase.from(tableName).insert({
    report_code: reportCode,
    event_type: eventType,
    actor_user_id: actor?.id ? String(actor.id) : null,
    actor_name: actor?.name || null,
    payload
  });
  if (error) throw error;
}

function findAssigneeById(config, assigneeId) {
  return config.assignees.find((item) => item.id === String(assigneeId)) || null;
}

async function safeReply(ctx, text, extra = {}) {
  try {
    await ctx.reply(text, extra);
  } catch (error) {
    console.error('Smart intake reply failed:', error);
  }
}

async function safeEditReportMessage(ctx, report, config) {
  const text = buildReportMessage(report, config.timezone);
  const keyboard = buildMainKeyboard(report.report_code, report.priority);
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error) {
    const description = String(error?.description || '').toLowerCase();
    if (!description.includes('message is not modified')) throw error;
  }
}

async function notifySourceUser(bot, report, text) {
  if (!report.source_chat_id) return;
  try {
    await bot.telegram.sendMessage(report.source_chat_id, text);
  } catch (error) {
    console.error('notifySourceUser failed:', error?.description || error?.message || error);
  }
}

async function createSmartReportFromContext({ ctx, bot, supabase, config, commandMode = false }) {
  if (!config.enabled) return false;
  if (!isPrivateChat(ctx)) return false;
  if (!config.devGroupId) throw new Error('DEV_GROUP_ID (yoki BUG_DEV_GROUP_ID) sozlanmagan.');

  const incomingText = getIncomingText(ctx);
  const normalizedText = normalizeCommandPayload(incomingText);

  if (!normalizedText || normalizedText.startsWith('/start') || normalizedText.startsWith('/help')) {
    if (commandMode) {
      await safeReply(
        ctx,
        'Iltimos, /bug yoki /intake dan keyin to\'liq matn yozing.\n\nMisol:\nClient: Sayilgoh\nHolat: Login ishlamayapti, user kira olmayapti.'
      );
      return true;
    }
    return false;
  }

  if (/^\/(?:bug|intake)(?:@\w+)?$/i.test(incomingText || '')) {
    await safeReply(
      ctx,
      'Iltimos, /bug yoki /intake dan keyin to\'liq matn yozing.\n\nMisol:\nClient: Sayilgoh\nHolat: Login ishlamayapti, user kira olmayapti.'
    );
    return true;
  }

  const senderName = getSenderName(ctx);
  const senderUsername = ctx.from?.username || '';
  const analyzed = analyzeMessage({
    text: normalizedText,
    senderName,
    senderUsername,
    configuredProjects: config.bugProjects
  });

  const reportCode = buildReportCode();
  const reportRow = {
    report_code: reportCode,
    source_chat_id: String(ctx.chat.id),
    source_user_id: String(ctx.from.id),
    source_name: analyzed.source_name,
    source_username: analyzed.source_username,
    client_name: analyzed.client_name,
    project_name: analyzed.project_name,
    report_type: analyzed.report_type,
    priority: analyzed.priority,
    tags: analyzed.tags,
    summary: analyzed.summary,
    details: analyzed.details,
    raw_text: analyzed.raw_text,
    status: 'new',
    attachment_present: hasAttachment(ctx.message),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_action: 'Created'
  };

  const inserted = await insertReport(supabase, config.reportsTable, reportRow);

  let groupMessage;
  try {
    groupMessage = await bot.telegram.sendMessage(
      config.devGroupId,
      buildReportMessage(inserted, config.timezone),
      {
        parse_mode: 'HTML',
        reply_markup: buildMainKeyboard(inserted.report_code, inserted.priority)
      }
    );
  } catch (error) {
    console.error('sendMessage to dev group failed:', error?.description || error?.message || error);
    throw new Error('Bot dev guruhga yozolmadi. DEV_GROUP_ID yoki bot permissionlarini tekshiring.');
  }

  const finalReport = await updateReportByCode(supabase, config.reportsTable, inserted.report_code, {
    group_chat_id: String(config.devGroupId),
    group_message_id: String(groupMessage.message_id),
    last_action: 'Sent to dev group'
  });

  await addEvent(
    supabase,
    config.eventsTable,
    inserted.report_code,
    'created',
    { id: ctx.from.id, name: senderName },
    {
      summary: finalReport.summary,
      report_type: finalReport.report_type,
      priority: finalReport.priority
    }
  );

  if (hasAttachment(ctx.message)) {
    try {
      await bot.telegram.copyMessage(config.devGroupId, ctx.chat.id, ctx.message.message_id, {
        reply_to_message_id: groupMessage.message_id
      });
    } catch (error) {
      console.error('copyMessage failed:', error?.description || error?.message || error);
    }
  }

  await safeReply(
    ctx,
    `✅ Qabul qilindi.\nReport ID: ${finalReport.report_code}\nType: ${finalReport.report_type}\nPriority: ${finalReport.priority}\nDev guruhga yuborildi.`
  );

  return true;
}

async function handleSmartIntakeCallback({ ctx, bot, supabase, config }) {
  const payload = String(ctx.callbackQuery?.data || '');
  if (!payload.startsWith('sr|')) return false;

  if (!canUsePmActions(ctx.from?.id, config)) {
    await ctx.answerCbQuery('Sizda bu amal uchun ruxsat yo\'q.', { show_alert: true });
    return true;
  }

  const parts = payload.split('|');
  const action = parts[1];
  const reportCode = parts[2];
  const extra = parts[3];

  let report;
  try {
    report = await getReportByCode(supabase, config.reportsTable, reportCode);
  } catch (error) {
    await ctx.answerCbQuery('Report topilmadi.', { show_alert: true });
    return true;
  }

  const actor = { id: ctx.from.id, name: getSenderName(ctx) };

  if (action === 'as') {
    if (!config.assignees.length) {
      await ctx.answerCbQuery('ASSIGNEES env to\'ldirilmagan.', { show_alert: true });
      return true;
    }
    await ctx.editMessageReplyMarkup(buildAssignKeyboard(report.report_code, config.assignees));
    await ctx.answerCbQuery('Assignee tanlang.');
    return true;
  }

  if (action === 'bk') {
    await ctx.editMessageReplyMarkup(buildMainKeyboard(report.report_code, report.priority));
    await ctx.answerCbQuery('Ortga qaytildi.');
    return true;
  }

  let patch = {};
  let eventType = 'updated';
  let sourceNotification = '';

  switch (action) {
    case 'ac':
      patch = { status: 'accepted', last_action: `Accepted by ${actor.name}` };
      eventType = 'accepted';
      sourceNotification = `✅ ${report.report_code} qabul qilindi.`;
      break;
    case 'pm':
      patch = {
        status: 'pm_owned',
        pm_user_id: String(actor.id),
        pm_name: actor.name,
        last_action: `PM ownership taken by ${actor.name}`
      };
      eventType = 'pm_owned';
      sourceNotification = `👤 ${report.report_code} Project Manager tomonidan olindi.`;
      break;
    case 'ip':
      patch = { status: 'in_progress', last_action: `Moved to in progress by ${actor.name}` };
      eventType = 'in_progress';
      sourceNotification = `⏳ ${report.report_code} hozir jarayonda.`;
      break;
    case 'ni':
      patch = { status: 'need_clarification', last_action: `Clarification requested by ${actor.name}` };
      eventType = 'need_clarification';
      sourceNotification = `💬 ${report.report_code} bo'yicha qo'shimcha aniqlik kerak.`;
      break;
    case 'rs':
      patch = {
        status: 'resolved',
        closed_at: new Date().toISOString(),
        last_action: `Resolved by ${actor.name}`
      };
      eventType = 'resolved';
      sourceNotification = `✅ ${report.report_code} yopildi.`;
      break;
    case 'cx':
      patch = {
        status: 'cancelled',
        closed_at: new Date().toISOString(),
        last_action: `Cancelled by ${actor.name}`
      };
      eventType = 'cancelled';
      sourceNotification = `❌ ${report.report_code} bekor qilindi.`;
      break;
    case 'p': {
      const nextPriority = ['urgent', 'high', 'medium', 'low'].includes(extra) ? extra : report.priority;
      patch = { priority: nextPriority, last_action: `Priority changed to ${nextPriority} by ${actor.name}` };
      eventType = 'priority_changed';
      sourceNotification = `⚠️ ${report.report_code} priority: ${nextPriority}.`;
      break;
    }
    case 'g': {
      const assignee = findAssigneeById(config, extra);
      if (!assignee) {
        await ctx.answerCbQuery('Assignee topilmadi.', { show_alert: true });
        return true;
      }
      patch = {
        status: 'assigned',
        assignee_id: String(assignee.id),
        assignee_name: assignee.label,
        last_action: `Assigned to ${assignee.label} by ${actor.name}`
      };
      eventType = 'assigned';
      sourceNotification = `🧑‍💻 ${report.report_code} ${assignee.label} ga biriktirildi.`;
      break;
    }
    default:
      await ctx.answerCbQuery('Noma\'lum amal.');
      return true;
  }

  const updated = await updateReportByCode(supabase, config.reportsTable, report.report_code, patch);
  await addEvent(supabase, config.eventsTable, report.report_code, eventType, actor, patch);
  await safeEditReportMessage(ctx, updated, config);
  await ctx.answerCbQuery('Yangilandi.');
  if (sourceNotification) await notifySourceUser(bot, updated, sourceNotification);
  return true;
}

module.exports = {
  getSmartIntakeConfig,
  createSmartReportFromContext,
  handleSmartIntakeCallback,
  getIncomingText,
  hasAttachment
};
