function cleanText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(maxLength - 1, 1)).trim()}…`;
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function scoreByKeywords(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.reduce((score, keyword) => {
    if (lower.includes(keyword)) return score + 1;
    return score;
  }, 0);
}

function firstSentence(text) {
  const normalized = text.replace(/\n+/g, ' ').trim();
  if (!normalized) return '';
  const match = normalized.match(/(.+?[.!?])(?:\s|$)/);
  return truncate((match ? match[1] : normalized).trim(), 110);
}

function extractFirstMeaningfulLine(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] || '';
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLabeledValue(text, labels) {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    for (const label of labels) {
      const safeLabel = escapeRegex(label);
      const pattern = new RegExp(`^${safeLabel}\\s*[:\\-]\\s*(.+)$`, 'i');
      const match = trimmed.match(pattern);
      if (match) return match[1].trim();
    }
  }
  return '';
}

function guessClientName(text) {
  const labeled = extractLabeledValue(text, ['client', 'mijoz', 'project', 'loyiha']);
  if (labeled) return truncate(labeled, 80);

  const firstLine = extractFirstMeaningfulLine(text);
  if (!firstLine) return 'Aniqlanmagan';

  const looksLikeHeader =
    firstLine.length <= 60 &&
    !/[.!?]/.test(firstLine) &&
    !/\b(muammo|xatolik|error|qilindi|berildi|hal|kira|ishlamayapti|so'radi|so‘radi)\b/i.test(firstLine);

  if (looksLikeHeader) return truncate(firstLine, 80);

  const words = firstLine.split(' ').filter(Boolean).slice(0, 4).join(' ');
  return truncate(words || 'Aniqlanmagan', 80);
}

function detectType(text) {
  const bugKeywords = [
    'bug', 'xatolik', 'error', 'muammo', 'ishlamayapti', 'ishlamadi', 'ochilmayapti',
    'kira olmayapti', 'kirmayapti', 'tushmayapti', 'to\'xtab qoldi', 'to‘xtab qoldi'
  ];
  const featureKeywords = [
    'taklif', 'feature', 'yangi funksiya', 'qo\'shish kerak', 'qo‘shish kerak', 'kerak bo\'ladi',
    'kerak bo‘ladi', 'so\'radi', 'so‘radi', 'request', 'talab'
  ];
  const doneKeywords = [
    'hal qilindi', 'bajarildi', 'yuborildi', 'tashlab berildi', 'o\'rgatildi', 'o‘rgatildi',
    'tushuntirildi', 'yangilik yetkazildi', 'meeting qilindi', 'kelishildi', 'amalga oshirildi'
  ];
  const supportKeywords = [
    'support', 'tushuntirildi', 'o\'rgatildi', 'o‘rgatildi', 'meeting', 'telefon qilindi',
    'bog\'lanildi', 'bog‘lanildi', 'login parol', 'parol'
  ];

  const textLower = text.toLowerCase();
  const scores = {
    bug: scoreByKeywords(textLower, bugKeywords),
    feature: scoreByKeywords(textLower, featureKeywords),
    done: scoreByKeywords(textLower, doneKeywords),
    support: scoreByKeywords(textLower, supportKeywords)
  };

  if (scores.done >= 2 && scores.done >= scores.bug) return 'done';
  if (scores.feature >= 2 && scores.feature >= scores.bug) return 'feature';
  if (scores.bug >= 1 && scores.bug >= scores.support) return 'bug';
  if (scores.support >= 1) return 'support';
  if (/\b(so\'radi|so‘radi|kerak|talab)\b/i.test(textLower)) return 'client_request';
  return 'support';
}

function detectPriority(text, type) {
  const lower = text.toLowerCase();
  const urgentTerms = [
    'shoshilinch', 'tez', 'hozir', 'kritik', 'bugun ish to\'xtab qoldi', 'bugun ish to‘xtab qoldi',
    'hamma to\'xtab qoldi', 'hamma to‘xtab qoldi', 'urgent'
  ];
  const highTerms = [
    'kira olmayapti', 'kirmayapti', 'login', 'parol', 'dostup', 'to\'lov', 'to‘lov',
    'asosiy', 'main', 'ochilmayapti'
  ];

  if (urgentTerms.some((term) => lower.includes(term))) return 'urgent';
  if (type === 'bug' && highTerms.some((term) => lower.includes(term))) return 'high';
  if (type === 'feature') return 'medium';
  if (type === 'done') return 'low';
  if (type === 'client_request') return 'medium';
  return 'medium';
}

function detectTags(text, type) {
  const lower = text.toLowerCase();
  const tags = [];
  const push = (tag, terms) => {
    if (terms.some((term) => lower.includes(term))) tags.push(tag);
  };

  const typeTagMap = {
    bug: '#bug',
    support: '#support',
    feature: '#feature',
    done: '#done',
    client_request: '#client_request'
  };

  tags.push(typeTagMap[type] || '#report');

  push('#login', ['login', 'parol', 'password']);
  push('#access', ['dostup', 'kirish', 'access', 'kira olmayapti', 'kirmayapti']);
  push('#warehouse', ['ombor', 'omborxona', 'sklad']);
  push('#estimate', ['smeta']);
  push('#meeting', ['meeting', 'uchrashuv']);
  push('#communication', ['telefon', 'bog\'lan', 'bog‘lan', 'javob bermadi', 'ko\'tarmadi', 'ko‘tarmadi']);
  push('#payment', ['to\'lov', 'to‘lov', 'kassa']);
  push('#update', ['yangilik', 'update']);
  push('#report', ['hisobot']);
  push('#training', ['o\'rgat', 'o‘rgat', 'tushuntir']);

  return uniq(tags);
}

function buildSummary(text, type, tags) {
  const explicitSummary = extractLabeledValue(text, ['summary', 'qisqacha', 'sarlavha']);
  if (explicitSummary) return truncate(explicitSummary, 120);

  const lower = text.toLowerCase();

  if (type === 'bug' && tags.includes('#login')) return 'Login / kirish bilan bog\'liq muammo aniqlandi';
  if (type === 'bug' && tags.includes('#payment')) return 'To\'lov jarayonida muammo aniqlandi';
  if (type === 'bug' && tags.includes('#warehouse')) return 'Ombor bilan bog\'liq xatolik aniqlandi';
  if (type === 'done' && tags.includes('#login')) return 'Login / parol bo\'yicha ish bajarildi';
  if (type === 'done' && tags.includes('#training')) return 'Tushuntirish / o\'rgatish ishlari bajarildi';
  if (type === 'support' && tags.includes('#meeting')) return 'Mijoz bilan ishchi uchrashuv o\'tkazildi';
  if (type === 'client_request' && tags.includes('#access')) return 'Kirish ruxsati bo\'yicha so\'rov qabul qilindi';
  if (type === 'feature') return 'Yangi talab / taklif qabul qilindi';

  const sentence = firstSentence(text);
  if (sentence) return sentence;

  if (lower) return truncate(lower, 120);
  return 'Yangi report qabul qilindi';
}

function extractDetails(text, clientName) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return '';

  const labeledLines = lines.filter((line) => {
    return !/^(client|mijoz|project|loyiha|summary|qisqacha|sarlavha)\s*[:\-]/i.test(line);
  });

  if (labeledLines[0] && labeledLines[0] === clientName) {
    labeledLines.shift();
  }

  const details = labeledLines.join('\n');
  return truncate(details || text, 2600);
}

function buildProjectName(clientName, configuredProjects = []) {
  const exact = configuredProjects.find((item) => item.toLowerCase() === clientName.toLowerCase());
  return exact || clientName;
}

function analyzeMessage({ text, senderName, senderUsername, configuredProjects = [] }) {
  const rawText = cleanText(text);
  const clientName = guessClientName(rawText);
  const reportType = detectType(rawText);
  const priority = detectPriority(rawText, reportType);
  const tags = detectTags(rawText, reportType);
  const summary = buildSummary(rawText, reportType, tags);
  const details = extractDetails(rawText, clientName);
  const projectName = buildProjectName(clientName, configuredProjects);

  return {
    source_name: senderName || 'Unknown',
    source_username: senderUsername || '',
    raw_text: rawText,
    client_name: clientName,
    project_name: projectName,
    report_type: reportType,
    priority,
    tags,
    summary,
    details
  };
}

module.exports = {
  analyzeMessage,
  cleanText,
  truncate
};
