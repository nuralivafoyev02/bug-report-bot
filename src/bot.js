const { Telegraf } = require('telegraf');
const { analyzeMessage, cleanText } = require('./analyze');
const { insertReport, getReportByCode, updateReportByCode, addEvent } = require('./db');
const { buildReportMessage, buildMainKeyboard, buildAssignKeyboard } = require('./format');
const { canUsePmActions } = require('./permissions');

function buildReportCode() {
    const now = new Date();
    const yy = String(now.getUTCFullYear()).slice(-2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `BR-${yy}${mm}${dd}-${random}`;
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

    if (typeof message.text === 'string' && message.text.trim()) {
        return message.text.trim();
    }

    if (typeof message.caption === 'string' && message.caption.trim()) {
        return message.caption.trim();
    }

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
    const reportCommandMatch = value.match(/^\/(report|bug)(?:@\w+)?\s+([\s\S]+)/i);
    if (reportCommandMatch) {
        return reportCommandMatch[2].trim();
    }
    return value;
}

async function safeReply(ctx, text, extra = {}) {
    try {
        await ctx.reply(text, extra);
    } catch (error) {
        console.error('Reply failed:', error);
    }
}

async function safeEditReportMessage(ctx, report, config) {
    const text = buildReportMessage(report, config.timezone);
    const keyboard = buildMainKeyboard(report.report_code, report.priority);

    try {
        await ctx.editMessageText(text, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    } catch (error) {
        const description = error?.description || '';
        if (!String(description).toLowerCase().includes('message is not modified')) {
            throw error;
        }
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

function findAssigneeById(config, assigneeId) {
    return config.assignees.find((item) => item.id === String(assigneeId)) || null;
}

async function createReportFromContext(ctx, config, bot) {
    const incomingText = getIncomingText(ctx);
    const normalizedText = normalizeCommandPayload(incomingText);

    if (!normalizedText || normalizedText.startsWith('/start') || normalizedText.startsWith('/help')) {
        return false;
    }

    if (normalizedText.startsWith('/report') || normalizedText.startsWith('/bug')) {
        await safeReply(
            ctx,
            'Iltimos, /report yoki /bug dan keyin to\'liq matn yozing.\n\nMisol:\nClient: Sayilgoh\nHolat: Login ishlamayapti, user kira olmayapti.'
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

    const inserted = await insertReport(reportRow);

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

    let finalReport = inserted;

    finalReport = await updateReportByCode(inserted.report_code, {
        group_chat_id: String(config.devGroupId),
        group_message_id: String(groupMessage.message_id),
        last_action: 'Sent to dev group'
    });

    await addEvent(inserted.report_code, 'created', {
        id: ctx.from.id,
        name: senderName
    }, {
        summary: finalReport.summary,
        report_type: finalReport.report_type,
        priority: finalReport.priority
    });

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

async function handleCallbackAction(ctx, config, bot) {
    const payload = String(ctx.callbackQuery?.data || '');
    if (!payload.startsWith('r|')) return;

    const parts = payload.split('|');
    const action = parts[1];
    const reportCode = parts[2];
    const extra = parts[3];

    if (!canUsePmActions(ctx.from?.id, config)) {
        await ctx.answerCbQuery('Sizda bu amal uchun ruxsat yo\'q.', { show_alert: true });
        return;
    }

    let report;
    try {
        report = await getReportByCode(reportCode);
    } catch (error) {
        await ctx.answerCbQuery('Report topilmadi.', { show_alert: true });
        return;
    }

    const actor = {
        id: ctx.from.id,
        name: getSenderName(ctx)
    };

    if (action === 'as') {
        if (!config.assignees.length) {
            await ctx.answerCbQuery('ASSIGNEES env to\'ldirilmagan.', { show_alert: true });
            return;
        }

        await ctx.editMessageReplyMarkup(buildAssignKeyboard(report.report_code, config.assignees));
        await ctx.answerCbQuery('Assignee tanlang.');
        return;
    }

    if (action === 'bk') {
        await ctx.editMessageReplyMarkup(buildMainKeyboard(report.report_code, report.priority));
        await ctx.answerCbQuery('Ortga qaytildi.');
        return;
    }

    let patch = {};
    let eventType = 'updated';
    let sourceNotification = '';

    switch (action) {
        case 'ac':
            patch = {
                status: 'accepted',
                last_action: `Accepted by ${actor.name}`
            };
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
            patch = {
                status: 'in_progress',
                last_action: `Moved to in progress by ${actor.name}`
            };
            eventType = 'in_progress';
            sourceNotification = `⏳ ${report.report_code} hozir jarayonda.`;
            break;
        case 'ni':
            patch = {
                status: 'need_clarification',
                last_action: `Clarification requested by ${actor.name}`
            };
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
            patch = {
                priority: nextPriority,
                last_action: `Priority changed to ${nextPriority} by ${actor.name}`
            };
            eventType = 'priority_changed';
            sourceNotification = `⚠️ ${report.report_code} priority: ${nextPriority}.`;
            break;
        }
        case 'g': {
            const assignee = findAssigneeById(config, extra);
            if (!assignee) {
                await ctx.answerCbQuery('Assignee topilmadi.', { show_alert: true });
                return;
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
            return;
    }

    const updated = await updateReportByCode(report.report_code, patch);
    await addEvent(report.report_code, eventType, actor, patch);
    await safeEditReportMessage(ctx, updated, config);
    await ctx.answerCbQuery('Yangilandi.');

    if (sourceNotification) {
        await notifySourceUser(bot, updated, sourceNotification);
    }
}

function createBot(config) {
    const bot = new Telegraf(config.botToken);

    bot.start(async (ctx) => {
        await safeReply(
            ctx,
            'Assalomu alaykum. Menga bir martada to\'liq report yuboring.\n\nMisol:\nClient: Sayilgoh\nHolat: Login ishlamayapti, user kira olmayapti, ish to\'xtab qoldi.\n\nYoki oddiy erkin matn ham bo\'ladi.'
        );
    });

    bot.help(async (ctx) => {
        await safeReply(
            ctx,
            'Ishlash tartibi:\n1) Botga private chatda bitta to\'liq matn yuborasiz\n2) Bot type / priority / tag / summary chiqaradi\n3) Dev guruhga PM tugmalari bilan yuboradi\n\nKomanda: /report <matn> yoki shunchaki matnning o\'zi.'
        );
    });

    bot.command(['report', 'bug'], async (ctx) => {
        if (!isPrivateChat(ctx)) {
            await safeReply(ctx, 'Report yuborish uchun botga private chatda yozing.');
            return;
        }

        try {
            await createReportFromContext(ctx, config, bot);
        } catch (error) {
            console.error('command create report error:', error);
            await safeReply(ctx, `❌ Xatolik: ${error.message || 'report yaratib bo\'lmadi.'}`);
        }
    });

    bot.on('callback_query', async (ctx) => {
        try {
            await handleCallbackAction(ctx, config, bot);
        } catch (error) {
            console.error('callback error:', error);
            try {
                await ctx.answerCbQuery('Xatolik yuz berdi.', { show_alert: true });
            } catch (_) { }
        }
    });

    bot.on(['text', 'photo', 'video', 'document', 'audio', 'voice', 'animation'], async (ctx) => {
        if (!isPrivateChat(ctx)) return;

        const text = getIncomingText(ctx);
        if (!text) {
            await safeReply(ctx, 'Iltimos, matn yuboring. Agar media yuborsangiz, caption ichiga to\'liq report yozing.');
            return;
        }

        if (text.startsWith('/start') || text.startsWith('/help')) return;

        try {
            await createReportFromContext(ctx, config, bot);
        } catch (error) {
            console.error('message create report error:', error);
            await safeReply(ctx, `❌ Xatolik: ${error.message || 'report yaratib bo\'lmadi.'}`);
        }
    });

    bot.catch((error) => {
        console.error('Telegraf global error:', error);
    });

    return bot;
}

module.exports = {
    createBot
};
