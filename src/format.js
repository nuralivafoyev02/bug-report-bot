const { truncate } = require('./analyze');

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toReadableType(type) {
    switch (type) {
        case 'bug':
            return { label: 'Bug', icon: '🐞', header: 'New Bug Report' };
        case 'feature':
            return { label: 'Feature', icon: '✨', header: 'New Feature Request' };
        case 'done':
            return { label: 'Done', icon: '✅', header: 'Work Report' };
        case 'client_request':
            return { label: 'Client request', icon: '📩', header: 'New Client Request' };
        default:
            return { label: 'Support', icon: '🛟', header: 'New Support Report' };
    }
}

function toReadablePriority(priority) {
    switch (priority) {
        case 'urgent':
            return { label: 'Urgent', icon: '🔴' };
        case 'high':
            return { label: 'High', icon: '🟠' };
        case 'low':
            return { label: 'Low', icon: '🟢' };
        default:
            return { label: 'Medium', icon: '🟡' };
    }
}

function toReadableStatus(status) {
    switch (status) {
        case 'accepted':
            return 'Accepted';
        case 'pm_owned':
            return 'PM Owned';
        case 'assigned':
            return 'Assigned';
        case 'in_progress':
            return 'In Progress';
        case 'need_clarification':
            return 'Need Clarification';
        case 'resolved':
            return 'Resolved';
        case 'cancelled':
            return 'Cancelled';
        default:
            return 'New';
    }
}

function formatTimestamp(dateValue, timezone) {
    const date = dateValue ? new Date(dateValue) : new Date();
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date).replace(',', '');
}

function buildReportMessage(report, timezone) {
    const type = toReadableType(report.report_type);
    const priority = toReadablePriority(report.priority);
    const status = toReadableStatus(report.status);
    const tags = Array.isArray(report.tags) && report.tags.length ? report.tags.join(' ') : '#report';
    const sourceLine = report.source_username
        ? `${escapeHtml(report.source_name)} (@${escapeHtml(report.source_username)})`
        : escapeHtml(report.source_name);

    const lines = [
        `${type.icon} <b>${escapeHtml(type.header)}</b>`,
        '',
        `<b>Client:</b> ${escapeHtml(report.client_name || 'Aniqlanmagan')}`,
        `<b>Project:</b> ${escapeHtml(report.project_name || report.client_name || 'Aniqlanmagan')}`,
        `<b>From:</b> ${sourceLine}`,
        `<b>Type:</b> ${escapeHtml(type.label)}`,
        `<b>Priority:</b> ${priority.icon} ${escapeHtml(priority.label)}`,
        `<b>Tags:</b> ${escapeHtml(tags)}`,
        '',
        `<b>Summary:</b>`,
        `${escapeHtml(truncate(report.summary || 'Yangi report qabul qilindi', 500))}`,
        '',
        `<b>Details:</b>`,
        `${escapeHtml(truncate(report.details || report.raw_text || '-', 2400))}`,
        '',
        `<b>Status:</b> ${escapeHtml(status)}`,
        `<b>ID:</b> ${escapeHtml(report.report_code)}`,
        `<b>Created:</b> ${escapeHtml(formatTimestamp(report.created_at, timezone))}`
    ];

    if (report.pm_name) {
        lines.push(`<b>PM:</b> ${escapeHtml(report.pm_name)}`);
    }

    if (report.assignee_name) {
        lines.push(`<b>Assigned to:</b> ${escapeHtml(report.assignee_name)}`);
    }

    if (report.last_action) {
        lines.push(`<b>Last action:</b> ${escapeHtml(report.last_action)}`);
    }

    return lines.join('\n');
}

function buildMainKeyboard(reportCode, currentPriority) {
    return {
        inline_keyboard: [
            [
                { text: '✅ Qabul qilindi', callback_data: `r|ac|${reportCode}` },
                { text: '👤 PM oldi', callback_data: `r|pm|${reportCode}` }
            ],
            [
                { text: '🧑‍💻 Assign', callback_data: `r|as|${reportCode}` },
                { text: '⏳ Jarayonda', callback_data: `r|ip|${reportCode}` }
            ],
            [
                { text: '💬 Savol bor', callback_data: `r|ni|${reportCode}` },
                { text: '✅ Yopildi', callback_data: `r|rs|${reportCode}` }
            ],
            [
                { text: `${currentPriority === 'urgent' ? '• ' : ''}🔴 Urgent`, callback_data: `r|p|${reportCode}|urgent` },
                { text: `${currentPriority === 'high' ? '• ' : ''}🟠 High`, callback_data: `r|p|${reportCode}|high` }
            ],
            [
                { text: `${currentPriority === 'medium' ? '• ' : ''}🟡 Medium`, callback_data: `r|p|${reportCode}|medium` },
                { text: `${currentPriority === 'low' ? '• ' : ''}🟢 Low`, callback_data: `r|p|${reportCode}|low` }
            ],
            [
                { text: '❌ Bekor', callback_data: `r|cx|${reportCode}` }
            ]
        ]
    };
}

function buildAssignKeyboard(reportCode, assignees) {
    const rows = assignees.map((assignee) => [
        { text: `👤 ${assignee.label}`, callback_data: `r|g|${reportCode}|${assignee.id}` }
    ]);

    rows.push([{ text: '⬅️ Ortga', callback_data: `r|bk|${reportCode}` }]);

    return {
        inline_keyboard: rows
    };
}

module.exports = {
    escapeHtml,
    buildReportMessage,
    buildMainKeyboard,
    buildAssignKeyboard,
    toReadableStatus
};
