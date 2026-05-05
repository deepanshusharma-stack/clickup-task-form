# GobbleCube Issue Raise Form — Vercel Deployment

A public client-facing form that creates issue tickets in the GobbleCube ClickUp **Bugs and DaaS › Dogfooding › Bug backlog** list.

## What's in this folder

```
vercel-issue-form/
├── public/
│   └── index.html         # The form (static — clients see this)
├── api/
│   └── create-ticket.js   # Serverless function — creates the ClickUp task + uploads attachments
├── package.json
├── vercel.json            # Vercel config (cleanUrls, security headers)
├── .env.example           # Template for env vars
├── .gitignore
└── README.md              # This file
```

## Deploy in 5 minutes

### Step 1 — Get a ClickUp API token

1. In ClickUp, click your avatar (bottom-left) → **Settings**.
2. Left sidebar → **Apps**.
3. Under "API Token", click **Generate** (or copy your existing one).
4. **Treat this like a password.** Anyone with this token can do anything in your workspace — create, edit, delete tasks, view all data.
5. *(Recommended for production)* Create a dedicated ClickUp service-account user with access only to the Bug backlog list, and use **its** token. That way a leak doesn't compromise the whole workspace.

### Step 2 — Sign up for Vercel

1. Go to [vercel.com](https://vercel.com) → **Sign Up**.
2. Sign in with GitHub (recommended) or email. Free tier is more than enough for this form.

### Step 3 — Deploy

You have two options.

**Option A — Drag & drop (no Git required, fastest).**

1. Open [vercel.com/new](https://vercel.com/new).
2. Drag this entire `vercel-issue-form` folder onto the page.
3. On the deployment screen, expand **Environment Variables** and add:
   - **Name:** `CLICKUP_API_TOKEN`
   - **Value:** (paste your ClickUp token from Step 1)
4. Click **Deploy**.
5. After ~30 seconds you'll get a URL like `https://gobblecube-issue-form-xyz.vercel.app`. Open it — you should see the form.

**Option B — Git-based (recommended for ongoing changes).**

1. Push this folder to a private GitHub repo.
2. On Vercel, **New Project** → **Import** the repo.
3. Add the `CLICKUP_API_TOKEN` env var as in Option A.
4. Click **Deploy**.

Future changes to the form: edit, push to `main`, Vercel auto-redeploys.

### Step 4 — Verify it works

1. Open the deployed URL.
2. Fill in: brand name, platform, CSM, an issue from the cascading dropdown.
3. Click **Submit Issue**.
4. You should see a green "✓ Ticket created — Open in ClickUp →" message.
5. Click the link — confirm the ticket landed in `Bugs and DaaS › Dogfooding › Bug backlog` with all the right fields filled.

### Step 5 (optional) — Custom domain

1. In your Vercel project → **Settings** → **Domains**.
2. Add `support.gobblecube.ai` (or whatever subdomain you want).
3. Vercel shows a CNAME record — add it to your DNS (Cloudflare, Route53, GoDaddy, wherever your domain lives).
4. SSL is provisioned automatically. Takes 5-15 minutes.

## How it works

```
┌──────────────────┐                ┌───────────────────────┐                ┌──────────────────┐
│  Client browser  │   POST JSON    │  Vercel function      │   REST API     │   ClickUp        │
│  (the form)      │ ─────────────▶ │  /api/create-ticket   │ ─────────────▶ │   Bug backlog    │
└──────────────────┘                │  (holds the token)    │                └──────────────────┘
                                    └───────────────────────┘
```

The form (`public/index.html`) collects the data, reads any attached files as base64, and POSTs the whole payload to `/api/create-ticket`.

The function (`api/create-ticket.js`):

1. Validates the request and rate-limits per IP (10 req/min).
2. Calls `POST https://api.clickup.com/api/v2/list/{list_id}/task` to create the task with all custom fields, assignees, tags, due date, priority.
3. For each attachment, calls `POST https://api.clickup.com/api/v2/task/{task_id}/attachment` (multipart) to upload the file.
4. Returns success + the ClickUp task URL to the form.

The `CLICKUP_API_TOKEN` only ever lives on Vercel's side — it's never sent to the client browser.

## Spam protection

- **Honeypot field** — a hidden input that bots fill but humans don't. Filled values are silently rejected.
- **IP rate limit** — 10 submissions per minute per IP. Resets when the function instance recycles.
- **Server-side validation** — required fields are re-checked on the server.

If you start getting abuse, add **Cloudflare Turnstile** or **hCaptcha** (both free) — happy to wire that in.

## Limits to know about

- **Attachment size:** Vercel hobby plan caps the request body at 4.5 MB. Since base64 inflates by ~33%, that's ~3 MB of total binary data per submission. Most screenshots fit easily; very large CSVs or videos would fail. Upgrade to Vercel Pro ($20/mo) to get 50 MB request bodies.
- **Function execution time:** 10s on hobby plan, 60s on Pro. Creating a task + uploading several attachments completes in ~2-5s — comfortably under either limit.
- **Cold starts:** the first request after idle takes ~200-500ms extra. Subsequent requests are warm.

## What gets created in ClickUp

Every submission creates a task in `list_id: 901413585324` (Bugs and DaaS › Dogfooding › Bug backlog) with:

| Field | Value |
| --- | --- |
| Task name | `[Brand] {Issue title} — {Platform}` |
| Description | Library issue ID + severity + SLA + brand + platform + CSM + client description + steps to reproduce |
| Priority | Auto-set from issue severity (P0=urgent, P1=high, P2=normal) |
| Due date | Today + 2 days |
| Tags | `perf. module` |
| Assignees | Selected CSM + Ishant Dahiya (always) |
| **Custom fields:** | |
| Issue Bucket (CSM) | Performance Marketing |
| Client Type | SMB |
| Company Name | (the brand name) |
| Perf Module | Mapped from the form's sub-module pick |
| Platforms Multi Select | Blinkit / Instamart / both |
| Raised by Client | Yes |
| Attachments | Uploaded to the task |

## Local development

```bash
npm install -g vercel
vercel dev
```

Set `CLICKUP_API_TOKEN` in `.env.local` first (see `.env.example`). The form will be served at `http://localhost:3000`.

## Updating the form

- **Change the form layout / styles:** edit `public/index.html`, push, redeploys automatically.
- **Add or change a CSM:** edit the dropdown options in `public/index.html` and the `CSM_USER_ID` map.
- **Change which custom fields get auto-set:** edit `public/index.html` (the `customFields` block in the submit handler) and possibly `api/create-ticket.js` if you change the payload shape.
- **Move to a different ClickUp list:** change `TARGET_LIST_ID` in `public/index.html`. The function uses whatever `list_id` the form sends.

## Troubleshooting

- **"ClickUp rejected task: no token" / 401** → `CLICKUP_API_TOKEN` is missing or wrong. Re-check the Vercel env var.
- **Tag not applied** → `perf. module` tag must already exist in the ClickUp space. Once any task uses it, ClickUp adds it to the space's tag list.
- **Custom field not set** → the field's option ID in `index.html` must match the actual ID in your ClickUp workspace. If you renamed/recreated a field, the IDs change.
- **Assignee not assigned** → the user must exist in your ClickUp workspace. The form silently skips unresolved CSMs.
- **413 Payload Too Large** → an attachment exceeded 4.5 MB (after base64 encoding). Compress the file or upgrade to Vercel Pro.

## Security checklist before going live

- [ ] `CLICKUP_API_TOKEN` is set in Vercel env vars, NOT committed to the repo.
- [ ] Token belongs to a service-account user with access only to the Bug backlog list (not your personal admin token).
- [ ] If you want to restrict who can submit, add Cloudflare Turnstile or basic auth in front of the form.
- [ ] Test a malicious payload — the form should reject empty / oversized / weird inputs without breaking.
- [ ] Set up Vercel deployment notifications so you know if a push breaks production.
