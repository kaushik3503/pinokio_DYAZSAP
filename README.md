# Ops Intelligence Dashboard

A local dashboard that combines Dynatrace problem and metric data with Azure OpenAI incident analysis. It runs as a small Node.js backend and serves a browser dashboard from the same local process.

## What it does

- Reads open problems from Dynatrace Problems API v2.
- Reads metrics from Dynatrace Metrics API v2.
- Plots metric history as dashboard trend graphs and per-metric sparklines.
- Enriches metric signals with status, trend, min/max, median, p95, delta, timing, and dimension details.
- Maintains a separate monitored-server inventory with per-server Dynatrace entity IDs.
- Checks inode usage with configurable warning and critical thresholds.
- Lets you ask natural-language server questions using Azure OpenAI over Dynatrace context.
- Sends the current dashboard context to Azure OpenAI for SRE-style analysis.
- Stores server name, host, owner, environment, status, and recipient details locally.
- Generates performance reports and sends them to distribution lists and individual email IDs through SMTP.
- Falls back to demo data when credentials are not configured, so the UI is usable immediately.
- Keeps API tokens on the backend; the browser only calls local `/api/*` endpoints.

## Configure

Create `app/dashboard/.env` from `app/dashboard/.env.example` and fill in your values:

```env
DYNATRACE_ENV_URL=https://your-environment.live.dynatrace.com
DYNATRACE_API_TOKEN=dt0c01...
DYNATRACE_DEFAULT_FROM=now-2h
DYNATRACE_PROBLEM_SELECTOR=status("open")
DYNATRACE_METRIC_SELECTOR=builtin:host.cpu.usage:avg:fold
DYNATRACE_INODE_METRIC_SELECTOR=builtin:host.disk.inodes.usage:avg

AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
AZURE_OPENAI_API_STYLE=v1

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_STARTTLS=true
SMTP_USER=report-sender@example.com
SMTP_PASS=...
SMTP_FROM=report-sender@example.com
```

The Dynatrace token needs `problems.read` and `metrics.read`.

SMTP is only required for actual email delivery. If SMTP is not configured, the app still generates a report preview and returns `mode: "preview"` from the email endpoint.

Server details, active/inactive state, and report recipients are saved in `app/dashboard/data/config.json`. That file is ignored by git because it is local runtime state.

For Azure OpenAI, `AZURE_OPENAI_API_STYLE=v1` uses:

```text
POST {AZURE_OPENAI_ENDPOINT}/openai/v1/chat/completions
```

For the older deployment-path API, set:

```env
AZURE_OPENAI_API_STYLE=deployments
AZURE_OPENAI_API_VERSION=2024-10-21
```

## Run

From Pinokio, click `Install`, then `Start`, then `Open Web UI`.

From a terminal:

```powershell
cd app/dashboard
npm install --no-audit --no-fund --omit=dev
npm start
```

The default local URL is `http://127.0.0.1:4317`. Pinokio uses an available port automatically.

## Server Details And Reports

Use the `Config` section in the dashboard to set:

- Server name, environment, host/URL, owner, and operational notes.
- Active/inactive toggle.
- Distribution list email addresses.
- Individual recipient email addresses.
- Report subject prefix and whether to include AI analysis.

When the server is marked inactive, performance reports can still be generated, but email delivery is skipped unless the API request explicitly uses `force: true`.

## Monitored Servers

Use the `Servers` page to add monitored servers separately from the global report configuration. Each server profile stores:

- Name, environment, host/URL, OS, owner, tags, and notes.
- Active/inactive state.
- Dynatrace host entity ID, such as `HOST-XXXXXXXXXXXXXXXX`.
- Optional problem selector override.
- Inode metric selector and warning/critical thresholds.

The inode check calls Dynatrace Metrics API v2 with the server's host entity selector when a Dynatrace entity ID is configured. Without Dynatrace credentials, the app returns demo inode data so the page can still be tested locally.

The `Ask About This Server` panel sends the selected server, inode results, dashboard metrics, and problem context to Azure OpenAI. Without Azure OpenAI credentials, it returns deterministic demo guidance.

## Timeline And Graphs

The dashboard supports preset ranges from 30 minutes through 30 days. Select `Custom range` to send explicit local start and end timestamps to the backend. API calls use `from` and optional `to` query parameters, matching Dynatrace time selector behavior.

