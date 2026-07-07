# Velox

Web-based bulk email interface with a **490 emails/day** limit. Upload contacts, compose campaigns, and send automatically with rate limiting and daily quota tracking.

## Features

- **Dashboard** — live stats, daily quota (490/day), recent send activity
- **Compose** — create HTML email campaigns with `{{name}}` personalization
- **Contacts** — upload CSV or add manually
- **Campaigns** — send, pause, resume; auto-queues overflow for next day
- **Settings** — SMTP configuration and connection test

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure SMTP

Copy the example env file and edit it:

```bash
cp .env.example .env
```

Set your SMTP credentials in `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
SMTP_FROM_NAME=Your Company
DAILY_LIMIT=490
```

**Gmail users:** Enable 2FA and create an [App Password](https://myaccount.google.com/apppasswords).

### 3. Start the server

```bash
npm start
```

Open **http://localhost:3001** in your browser.

## Usage

1. **Settings** — verify SMTP connection works
2. **Contacts** — upload a CSV with `email` and `name` columns (or add manually)
3. **Compose** — write your email and click "Save & Send to All Contacts"
4. **Dashboard** — monitor progress; sender runs automatically

### CSV Format

```csv
email,name
john@example.com,John Doe
jane@example.com,Jane Smith
```

### Daily Limit

- Sends up to **490 emails per calendar day**
- Remaining emails stay queued and resume automatically the next day
- Default delay: 2 seconds between emails (configurable via `SEND_DELAY_MS`)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `DAILY_LIMIT` | 490 | Max emails per day |
| `SEND_DELAY_MS` | 2000 | Delay between sends (ms) |
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | 587 | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | — | From email address |
| `SMTP_FROM_NAME` | Velox | From display name |

## Data Storage

Contacts, campaigns, queue, and send logs are stored in `data/store.json`.

## Deploying

### Vercel (UI + API only — limited)

Velox can run on Vercel for the web UI and API routes, but **bulk background sending does not work** on serverless (no persistent process or disk). Use Vercel for testing the UI, or prefer Railway/Render for production sending.

1. Import the GitHub repo in [Vercel](https://vercel.com)
2. Add environment variables from `.env.example` (SMTP credentials, `DAILY_LIMIT`, etc.)
3. Deploy — `vercel.json` routes `/api/*` to the Express handler

### Railway / Render (recommended for sending)

Run as a normal Node server so the background sender and daily queue work:

```bash
npm install
npm start
```

Set the same environment variables as local `.env`. Data persists on the server disk under `data/`.
