# NJRP ePCR

A full-stack EMS electronic patient care reporting system for roleplay and training.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

For a production build:

```bash
npm run build
npm start
```

## Public and master accounts

Login uses Roblox username + password only. There is no email field.

| Role | Roblox username | Password |
| --- | --- | --- |
| Public Provider | `ProviderDemo` | `provider123` |
| Master Admin | `NJRPMaster` | `master2026!` |

The login screen only advertises the public Provider account. The Master Admin account is for account management, QA, approvals, returns, and locking completed records.

Admins can create accounts, edit Roblox usernames/roles, enable or disable users, and reset passwords. Existing passwords are stored securely and cannot be viewed as plain text; a newly reset temporary password is shown once.

## Test the provider workflow

1. Sign in as Provider.
2. Open the draft chest-pain PCR or create a new PCR.
3. Work through the chart tabs.
4. Add a vital, medication, or intervention.
5. Let autosave run, or use Save, then click **Post** to send the chart to QA.
6. Preview or generate the printable PCR PDF.

Providers may edit their own Draft and Returned reports. Submitted, Approved, and Locked reports are read-only.

## Test the supervisor workflow

1. Sign in as Master Admin.
2. Open **QA Queue** or any Submitted report.
3. Open a Submitted report and select **QA/QI**.
4. Add a QA comment, return the report, or approve it from the toolbar or QA/QI tab.
5. Open an Approved report to lock it.
6. Review the system-wide Audit Log.

## Architecture

- `src/App.jsx` — role-aware application shell, pages, PCR editor tabs, clinical tables, modals, refusals, QA, audit, and users
- `src/styles.css` — responsive EMS design system and printable UI styling
- `src/api.js` — authenticated API client and session handling
- `server/index.js` — Express API, SQLite schema/seed data, workflow authorization, audit logging, and PDF generation
- `server/njrp-epcr.db` — generated persistent SQLite database
- `design/` — approved visual concept and browser QA renders

The local SQLite database is created and seeded automatically on first run.

## Free hosting

### Fastest public demo: Render

1. Push this folder to a GitHub repository.
2. In Render, choose **New → Blueprint** and connect the repository.
3. Render reads `render.yaml`, builds the app, and gives it a public HTTPS address.

This is the fastest free public launch, usually the quickest way to get a shareable URL. It is suitable for a demo, but Render's free web-service filesystem is ephemeral. The SQLite database can reset after a restart, spin-down, or redeploy. Do not use the free Render option for records that must remain permanent.

Render may ask for a credit card before deploying free services on some accounts.

### Best free option if you want records to persist: Oracle Cloud Always Free

Create an Always Free Ubuntu VM, clone the repository, install Node.js, run `npm install && npm run build`, and keep `npm start` running with a process manager such as systemd. Put Caddy or Nginx in front of port 3001 for HTTPS. The VM's block storage preserves the SQLite database.

Oracle Cloud Always Free is the best fit for this exact app because the current backend is a normal long-running Node server with SQLite. It is more setup than Render, but it can preserve the database without rewriting the app.

### No-card quick public preview

For instant sharing without a credit card, run a temporary tunnel while the app is running locally:

```bash
npm_config_cache=./tmp/npm-cache npx --yes localtunnel --port 3001 --local-host 127.0.0.1
```

That produces a public URL, but it only stays online while your computer and the tunnel command are running.

The server supports:

- `PORT` — hosting-provider HTTP port
- `DATA_DIR` — directory where `njrp-epcr.db` is stored

For any real deployment, use strong non-demo passwords and restrict access appropriately. This project is for roleplay/training and is not designed to store real patient information.