Metric cards show sparklines from the returned samples, and the Metrics section renders a larger trend graph for up to four returned metric series.

For `POST /api/reports/email`, use `rangeTo` for the timeline end because `to` is reserved for additional recipient addresses.

## Metric Signal Details

The `Metrics` section includes a summary strip, detailed cards, and a detail table. Each normalized metric can include:

- Display name, category, inferred unit, status, and status reason.
- Latest, average, min, max, median, p95, delta, and delta percent.
- Trend direction, sample count, dimension count, sample window, sample interval, and average change.
- Dimension breakdown from Dynatrace `dimensionMap` or `dimensions` values when available.

Status is heuristic because Dynatrace metric selectors do not always include explicit thresholds. CPU, memory, and disk-like signals use percent-style warning and critical bands; latency and error signals use separate conservative bands; rising signals are marked for watch when the increase is material.

## Local API

### JavaScript

```js
const dashboard = await fetch("http://127.0.0.1:4317/api/dashboard?from=now-7d")
  .then((response) => response.json());

const analysis = await fetch("http://127.0.0.1:4317/api/ai/analyze", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    question: "What should the on-call engineer do next?",
    context: dashboard
  })
}).then((response) => response.json());

const config = await fetch("http://127.0.0.1:4317/api/config", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    server: {
      name: "Checkout API",
      environment: "Production",
      host: "checkout.internal.example.com",
      owner: "SRE",
      details: "Customer checkout workload",
      active: true
    },
    recipients: {
      dls: ["sre-dl@example.com"],
      individuals: ["owner@example.com"]
    },
    report: {
      subjectPrefix: "[Checkout]",
      includeAiAnalysis: true
    }
  })
}).then((response) => response.json());

const report = await fetch("http://127.0.0.1:4317/api/reports/performance?from=now-7d")
  .then((response) => response.json());

const emailResult = await fetch("http://127.0.0.1:4317/api/reports/email", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ from: "now-7d", includeAiAnalysis: true })
}).then((response) => response.json());

const server = await fetch("http://127.0.0.1:4317/api/servers", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Checkout Linux 01",
    environment: "Production",
    host: "checkout-linux-01.internal.example.com",
    dynatraceEntityId: "HOST-XXXXXXXXXXXXXXXX",
    os: "Linux",
    owner: "SRE",
    tags: ["checkout", "linux"],
    active: true,
    inode: {
      enabled: true,
      metricSelector: "builtin:host.disk.inodes.usage:avg",
      warningPercent: 75,
      criticalPercent: 90
    }
  })
}).then((response) => response.json());

const inodeCheck = await fetch(
  `http://127.0.0.1:4317/api/servers/${server.server.id}/inodes?from=now-24h`
).then((response) => response.json());

const serverAnswer = await fetch(
  `http://127.0.0.1:4317/api/servers/${server.server.id}/ask`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "now-24h",
      question: "Why is inode usage increasing and what should I check next?"
    })
  }
).then((response) => response.json());
```

### Python

```python
import requests

base_url = "http://127.0.0.1:4317"
dashboard = requests.get(f"{base_url}/api/dashboard", params={"from": "now-7d"}).json()
analysis = requests.post(
    f"{base_url}/api/ai/analyze",
    json={
        "question": "Summarize current operational risk.",
        "context": dashboard,
    },
).json()

config = requests.put(
    f"{base_url}/api/config",
    json={
        "server": {
            "name": "Checkout API",
            "environment": "Production",
            "host": "checkout.internal.example.com",
            "owner": "SRE",
            "details": "Customer checkout workload",
            "active": True,
        },
        "recipients": {
            "dls": ["sre-dl@example.com"],
            "individuals": ["owner@example.com"],
        },
        "report": {
            "subjectPrefix": "[Checkout]",
            "includeAiAnalysis": True,
        },
    },
).json()

report = requests.get(f"{base_url}/api/reports/performance", params={"from": "now-7d"}).json()
email_result = requests.post(
    f"{base_url}/api/reports/email",
    json={"from": "now-7d", "includeAiAnalysis": True},
).json()

