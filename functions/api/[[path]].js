const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

const ok = (body, init = {}) => new Response(JSON.stringify(body), { ...init, headers: { ...jsonHeaders, ...(init.headers || {}) } });
const fail = (status, error) => ok({ error }, { status });
const now = () => new Date().toISOString();

function requireEnv(env) {
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET"]) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytesOrText) {
  const bytes = typeof bytesOrText === "string" ? new TextEncoder().encode(bytesOrText) : new Uint8Array(bytesOrText);
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || ""))));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function createToken(env, user) {
  const payload = base64Url(JSON.stringify({ sub: user.id, role: user.role, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 }));
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

async function readToken(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (sig !== await hmac(env.SESSION_SECRET, payload)) return null;
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const data = JSON.parse(atob(padded));
    if (!data.sub || Date.now() > data.exp) return null;
    return Number(data.sub);
  } catch {
    return null;
  }
}

class SupabaseRest {
  constructor(env) {
    this.base = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
    this.headers = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    };
  }

  async request(path, init = {}) {
    const response = await fetch(`${this.base}${path}`, { ...init, headers: { ...this.headers, ...(init.headers || {}) } });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(body?.message || body?.hint || text || `Supabase ${response.status}`);
    return body;
  }

  list(table, query = "") {
    return this.request(`/${table}${query}`);
  }

  one(table, query = "") {
    return this.list(table, query).then((rows) => rows?.[0] || null);
  }

  insert(table, body) {
    return this.request(`/${table}`, { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation" } }).then((rows) => rows[0]);
  }

  update(table, query, body) {
    return this.request(`/${table}${query}`, { method: "PATCH", body: JSON.stringify(body), headers: { Prefer: "return=representation" } }).then((rows) => rows?.[0] || null);
  }

  delete(table, query) {
    return this.request(`/${table}${query}`, { method: "DELETE" });
  }
}

function tableReport(row, users = new Map()) {
  const patient = row.patient || {};
  return {
    id: row.id,
    pcrId: row.pcr_id,
    cadNumber: row.cad_number || "",
    status: row.status,
    incidentType: row.incident_type || "",
    unit: row.unit || "",
    priority: row.priority || "",
    incidentDate: row.incident_date || "",
    updatedAt: row.updated_at,
    providerName: users.get(row.owner_id)?.name || row.provider_name || "Unknown",
    patientName: patient.patientName || "Unknown",
  };
}

async function getUsersById(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db.list("users", `?select=id,name,username,role,active&id=in.(${unique.join(",")})`);
  return new Map(rows.map((user) => [user.id, user]));
}

async function reportDetail(db, id) {
  const row = await db.one("pcr_reports", `?select=*&id=eq.${id}`);
  if (!row) return null;
  const users = await getUsersById(db, [row.owner_id]);
  const comments = await db.list("qa_comments", `?select=*&report_id=eq.${id}&order=created_at.desc`);
  const commentUsers = await getUsersById(db, comments.map((comment) => comment.user_id));
  const audit = await db.list("audit_logs", `?select=*&report_id=eq.${id}&order=created_at.desc`);
  const auditUsers = await getUsersById(db, audit.map((item) => item.user_id));
  return {
    id: row.id,
    pcrId: row.pcr_id,
    status: row.status,
    ownerId: row.owner_id,
    providerName: users.get(row.owner_id)?.name || "Unknown",
    updatedAt: row.updated_at,
    incident: row.incident || {},
    patient: row.patient || {},
    times: row.times || {},
    assessment: row.assessment || {},
    narrative: row.narrative || {},
    vitals: row.vitals || [],
    medications: row.medications || [],
    interventions: row.interventions || [],
    signatures: row.signatures || [],
    qaComments: comments.map((comment) => ({ ...comment, author: commentUsers.get(comment.user_id)?.name || "Unknown" })),
    audit: audit.map((item) => ({ ...item, user_name: auditUsers.get(item.user_id)?.name || "Unknown" })),
  };
}

async function currentUser(env, request, db) {
  const userId = await readToken(env, request);
  if (!userId) return null;
  return db.one("users", `?select=id,name,username,role,active&id=eq.${userId}&active=eq.true`);
}

async function audit(db, userId, reportId, action, detail = "") {
  await db.insert("audit_logs", { user_id: userId, report_id: reportId || null, action, detail, created_at: now() });
}

async function ensureBuiltInAccounts(db) {
  const password_hash = await sha256("master2026!");
  const existing = await db.one("users", "?select=*&email=eq.master%40njrp.local") || await db.one("users", "?select=*&username=eq.Yoroblox372");
  if (existing) {
    if (existing.username !== "Yoroblox372" || existing.password_hash !== password_hash || existing.role !== "Admin" || !existing.active) {
      const usernameConflict = await db.one("users", "?select=*&username=eq.Yoroblox372");
      if (usernameConflict && usernameConflict.id !== existing.id) {
        await db.update("users", `?id=eq.${usernameConflict.id}`, { username: `${usernameConflict.username}_old_${usernameConflict.id}` });
      }
      await db.update("users", `?id=eq.${existing.id}`, { name: "NJRP Master", username: "Yoroblox372", email: "master@njrp.local", password_hash, role: "Admin", active: true });
    }
    return;
  }
  await db.insert("users", { name: "NJRP Master", email: "master@njrp.local", username: "Yoroblox372", password_hash, role: "Admin", active: true });
}

function canEdit(user, report) {
  if (["Locked", "Approved"].includes(report.status)) return false;
  if (user.role === "Admin") return true;
  if (user.role === "Supervisor") return false;
  return report.ownerId === user.id && ["Draft", "Returned"].includes(report.status);
}

function printableHtml(title, identifier, sections) {
  const esc = (v) => String(v ?? "-").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const sectionHtml = sections.map(({ heading, rows, text }) => `<section><h2>${esc(heading)}</h2>${rows ? `<dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v || "-")}</dd></div>`).join("")}</dl>` : ""}${text ? `<p>${esc(text)}</p>` : ""}</section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(identifier)}</title><style>
    body{font-family:Arial,sans-serif;margin:0;color:#172b3d}.head{background:#0d2744;color:white;padding:28px 42px}.head h1{margin:0;font-size:30px}.head p{margin:7px 0 0}main{padding:30px 42px}h2{background:#dfe8f0;color:#123958;font-size:14px;padding:10px;margin:18px 0 10px}dl{display:grid;grid-template-columns:1fr 1fr;gap:0 30px}div{border-bottom:1px solid #d9dfe4;padding:7px 0}dt{font-size:10px;text-transform:uppercase;color:#6b7780}dd{margin:3px 0 0;font-size:14px}p{line-height:1.55}.foot{position:fixed;bottom:18px;left:42px;right:42px;text-align:center;color:#71808b;font-size:11px}@media print{button{display:none}.head{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body><div class="head"><h1>NJRP ePCR</h1><p>${esc(title)} • ${esc(identifier)}</p></div><main><button onclick="window.print()">Print / Save as PDF</button>${sectionHtml}</main><div class="foot">NJRP ePCR | Roleplay/training record - not for real-world patient care</div></body></html>`;
}

