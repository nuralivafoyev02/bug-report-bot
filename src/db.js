const { createClient } = require('@supabase/supabase-js');
const { config } = require('./config');

let supabaseClient;

function getSupabase() {
    if (!supabaseClient) {
        supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceKey, {
            auth: { persistSession: false }
        });
    }
    return supabaseClient;
}

async function insertReport(payload) {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('reports')
        .insert(payload)
        .select('*')
        .single();

    if (error) throw error;
    return data;
}

async function getReportByCode(reportCode) {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('report_code', reportCode)
        .single();

    if (error) throw error;
    return data;
}

async function updateReportByCode(reportCode, patch) {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('reports')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('report_code', reportCode)
        .select('*')
        .single();

    if (error) throw error;
    return data;
}

async function addEvent(reportCode, eventType, actor, payload = {}) {
    const supabase = getSupabase();
    const row = {
        report_code: reportCode,
        event_type: eventType,
        actor_user_id: actor?.id ? String(actor.id) : null,
        actor_name: actor?.name || null,
        payload
    };

    const { error } = await supabase.from('report_events').insert(row);
    if (error) throw error;
}

module.exports = {
    insertReport,
    getReportByCode,
    updateReportByCode,
    addEvent
};
