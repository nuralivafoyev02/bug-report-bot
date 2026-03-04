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
            const [labelRaw, idRaw] = pair.split(':');
            const label = String(labelRaw || '').trim();
            const id = String(idRaw || '').trim();
            if (!label || !id) return null;
            return { label, id };
        })
        .filter(Boolean);
}

const config = {
    botToken: process.env.BOT_TOKEN || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',
    devGroupId: process.env.DEV_GROUP_ID || '',
    devAdminIds: parseIdList(process.env.DEV_ADMIN_IDS),
    assignees: parseAssignees(process.env.ASSIGNEES),
    bugProjects: parseCsv(process.env.BUG_PROJECTS),
    webhookVerify: String(process.env.TELEGRAM_WEBHOOK_VERIFY || 'false').toLowerCase() === 'true',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
    timezone: process.env.TIMEZONE || 'Asia/Tashkent'
};

function getMissingRequiredEnv() {
    const missing = [];
    if (!config.botToken) missing.push('BOT_TOKEN');
    if (!config.supabaseUrl) missing.push('SUPABASE_URL');
    if (!config.supabaseServiceKey) missing.push('SUPABASE_SERVICE_KEY');
    if (!config.devGroupId) missing.push('DEV_GROUP_ID');
    if (config.webhookVerify && !config.webhookSecret) missing.push('TELEGRAM_WEBHOOK_SECRET');
    return missing;
}

module.exports = {
    config,
    getMissingRequiredEnv
};