async function handler(request, env) {
  requireEnv(env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  const db = new SupabaseRest(env);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const parts = path.split("/").filter(Boolean);

  if (path === "health") return ok({ ok: true, runtime: "cloudflare-pages", database: "supabase" });

  if (path === "login" && request.method === "POST") {
    await ensureBuiltInAccounts(db);
    const body = await request.json();
    const username = String(body.username || "").trim();
    const user = await db.one("users", `?select=*&username=ilike.${encodeURIComponent(username)}`);
    if (!user || !user.active || user.password_hash !== await sha256(body.password)) return fail(401, "Invalid Roblox username or password");
    const token = await createToken(env, user);
    await audit(db, user.id, null, "Signed in", "Authenticated to NJRP ePCR");
    return ok({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role } });
  }

  const user = await currentUser(env, request, db);
  if (!user) return fail(401, "Authentication required");

  if (path === "me") return ok(user);

  if (path === "dashboard") {
    const filter = user.role === "Provider" ? `&owner_id=eq.${user.id}` : "";
    const reports = await db.list("pcr_reports", `?select=*&order=updated_at.desc${filter}`);
    const users = await getUsersById(db, reports.map((r) => r.owner_id));
    const mapped = reports.map((row) => tableReport(row, users));
    const counts = mapped.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
    const activity = await db.list("audit_logs", "?select=*&order=created_at.desc&limit=8");
    const activityUsers = await getUsersById(db, activity.map((item) => item.user_id));
    return ok({ counts, reports: mapped, activity: activity.map((item) => ({ ...item, user_name: activityUsers.get(item.user_id)?.name || "Unknown" })) });
  }

  if (parts[0] === "reports" && parts.length === 1 && request.method === "GET") {
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");
    let query = "?select=*&order=updated_at.desc";
    if (user.role === "Provider") query += `&owner_id=eq.${user.id}`;
    if (status && status !== "All") query += `&status=eq.${encodeURIComponent(status)}`;
    if (q) query += `&or=(pcr_id.ilike.*${encodeURIComponent(q)}*,cad_number.ilike.*${encodeURIComponent(q)}*,incident_type.ilike.*${encodeURIComponent(q)}*)`;
    const rows = await db.list("pcr_reports", query);
    const users = await getUsersById(db, rows.map((r) => r.owner_id));
    return ok(rows.map((row) => tableReport(row, users)));
  }

  if (parts[0] === "reports" && parts.length === 1 && request.method === "POST") {
    const latest = await db.one("pcr_reports", "?select=id&order=id.desc&limit=1");
    const seq = Number(latest?.id || 0) + 1;
    const pcrId = `PCR-2026-${String(10020 + seq).padStart(5, "0")}`;
    const incident = { pcrId, cadNumber: "", unit: "", crew: user.name, primaryProvider: user.name, incidentType: "", priority: "2-Urgent", incidentDate: new Date().toISOString().slice(0, 10), status: "Draft" };
    const row = await db.insert("pcr_reports", {
      pcr_id: pcrId, cad_number: "", owner_id: user.id, status: "Draft", incident_type: "", unit: "", priority: "2-Urgent",
      incident_date: incident.incidentDate, incident, patient: {}, times: {}, assessment: {}, narrative: {}, vitals: [], medications: [], interventions: [], signatures: [], updated_at: now(),
    });
    await audit(db, user.id, row.id, "Created PCR", `${pcrId} created as draft`);
    return ok(await reportDetail(db, row.id), { status: 201 });
  }

  if (parts[0] === "reports" && parts[1]) {
    const id = Number(parts[1]);
    const report = await reportDetail(db, id);
    if (!report) return fail(404, "Report not found");
    if (user.role === "Provider" && report.ownerId !== user.id) return fail(403, "Access denied");

    if (parts.length === 2 && request.method === "GET") return ok(report);

    if (parts.length === 2 && request.method === "PUT") {
      if (!canEdit(user, report)) return fail(403, "This report is read-only");
      const data = await request.json();
      const incident = { ...(data.incident || {}), pcrId: report.pcrId, status: report.status };
      await db.update("pcr_reports", `?id=eq.${id}`, {
        cad_number: incident.cadNumber || "", incident_type: incident.incidentType || "", unit: incident.unit || "", priority: incident.priority || "",
        incident_date: incident.incidentDate || null, incident, patient: data.patient || {}, times: data.times || {}, assessment: data.assessment || {},
        narrative: data.narrative || {}, vitals: data.vitals || [], medications: data.medications || [], interventions: data.interventions || [],
        signatures: data.signatures || [], updated_at: now(),
      });
      await audit(db, user.id, id, "Saved draft", "Report content updated");
      return ok(await reportDetail(db, id));
    }

    if (parts.length === 2 && request.method === "DELETE") {
      if (user.role !== "Admin") return fail(403, "Admin access required");
      await db.delete("pcr_reports", `?id=eq.${id}`);
      await audit(db, user.id, null, "Deleted PCR", `${report.pcrId} deleted`);
      return ok({ ok: true, deletedId: id });
    }

    if (parts[2] === "action" && request.method === "POST") {
      const body = await request.json();
      const action = body.action;
      const allowed = {
        submit: (user.role === "Admin" || (user.role === "Provider" && report.ownerId === user.id)) && ["Draft", "Returned"].includes(report.status),
        return: ["Supervisor", "Admin"].includes(user.role) && report.status === "Submitted",
        approve: ["Supervisor", "Admin"].includes(user.role) && report.status === "Submitted",
        lock: ["Supervisor", "Admin"].includes(user.role) && report.status === "Approved",
      };
      if (!allowed[action]) return fail(403, "Action is not allowed");
      const status = { submit: "Submitted", return: "Returned", approve: "Approved", lock: "Locked" }[action];
      const update = { status, updated_at: now() };
      if (action === "submit") update.submitted_at = now();
      if (action === "approve") update.approved_at = now();
      if (action === "lock") update.locked_at = now();
      await db.update("pcr_reports", `?id=eq.${id}`, update);
      if (body.comment) await db.insert("qa_comments", { report_id: id, user_id: user.id, comment: body.comment, type: action === "return" ? "Return reason" : "Comment", created_at: now() });
      await audit(db, user.id, id, `${status} report`, body.comment || `${report.pcrId} moved to ${status}`);
      return ok(await reportDetail(db, id));
    }

    if (parts[2] === "comments" && request.method === "POST") {
      if (!["Supervisor", "Admin"].includes(user.role)) return fail(403, "Supervisor access required");
      const body = await request.json();
      await db.insert("qa_comments", { report_id: id, user_id: user.id, comment: body.comment, type: "Comment", created_at: now() });
      await audit(db, user.id, id, "Added QA comment", body.comment);
      return ok(await reportDetail(db, id));
    }

    if (parts[2] === "pdf" && request.method === "GET") {
      await audit(db, user.id, id, "Generated printable report", report.pcrId);
      const html = printableHtml("Patient Care Report", report.pcrId, [
        { heading: "Incident", rows: [["PCR ID", report.pcrId], ["Status", report.status], ["CAD number", report.incident.cadNumber], ["Incident date", report.incident.incidentDate], ["Unit", report.incident.unit], ["Priority", report.incident.priority], ["Incident type", report.incident.incidentType], ["Primary provider", report.incident.primaryProvider]] },
        { heading: "Patient", rows: [["Patient name", report.patient.patientName], ["DOB / age", `${report.patient.dob || "-"} / ${report.patient.age || "-"}`], ["Sex", report.patient.sex], ["Weight", report.patient.weight], ["Chief complaint", report.patient.chiefComplaint], ["Allergies", report.patient.allergies]] },
        { heading: "Medical Abstract", text: report.narrative.medicalAbstract || "No medical abstract generated." },
        { heading: "Narrative", text: report.narrative.full || "No narrative documented." },
      ]);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
  }

  if (parts[0] === "refusals" && parts.length === 1 && request.method === "GET") {
    const rows = await db.list("refusal_reports", `?select=*&order=updated_at.desc${user.role === "Provider" ? `&owner_id=eq.${user.id}` : ""}`);
    const users = await getUsersById(db, rows.map((r) => r.owner_id));
    return ok(rows.map((row) => ({ id: row.id, refusalId: row.refusal_id, status: row.status, updatedAt: row.updated_at, providerName: users.get(row.owner_id)?.name || "Unknown", ...(row.data || {}) })));
  }

  if (parts[0] === "refusals" && parts.length === 1 && request.method === "POST") {
    const body = await request.json();
    const latest = await db.one("refusal_reports", "?select=id&order=id.desc&limit=1");
    const refusalId = `REF-2026-${String(Number(latest?.id || 0) + 1).padStart(4, "0")}`;
    const row = await db.insert("refusal_reports", { refusal_id: refusalId, owner_id: user.id, status: "Draft", data: body, updated_at: now() });
    await audit(db, user.id, null, "Created refusal", refusalId);
    return ok({ id: row.id, refusalId, status: "Draft", ...body }, { status: 201 });
  }

  if (parts[0] === "refusals" && parts[1]) {
    const id = Number(parts[1]);
    const row = await db.one("refusal_reports", `?select=*&id=eq.${id}`);
    if (!row || (user.role === "Provider" && row.owner_id !== user.id)) return fail(404, "Refusal not found");
    if (request.method === "PUT") {
      const body = await request.json();
      await db.update("refusal_reports", `?id=eq.${id}`, { data: body, updated_at: now() });
      await audit(db, user.id, null, "Updated refusal", row.refusal_id);
      return ok({ id, refusalId: row.refusal_id, status: row.status, ...body });
    }
    if (parts[2] === "pdf") return new Response(printableHtml("Refusal of Care", row.refusal_id, [{ heading: "Refusal", rows: Object.entries(row.data || {}) }]), { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  if (parts[0] === "audit" && request.method === "GET") {
    if (user.role === "Provider") return fail(403, "Supervisor access required");
    const rows = await db.list("audit_logs", "?select=*&order=created_at.desc&limit=100");
    const users = await getUsersById(db, rows.map((r) => r.user_id));
    return ok(rows.map((row) => ({ ...row, user_name: users.get(row.user_id)?.name || "Unknown" })));
  }

  if (parts[0] === "users") {
    if (user.role !== "Admin") return fail(403, "Admin access required");
    if (parts.length === 1 && request.method === "GET") return ok(await db.list("users", "?select=id,name,username,role,active&order=role.asc,name.asc"));
    const body = await request.json();
    if (parts.length === 1 && request.method === "POST") {
      const name = String(body.name || "").trim();
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const role = String(body.role || "");
      if (!name || !/^[A-Za-z0-9_]{3,20}$/.test(username) || password.length < 8 || !["Provider", "Supervisor", "Admin"].includes(role)) return fail(400, "Valid display name, Roblox username, temporary password, and role are required");
      const created = await db.insert("users", { name, email: `${username.toLowerCase()}@local.invalid`, username, password_hash: await sha256(password), role, active: true });
      await audit(db, user.id, null, "Created user", `${username} (${role})`);
      return ok({ id: created.id, name, username, role, active: true, temporaryPassword: password }, { status: 201 });
    }
    if (parts[1] && request.method === "PUT") {
      const id = Number(parts[1]);
      const existing = await db.one("users", `?select=*&id=eq.${id}`);
      if (!existing) return fail(404, "User not found");
      const update = {
        name: String(body.name ?? existing.name).trim(),
        username: String(body.username ?? existing.username).trim(),
        email: `${String(body.username ?? existing.username).trim().toLowerCase()}@local.invalid`,
        role: String(body.role ?? existing.role),
        active: body.active === undefined ? existing.active : Boolean(body.active),
      };
      if (id === user.id && (!update.active || update.role !== "Admin")) return fail(400, "You cannot remove your own admin access or deactivate your own account");
      if (!/^[A-Za-z0-9_]{3,20}$/.test(update.username) || !["Provider", "Supervisor", "Admin"].includes(update.role)) return fail(400, "Valid display name, Roblox username, and role are required");
      if (body.password) update.password_hash = await sha256(body.password);
      const saved = await db.update("users", `?id=eq.${id}`, update);
      await audit(db, user.id, null, body.password ? "Updated user and reset password" : "Updated user", `${saved.username} (${saved.role})`);
      return ok({ id: saved.id, name: saved.name, username: saved.username, role: saved.role, active: saved.active, temporaryPassword: body.password || undefined });
    }
  }

  return fail(404, "Not found");
}

export async function onRequest(context) {
  try {
    return await handler(context.request, context.env);
  } catch (error) {
    return fail(500, error.message || "Server error");
  }
}
