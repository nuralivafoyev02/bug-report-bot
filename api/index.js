const { createBot } = require('../src/bot');
const { config, getMissingRequiredEnv } = require('../src/config');

let botInstance;

function getBot() {
  if (!botInstance) {
    botInstance = createBot(config);
  }
  return botInstance;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

module.exports = async (req, res) => {
  try {
    const missing = getMissingRequiredEnv();

    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        message: 'Bug Report Bot is running',
        missing_env: missing,
        projects: config.bugProjects,
        assignees: config.assignees.map((item) => item.label)
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }

    if (missing.length) {
      return res.status(500).json({
        ok: false,
        error: `Missing env: ${missing.join(', ')}`
      });
    }

    if (config.webhookVerify) {
      const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
      if (!incomingSecret || incomingSecret !== config.webhookSecret) {
        return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
      }
    }

    const update = await readBody(req);
    const bot = getBot();
    await bot.handleUpdate(update);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Internal Server Error'
    });
  }
};
