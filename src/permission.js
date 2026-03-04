function canUsePmActions(userId, config) {
    const actorId = String(userId || '');
    if (!actorId) return false;

    if (!config.devAdminIds.length) {
        return true;
    }

    return config.devAdminIds.includes(actorId);
}

module.exports = {
    canUsePmActions
};
