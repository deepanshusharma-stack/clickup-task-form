// Vercel serverless function — POST /api/create-ticket
// Receives the form payload, creates a task in ClickUp's Bug backlog list,
// then uploads each attachment. Holds the API token in CLICKUP_API_TOKEN env var.

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

// In-memory rate limiter — survives within a single warm function instance.
// Vercel may spin multiple instances; this is best-effort, not a hard limit.
const RATE = { hits: new Map(), windowMs: 60_000, maxPerWindow: 10 };
function checkRate(ip) {
  const now = Date.now();
  const arr = (RATE.hits.get(ip) || []).filter(t => now - t < RATE.windowMs);
  if (arr.length >= RATE.maxPerWindow) return false;
  arr.push(now);
  RATE.hits.set(ip, arr);
  return true;
}

function jsonResponse(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}

// Convert a base64 string to a Buffer
function base64ToBuffer(b64) { return Buffer.from(b64, 'base64'); }

// Upload one attachment to a ClickUp task using multipart/form-data
async function uploadAttachment(token, taskId, name, type, dataBase64) {
  const fd = new FormData();
  const blob = new Blob([base64ToBuffer(dataBase64)], { type: type || 'application/octet-stream' });
  fd.append('attachment', blob, name);
  const resp = await fetch(`${CLICKUP_API_BASE}/task/${taskId}/attachment`, {
    method: 'POST',
    headers: { Authorization: token },
    body: fd,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Attachment "${name}" failed: HTTP ${resp.status} — ${txt.slice(0, 200)}`);
  }
  return resp.json();
}

module.exports = async (req, res) => {
  // Basic CORS — allow same-origin always; if you serve the form on a different domain,
  // set ALLOWED_ORIGIN env var to that domain.
  const origin = req.headers.origin || '';
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });

  // Rate limit by IP
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (!checkRate(ip)) return jsonResponse(res, 429, { success: false, error: 'Rate limit exceeded — try again in a minute.' });

  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) return jsonResponse(res, 500, { success: false, error: 'Server misconfigured: CLICKUP_API_TOKEN missing.' });

  // Parse body — Vercel auto-parses JSON if Content-Type is application/json
  const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const {
    name, list_id, markdown_description, due_date, priority, tags, assignees,
    custom_fields, attachments, csm,
  } = payload;

  if (!name)    return jsonResponse(res, 400, { success: false, error: 'Missing task name.' });
  if (!list_id) return jsonResponse(res, 400, { success: false, error: 'Missing list_id.' });

  // Build the ClickUp create-task payload. ClickUp wants `due_date` as a millisecond timestamp.
  const clickupPayload = {
    name,
    markdown_description,
    priority: ({ urgent: 1, high: 2, normal: 3, low: 4 }[priority] || 3),
    tags: Array.isArray(tags) ? tags : [],
    custom_fields: Array.isArray(custom_fields) ? custom_fields : [],
  };
  if (Array.isArray(assignees) && assignees.length) clickupPayload.assignees = assignees.map(Number).filter(Boolean);
  if (due_date) {
    // Accept both YYYY-MM-DD and millis
    const d = /^\d{4}-\d{2}-\d{2}$/.test(due_date) ? new Date(due_date + 'T17:00:00').getTime() : Number(due_date);
    if (!Number.isNaN(d)) { clickupPayload.due_date = d; clickupPayload.due_date_time = false; }
  }

  // Step 1 — create the task
  let taskRes, taskBody;
  try {
    taskRes = await fetch(`${CLICKUP_API_BASE}/list/${encodeURIComponent(list_id)}/task`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(clickupPayload),
    });
    taskBody = await taskRes.json();
  } catch (err) {
    return jsonResponse(res, 502, { success: false, error: 'ClickUp request failed: ' + (err.message || err) });
  }

  if (!taskRes.ok) {
    return jsonResponse(res, taskRes.status, {
      success: false,
      error: `ClickUp rejected task: ${taskBody?.err || taskBody?.ECODE || taskRes.statusText}`,
      detail: taskBody,
    });
  }

  const taskId = taskBody?.id;
  const taskUrl = taskBody?.url;

  // Step 2 — upload attachments (best-effort; per-file failures don't fail the whole submission)
  let uploaded = 0, failed = 0;
  if (Array.isArray(attachments) && attachments.length && taskId) {
    for (const a of attachments) {
      if (!a?.name || !a?.data) { failed++; continue; }
      try {
        await uploadAttachment(token, taskId, a.name, a.type, a.data);
        uploaded++;
      } catch (e) {
        console.error('[create-ticket] attachment failed:', a.name, e.message);
        failed++;
      }
    }
  }

  return jsonResponse(res, 200, {
    success: true,
    task_id: taskId,
    task_url: taskUrl,
    attachments_uploaded: uploaded,
    attachments_failed: failed,
    csm: csm || null,
  });
};

// Vercel: increase body size limit so attachments can ride along (max ~4.5 MB on hobby plan).
module.exports.config = {
  api: {
    bodyParser: { sizeLimit: '4.5mb' },
  },
};