server = requests.post(
    f"{base_url}/api/servers",
    json={
        "name": "Checkout Linux 01",
        "environment": "Production",
        "host": "checkout-linux-01.internal.example.com",
        "dynatraceEntityId": "HOST-XXXXXXXXXXXXXXXX",
        "os": "Linux",
        "owner": "SRE",
        "tags": ["checkout", "linux"],
        "active": True,
        "inode": {
            "enabled": True,
            "metricSelector": "builtin:host.disk.inodes.usage:avg",
            "warningPercent": 75,
            "criticalPercent": 90,
        },
    },
).json()
inode_check = requests.get(
    f"{base_url}/api/servers/{server['server']['id']}/inodes",
    params={"from": "now-24h"},
).json()
server_answer = requests.post(
    f"{base_url}/api/servers/{server['server']['id']}/ask",
    json={
        "from": "now-24h",
        "question": "Why is inode usage increasing and what should I check next?",
    },
).json()
```

### Curl

```bash
curl "http://127.0.0.1:4317/api/dashboard?from=now-7d"

curl -X POST "http://127.0.0.1:4317/api/ai/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"question\":\"Summarize current operational risk.\"}"

curl -X PUT "http://127.0.0.1:4317/api/config" \
  -H "Content-Type: application/json" \
  -d "{\"server\":{\"name\":\"Checkout API\",\"environment\":\"Production\",\"host\":\"checkout.internal.example.com\",\"owner\":\"SRE\",\"details\":\"Customer checkout workload\",\"active\":true},\"recipients\":{\"dls\":[\"sre-dl@example.com\"],\"individuals\":[\"owner@example.com\"]},\"report\":{\"subjectPrefix\":\"[Checkout]\",\"includeAiAnalysis\":true}}"

curl "http://127.0.0.1:4317/api/reports/performance?from=now-7d"

curl -X POST "http://127.0.0.1:4317/api/reports/email" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"now-7d\",\"includeAiAnalysis\":true}"

curl -X POST "http://127.0.0.1:4317/api/servers" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Checkout Linux 01\",\"environment\":\"Production\",\"host\":\"checkout-linux-01.internal.example.com\",\"dynatraceEntityId\":\"HOST-XXXXXXXXXXXXXXXX\",\"os\":\"Linux\",\"owner\":\"SRE\",\"tags\":[\"checkout\",\"linux\"],\"active\":true,\"inode\":{\"enabled\":true,\"metricSelector\":\"builtin:host.disk.inodes.usage:avg\",\"warningPercent\":75,\"criticalPercent\":90}}"

curl "http://127.0.0.1:4317/api/servers/checkout-linux-01/inodes?from=now-24h"

curl -X POST "http://127.0.0.1:4317/api/servers/checkout-linux-01/ask" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"now-24h\",\"question\":\"Why is inode usage increasing and what should I check next?\"}"
```

## Endpoints

- `GET /api/health`: shows whether Dynatrace and Azure OpenAI are configured.
- `GET /api/config`: returns server details, active state, recipients, and email setup status.
- `PUT /api/config`: saves server details, active state, recipients, and report preferences.
- `GET /api/servers`: lists monitored servers and inventory summary.
- `POST /api/servers`: creates a monitored server profile.
- `GET /api/servers/:id`: returns one monitored server profile.
- `PUT /api/servers/:id`: updates one monitored server profile.
- `DELETE /api/servers/:id`: removes one monitored server profile.
- `GET /api/servers/:id/inodes`: checks inode usage for one server. Accepts `from` and optional `to`.
- `POST /api/servers/:id/ask`: asks Azure OpenAI a natural-language question using server, inode, metrics, and Dynatrace problem context.
- `GET /api/dashboard`: returns normalized summary, problems, enriched metric signals, graph samples, and dimension details. Accepts `from` and optional `to`.
- `GET /api/dynatrace/problems`: proxies Dynatrace Problems API v2 with safe defaults. Accepts `from`, optional `to`, and `problemSelector`.
- `GET /api/dynatrace/metrics`: proxies Dynatrace Metrics API v2 query. Accepts `from`, optional `to`, and `metricSelector`.
- `POST /api/ai/analyze`: generates or demos an SRE analysis for the current context.
- `GET /api/reports/performance`: generates a performance report payload, text, and HTML. Accepts `from` and optional `to`.
- `POST /api/reports/email`: generates and sends the performance report to configured DLs and individual recipients. Use `from` and optional `rangeTo` for the report range.
