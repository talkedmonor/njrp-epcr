import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "njrp-epcr.db"));
const app = express();
const sessions = new Map();

app.use(express.json({ limit: "2mb" }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
const parse = (value, fallback = {}) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS pcr_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pcr_id TEXT NOT NULL UNIQUE,
    cad_number TEXT,
    owner_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    incident_type TEXT,
    unit TEXT,
    priority TEXT,
    incident_date TEXT,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    submitted_at TEXT,
    approved_at TEXT,
    locked_at TEXT,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL UNIQUE,
    data TEXT NOT NULL,
    FOREIGN KEY(report_id) REFERENCES pcr_reports(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS report_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL UNIQUE,
    data TEXT NOT NULL,
    FOREIGN KEY(report_id) REFERENCES pcr_reports(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL UNIQUE,
    data TEXT NOT NULL,
    FOREIGN KEY(report_id) REFERENCES pcr_reports(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS vitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    FOREIGN KEY(report_id) REFERENCES pcr_reports(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    FOREIGN KEY(report_id) REFERENCES pcr_reports(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS interventions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    FOREIGN KEY(report_id) REFERENCES pcr_reports(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS narratives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL UNIQUE,
    data TEXT NOT NULL,
    FOREIGN KEY(report_id) REFERENCES pcr_reports(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    FOREIGN KEY(report_id) REFERENCES pcr_reports(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS refusal_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    refusal_id TEXT NOT NULL UNIQUE,
    owner_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS qa_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    comment TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(report_id) REFERENCES pcr_reports(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    report_id INTEGER,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS generated_pdfs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER,
    refusal_id INTEGER,
    generated_by INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
if (!userColumns.includes("username")) db.exec("ALTER TABLE users ADD COLUMN username TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username)");
const legacyUsers = db.prepare("SELECT id,name,email,username FROM users").all();
for (const user of legacyUsers) {
  if (!user.username) {
    const defaults = { "provider@njrp.local": "ProviderDemo", "supervisor@njrp.local": "SupervisorDemo", "admin@njrp.local": "AdminDemo" };
    db.prepare("UPDATE users SET username=? WHERE id=?").run(defaults[user.email] || user.email.split("@")[0], user.id);
  }
}

function seed() {
  if (!db.prepare("SELECT COUNT(*) AS count FROM users").get().count) {
    const insert = db.prepare("INSERT INTO users (name,email,username,password_hash,role) VALUES (?,?,?,?,?)");
    insert.run("Jordan Reyes", "provider@njrp.local", "ProviderDemo", hash("provider123"), "Provider");
    insert.run("Morgan Blake", "supervisor@njrp.local", "SupervisorDemo", hash("supervisor123"), "Supervisor");
    insert.run("Casey Park", "admin@njrp.local", "AdminDemo", hash("admin123"), "Admin");
  }
  if (db.prepare("SELECT COUNT(*) AS count FROM pcr_reports").get().count) return;
  const provider = db.prepare("SELECT id FROM users WHERE role='Provider'").get();
  const reports = [
    ["PCR-2026-10021", "CAD-260623-0412", "Draft", "Chest Pain", "Medic 12", "1-Emergent", "Avery Thompson", 64, "Chest pressure", "2026-06-23T08:42:00.000Z"],
    ["PCR-2026-10018", "CAD-260622-1931", "Returned", "Motor Vehicle Collision", "Rescue 4", "2-Urgent", "Cameron Diaz", 31, "Neck pain after MVC", "2026-06-22T23:16:00.000Z"],
    ["PCR-2026-10016", "CAD-260622-1617", "Submitted", "Overdose / Poisoning", "Medic 7", "1-Emergent", "Taylor Morgan", 27, "Unresponsive", "2026-06-22T18:40:00.000Z"],
    ["PCR-2026-10009", "CAD-260621-0844", "Approved", "Difficulty Breathing", "Medic 12", "1-Emergent", "Riley Chen", 72, "Shortness of breath", "2026-06-21T11:05:00.000Z"],
    ["PCR-2026-10003", "CAD-260620-1408", "Locked", "Fall", "BLS 3", "3-Routine", "Alex Johnson", 54, "Left wrist pain", "2026-06-20T16:51:00.000Z"],
  ];
  const reportInsert = db.prepare(`INSERT INTO pcr_reports
    (pcr_id,cad_number,owner_id,status,incident_type,unit,priority,incident_date,data,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const [pcrId, cad, status, type, unit, priority, name, age, complaint, updated] of reports) {
    const incident = {
      pcrId, cadNumber: cad, unit, crew: "J. Reyes, EMT-P / S. Cole, EMT",
      primaryProvider: "Jordan Reyes", incidentType: type, priority,
      incidentDate: updated.slice(0, 10), status,
    };
    const result = reportInsert.run(pcrId, cad, provider.id, status, type, unit, priority, updated.slice(0, 10), JSON.stringify(incident), updated);
    const reportId = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO patients (report_id,data) VALUES (?,?)").run(reportId, JSON.stringify({
      patientName: name, age, dob: `19${90 - (age % 40)}-04-12`, sex: age % 2 ? "Female" : "Male",
      weight: age > 60 ? "82 kg" : "74 kg", chiefComplaint: complaint, allergies: "NKDA",
      medications: "See medication list", pastMedicalHistory: type.includes("Breathing") ? "COPD, HTN" : "Hypertension",
    }));
    db.prepare("INSERT INTO report_times (report_id,data) VALUES (?,?)").run(reportId, JSON.stringify({
      dispatched: "08:32", enroute: "08:35", onScene: "08:42", patientContact: "08:45",
      departScene: "09:08", atDestination: "09:24", transferOfCare: "09:39", available: "09:54",
    }));
    db.prepare("INSERT INTO assessments (report_id,data) VALUES (?,?)").run(reportId, JSON.stringify({
      mentalStatus: "Alert and oriented ×4", avpu: "Alert", gcs: "15", airway: "Patent",
      breathing: type.includes("Breathing") ? "Labored, accessory muscle use" : "Even and unlabored",
      circulation: "Radial pulses strong and regular", skin: "Warm, dry, normal color", pupils: "PERRL 3 mm",
      lungSounds: type.includes("Breathing") ? "Expiratory wheezes bilaterally" : "Clear bilaterally",
      painScale: type === "Chest Pain" ? "7/10" : "3/10", impression: type,
      physicalExam: "No obvious trauma. Head-to-toe assessment completed without additional acute findings.",
      opqrst: "Onset with activity; pressure-like; non-radiating; 7/10; began 30 minutes prior.",
      sample: "Symptoms as documented; NKDA; medications reviewed; last oral intake 0700; event while walking.",
    }));
    const vitalRows = type === "Chest Pain"
      ? [
          { time: "08:48", hr: 108, sys: 168, dia: 96, rr: 22, spo2: 94, etco2: 36, temp: 98.4, bgl: 112, pain: 7, gcs: 15, rhythm: "Sinus tach", notes: "Initial" },
          { time: "09:06", hr: 92, sys: 148, dia: 86, rr: 18, spo2: 97, etco2: 38, temp: 98.4, bgl: 112, pain: 3, gcs: 15, rhythm: "NSR", notes: "Post NTG" },
        ]
      : [{ time: "08:48", hr: 88, sys: 132, dia: 78, rr: 18, spo2: 97, etco2: 37, temp: 98.6, bgl: 104, pain: 3, gcs: 15, rhythm: "NSR", notes: "Initial" }];
    for (const vital of vitalRows) db.prepare("INSERT INTO vitals (report_id,data) VALUES (?,?)").run(reportId, JSON.stringify(vital));
    if (type === "Chest Pain") {
      db.prepare("INSERT INTO medications (report_id,data) VALUES (?,?)").run(reportId, JSON.stringify({ medication: "Aspirin", dose: "324 mg", route: "PO", time: "08:52", indication: "Suspected ACS", contraindications: "Checked", response: "No adverse response", administeredBy: "J. Reyes", notes: "" }));
      db.prepare("INSERT INTO medications (report_id,data) VALUES (?,?)").run(reportId, JSON.stringify({ medication: "Nitroglycerin", dose: "0.4 mg", route: "SL", time: "08:57", indication: "Chest pain", contraindications: "Checked", response: "Pain reduced to 3/10", administeredBy: "J. Reyes", notes: "" }));
    }
    db.prepare("INSERT INTO interventions (report_id,data) VALUES (?,?)").run(reportId, JSON.stringify({ intervention: "12-lead ECG", time: "08:50", successful: "Yes", performedBy: "J. Reyes", response: "Sinus tachycardia, no STEMI criteria", notes: "Transmitted" }));
    db.prepare("INSERT INTO interventions (report_id,data) VALUES (?,?)").run(reportId, JSON.stringify({ intervention: "IV access", time: "08:54", successful: "Yes", performedBy: "J. Reyes", response: "18g left AC", notes: "Saline lock" }));
    db.prepare("INSERT INTO narratives (report_id,data) VALUES (?,?)").run(reportId, JSON.stringify({
      dispatch: `Dispatched priority one for ${complaint.toLowerCase()}.`,
      arrival: "Crew arrived to find patient seated, alert, and tracking EMS.",
      assessment: "Primary and secondary assessments completed. Findings documented above.",
      treatment: "Patient monitored continuously. Treatments provided per protocol with reassessment.",
      transport: "Transported without incident. Care transferred with bedside report.",
      full: `Unit ${unit} responded for ${complaint.toLowerCase()}. Patient was assessed, treated per NJRP protocol, and transported in a position of comfort. Serial vital signs obtained and documented. No deterioration noted during transport.`,
    }));
  }
  const submitted = db.prepare("SELECT id FROM pcr_reports WHERE status='Submitted'").get();
  const supervisor = db.prepare("SELECT id FROM users WHERE role='Supervisor'").get();
  db.prepare("INSERT INTO qa_comments (report_id,user_id,comment,type,created_at) VALUES (?,?,?,?,?)")
    .run(submitted.id, supervisor.id, "Review medication timeline and document response to naloxone.", "Comment", "2026-06-22T19:02:00.000Z");
  const refusal = {
    linkedPcrId: "", patientName: "Jamie Lee", age: "43", sex: "Female",
    capacity: "Alert and oriented ×4; demonstrates understanding and decision-making capacity.",
    recommendedCare: "Evaluation and transport to emergency department.",
    risksExplained: "Worsening condition, permanent disability, and death.",
    patientRefused: true, alternatives: "Private vehicle, urgent care, call 911 if symptoms worsen.",
    witness: "Pat Quinn", providerNotes: "Patient repeated risks in own words and continued to decline.",
    signatures: { patient: "Jamie Lee", provider: "Jordan Reyes", witness: "Pat Quinn" },
  };
  db.prepare("INSERT INTO refusal_reports (refusal_id,owner_id,status,data,updated_at) VALUES (?,?,?,?,?)")
    .run("REF-2026-0017", provider.id, "Draft", JSON.stringify(refusal), "2026-06-22T15:34:00.000Z");
}
seed();

function userFromRequest(req) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const userId = sessions.get(token);
  return userId ? db.prepare("SELECT id,name,username,role,active FROM users WHERE id=?").get(userId) : null;
}

function auth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  req.user = user;
  next();
}

function audit(userId, reportId, action, detail = "") {
  db.prepare("INSERT INTO audit_logs (user_id,report_id,action,detail,created_at) VALUES (?,?,?,?,?)")
    .run(userId, reportId || null, action, detail, now());
}

function reportDetail(id) {
  const row = db.prepare(`SELECT r.*,u.name AS provider_name FROM pcr_reports r JOIN users u ON u.id=r.owner_id WHERE r.id=?`).get(id);
  if (!row) return null;
  const one = (table) => parse(db.prepare(`SELECT data FROM ${table} WHERE report_id=?`).get(id)?.data || "{}");
  const many = (table) => db.prepare(`SELECT id,data FROM ${table} WHERE report_id=? ORDER BY id`).all(id).map((item) => ({ id: item.id, ...parse(item.data) }));
  return {
    id: row.id, pcrId: row.pcr_id, status: row.status, ownerId: row.owner_id, providerName: row.provider_name,
    updatedAt: row.updated_at, incident: parse(row.data), patient: one("patients"), times: one("report_times"),
    assessment: one("assessments"), narrative: one("narratives"), vitals: many("vitals"),
    medications: many("medications"), interventions: many("interventions"),
    signatures: many("signatures"),
    qaComments: db.prepare(`SELECT q.*,u.name AS author FROM qa_comments q JOIN users u ON u.id=q.user_id WHERE q.report_id=? ORDER BY q.created_at DESC`).all(id),
    audit: db.prepare(`SELECT a.*,u.name AS user_name FROM audit_logs a JOIN users u ON u.id=a.user_id WHERE a.report_id=? ORDER BY a.created_at DESC`).all(id),
  };
}

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const user = db.prepare("SELECT id,name,username,role,active,password_hash FROM users WHERE username=? COLLATE NOCASE").get(username);
  if (!user || user.password_hash !== hash(req.body.password) || !user.active) return res.status(401).json({ error: "Invalid Roblox username or password" });
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, user.id);
  audit(user.id, null, "Signed in", "Authenticated to NJRP ePCR");
  res.json({ token, user: { id: user.id, name: user.name, username: user.username, role: user.role } });
});

app.get("/api/me", auth, (req, res) => res.json(req.user));

app.get("/api/dashboard", auth, (req, res) => {
  const where = req.user.role === "Provider" ? "WHERE r.owner_id=?" : "";
  const args = req.user.role === "Provider" ? [req.user.id] : [];
  const reports = db.prepare(`SELECT r.id,r.pcr_id AS pcrId,r.cad_number AS cadNumber,r.status,r.incident_type AS incidentType,r.unit,r.priority,r.updated_at AS updatedAt,u.name AS providerName,p.data AS patientData
    FROM pcr_reports r JOIN users u ON u.id=r.owner_id LEFT JOIN patients p ON p.report_id=r.id ${where} ORDER BY r.updated_at DESC`).all(...args)
    .map((r) => ({ ...r, patientName: parse(r.patientData).patientName || "Unknown" }));
  const counts = reports.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  const activity = db.prepare(`SELECT a.*,u.name AS user_name,r.pcr_id FROM audit_logs a JOIN users u ON u.id=a.user_id LEFT JOIN pcr_reports r ON r.id=a.report_id ORDER BY a.created_at DESC LIMIT 8`).all();
  res.json({ counts, reports, activity });
});

app.get("/api/reports", auth, (req, res) => {
  const clauses = [];
  const args = [];
  if (req.user.role === "Provider") { clauses.push("r.owner_id=?"); args.push(req.user.id); }
  if (req.query.status && req.query.status !== "All") { clauses.push("r.status=?"); args.push(req.query.status); }
  if (req.query.q) { clauses.push("(r.pcr_id LIKE ? OR r.cad_number LIKE ? OR r.incident_type LIKE ? OR p.data LIKE ?)"); for (let i = 0; i < 4; i++) args.push(`%${req.query.q}%`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT r.id,r.pcr_id AS pcrId,r.cad_number AS cadNumber,r.status,r.incident_type AS incidentType,r.unit,r.priority,r.incident_date AS incidentDate,r.updated_at AS updatedAt,u.name AS providerName,p.data AS patientData
    FROM pcr_reports r JOIN users u ON u.id=r.owner_id LEFT JOIN patients p ON p.report_id=r.id ${where} ORDER BY r.updated_at DESC`).all(...args);
  res.json(rows.map((r) => ({ ...r, patientName: parse(r.patientData).patientName || "Unknown" })));
});

app.get("/api/reports/:id", auth, (req, res) => {
  const report = reportDetail(Number(req.params.id));
  if (!report) return res.status(404).json({ error: "Report not found" });
  if (req.user.role === "Provider" && report.ownerId !== req.user.id) return res.status(403).json({ error: "Access denied" });
  res.json(report);
});

app.post("/api/reports", auth, (req, res) => {
  const seq = db.prepare("SELECT COALESCE(MAX(id),0)+1 AS next FROM pcr_reports").get().next;
  const pcrId = `PCR-2026-${String(10020 + seq).padStart(5, "0")}`;
  const incident = { pcrId, cadNumber: "", unit: "", crew: req.user.name, primaryProvider: req.user.name, incidentType: "", priority: "2-Urgent", incidentDate: new Date().toISOString().slice(0, 10), status: "Draft" };
  const result = db.prepare(`INSERT INTO pcr_reports (pcr_id,cad_number,owner_id,status,incident_type,unit,priority,incident_date,data,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(pcrId, "", req.user.id, "Draft", "", "", "2-Urgent", incident.incidentDate, JSON.stringify(incident), now());
  const id = Number(result.lastInsertRowid);
  for (const table of ["patients", "report_times", "assessments", "narratives"]) db.prepare(`INSERT INTO ${table} (report_id,data) VALUES (?,?)`).run(id, "{}");
  audit(req.user.id, id, "Created PCR", `${pcrId} created as draft`);
  res.status(201).json(reportDetail(id));
});

function canEdit(user, report) {
  if (report.status === "Locked") return false;
  if (report.status === "Approved") return false;
  if (user.role === "Admin") return true;
  if (user.role === "Supervisor") return false;
  return report.ownerId === user.id && ["Draft", "Returned"].includes(report.status);
}

app.put("/api/reports/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const existing = reportDetail(id);
  if (!existing) return res.status(404).json({ error: "Report not found" });
  if (!canEdit(req.user, existing)) return res.status(403).json({ error: "This report is read-only" });
  const data = req.body;
  const incident = { ...data.incident, pcrId: existing.pcrId, status: existing.status };
  db.prepare(`UPDATE pcr_reports SET cad_number=?,incident_type=?,unit=?,priority=?,incident_date=?,data=?,updated_at=? WHERE id=?`)
    .run(incident.cadNumber || "", incident.incidentType || "", incident.unit || "", incident.priority || "", incident.incidentDate || "", JSON.stringify(incident), now(), id);
  const replaceOne = (table, value) => db.prepare(`UPDATE ${table} SET data=? WHERE report_id=?`).run(JSON.stringify(value || {}), id);
  replaceOne("patients", data.patient); replaceOne("report_times", data.times); replaceOne("assessments", data.assessment); replaceOne("narratives", data.narrative);
  for (const table of ["vitals", "medications", "interventions"]) {
    db.prepare(`DELETE FROM ${table} WHERE report_id=?`).run(id);
    const statement = db.prepare(`INSERT INTO ${table} (report_id,data) VALUES (?,?)`);
    for (const item of data[table] || []) { const { id: ignored, ...clean } = item; statement.run(id, JSON.stringify(clean)); }
  }
  db.prepare("DELETE FROM signatures WHERE report_id=?").run(id);
  const signatureInsert = db.prepare("INSERT INTO signatures (report_id,data) VALUES (?,?)");
  for (const signature of data.signatures || []) { const { id: ignored, ...clean } = signature; signatureInsert.run(id, JSON.stringify(clean)); }
  audit(req.user.id, id, "Saved draft", "Report content updated");
  res.json(reportDetail(id));
});

app.post("/api/reports/:id/action", auth, (req, res) => {
  const id = Number(req.params.id);
  const report = reportDetail(id);
  if (!report) return res.status(404).json({ error: "Report not found" });
  const action = req.body.action;
  const allowed = {
    submit: req.user.role === "Provider" && report.ownerId === req.user.id && ["Draft", "Returned"].includes(report.status),
    return: ["Supervisor", "Admin"].includes(req.user.role) && report.status === "Submitted",
    approve: ["Supervisor", "Admin"].includes(req.user.role) && report.status === "Submitted",
    lock: ["Supervisor", "Admin"].includes(req.user.role) && report.status === "Approved",
  };
  if (!allowed[action]) return res.status(403).json({ error: "Action is not allowed" });
  const status = { submit: "Submitted", return: "Returned", approve: "Approved", lock: "Locked" }[action];
  const field = { submit: "submitted_at", approve: "approved_at", lock: "locked_at" }[action];
  if (field) db.prepare(`UPDATE pcr_reports SET status=?,${field}=?,updated_at=? WHERE id=?`).run(status, now(), now(), id);
  else db.prepare("UPDATE pcr_reports SET status=?,updated_at=? WHERE id=?").run(status, now(), id);
  if (req.body.comment) db.prepare("INSERT INTO qa_comments (report_id,user_id,comment,type,created_at) VALUES (?,?,?,?,?)").run(id, req.user.id, req.body.comment, action === "return" ? "Return reason" : "Comment", now());
  audit(req.user.id, id, `${status} report`, req.body.comment || `${report.pcrId} moved to ${status}`);
  res.json(reportDetail(id));
});

app.post("/api/reports/:id/comments", auth, (req, res) => {
  if (!["Supervisor", "Admin"].includes(req.user.role)) return res.status(403).json({ error: "Supervisor access required" });
  db.prepare("INSERT INTO qa_comments (report_id,user_id,comment,type,created_at) VALUES (?,?,?,?,?)").run(Number(req.params.id), req.user.id, req.body.comment, "Comment", now());
  audit(req.user.id, Number(req.params.id), "Added QA comment", req.body.comment);
  res.json(reportDetail(Number(req.params.id)));
});

app.get("/api/refusals", auth, (req, res) => {
  const where = req.user.role === "Provider" ? "WHERE f.owner_id=?" : "";
  const rows = db.prepare(`SELECT f.*,u.name AS provider_name FROM refusal_reports f JOIN users u ON u.id=f.owner_id ${where} ORDER BY f.updated_at DESC`).all(...(req.user.role === "Provider" ? [req.user.id] : []));
  res.json(rows.map((r) => ({ id: r.id, refusalId: r.refusal_id, status: r.status, updatedAt: r.updated_at, providerName: r.provider_name, ...parse(r.data) })));
});

app.post("/api/refusals", auth, (req, res) => {
  const next = db.prepare("SELECT COALESCE(MAX(id),0)+1 AS next FROM refusal_reports").get().next;
  const refusalId = `REF-2026-${String(next).padStart(4, "0")}`;
  const result = db.prepare("INSERT INTO refusal_reports (refusal_id,owner_id,status,data,updated_at) VALUES (?,?,?,?,?)").run(refusalId, req.user.id, "Draft", JSON.stringify(req.body), now());
  audit(req.user.id, null, "Created refusal", refusalId);
  res.status(201).json({ id: Number(result.lastInsertRowid), refusalId, status: "Draft", ...req.body });
});

app.put("/api/refusals/:id", auth, (req, res) => {
  const row = db.prepare("SELECT * FROM refusal_reports WHERE id=?").get(Number(req.params.id));
  if (!row || (req.user.role === "Provider" && row.owner_id !== req.user.id)) return res.status(404).json({ error: "Refusal not found" });
  db.prepare("UPDATE refusal_reports SET data=?,updated_at=? WHERE id=?").run(JSON.stringify(req.body), now(), row.id);
  audit(req.user.id, null, "Updated refusal", row.refusal_id);
  res.json({ id: row.id, refusalId: row.refusal_id, status: row.status, ...req.body });
});

app.get("/api/audit", auth, (req, res) => {
  if (req.user.role === "Provider") return res.status(403).json({ error: "Supervisor access required" });
  res.json(db.prepare(`SELECT a.*,u.name AS user_name,r.pcr_id FROM audit_logs a JOIN users u ON u.id=a.user_id LEFT JOIN pcr_reports r ON r.id=a.report_id ORDER BY a.created_at DESC LIMIT 100`).all());
});

app.get("/api/users", auth, (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Admin access required" });
  res.json(db.prepare("SELECT id,name,username,role,active FROM users ORDER BY role,name").all());
});

app.post("/api/users", auth, (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Admin access required" });
  const name = String(req.body.name || "").trim();
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const role = String(req.body.role || "");
  if (!name || !username || !password) return res.status(400).json({ error: "Display name, Roblox username, and temporary password are required" });
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: "Roblox username must be 3-20 letters, numbers, or underscores" });
  if (password.length < 8) return res.status(400).json({ error: "Temporary password must be at least 8 characters" });
  if (!["Provider", "Supervisor", "Admin"].includes(role)) return res.status(400).json({ error: "Select a valid role" });
  try {
    const result = db.prepare("INSERT INTO users (name,email,username,password_hash,role,active) VALUES (?,?,?,?,?,1)")
      .run(name, `${username.toLowerCase()}@local.invalid`, username, hash(password), role);
    audit(req.user.id, null, "Created user", `${username} (${role})`);
    res.status(201).json({ id: Number(result.lastInsertRowid), name, username, role, active: 1, temporaryPassword: password });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "That Roblox username is already in use" });
    throw error;
  }
});

app.put("/api/users/:id", auth, (req, res) => {
  if (req.user.role !== "Admin") return res.status(403).json({ error: "Admin access required" });
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id,name,username,role,active FROM users WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "User not found" });
  const name = String(req.body.name ?? existing.name).trim();
  const username = String(req.body.username ?? existing.username).trim();
  const role = String(req.body.role ?? existing.role);
  const active = req.body.active === undefined ? existing.active : (req.body.active ? 1 : 0);
  const password = String(req.body.password || "");
  if (!name || !/^[A-Za-z0-9_]{3,20}$/.test(username) || !["Provider", "Supervisor", "Admin"].includes(role)) return res.status(400).json({ error: "Valid display name, Roblox username, and role are required" });
  if (id === req.user.id && (!active || role !== "Admin")) return res.status(400).json({ error: "You cannot remove your own admin access or deactivate your own account" });
  if (password && password.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
  try {
    if (password) db.prepare("UPDATE users SET name=?,username=?,email=?,role=?,active=?,password_hash=? WHERE id=?").run(name, username, `${username.toLowerCase()}@local.invalid`, role, active, hash(password), id);
    else db.prepare("UPDATE users SET name=?,username=?,email=?,role=?,active=? WHERE id=?").run(name, username, `${username.toLowerCase()}@local.invalid`, role, active, id);
    audit(req.user.id, null, password ? "Updated user and reset password" : "Updated user", `${username} (${role}) - ${active ? "Active" : "Inactive"}`);
    res.json({ id, name, username, role, active, temporaryPassword: password || undefined });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "That Roblox username is already in use" });
    throw error;
  }
});

function pdfHeader(doc, title, identifier) {
  doc.rect(0, 0, 612, 76).fill("#0d2744");
  doc.fillColor("#ffffff").fontSize(21).font("Helvetica-Bold").text("NJRP ePCR", 42, 22);
  doc.fontSize(9).font("Helvetica").text("Emergency Medical Services Patient Care Record", 42, 48);
  doc.fontSize(11).font("Helvetica-Bold").text(title, 390, 23, { align: "right", width: 180 });
  doc.fontSize(9).font("Helvetica").text(identifier, 390, 45, { align: "right", width: 180 });
  doc.fillColor("#172b3d");
}

function section(doc, title, y) {
  doc.rect(36, y, 540, 24).fill("#dfe8f0");
  doc.fillColor("#123958").font("Helvetica-Bold").fontSize(9).text(title.toUpperCase(), 44, y + 8);
  doc.fillColor("#172b3d").font("Helvetica");
  return y + 31;
}

function pdfFooter(doc, reportId) {
  doc.fillColor("#71808b").font("Helvetica").fontSize(7)
    .text(`NJRP ePCR | ${reportId} | Roleplay/training record - not for real-world patient care`, 36, 752, { width: 540, align: "center" });
}

function ensurePdfSpace(doc, y, needed, reportId) {
  if (y + needed < 735) return y;
  pdfFooter(doc, reportId);
  doc.addPage();
  return 38;
}

function pdfKeyValues(doc, entries, y) {
  const width = 540;
  const colWidth = width / 2;
  entries.forEach(([label, value], index) => {
    const x = 36 + (index % 2) * colWidth;
    const rowY = y + Math.floor(index / 2) * 27;
    doc.fillColor("#6b7780").font("Helvetica-Bold").fontSize(7).text(label.toUpperCase(), x + 8, rowY + 2, { width: colWidth - 16 });
    doc.fillColor("#172b3d").font("Helvetica").fontSize(9).text(String(value || "-"), x + 8, rowY + 12, { width: colWidth - 16 });
    doc.moveTo(x, rowY + 26).lineTo(x + colWidth, rowY + 26).strokeColor("#d9dfe4").lineWidth(.5).stroke();
  });
  return y + Math.ceil(entries.length / 2) * 27 + 6;
}

app.get("/api/reports/:id/pdf", auth, (req, res) => {
  const report = reportDetail(Number(req.params.id));
  if (!report) return res.status(404).end();
  if (req.user.role === "Provider" && report.ownerId !== req.user.id) return res.status(403).end();
  db.prepare("INSERT INTO generated_pdfs (report_id,generated_by,created_at) VALUES (?,?,?)").run(report.id, req.user.id, now());
  audit(req.user.id, report.id, "Generated PDF", report.pcrId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=${report.pcrId}.pdf`);
  const doc = new PDFDocument({ size: "LETTER", margin: 36, bufferPages: true });
  doc.pipe(res);
  pdfHeader(doc, "Patient Care Report", report.pcrId);
  let y = 90;
  y = section(doc, "Incident", y);
  y = pdfKeyValues(doc, [
    ["PCR ID", report.pcrId], ["Status", report.status], ["CAD number", report.incident.cadNumber], ["Incident date", report.incident.incidentDate],
    ["Unit", report.incident.unit], ["Priority", report.incident.priority], ["Incident type", report.incident.incidentType], ["Primary provider", report.incident.primaryProvider],
    ["Crew", report.incident.crew], ["Last updated", report.updatedAt],
  ], y);
  y = section(doc, "Patient", y);
  y = pdfKeyValues(doc, [
    ["Patient name", report.patient.patientName], ["DOB / age", `${report.patient.dob || "-"} / ${report.patient.age || "-"}`],
    ["Sex", report.patient.sex], ["Weight", report.patient.weight], ["Chief complaint", report.patient.chiefComplaint], ["Allergies", report.patient.allergies],
    ["Medications", report.patient.medications], ["Medical history", report.patient.pastMedicalHistory],
  ], y);
  y = ensurePdfSpace(doc, y, 155, report.pcrId);
  y = section(doc, "Assessment", y);
  y = pdfKeyValues(doc, [
    ["Mental status", report.assessment.mentalStatus], ["AVPU / GCS", `${report.assessment.avpu || "-"} / ${report.assessment.gcs || "-"}`],
    ["Airway", report.assessment.airway], ["Breathing", report.assessment.breathing], ["Circulation", report.assessment.circulation], ["Skin", report.assessment.skin],
    ["Pupils", report.assessment.pupils], ["Lung sounds", report.assessment.lungSounds], ["Pain", report.assessment.painScale], ["Impression", report.assessment.impression],
  ], y);
  y = ensurePdfSpace(doc, y, 120, report.pcrId);
  y = section(doc, "Vital Signs", y);
  const vitalCols = [36, 78, 112, 160, 194, 231, 274, 320, 360, 400, 438, 482];
  const vitalHeaders = ["Time", "HR", "BP", "RR", "SpO2", "EtCO2", "Temp", "BGL", "Pain", "GCS", "Rhythm"];
  doc.rect(36, y, 540, 20).fill("#f0f3f5");
  vitalHeaders.forEach((header, index) => doc.fillColor("#314758").font("Helvetica-Bold").fontSize(7).text(header, vitalCols[index] + 3, y + 7));
  y += 20;
  report.vitals.forEach((v, index) => {
    if (index % 2) doc.rect(36, y, 540, 19).fill("#f8fafb");
    const values = [v.time, v.hr, `${v.sys || "-"}/${v.dia || "-"}`, v.rr, v.spo2, v.etco2, v.temp, v.bgl, v.pain, v.gcs, v.rhythm];
    values.forEach((value, column) => doc.fillColor("#172b3d").font("Helvetica").fontSize(7.5).text(String(value || "-"), vitalCols[column] + 3, y + 6, { width: column === 10 ? 88 : 42 }));
    y += 19;
  });
  y += 8;
  y = ensurePdfSpace(doc, y, 145, report.pcrId);
  y = section(doc, "Medications & Interventions", y);
  doc.fontSize(8);
  report.medications.forEach((m) => { doc.fillColor("#172b3d").font("Helvetica-Bold").text(`${m.time || "-"}  ${m.medication || "-"} ${m.dose || ""} ${m.route || ""}`, 44, y, { width: 230 }); doc.font("Helvetica").text(m.response || m.indication || "-", 286, y, { width: 282 }); y += 17; });
  if (!report.medications.length) { doc.font("Helvetica").text("No medications documented.", 44, y); y += 17; }
  report.interventions.forEach((i) => { doc.fillColor("#172b3d").font("Helvetica-Bold").text(`${i.time || "-"}  ${i.intervention || "-"}`, 44, y, { width: 230 }); doc.font("Helvetica").text(i.response || i.notes || "-", 286, y, { width: 282 }); y += 17; });
  if (!report.interventions.length) { doc.font("Helvetica").text("No interventions documented.", 44, y); y += 17; }
  y += 8;
  y = ensurePdfSpace(doc, y, 180, report.pcrId);
  y = section(doc, "Medical Abstract", y);
  doc.fillColor("#172b3d").font("Helvetica").fontSize(8.5).text(report.narrative.medicalAbstract || "No medical abstract generated.", 44, y, { width: 524, lineGap: 2 });
  y = doc.y + 14;
  y = ensurePdfSpace(doc, y, 220, report.pcrId);
  y = section(doc, "Narrative", y);
  doc.fontSize(8.5).text(report.narrative.full || "No narrative documented.", 44, y, { width: 524, lineGap: 2 });
  y = doc.y + 16;
  y = ensurePdfSpace(doc, y, 100, report.pcrId);
  y = section(doc, "QA / Approval", y);
  doc.fontSize(8.5).text(`Status: ${report.status}   Primary provider: ${report.providerName}`, 44, y);
  doc.text(report.qaComments[0] ? `Latest QA note: ${report.qaComments[0].comment}` : "No QA comments.", 44, y + 16, { width: 524 });
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    pdfFooter(doc, report.pcrId);
    doc.fillColor("#71808b").fontSize(7).text(`Page ${page + 1} of ${range.count}`, 500, 752, { width: 76, align: "right" });
  }
  doc.end();
});

app.get("/api/refusals/:id/pdf", auth, (req, res) => {
  const row = db.prepare("SELECT * FROM refusal_reports WHERE id=?").get(Number(req.params.id));
  if (!row) return res.status(404).end();
  const data = parse(row.data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=${row.refusal_id}.pdf`);
  const doc = new PDFDocument({ size: "LETTER", margin: 40 }); doc.pipe(res);
  pdfHeader(doc, "Refusal of Care", row.refusal_id);
  let y = 100;
  for (const [title, text] of [
    ["Patient", `${data.patientName || "—"} • Age ${data.age || "—"} • ${data.sex || "—"}`],
    ["Capacity Assessment", data.capacity],
    ["Recommended Care", data.recommendedCare],
    ["Risks Explained", data.risksExplained],
    ["Alternatives Offered", data.alternatives],
    ["Provider Notes", data.providerNotes],
    ["Signatures", `Patient: ${data.signatures?.patient || "—"}   Provider: ${data.signatures?.provider || "—"}   Witness: ${data.signatures?.witness || "—"}`],
  ]) {
    y = section(doc, title, y); doc.fontSize(9).text(text || "—", 48, y, { width: 516 }); y = doc.y + 20;
  }
  doc.end();
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.use((_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT || 3001);
app.listen(port, "0.0.0.0", () => console.log(`NJRP ePCR running on port ${port}`));
