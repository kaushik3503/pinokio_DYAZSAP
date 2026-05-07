const http = require("http");
const fs = require("fs");
const net = require("net");
const path = require("path");
const tls = require("tls");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const APP_CONFIG_FILE = path.join(DATA_DIR, "config.json");
const ENV_FILE = path.join(ROOT, ".env");
loadEnvFile(ENV_FILE);

const HOST = process.env.DASHBOARD_HOST || process.env.APP_HOST || "127.0.0.1";
const PORT = Number(process.env.DASHBOARD_PORT || process.env.APP_PORT || 4317);

const CONFIG = {
  dynatraceUrl: trimTrailingSlash(process.env.DYNATRACE_ENV_URL || ""),
  dynatraceToken: process.env.DYNATRACE_API_TOKEN || "",
  defaultFrom: process.env.DYNATRACE_DEFAULT_FROM || "now-2h",
  defaultProblemSelector: process.env.DYNATRACE_PROBLEM_SELECTOR || 'status("open")',
  defaultMetricSelector:
    process.env.DYNATRACE_METRIC_SELECTOR || "builtin:host.cpu.usage:avg:fold",
  defaultInodeMetricSelector:
    process.env.DYNATRACE_INODE_METRIC_SELECTOR || "builtin:host.disk.inodes.usage:avg",
  azureEndpoint: trimTrailingSlash(process.env.AZURE_OPENAI_ENDPOINT || ""),
  azureApiKey: process.env.AZURE_OPENAI_API_KEY || "",
  azureBearerToken: process.env.AZURE_OPENAI_BEARER_TOKEN || "",
  azureDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || "",
  azureApiVersion: process.env.AZURE_OPENAI_API_VERSION || "",
  azureApiStyle: (process.env.AZURE_OPENAI_API_STYLE || "v1").toLowerCase(),
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: parseBoolean(process.env.SMTP_SECURE, false),
  smtpStartTls: parseBoolean(process.env.SMTP_STARTTLS, true),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  smtpRejectUnauthorized: parseBoolean(process.env.SMTP_REJECT_UNAUTHORIZED, true)
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: "Internal server error",
      details: error.message
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard listening at http://${HOST}:${PORT}`);
});

async function route(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (requestUrl.pathname === "/api/health") {
    return sendJson(res, 200, getHealth());
  }

  if (requestUrl.pathname === "/api/config") {
    if (req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        config: readAppConfig(),
        email: getEmailHealth()
      });
    }
    if (req.method === "POST" || req.method === "PUT") {
      const body = await readJsonBody(req);
      const config = saveAppConfig(body.config || body);
      return sendJson(res, 200, {
        ok: true,
        config,
        email: getEmailHealth()
      });
    }
  }

  const serverRoute = matchServerRoute(requestUrl.pathname);
  if (serverRoute) {
    return routeServers(req, res, requestUrl, serverRoute);
  }

  if (requestUrl.pathname === "/api/dashboard" && req.method === "GET") {
    const from = requestUrl.searchParams.get("from") || CONFIG.defaultFrom;
    const to = requestUrl.searchParams.get("to") || undefined;
    const problemSelector =
      requestUrl.searchParams.get("problemSelector") || CONFIG.defaultProblemSelector;
    const metricSelector =
      requestUrl.searchParams.get("metricSelector") || CONFIG.defaultMetricSelector;
    const dashboard = await buildDashboard({ from, to, problemSelector, metricSelector });
    return sendJson(res, 200, dashboard);
  }

  if (requestUrl.pathname === "/api/dynatrace/problems" && req.method === "GET") {
    const payload = await getProblems({
      from: requestUrl.searchParams.get("from") || CONFIG.defaultFrom,
      to: requestUrl.searchParams.get("to") || undefined,
      problemSelector:
        requestUrl.searchParams.get("problemSelector") || CONFIG.defaultProblemSelector,
      pageSize: requestUrl.searchParams.get("pageSize") || "50"
    });
    return sendJson(res, 200, payload);
  }

  if (requestUrl.pathname === "/api/dynatrace/metrics" && req.method === "GET") {
    const payload = await getMetrics({
      from: requestUrl.searchParams.get("from") || CONFIG.defaultFrom,
      to: requestUrl.searchParams.get("to") || undefined,
      metricSelector:
        requestUrl.searchParams.get("metricSelector") || CONFIG.defaultMetricSelector
    });
    return sendJson(res, 200, payload);
  }

  if (requestUrl.pathname === "/api/reports/performance") {
    const body = req.method === "POST" ? await readJsonBody(req) : {};
    const includeAiParam =
      body.includeAiAnalysis ?? requestUrl.searchParams.get("includeAiAnalysis");
    const report = await generatePerformanceReport({
      from: body.from || requestUrl.searchParams.get("from") || CONFIG.defaultFrom,
      to:
        body.to ||
        body.rangeTo ||
        requestUrl.searchParams.get("to") ||
        requestUrl.searchParams.get("rangeTo") ||
        undefined,
      problemSelector:
        body.problemSelector ||
        requestUrl.searchParams.get("problemSelector") ||
        CONFIG.defaultProblemSelector,
      metricSelector:
        body.metricSelector ||
        requestUrl.searchParams.get("metricSelector") ||
        CONFIG.defaultMetricSelector,
      includeAiAnalysis:
        includeAiParam === null || includeAiParam === undefined
          ? undefined
          : parseBoolean(includeAiParam, false)
    });
    return sendJson(res, 200, report);
  }

  if (requestUrl.pathname === "/api/reports/email" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = await emailPerformanceReport(body);
    return sendJson(res, 200, result);
  }

  if (requestUrl.pathname === "/api/ai/analyze" && req.method === "POST") {
    const body = await readJsonBody(req);
    const context = body.context || (await buildDashboard({
      from: CONFIG.defaultFrom,
      problemSelector: CONFIG.defaultProblemSelector,
      metricSelector: CONFIG.defaultMetricSelector
    }));
    const analysis = await analyzeWithAzureOpenAI(body.question || "", context);
    return sendJson(res, 200, analysis);
  }

  return serveStatic(requestUrl.pathname, res);
}

async function buildDashboard({ from, to, problemSelector, metricSelector }) {
  const [problemsPayload, metricsPayload] = await Promise.all([
    getProblems({ from, to, problemSelector, pageSize: "50" }),
    getMetrics({ from, to, metricSelector })
  ]);

  const problems = normalizeProblems(problemsPayload);
  const metrics = normalizeMetrics(metricsPayload);
  const summary = summarize(problems, metrics);
  const appConfig = readAppConfig();

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: problemsPayload.mode === "live" || metricsPayload.mode === "live" ? "live" : "demo",
    health: getHealth(),
    monitoredServer: appConfig.server,
    filters: { from, to: to || null, problemSelector, metricSelector },
    summary,
    problems,
    metrics,
    raw: {
      problemsMeta: stripLargePayload(problemsPayload),
      metricsMeta: stripLargePayload(metricsPayload)
    }
  };
}

function matchServerRoute(pathname) {
  const match = pathname.match(/^\/api\/servers(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if (!match) {
    return null;
  }
  return {
    id: match[1] ? decodeURIComponent(match[1]) : null,
    action: match[2] || null
  };
}

async function routeServers(req, res, requestUrl, routeInfo) {
  if (!routeInfo.id && !routeInfo.action) {
    if (req.method === "GET") {
      const config = readAppConfig();
      return sendJson(res, 200, {
        ok: true,
        servers: config.monitoredServers || [],
        summary: summarizeMonitoredServers(config.monitoredServers || [])
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const serverRecord = saveMonitoredServer(body.server || body);
      return sendJson(res, 200, { ok: true, server: serverRecord });
    }
  }

  const serverRecord = routeInfo.id ? findMonitoredServer(routeInfo.id) : null;
  if (routeInfo.id && !serverRecord) {
    return sendJson(res, 404, { ok: false, error: "Monitored server not found." });
  }

  if (routeInfo.id && !routeInfo.action) {
    if (req.method === "GET") {
      return sendJson(res, 200, { ok: true, server: serverRecord });
    }

    if (req.method === "PUT" || req.method === "PATCH") {
      const body = await readJsonBody(req);
      const updated = saveMonitoredServer(body.server || body, routeInfo.id);
      return sendJson(res, 200, { ok: true, server: updated });
    }

    if (req.method === "DELETE") {
      return sendJson(res, 200, deleteMonitoredServer(routeInfo.id));
    }
  }

  if (routeInfo.action === "inodes" && req.method === "GET") {
    const result = await buildInodeCheck(serverRecord, {
      from: requestUrl.searchParams.get("from") || CONFIG.defaultFrom,
      to: requestUrl.searchParams.get("to") || undefined
    });
    return sendJson(res, 200, result);
  }

  if (routeInfo.action === "ask" && req.method === "POST") {
    const body = await readJsonBody(req);
    const result = await answerServerQuestion({
      server: serverRecord,
      question: body.question || "",
      from: body.from || CONFIG.defaultFrom,
      to: body.to || body.rangeTo || undefined
    });
    return sendJson(res, 200, result);
  }

  return sendJson(res, 405, { ok: false, error: "Unsupported server route or method." });
}

async function getProblems({ from, to, problemSelector, pageSize }) {
  if (!CONFIG.dynatraceUrl || !CONFIG.dynatraceToken) {
    return { ok: true, mode: "demo", ...demoProblems() };
  }

  const endpoint = new URL(`${CONFIG.dynatraceUrl}/api/v2/problems`);
  endpoint.searchParams.set("from", from);
  if (to) {
    endpoint.searchParams.set("to", to);
  }
  endpoint.searchParams.set("pageSize", pageSize);
  endpoint.searchParams.set("fields", "evidenceDetails,impactAnalysis,recentComments");
  if (problemSelector) {
    endpoint.searchParams.set("problemSelector", problemSelector);
  }

  try {
    const data = await fetchJson(endpoint, {
      headers: dynatraceHeaders()
    });
    return { ok: true, mode: "live", ...data };
  } catch (error) {
    return {
      ok: false,
      mode: "demo",
      error: error.message,
      ...demoProblems()
    };
  }
}

async function getMetrics({ from, to, metricSelector, entitySelector }) {
  if (!CONFIG.dynatraceUrl || !CONFIG.dynatraceToken) {
    return { ok: true, mode: "demo", ...demoMetrics() };
  }

  const endpoint = new URL(`${CONFIG.dynatraceUrl}/api/v2/metrics/query`);
  endpoint.searchParams.set("from", from);
  if (to) {
    endpoint.searchParams.set("to", to);
  }
  endpoint.searchParams.set("metricSelector", metricSelector);
  if (entitySelector) {
    endpoint.searchParams.set("entitySelector", entitySelector);
  }

  try {
    const data = await fetchJson(endpoint, {
      headers: dynatraceHeaders()
    });
    return { ok: true, mode: "live", ...data };
  } catch (error) {
    return {
      ok: false,
      mode: "demo",
      error: error.message,
      ...demoMetrics()
    };
  }
}

async function buildInodeCheck(serverRecord, { from, to }) {
  const inode = serverRecord.inode || defaultInodeConfig();
  if (!inode.enabled) {
    return {
      ok: true,
      mode: "disabled",
      checkedAt: new Date().toISOString(),
      server: serverRecord,
      status: "disabled",
      message: "Inode checks are disabled for this server.",
      metrics: []
    };
  }

  const metricSelector = inode.metricSelector || CONFIG.defaultInodeMetricSelector;
  const entitySelector = buildServerEntitySelector(serverRecord);
  const payload = await getInodeMetrics({ from, to, metricSelector, entitySelector, serverRecord });
  const metrics = normalizeMetrics(payload);
  const values = metrics.flatMap((metric) => metric.series || []).map((sample) => sample.value);
  const latestUsagePercent = values.length ? values[values.length - 1] : null;
  const averageUsagePercent = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
  const status = deriveInodeStatus(
    latestUsagePercent,
    inode.warningPercent,
    inode.criticalPercent,
    serverRecord.active
  );

  return {
    ok: true,
    mode: payload.mode,
    checkedAt: new Date().toISOString(),
    server: serverRecord,
    filters: {
      from,
      to: to || null,
      metricSelector,
      entitySelector: entitySelector || null
    },
    thresholds: {
      warningPercent: inode.warningPercent,
      criticalPercent: inode.criticalPercent
    },
    status,
    latestUsagePercent,
    averageUsagePercent,
    metrics,
    raw: stripLargePayload(payload)
  };
}

async function getInodeMetrics({ from, to, metricSelector, entitySelector, serverRecord }) {
  if (!CONFIG.dynatraceUrl || !CONFIG.dynatraceToken) {
    return { ok: true, mode: "demo", ...demoInodeMetrics(serverRecord) };
  }

  const endpoint = new URL(`${CONFIG.dynatraceUrl}/api/v2/metrics/query`);
  endpoint.searchParams.set("from", from);
  if (to) {
    endpoint.searchParams.set("to", to);
  }
  endpoint.searchParams.set("metricSelector", metricSelector);
  if (entitySelector) {
    endpoint.searchParams.set("entitySelector", entitySelector);
  }

  try {
    const data = await fetchJson(endpoint, {
      headers: dynatraceHeaders()
    });
    return { ok: true, mode: "live", ...data };
  } catch (error) {
    return {
      ok: false,
      mode: "demo",
      error: error.message,
      ...demoInodeMetrics(serverRecord)
    };
  }
}

function buildServerEntitySelector(serverRecord) {
  if (!serverRecord.dynatraceEntityId) {
    return "";
  }
  return `type("HOST"),entityId("${serverRecord.dynatraceEntityId}")`;
}

function deriveInodeStatus(value, warningPercent, criticalPercent, active) {
  if (!active) {
    return "inactive";
  }
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "unknown";
  }
  if (value >= criticalPercent) {
    return "critical";
  }
  if (value >= warningPercent) {
    return "warning";
  }
  return "healthy";
}

async function answerServerQuestion({ server, question, from, to }) {
  const inodeCheck = await buildInodeCheck(server, { from, to });
  const dashboard = await buildDashboard({
    from,
    to,
    problemSelector: server.problemSelector || CONFIG.defaultProblemSelector,
    metricSelector: CONFIG.defaultMetricSelector
  });
  const context = {
    generatedAt: new Date().toISOString(),
    timeline: { from, to: to || null },
    server,
    inodeCheck,
    dashboard: compactDashboardContext(dashboard)
  };
  const analysis = await analyzeServerWithAzureOpenAI(question, context);

  return {
    ok: true,
    mode: analysis.mode,
    server,
    answer: analysis.answer,
    context: {
      timeline: context.timeline,
      inodeStatus: inodeCheck.status,
      latestInodeUsagePercent: inodeCheck.latestUsagePercent,
      openProblems: dashboard.summary?.openProblems ?? 0,
      criticalSignals: dashboard.summary?.criticalProblems ?? 0
    },
    usage: analysis.usage || null,
    error: analysis.error || null
  };
}

async function analyzeServerWithAzureOpenAI(question, context) {
  if (!CONFIG.azureEndpoint || !CONFIG.azureDeployment || (!CONFIG.azureApiKey && !CONFIG.azureBearerToken)) {
    return {
      ok: true,
      mode: "demo",
      answer: demoServerConversation(question, context),
      usage: null
    };
  }

  const messages = [
    {
      role: "system",
      content:
        "You are an SRE assistant for Dynatrace-monitored servers. Answer natural language questions using only the provided server, inode, metric, and problem context. Include specific checks, risks, and next actions. If the data is insufficient, say what Dynatrace query or host detail is missing."
    },
    {
      role: "user",
      content: JSON.stringify({
        question: question || "Summarize this server's current health and inode risk.",
        context
      })
    }
  ];

  const request = buildAzureOpenAIRequest(messages);
  try {
    const data = await fetchJson(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body)
    });
    return {
      ok: true,
      mode: "live",
      answer: extractAzureAnswer(data),
      usage: data.usage || null
    };
  } catch (error) {
    return {
      ok: false,
      mode: "demo",
      error: error.message,
      answer: demoServerConversation(question, context),
      usage: null
    };
  }
}

async function analyzeWithAzureOpenAI(question, context) {
  if (!CONFIG.azureEndpoint || !CONFIG.azureDeployment || (!CONFIG.azureApiKey && !CONFIG.azureBearerToken)) {
    return {
      ok: true,
      mode: "demo",
      answer: demoAnalysis(context),
      usage: null
    };
  }

  const messages = [
    {
      role: "system",
      content:
        "You are an SRE assistant. Analyze Dynatrace dashboard JSON and return concise incident insights with impact, probable cause, and next actions. Do not invent services or data."
    },
    {
      role: "user",
      content: JSON.stringify({
        question: question || "Summarize current operational risk and recommended next steps.",
        dashboard: compactDashboardContext(context)
      })
    }
  ];

  const request = buildAzureOpenAIRequest(messages);

  try {
    const data = await fetchJson(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body)
    });
    return {
      ok: true,
      mode: "live",
      answer: extractAzureAnswer(data),
      usage: data.usage || null,
      rawId: data.id || null
    };
  } catch (error) {
    return {
      ok: false,
      mode: "demo",
      error: error.message,
      answer: demoAnalysis(context),
      usage: null
    };
  }
}

async function enrichReportWithAzureOpenAI(appConfig, dashboard) {
  const fallback = buildLocalReportEnrichment(appConfig, dashboard, "Azure OpenAI is not configured.");
  if (!CONFIG.azureEndpoint || !CONFIG.azureDeployment || (!CONFIG.azureApiKey && !CONFIG.azureBearerToken)) {
    return fallback;
  }

  const messages = [
    {
      role: "system",
      content:
        "You are an SRE report editor for operations leadership. Enrich the supplied operations report using only the provided Dynatrace/dashboard JSON. Return strictly valid JSON. Do not include markdown, code fences, or invented services, owners, tickets, dates, metrics, or customer counts."
    },
    {
      role: "user",
      content: JSON.stringify({
        template: REPORT_TEMPLATE,
        requiredSchema: {
          executiveSummary: "2-3 sentences for technical and non-technical stakeholders",
          impactAssessment: "1-2 sentences quantifying impact using only provided data",
          probableRootCause: "1 sentence; say unknown if evidence is insufficient",
          contributingFactors: ["up to 5 concise bullets"],
          recommendedActions: ["4-6 imperative, specific next actions"],
          watchItems: ["up to 4 signals to monitor next"],
          emailIntro: "1 sentence suitable for the opening of the email",
          confidence: "low | medium | high"
        },
        server: appConfig.server,
        recipients: appConfig.recipients,
        dashboard: compactDashboardContext(dashboard)
      })
    }
  ];
  const request = buildAzureOpenAIRequest(messages, {
    temperature: 0.15,
    maxTokens: 1400
  });

  try {
    const data = await fetchJson(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body)
    });
    const answer = extractAzureAnswer(data);
    const parsed = parseJsonObjectFromText(answer);
    return normalizeReportEnrichment(parsed || { narrative: answer }, fallback, {
      ok: true,
      mode: parsed ? "live" : "live-unstructured",
      provider: "Azure OpenAI",
      model: CONFIG.azureDeployment,
      usage: data.usage || null,
      rawId: data.id || null,
      warning: parsed ? null : "Azure OpenAI returned unstructured text; local fields were used for missing sections."
    });
  } catch (error) {
    return normalizeReportEnrichment(null, fallback, {
      ok: false,
      mode: "demo",
      provider: "Azure OpenAI",
      model: CONFIG.azureDeployment,
      error: error.message
    });
  }
}

function buildAzureOpenAIRequest(messages, options = {}) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (CONFIG.azureBearerToken) {
    headers.Authorization = `Bearer ${CONFIG.azureBearerToken}`;
  } else {
    headers["api-key"] = CONFIG.azureApiKey;
  }

  const body = {
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 700
  };

  if (CONFIG.azureApiStyle === "deployments") {
    const apiVersion = CONFIG.azureApiVersion || "2024-10-21";
    const url = `${CONFIG.azureEndpoint}/openai/deployments/${encodeURIComponent(
      CONFIG.azureDeployment
    )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    return { url, headers, body };
  }

  body.model = CONFIG.azureDeployment;
  const apiVersion = CONFIG.azureApiVersion
    ? `?api-version=${encodeURIComponent(CONFIG.azureApiVersion)}`
    : "";
  return {
    url: `${CONFIG.azureEndpoint}/openai/v1/chat/completions${apiVersion}`,
    headers,
    body
  };
}

function dynatraceHeaders() {
  return {
    Accept: "application/json",
    Authorization: `Api-Token ${CONFIG.dynatraceToken}`
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return data || {};
}

function normalizeProblems(payload) {
  const problems = Array.isArray(payload.problems) ? payload.problems : [];
  return problems.map((problem) => ({
    id: problem.problemId || problem.displayId || "unknown",
    displayId: problem.displayId || problem.problemId || "N/A",
    title: problem.title || "Untitled problem",
    status: problem.status || "UNKNOWN",
    severity: problem.severityLevel || "INFO",
    impact: problem.impactLevel || "UNKNOWN",
    startTime: problem.startTime || null,
    duration: formatDuration(problem.startTime, problem.endTime),
    rootCause: problem.rootCauseEntity?.name || problem.rootCauseEntity?.entityId || "Unknown",
    affectedCount: Array.isArray(problem.affectedEntities) ? problem.affectedEntities.length : 0,
    impactedCount: Array.isArray(problem.impactedEntities) ? problem.impactedEntities.length : 0,
    comments: problem.recentComments?.comments?.length || 0
  }));
}

function normalizeMetrics(payload) {
  const result = Array.isArray(payload.result) ? payload.result : [];
  return result.map((metric) => {
    const series = Array.isArray(metric.data) ? metric.data : [];
    const samples = buildMetricSamples(series);
    const stats = calculateMetricStats(samples);
    const metadata = describeMetric(metric.metricId || "metric", stats);

    return {
      id: metric.metricId || "metric",
      displayName: metadata.displayName,
      category: metadata.category,
      unit: metadata.unit,
      latest: stats.latest,
      average: stats.average,
      min: stats.min,
      max: stats.max,
      median: stats.median,
      p95: stats.p95,
      first: stats.first,
      delta: stats.delta,
      deltaPercent: stats.deltaPercent,
      trend: metadata.trend,
      status: metadata.status,
      statusReason: metadata.statusReason,
      firstTimestamp: stats.firstTimestamp,
      latestTimestamp: stats.latestTimestamp,
      sampleWindowMinutes: stats.sampleWindowMinutes,
      sampleIntervalMinutes: stats.sampleIntervalMinutes,
      volatility: stats.volatility,
      points: stats.points,
      dimensions: series.length,
      dimensionBreakdown: summarizeMetricDimensions(series),
      series: samples.slice(-180)
    };
  });
}

function calculateMetricStats(samples) {
  const values = samples.map((sample) => sample.value).filter((value) => Number.isFinite(value));
  const points = values.length;
  const sorted = [...values].sort((left, right) => left - right);
  const first = points ? values[0] : null;
  const latest = points ? values[points - 1] : null;
  const average = points ? values.reduce((sum, value) => sum + value, 0) / points : null;
  const min = points ? sorted[0] : null;
  const max = points ? sorted[points - 1] : null;
  const median = points ? percentile(sorted, 50) : null;
  const p95 = points ? percentile(sorted, 95) : null;
  const delta = points >= 2 ? latest - first : null;
  const deltaPercent = points >= 2 && first !== 0 ? (delta / Math.abs(first)) * 100 : null;
  const firstTimestamp = samples.find((sample) => sample.timestamp !== null)?.timestamp || null;
  const latestTimestamp = [...samples].reverse().find((sample) => sample.timestamp !== null)?.timestamp || null;
  const sampleWindowMinutes =
    firstTimestamp && latestTimestamp
      ? Math.max(0, Math.round((latestTimestamp - firstTimestamp) / 60000))
      : null;
  const sampleIntervalMinutes = estimateSampleIntervalMinutes(samples);
  const volatility = calculateVolatility(values);

  return {
    latest,
    average,
    min,
    max,
    median,
    p95,
    first,
    delta,
    deltaPercent,
    firstTimestamp,
    latestTimestamp,
    sampleWindowMinutes,
    sampleIntervalMinutes,
    volatility,
    points
  };
}

function percentile(sortedValues, percentileValue) {
  if (!sortedValues.length) {
    return null;
  }
  const index = (percentileValue / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function estimateSampleIntervalMinutes(samples) {
  const timestamps = samples
    .map((sample) => sample.timestamp)
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => left - right);
  if (timestamps.length < 2) {
    return null;
  }
  const intervals = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const interval = timestamps[index] - timestamps[index - 1];
    if (interval > 0) {
      intervals.push(interval);
    }
  }
  if (!intervals.length) {
    return null;
  }
  intervals.sort((left, right) => left - right);
  return Math.max(1, Math.round(percentile(intervals, 50) / 60000));
}

function calculateVolatility(values) {
  if (values.length < 2) {
    return null;
  }
  const changes = [];
  for (let index = 1; index < values.length; index += 1) {
    changes.push(Math.abs(values[index] - values[index - 1]));
  }
  return changes.reduce((sum, value) => sum + value, 0) / changes.length;
}

function describeMetric(metricId, stats) {
  const category = inferMetricCategory(metricId);
  const unit = inferMetricUnit(metricId);
  const displayName = formatMetricDisplayName(metricId);
  const trend = inferMetricTrend(stats);
  const status = inferMetricStatus(category, stats, trend);
  return {
    displayName,
    category,
    unit,
    trend,
    status: status.level,
    statusReason: status.reason
  };
}

function inferMetricCategory(metricId) {
  const value = metricId.toLowerCase();
  if (value.includes("cpu")) {
    return "CPU";
  }
  if (value.includes("memory") || value.includes("mem")) {
    return "Memory";
  }
  if (value.includes("disk") || value.includes("inode") || value.includes("filesystem")) {
    return "Disk";
  }
  if (value.includes("response") || value.includes("latency") || value.includes("duration")) {
    return "Latency";
  }
  if (value.includes("error") || value.includes("failure") || value.includes("failed")) {
    return "Errors";
  }
  if (value.includes("traffic") || value.includes("request") || value.includes("throughput")) {
    return "Traffic";
  }
  return "Metric";
}

function inferMetricUnit(metricId) {
  const value = metricId.toLowerCase();
  if (value.includes("percent") || value.includes("usage") || value.includes("rate")) {
    return "%";
  }
  if (value.includes("response.time") || value.includes("latency") || value.includes("duration")) {
    return "ms";
  }
  if (value.includes("bytes") || value.includes("memory")) {
    return "bytes";
  }
  if (value.includes("count") || value.includes("request")) {
    return "count";
  }
  return "";
}

function formatMetricDisplayName(metricId) {
  return String(metricId || "metric")
    .replace(/^builtin:/, "")
    .replace(/^custom:/, "")
    .replace(/:(avg|fold|sum|min|max|percentile|p\d+).*$/i, "")
    .split(/[.:_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferMetricTrend(stats) {
  if (!Number.isFinite(stats.delta) || !Number.isFinite(stats.deltaPercent)) {
    return "insufficient-data";
  }
  if (Math.abs(stats.deltaPercent) < 5) {
    return "steady";
  }
  return stats.deltaPercent > 0 ? "rising" : "falling";
}

function inferMetricStatus(category, stats, trend) {
  if (!Number.isFinite(stats.latest)) {
    return { level: "unknown", reason: "No numeric samples returned" };
  }

  if (["CPU", "Memory", "Disk"].includes(category)) {
    if (stats.latest >= 90 || stats.p95 >= 90) {
      return { level: "critical", reason: "Latest or p95 is at or above 90" };
    }
    if (stats.latest >= 75 || stats.p95 >= 75) {
      return { level: "warning", reason: "Latest or p95 is at or above 75" };
    }
    if (trend === "rising" && Number.isFinite(stats.deltaPercent) && stats.deltaPercent >= 25) {
      return { level: "watch", reason: "Signal is rising by 25% or more" };
    }
  }

  if (category === "Latency") {
    if (stats.latest >= 1000 || stats.p95 >= 1000) {
      return { level: "critical", reason: "Latest or p95 latency is at or above 1000 ms" };
    }
    if (stats.latest >= 500 || stats.p95 >= 500) {
      return { level: "warning", reason: "Latest or p95 latency is at or above 500 ms" };
    }
    if (trend === "rising" && Number.isFinite(stats.deltaPercent) && stats.deltaPercent >= 25) {
      return { level: "watch", reason: "Latency is rising by 25% or more" };
    }
  }

  if (category === "Errors") {
    if (stats.latest >= 5 || stats.p95 >= 5) {
      return { level: "critical", reason: "Latest or p95 error signal is at or above 5" };
    }
    if (stats.latest >= 1 || stats.p95 >= 1) {
      return { level: "warning", reason: "Latest or p95 error signal is at or above 1" };
    }
    if (trend === "rising" && Number.isFinite(stats.deltaPercent) && stats.deltaPercent >= 25) {
      return { level: "watch", reason: "Error signal is rising by 25% or more" };
    }
  }

  if (trend === "insufficient-data") {
    return { level: "unknown", reason: "Need at least two samples for trend" };
  }
  return { level: "normal", reason: "No threshold or trend concern detected" };
}

function summarizeMetricDimensions(series) {
  return series.slice(0, 8).map((item, index) => {
    const values = Array.isArray(item.values)
      ? item.values.filter((value) => value !== null && value !== undefined)
      : [];
    const latest = values.length ? values[values.length - 1] : null;
    return {
      index: index + 1,
      label: formatDimensionLabel(item),
      latest: typeof latest === "number" ? latest : Number(latest),
      points: values.length
    };
  });
}

function formatDimensionLabel(item) {
  if (item.dimensionMap && typeof item.dimensionMap === "object") {
    const parts = Object.entries(item.dimensionMap)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .map(([key, value]) => `${key}: ${value}`);
    if (parts.length) {
      return parts.slice(0, 3).join(", ");
    }
  }
  if (Array.isArray(item.dimensions) && item.dimensions.length) {
    return item.dimensions.slice(0, 3).join(", ");
  }
  return "All dimensions";
}

function buildMetricSamples(series) {
  const buckets = new Map();
  let fallbackOrder = 0;

  for (const item of series) {
    const timestamps = Array.isArray(item.timestamps) ? item.timestamps : [];
    const values = Array.isArray(item.values) ? item.values : [];
    for (let index = 0; index < values.length; index += 1) {
      const rawValue = values[index];
      if (rawValue === null || rawValue === undefined || rawValue === "") {
        continue;
      }
      const value = Number(rawValue);
      if (!Number.isFinite(value)) {
        continue;
      }
      const timestamp = Number(timestamps[index]);
      const hasTimestamp = Number.isFinite(timestamp);
      const key = hasTimestamp ? String(timestamp) : `sample-${fallbackOrder}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          timestamp: hasTimestamp ? timestamp : null,
          order: fallbackOrder,
          total: 0,
          count: 0
        });
      }
      const bucket = buckets.get(key);
      bucket.total += value;
      bucket.count += 1;
      fallbackOrder += 1;
    }
  }

  return Array.from(buckets.values())
    .sort((left, right) => (left.timestamp ?? left.order) - (right.timestamp ?? right.order))
    .map((bucket) => ({
      timestamp: bucket.timestamp,
      value: bucket.total / bucket.count
    }));
}

function summarize(problems, metrics) {
  const openProblems = problems.filter((problem) => problem.status === "OPEN").length;
  const criticalProblems = problems.filter((problem) =>
    ["AVAILABILITY", "ERROR", "RESOURCE_CONTENTION"].includes(problem.severity)
  ).length;
  const impactedEntities = problems.reduce((sum, problem) => sum + problem.impactedCount, 0);
  const signalCount = metrics.reduce((sum, metric) => sum + metric.points, 0);

  return {
    openProblems,
    criticalProblems,
    impactedEntities,
    signalCount,
    posture: criticalProblems > 0 ? "Investigate" : openProblems > 0 ? "Watch" : "Healthy"
  };
}

function compactDashboardContext(context) {
  return {
    generatedAt: context.generatedAt,
    mode: context.mode,
    summary: context.summary,
    problems: (context.problems || []).slice(0, 12),
    metrics: (context.metrics || []).slice(0, 8)
  };
}

function extractAzureAnswer(data) {
  return (
    data?.choices?.[0]?.message?.content ||
    data?.output_text ||
    data?.choices?.[0]?.text ||
    "No answer returned by Azure OpenAI."
  );
}

function getHealth() {
  return {
    ok: true,
    dynatrace: {
      configured: Boolean(CONFIG.dynatraceUrl && CONFIG.dynatraceToken),
      endpoint: CONFIG.dynatraceUrl ? redactUrl(CONFIG.dynatraceUrl) : null,
      requiredScopes: ["problems.read", "metrics.read"]
    },
    azureOpenAI: {
      configured: Boolean(
        CONFIG.azureEndpoint &&
          CONFIG.azureDeployment &&
          (CONFIG.azureApiKey || CONFIG.azureBearerToken)
      ),
      endpoint: CONFIG.azureEndpoint ? redactUrl(CONFIG.azureEndpoint) : null,
      deployment: CONFIG.azureDeployment || null,
      apiStyle: CONFIG.azureApiStyle
    },
    email: getEmailHealth()
  };
}

function getEmailHealth() {
  return {
    configured: isSmtpConfigured(),
    host: CONFIG.smtpHost || null,
    port: CONFIG.smtpHost ? CONFIG.smtpPort : null,
    from: CONFIG.smtpFrom || null,
    secure: CONFIG.smtpSecure,
    startTls: CONFIG.smtpStartTls
  };
}

function defaultAppConfig() {
  const server = {
    name: "Primary monitored server",
    environment: "Production",
    host: "",
    owner: "",
    details: "",
    active: true
  };

  return {
    server,
    monitoredServers: [defaultMonitoredServer(server)],
    recipients: {
      dls: [],
      individuals: []
    },
    report: {
      subjectPrefix: "[Ops Intelligence]",
      includeAiAnalysis: true
    }
  };
}

function readAppConfig() {
  if (!fs.existsSync(APP_CONFIG_FILE)) {
    return defaultAppConfig();
  }

  try {
    return mergeAppConfig(defaultAppConfig(), JSON.parse(fs.readFileSync(APP_CONFIG_FILE, "utf8")));
  } catch {
    return defaultAppConfig();
  }
}

function saveAppConfig(input) {
  const config = mergeAppConfig(readAppConfig(), input || {});
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(APP_CONFIG_FILE, JSON.stringify(config, null, 2));
  return config;
}

function mergeAppConfig(base, input) {
  const config = JSON.parse(JSON.stringify(base));
  if (input.server && typeof input.server === "object") {
    config.server = {
      ...config.server,
      name: cleanString(input.server.name, 100) || config.server.name,
      environment: cleanString(input.server.environment, 80),
      host: cleanString(input.server.host, 160),
      owner: cleanString(input.server.owner, 120),
      details: cleanString(input.server.details, 2000),
      active:
        input.server.active === undefined ? config.server.active : Boolean(input.server.active)
    };
  }

  if (Array.isArray(input.monitoredServers)) {
    config.monitoredServers = normalizeMonitoredServers(input.monitoredServers, config.server);
  } else if (!Array.isArray(config.monitoredServers) || !config.monitoredServers.length) {
    config.monitoredServers = [defaultMonitoredServer(config.server)];
  }

  if (input.recipients && typeof input.recipients === "object") {
    config.recipients = {
      dls: parseEmailList(input.recipients.dls),
      individuals: parseEmailList(input.recipients.individuals)
    };
  }

  if (input.report && typeof input.report === "object") {
    config.report = {
      ...config.report,
      subjectPrefix: cleanString(input.report.subjectPrefix, 120) || config.report.subjectPrefix,
      includeAiAnalysis:
        input.report.includeAiAnalysis === undefined
          ? config.report.includeAiAnalysis
          : Boolean(input.report.includeAiAnalysis)
    };
  }

  return config;
}

function defaultMonitoredServer(server = {}) {
  return {
    id: "primary",
    name: server.name || "Primary monitored server",
    environment: server.environment || "Production",
    host: server.host || "",
    dynatraceEntityId: "",
    managementZone: "",
    os: "Linux",
    owner: server.owner || "",
    details: server.details || "",
    tags: [],
    active: server.active !== false,
    problemSelector: "",
    inode: defaultInodeConfig(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function defaultInodeConfig() {
  return {
    enabled: true,
    metricSelector: CONFIG.defaultInodeMetricSelector,
    warningPercent: 75,
    criticalPercent: 90
  };
}

function normalizeMonitoredServers(servers, fallbackServer) {
  if (!servers.length) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const item of servers) {
    const server = normalizeMonitoredServer(item, fallbackServer);
    if (!server.name) {
      continue;
    }
    let id = server.id || generateServerId(server.name);
    const baseId = id;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    normalized.push({ ...server, id });
  }
  return normalized;
}

function normalizeMonitoredServer(input = {}, fallbackServer = {}, existing = {}) {
  const inode = input.inode && typeof input.inode === "object" ? input.inode : {};
  const existingInode = existing.inode && typeof existing.inode === "object" ? existing.inode : {};
  const defaultInode = defaultInodeConfig();
  const name =
    cleanString(input.name, 120) ||
    cleanString(existing.name, 120) ||
    cleanString(fallbackServer.name, 120) ||
    "Monitored server";
  const now = new Date().toISOString();

  return {
    id: sanitizeId(input.id || existing.id || generateServerId(name)),
    name,
    environment:
      cleanString(input.environment, 80) ||
      cleanString(existing.environment, 80) ||
      cleanString(fallbackServer.environment, 80),
    host:
      cleanString(input.host, 180) ||
      cleanString(existing.host, 180) ||
      cleanString(fallbackServer.host, 180),
    dynatraceEntityId:
      cleanString(input.dynatraceEntityId, 120) ||
      cleanString(existing.dynatraceEntityId, 120),
    managementZone:
      cleanString(input.managementZone, 120) || cleanString(existing.managementZone, 120),
    os: cleanString(input.os, 40) || cleanString(existing.os, 40) || "Linux",
    owner:
      cleanString(input.owner, 120) ||
      cleanString(existing.owner, 120) ||
      cleanString(fallbackServer.owner, 120),
    details:
      cleanString(input.details, 2000) ||
      cleanString(existing.details, 2000) ||
      cleanString(fallbackServer.details, 2000),
    tags: parseTagList(input.tags !== undefined ? input.tags : existing.tags),
    active: input.active === undefined ? existing.active !== false : Boolean(input.active),
    problemSelector:
      cleanString(input.problemSelector, 500) || cleanString(existing.problemSelector, 500),
    inode: {
      enabled:
        inode.enabled === undefined
          ? existingInode.enabled !== undefined
            ? Boolean(existingInode.enabled)
            : defaultInode.enabled
          : Boolean(inode.enabled),
      metricSelector:
        cleanString(inode.metricSelector, 500) ||
        cleanString(existingInode.metricSelector, 500) ||
        defaultInode.metricSelector,
      warningPercent: clampNumber(
        inode.warningPercent ?? existingInode.warningPercent,
        1,
        100,
        defaultInode.warningPercent
      ),
      criticalPercent: clampNumber(
        inode.criticalPercent ?? existingInode.criticalPercent,
        1,
        100,
        defaultInode.criticalPercent
      )
    },
    createdAt: existing.createdAt || cleanString(input.createdAt, 40) || now,
    updatedAt: now
  };
}

function saveMonitoredServer(input, existingId) {
  const config = readAppConfig();
  const servers = Array.isArray(config.monitoredServers) ? config.monitoredServers : [];
  const existing = existingId ? servers.find((server) => server.id === existingId) : null;
  const normalized = normalizeMonitoredServer(input, config.server, existing || {});
  normalized.id = assignUniqueServerId(normalized.id, servers, existingId);
  const nextServers = existing
    ? servers.map((server) => (server.id === existingId ? normalized : server))
    : [...servers, normalized];
  const saved = saveAppConfig({ ...config, monitoredServers: nextServers });
  return saved.monitoredServers.find((server) => server.id === normalized.id);
}

function deleteMonitoredServer(id) {
  const config = readAppConfig();
  const servers = Array.isArray(config.monitoredServers) ? config.monitoredServers : [];
  const nextServers = servers.filter((server) => server.id !== id);
  if (nextServers.length === servers.length) {
    return { ok: false, error: "Monitored server not found." };
  }
  const saved = saveAppConfig({ ...config, monitoredServers: nextServers });
  return {
    ok: true,
    deletedId: id,
    servers: saved.monitoredServers,
    summary: summarizeMonitoredServers(saved.monitoredServers)
  };
}

function findMonitoredServer(id) {
  const config = readAppConfig();
  return (config.monitoredServers || []).find((server) => server.id === id) || null;
}

function summarizeMonitoredServers(servers) {
  const total = servers.length;
  const active = servers.filter((server) => server.active).length;
  const inodeEnabled = servers.filter((server) => server.inode?.enabled).length;
  const dynatraceLinked = servers.filter((server) => server.dynatraceEntityId).length;
  return { total, active, inactive: total - active, inodeEnabled, dynatraceLinked };
}

function assignUniqueServerId(preferredId, servers, existingId) {
  const baseId = sanitizeId(preferredId) || "server";
  let id = baseId;
  let suffix = 2;
  while (servers.some((server) => server.id === id && server.id !== existingId)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function generateServerId(name) {
  return sanitizeId(name) || `server-${Date.now().toString(36)}`;
}

function sanitizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseTagList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,\n;]/);
  return Array.from(
    new Set(values.map((item) => cleanString(item, 80)).filter(Boolean))
  ).slice(0, 30);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, number));
}

async function generatePerformanceReport(options = {}) {
  const appConfig = readAppConfig();
  const dashboard = await buildDashboard({
    from: options.from || CONFIG.defaultFrom,
    to: options.to || options.rangeTo || undefined,
    problemSelector: options.problemSelector || CONFIG.defaultProblemSelector,
    metricSelector: options.metricSelector || CONFIG.defaultMetricSelector
  });
  const includeAiAnalysis =
    options.includeAiAnalysis !== undefined
      ? Boolean(options.includeAiAnalysis)
      : Boolean(appConfig.report.includeAiAnalysis);
  const enrichment = includeAiAnalysis
    ? await enrichReportWithAzureOpenAI(appConfig, dashboard)
    : buildLocalReportEnrichment(appConfig, dashboard, "Azure OpenAI enrichment disabled for this report.");

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    template: REPORT_TEMPLATE,
    server: appConfig.server,
    recipients: appConfig.recipients,
    dashboard,
    enrichment,
    analysis: enrichment?.narrative || null,
    email: getEmailHealth()
  };

  return {
    ...report,
    subject: buildReportSubject(appConfig, dashboard),
    text: renderPerformanceReportText(report),
    html: renderPerformanceReportHtml(report)
  };
}

async function emailPerformanceReport(options = {}) {
  const appConfig = readAppConfig();
  const recipients = uniqueEmails([
    ...appConfig.recipients.dls,
    ...appConfig.recipients.individuals,
    ...parseEmailList(options.to)
  ]);
  const report = await generatePerformanceReport({
    from: options.from || CONFIG.defaultFrom,
    to: options.rangeTo || options.timelineTo || options.toTime || undefined,
    problemSelector: options.problemSelector || CONFIG.defaultProblemSelector,
    metricSelector: options.metricSelector || CONFIG.defaultMetricSelector,
    includeAiAnalysis: options.includeAiAnalysis ?? appConfig.report.includeAiAnalysis
  });

  if (!appConfig.server.active && !options.force) {
    return {
      ok: true,
      mode: "skipped",
      message: "Server is inactive. Report was generated but email delivery was skipped.",
      report
    };
  }

  if (!recipients.length) {
    return {
      ok: false,
      mode: "blocked",
      error: "No distribution list or individual recipient email addresses are configured.",
      report
    };
  }

  if (!isSmtpConfigured()) {
    return {
      ok: true,
      mode: "preview",
      message: "SMTP is not configured. Report was generated but not sent.",
      recipients,
      report
    };
  }

  await sendSmtpMail({
    from: CONFIG.smtpFrom,
    to: recipients,
    subject: report.subject,
    text: report.text,
    html: report.html
  });

  return {
    ok: true,
    mode: "sent",
    recipients,
    sentAt: new Date().toISOString(),
    report
  };
}

function isSmtpConfigured() {
  return Boolean(CONFIG.smtpHost && CONFIG.smtpPort && CONFIG.smtpFrom);
}

const REPORT_TEMPLATE = {
  name: "SRE Operations Review",
  version: "2026.05",
  basis: "Google SRE, AWS COE, Microsoft post-incident activity, Atlassian postmortems, PagerDuty postmortems"
};

function buildLocalReportEnrichment(appConfig, dashboard, reason) {
  const summary = dashboard.summary || {};
  const server = appConfig.server || {};
  const problems = Array.isArray(dashboard.problems) ? dashboard.problems : [];
  const metrics = Array.isArray(dashboard.metrics) ? dashboard.metrics : [];
  const attentionMetrics = metrics.filter((metric) =>
    ["critical", "warning", "watch"].includes(String(metric.status || "").toLowerCase())
  );
  const roots = [...new Set(problems.map((problem) => problem.rootCause).filter(Boolean))];
  const posture = summary.posture || "Unknown";
  const serverName = server.name || "Monitored server";
  const openProblems = summary.openProblems ?? problems.filter((problem) => problem.status === "OPEN").length;
  const criticalSignals = summary.criticalProblems ?? 0;
  const impactedEntities = summary.impactedEntities ?? 0;
  const topMetric = attentionMetrics[0] || metrics[0] || null;

  return {
    ok: true,
    mode: "demo",
    provider: "Local deterministic fallback",
    model: null,
    reason,
    executiveSummary: `${serverName} is in ${posture} posture with ${openProblems} open problem(s), ${criticalSignals} critical signal(s), and ${impactedEntities} impacted entity reference(s). ${attentionMetrics.length ? `${attentionMetrics.length} metric signal(s) need review.` : "No metric signal is currently marked critical, warning, or watch."}`,
    impactAssessment: `Impact is currently represented by ${impactedEntities} impacted entity reference(s) and ${openProblems} open Dynatrace problem(s) in the selected observation window.`,
    probableRootCause: roots.length
      ? `Dynatrace root-cause candidates are ${roots.slice(0, 4).join(", ")}.`
      : "Root cause is unknown from the current dashboard data.",
    contributingFactors: [
      roots.length ? `Root-cause candidates: ${roots.slice(0, 4).join(", ")}` : "No root-cause candidate returned",
      attentionMetrics.length
        ? `Attention metrics: ${attentionMetrics.slice(0, 4).map((metric) => metric.displayName || metric.id).join(", ")}`
        : "No critical or warning metric classification",
      topMetric ? `${topMetric.displayName || topMetric.id} trend is ${topMetric.trend || "unknown"}` : "No metric trend available"
    ],
    recommendedActions: buildRecommendedActions({
      server,
      problems,
      metrics,
      attentionMetrics,
      criticalProblems: problems.filter((problem) =>
        ["AVAILABILITY", "ERROR", "RESOURCE_CONTENTION"].includes(String(problem.severity || "").toUpperCase())
      )
    }),
    watchItems: [
      ...attentionMetrics.slice(0, 3).map((metric) => `${metric.displayName || metric.id}: ${metric.status}`),
      openProblems ? "Open Dynatrace problem count" : "Problem feed remains clear"
    ].slice(0, 4),
    emailIntro: `${serverName} requires ${posture === "Healthy" ? "routine monitoring" : "operational review"} for the selected reporting window.`,
    confidence: roots.length || attentionMetrics.length ? "medium" : "low",
    narrative: reason
      ? `${reason} The report was enriched with deterministic local guidance using the available dashboard signals.`
      : "The report was enriched with deterministic local guidance using the available dashboard signals."
  };
}

function normalizeReportEnrichment(input, fallback, metadata = {}) {
  const base = fallback || {};
  const value = input && typeof input === "object" ? input : {};
  const normalized = {
    ...base,
    ...metadata,
    executiveSummary: cleanReportText(value.executiveSummary) || base.executiveSummary || "",
    impactAssessment: cleanReportText(value.impactAssessment) || base.impactAssessment || "",
    probableRootCause: cleanReportText(value.probableRootCause) || base.probableRootCause || "",
    contributingFactors: normalizeReportList(value.contributingFactors, base.contributingFactors),
    recommendedActions: normalizeReportList(value.recommendedActions, base.recommendedActions),
    watchItems: normalizeReportList(value.watchItems, base.watchItems),
    emailIntro: cleanReportText(value.emailIntro) || base.emailIntro || "",
    confidence: normalizeConfidence(value.confidence || base.confidence),
    narrative: cleanReportText(value.narrative) || cleanReportText(value.analysis) || base.narrative || ""
  };
  normalized.ok = metadata.ok ?? value.ok ?? base.ok ?? true;
  normalized.mode = metadata.mode || value.mode || base.mode || "demo";
  normalized.provider = metadata.provider || value.provider || base.provider || "Azure OpenAI";
  normalized.model = metadata.model || value.model || base.model || CONFIG.azureDeployment || null;
  normalized.reason = metadata.reason || value.reason || base.reason || null;
  normalized.warning = metadata.warning || value.warning || base.warning || null;
  normalized.error = metadata.error || value.error || base.error || null;
  normalized.usage = metadata.usage || value.usage || base.usage || null;
  normalized.rawId = metadata.rawId || value.rawId || base.rawId || null;
  return normalized;
}

function normalizeReportList(value, fallback = []) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n|;/) : fallback;
  return (Array.isArray(source) ? source : [])
    .map((item) =>
      cleanReportText(
        item && typeof item === "object"
          ? item.action || item.description || item.title || item.name || ""
          : item
      ).replace(/^-+\s*/, "")
    )
    .filter(Boolean)
    .slice(0, 8);
}

function cleanReportText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 1200);
}

function normalizeConfidence(value) {
  const confidence = String(value || "").toLowerCase();
  return ["low", "medium", "high"].includes(confidence) ? confidence : "low";
}

function parseJsonObjectFromText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function buildReportSubject(appConfig, dashboard) {
  const serverName = appConfig.server.name || "Monitored server";
  const posture = dashboard.summary?.posture || "Unknown";
  const mode = dashboard.mode ? ` ${String(dashboard.mode).toUpperCase()}` : "";
  return `${appConfig.report.subjectPrefix} ${posture}${mode} | ${serverName} operations report`;
}

function renderPerformanceReportText(report) {
  const view = buildReportView(report);
  return [
    `${view.serverName} operations report`,
    `Template: ${REPORT_TEMPLATE.name} v${REPORT_TEMPLATE.version}`,
    `Generated: ${view.generatedAt}`,
    `Observation window: ${view.timeRange}`,
    `Data mode: ${view.dataMode}`,
    "",
    "1. Executive summary",
    view.executiveSummary,
    "",
    "2. Scope and ownership",
    `- Server: ${view.serverName}`,
    `- Status: ${view.serverStatus}`,
    `- Environment: ${view.environment}`,
    `- Host: ${view.host}`,
    `- Owner: ${view.owner}`,
    "",
    "3. Impact snapshot",
    ...view.snapshot.map((item) => `- ${item.label}: ${item.value}`),
    `- AI impact assessment: ${view.impactAssessment}`,
    "",
    "4. Problem and risk evidence",
    ...view.problemLines,
    "",
    "5. Metric evidence",
    ...view.metricLines,
    "",
    "6. Timeline and detection context",
    ...view.timelineLines,
    "",
    "7. Root cause and contributing factors",
    ...view.rootCauseLines,
    "",
    "8. Recommended next actions",
    ...view.actionLines,
    "",
    "9. Azure OpenAI enrichment",
    `- Mode: ${view.enrichmentMode}`,
    `- Confidence: ${view.enrichmentConfidence}`,
    `- Opening note: ${view.emailIntro}`,
    `- Narrative: ${view.analysis}`,
    ...(view.watchLines.length ? ["- Watch items:", ...view.watchLines] : []),
    "",
    "10. Recipients and delivery",
    `- Distribution lists: ${view.distributionLists}`,
    `- Individuals: ${view.individualRecipients}`,
    `- SMTP: ${view.smtpState}`,
    "",
    "11. Server notes",
    view.serverDetails
  ].join("\n");
}

function formatReportRange(filters) {
  if (!filters.from && !filters.to) {
    return "Default";
  }
  return filters.to ? `${filters.from} to ${filters.to}` : `${filters.from} to now`;
}

function renderPerformanceReportHtml(report) {
  const view = buildReportView(report);
  const problemRows = view.problemRows.length
    ? view.problemRows.map(renderProblemHtmlRow).join("")
    : `<tr><td colspan="6" style="${tdStyle()}">No problems returned.</td></tr>`;
  const metricRows = view.metricRows.length
    ? view.metricRows.map(renderMetricHtmlRow).join("")
    : `<tr><td colspan="7" style="${tdStyle()}">No metric samples returned.</td></tr>`;
  const actionRows = view.actionItems.map(
    (item, index) => `
      <tr>
        <td style="${tdStyle({ width: "52px", textAlign: "center", fontWeight: "700" })}">${index + 1}</td>
        <td style="${tdStyle()}">${escapeHtml(item)}</td>
      </tr>`
  ).join("");
  const snapshotCards = view.snapshot.map((item) => `
    <td style="width:20%;padding:8px">
      <div style="border:1px solid #d7e1e5;border-radius:8px;padding:12px;background:#fbfcfd">
        <div style="font-size:12px;text-transform:uppercase;color:#657783;font-weight:700">${escapeHtml(item.label)}</div>
        <div style="font-size:24px;line-height:1.2;font-weight:800;color:#162126;margin-top:4px">${escapeHtml(item.value)}</div>
      </div>
    </td>`
  ).join("");

  return `<!doctype html>
<html>
  <body style="margin:0;background:#eef3f4;color:#162126;font-family:Arial,sans-serif;line-height:1.5">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3f4;padding:24px 0">
      <tr>
        <td align="center">
          <table role="presentation" width="760" cellspacing="0" cellpadding="0" style="width:760px;max-width:calc(100vw - 24px);background:#ffffff;border:1px solid #d7e1e5;border-radius:8px;overflow:hidden">
            <tr>
              <td style="height:5px;background:#0b766d"></td>
            </tr>
            <tr>
              <td style="padding:24px 26px 16px">
                <div style="font-size:12px;text-transform:uppercase;color:#657783;font-weight:700">Ops Intelligence</div>
                <h1 style="margin:6px 0 6px;font-size:26px;line-height:1.2;color:#162126">${escapeHtml(view.serverName)} operations report</h1>
                <div style="font-size:14px;color:#657783">Template: ${escapeHtml(REPORT_TEMPLATE.name)} v${escapeHtml(REPORT_TEMPLATE.version)} | Generated: ${escapeHtml(view.generatedAt)}</div>
                <p style="margin:12px 0 0;color:#42535d">${escapeHtml(view.emailIntro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 26px 22px">
                <span style="${pillStyle(view.postureTone)}">${escapeHtml(view.posture)}</span>
                <span style="${pillStyle("neutral")}">Window: ${escapeHtml(view.timeRange)}</span>
                <span style="${pillStyle("neutral")}">Data: ${escapeHtml(view.dataMode)}</span>
                <span style="${pillStyle(view.enrichmentTone)}">AI: ${escapeHtml(view.enrichmentMode)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:0 18px 18px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>${snapshotCards}</tr>
                </table>
              </td>
            </tr>
            ${htmlSection("Executive Summary", `<p style="margin:0">${escapeHtml(view.executiveSummary)}</p><p style="margin:10px 0 0;color:#42535d"><strong>AI impact assessment:</strong> ${escapeHtml(view.impactAssessment)}</p>`)}
            ${htmlSection("Scope and Ownership", renderDefinitionHtml([
              ["Server", view.serverName],
              ["Status", view.serverStatus],
              ["Environment", view.environment],
              ["Host", view.host],
              ["Owner", view.owner]
            ]))}
            ${htmlSection("Problem and Risk Evidence", renderTableHtml(["Problem", "Severity", "Impact", "Root Cause", "Duration", "Status"], problemRows))}
            ${htmlSection("Metric Evidence", renderTableHtml(["Metric", "Status", "Trend", "Latest", "Average", "P95", "Points"], metricRows))}
            ${htmlSection("Timeline and Detection Context", renderListHtml(view.timelineLines))}
            ${htmlSection("Root Cause and Contributing Factors", renderListHtml(view.rootCauseLines))}
            ${htmlSection("Recommended Next Actions", renderTableHtml(["#", "Action"], actionRows))}
            ${htmlSection("Azure OpenAI Enrichment", `
              ${renderDefinitionHtml([
                ["Mode", view.enrichmentMode],
                ["Confidence", view.enrichmentConfidence],
                ["Provider", view.enrichmentProvider],
                ["Model", view.enrichmentModel]
              ])}
              <div style="white-space:pre-wrap;background:#f3f6f7;border:1px solid #d7e1e5;border-radius:8px;padding:12px;margin-top:10px">${escapeHtml(view.analysis)}</div>
              <h3 style="margin:12px 0 8px;font-size:14px;color:#162126">Watch Items</h3>
              ${renderListHtml(view.watchLines.length ? view.watchLines : ["- No additional watch items returned."])}
            `)}
            ${htmlSection("Recipients and Delivery", renderDefinitionHtml([
              ["Distribution lists", view.distributionLists],
              ["Individuals", view.individualRecipients],
              ["SMTP", view.smtpState]
            ]))}
            ${htmlSection("Server Notes", `<p style="margin:0;white-space:pre-wrap">${escapeHtml(view.serverDetails)}</p>`)}
            <tr>
              <td style="padding:18px 26px 24px;color:#657783;font-size:12px;border-top:1px solid #d7e1e5">
                Format basis: ${escapeHtml(REPORT_TEMPLATE.basis)}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildReportView(report) {
  const dashboard = report.dashboard || {};
  const summary = dashboard.summary || {};
  const server = report.server || {};
  const metrics = Array.isArray(dashboard.metrics) ? dashboard.metrics : [];
  const problems = Array.isArray(dashboard.problems) ? dashboard.problems : [];
  const recipients = report.recipients || {};
  const filters = dashboard.filters || {};
  const attentionMetrics = metrics.filter((metric) =>
    ["critical", "warning", "watch"].includes(String(metric.status || "").toLowerCase())
  );
  const criticalProblems = problems.filter((problem) =>
    ["AVAILABILITY", "ERROR", "RESOURCE_CONTENTION"].includes(String(problem.severity || "").toUpperCase())
  );
  const fallbackEnrichment = buildLocalReportEnrichment({ server, recipients }, dashboard, "Azure OpenAI enrichment was unavailable.");
  const enrichment = normalizeReportEnrichment(report.enrichment, fallbackEnrichment);
  const serverName = server.name || "Monitored server";
  const posture = summary.posture || "Unknown";
  const dataMode = dashboard.mode || "unknown";
  const owner = server.owner || "Not set";
  const environment = server.environment || "Not set";
  const host = server.host || "Not set";
  const serverStatus = server.active ? "Active" : "Inactive";
  const generatedAt = formatReportDate(report.generatedAt);
  const timeRange = formatReportRange(filters);

  const snapshot = [
    { label: "Posture", value: posture },
    { label: "Open Problems", value: String(summary.openProblems ?? 0) },
    { label: "Critical Signals", value: String(summary.criticalProblems ?? criticalProblems.length) },
    { label: "Impacted Entities", value: String(summary.impactedEntities ?? 0) },
    { label: "Metric Signals", value: String(summary.signalCount ?? metrics.length) }
  ];

  const baseExecutiveSummary = [
    `${serverName} is currently ${serverStatus.toLowerCase()} in ${environment}.`,
    `The observed posture is ${posture} for ${timeRange}.`,
    `${summary.openProblems ?? 0} open problem(s), ${summary.criticalProblems ?? criticalProblems.length} critical signal(s), and ${summary.impactedEntities ?? 0} impacted entity reference(s) were found.`,
    attentionMetrics.length
      ? `${attentionMetrics.length} metric signal(s) need attention.`
      : "No metric signal is currently classified as critical, warning, or watch."
  ].join(" ");
  const executiveSummary = enrichment.executiveSummary || baseExecutiveSummary;

  const problemRows = problems.slice(0, 12).map((problem) => ({
    displayId: problem.displayId || "N/A",
    title: problem.title || "Untitled problem",
    severity: problem.severity || "INFO",
    impact: problem.impact || "UNKNOWN",
    rootCause: problem.rootCause || "Unknown",
    duration: problem.duration || "Unknown",
    status: problem.status || "UNKNOWN"
  }));
  const metricRows = metrics.slice(0, 12).map((metric) => ({
    name: metric.displayName || metric.id || "Metric",
    id: metric.id || "metric",
    status: metric.status || "unknown",
    trend: metric.trend || "unknown",
    latest: formatMetricForReport(metric.latest, metric.unit),
    average: formatMetricForReport(metric.average, metric.unit),
    p95: formatMetricForReport(metric.p95, metric.unit),
    points: String(metric.points ?? 0)
  }));

  const problemLines = problemRows.length
    ? problemRows.map(
        (problem) =>
          `- ${problem.displayId} ${problem.title}: ${problem.severity}, ${problem.status}, impact ${problem.impact}, root cause ${problem.rootCause}, duration ${problem.duration}`
      )
    : ["- No Dynatrace problems returned for the selected window."];
  const metricLines = metricRows.length
    ? metricRows.map(
        (metric) =>
          `- ${metric.name}: status ${metric.status}, trend ${metric.trend}, latest ${metric.latest}, average ${metric.average}, p95 ${metric.p95}, points ${metric.points}`
      )
    : ["- No metric samples returned for the selected window."];

  const rootCauseLines = buildRootCauseLines(problemRows, attentionMetrics, enrichment);
  const baseActionItems = buildRecommendedActions({
    server,
    problems: problemRows,
    metrics,
    attentionMetrics,
    criticalProblems
  });
  const actionItems = uniqueReportLines([
    ...(enrichment.recommendedActions || []),
    ...baseActionItems
  ]).slice(0, 8);
  const timelineLines = buildTimelineLines({
    generatedAt,
    timeRange,
    problems,
    metrics,
    dataMode
  });

  return {
    serverName,
    generatedAt,
    timeRange,
    dataMode,
    posture,
    postureTone: postureTone(posture),
    serverStatus,
    environment,
    host,
    owner,
    snapshot,
    executiveSummary,
    impactAssessment: enrichment.impactAssessment || "No additional Azure impact assessment returned.",
    problemRows,
    problemLines,
    metricRows,
    metricLines,
    timelineLines,
    rootCauseLines,
    actionItems,
    actionLines: actionItems.map((item) => `- ${item}`),
    analysis: enrichment.narrative || report.analysis || "Not included.",
    emailIntro: enrichment.emailIntro || `${serverName} operations report for ${timeRange}.`,
    watchLines: (enrichment.watchItems || []).map((item) => `- ${item}`),
    enrichmentMode: enrichment.mode || "demo",
    enrichmentTone: enrichment.mode === "live" ? "ok" : enrichment.mode === "live-unstructured" ? "warning" : "neutral",
    enrichmentConfidence: enrichment.confidence || "low",
    enrichmentProvider: enrichment.provider || "Azure OpenAI",
    enrichmentModel: enrichment.model || "Not configured",
    distributionLists: (recipients.dls || []).join(", ") || "None",
    individualRecipients: (recipients.individuals || []).join(", ") || "None",
    smtpState: report.email?.configured ? `${report.email.host}:${report.email.port}` : "Not configured",
    serverDetails: server.details || "No details configured."
  };
}

function buildRootCauseLines(problemRows, attentionMetrics, enrichment = {}) {
  const roots = [...new Set(problemRows.map((problem) => problem.rootCause).filter(Boolean))];
  const lines = [];
  if (enrichment.probableRootCause) {
    lines.push(`- Enrichment assessment: ${enrichment.probableRootCause}`);
  }
  for (const factor of enrichment.contributingFactors || []) {
    lines.push(`- Contributing factor: ${factor}`);
  }
  if (roots.length) {
    lines.push(`- Dynatrace root-cause candidates: ${roots.slice(0, 6).join(", ")}.`);
  } else {
    lines.push("- No Dynatrace root-cause candidate was returned.");
  }
  if (attentionMetrics.length) {
    lines.push(
      `- Contributing metric signals: ${attentionMetrics
        .slice(0, 6)
        .map((metric) => `${metric.displayName || metric.id} (${metric.status})`)
        .join(", ")}.`
    );
  } else {
    lines.push("- No metric signal is currently flagged as critical, warning, or watch.");
  }
  lines.push("- Validate root cause with deployment, infrastructure, and application logs before closing actions.");
  return uniqueReportLines(lines);
}

function buildTimelineLines({ generatedAt, timeRange, problems, metrics, dataMode }) {
  const problemStarts = problems
    .map((problem) => Number(problem.startTime))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  const metricSamples = metrics
    .map((metric) => Number(metric.latestTimestamp))
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  const firstProblem = problemStarts.length ? formatReportDate(Math.min(...problemStarts)) : "No problem start time available";
  const latestMetric = metricSamples.length ? formatReportDate(Math.max(...metricSamples)) : "No metric sample time available";
  return [
    `- Observation window: ${timeRange}.`,
    `- First problem start observed: ${firstProblem}.`,
    `- Latest metric sample observed: ${latestMetric}.`,
    `- Report generated: ${generatedAt}.`,
    `- Data source mode: ${dataMode}.`
  ];
}

function buildRecommendedActions({ server, problems, metrics, attentionMetrics, criticalProblems }) {
  const actions = [];
  if (!server.active) {
    actions.push("Confirm whether this server should remain inactive or re-enable monitoring before the next report cycle.");
  }
  if (criticalProblems.length) {
    actions.push(`Prioritize triage for ${criticalProblems.length} critical Dynatrace problem(s), starting with open availability, error, or resource contention events.`);
  }
  if (attentionMetrics.length) {
    actions.push(`Review ${attentionMetrics.length} metric signal(s) marked critical, warning, or watch and compare with application logs for the same window.`);
  }
  if (problems.length) {
    actions.push("Assign an owner for each root-cause candidate and capture the mitigation or rollback decision.");
  }
  if (metrics.length) {
    actions.push("Validate alert thresholds for the reported metrics and tune noisy or missing alerts after review.");
  }
  actions.push("Record follow-up tickets with owner, due date, and verification criteria.");
  return actions;
}

function uniqueReportLines(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const item = String(value || "").trim();
    const key = item.replace(/^-+\s*/, "").toLowerCase();
    if (!item || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

function renderProblemHtmlRow(problem) {
  return `
    <tr>
      <td style="${tdStyle()}"><strong>${escapeHtml(problem.displayId)}</strong><br>${escapeHtml(problem.title)}</td>
      <td style="${tdStyle()}"><span style="${pillStyle(problemTone(problem.severity))}">${escapeHtml(problem.severity)}</span></td>
      <td style="${tdStyle()}">${escapeHtml(problem.impact)}</td>
      <td style="${tdStyle()}">${escapeHtml(problem.rootCause)}</td>
      <td style="${tdStyle()}">${escapeHtml(problem.duration)}</td>
      <td style="${tdStyle()}">${escapeHtml(problem.status)}</td>
    </tr>`;
}

function renderMetricHtmlRow(metric) {
  return `
    <tr>
      <td style="${tdStyle()}"><strong>${escapeHtml(metric.name)}</strong><br><span style="color:#657783">${escapeHtml(metric.id)}</span></td>
      <td style="${tdStyle()}"><span style="${pillStyle(metricTone(metric.status))}">${escapeHtml(metric.status)}</span></td>
      <td style="${tdStyle()}">${escapeHtml(metric.trend)}</td>
      <td style="${tdStyle()}">${escapeHtml(metric.latest)}</td>
      <td style="${tdStyle()}">${escapeHtml(metric.average)}</td>
      <td style="${tdStyle()}">${escapeHtml(metric.p95)}</td>
      <td style="${tdStyle()}">${escapeHtml(metric.points)}</td>
    </tr>`;
}

function htmlSection(title, content) {
  return `
    <tr>
      <td style="padding:0 26px 20px">
        <h2 style="margin:0 0 10px;font-size:18px;line-height:1.25;color:#162126">${escapeHtml(title)}</h2>
        ${content}
      </td>
    </tr>`;
}

function renderDefinitionHtml(rows) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #d7e1e5;border-radius:8px;overflow:hidden">
      ${rows.map(([label, value]) => `
        <tr>
          <td style="${tdStyle({ width: "190px", color: "#657783", fontWeight: "700", background: "#f3f6f7" })}">${escapeHtml(label)}</td>
          <td style="${tdStyle()}">${escapeHtml(value)}</td>
        </tr>`).join("")}
    </table>`;
}

function renderListHtml(lines) {
  return `<ul style="margin:0;padding-left:20px">${lines.map((line) => `<li>${escapeHtml(line.replace(/^- /, ""))}</li>`).join("")}</ul>`;
}

function renderTableHtml(headers, rows) {
  return `
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d7e1e5;border-radius:8px;overflow:hidden">
      <thead>
        <tr>${headers.map((header) => `<th style="${thStyle()}">${escapeHtml(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function thStyle() {
  return "padding:10px 12px;text-align:left;border-bottom:1px solid #d7e1e5;background:#f3f6f7;color:#42535d;font-size:12px;text-transform:uppercase";
}

function tdStyle(extra = {}) {
  const styles = {
    padding: "10px 12px",
    textAlign: "left",
    borderBottom: "1px solid #d7e1e5",
    verticalAlign: "top",
    fontSize: "14px",
    color: "#162126",
    ...extra
  };
  return Object.entries(styles)
    .map(([key, value]) => `${kebabCase(key)}:${value}`)
    .join(";");
}

function pillStyle(tone) {
  const tones = {
    danger: ["#fde8e5", "#b42318"],
    warning: ["#fff3df", "#92400e"],
    ok: ["#e5f7ec", "#166534"],
    info: ["#e8f0ff", "#1d4ed8"],
    neutral: ["#edf2f4", "#31424c"]
  };
  const [background, color] = tones[tone] || tones.neutral;
  return `display:inline-block;margin:0 6px 6px 0;padding:5px 9px;border-radius:999px;background:${background};color:${color};font-size:12px;font-weight:800;text-transform:uppercase`;
}

function postureTone(posture) {
  const value = String(posture || "").toLowerCase();
  if (value.includes("critical") || value.includes("investigate")) {
    return "danger";
  }
  if (value.includes("watch") || value.includes("degrad")) {
    return "warning";
  }
  if (value.includes("healthy") || value.includes("normal")) {
    return "ok";
  }
  return "neutral";
}

function problemTone(severity) {
  const value = String(severity || "").toUpperCase();
  if (["AVAILABILITY", "ERROR", "RESOURCE_CONTENTION"].includes(value)) {
    return "danger";
  }
  if (value === "PERFORMANCE") {
    return "warning";
  }
  return "neutral";
}

function metricTone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "critical") {
    return "danger";
  }
  if (value === "warning" || value === "watch") {
    return "warning";
  }
  if (value === "normal") {
    return "ok";
  }
  return "neutral";
}

function formatMetricForReport(value, unit) {
  const formatted = formatNumber(value);
  return formatted === "n/a" ? formatted : `${formatted}${unit || ""}`;
}

function formatReportDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

function kebabCase(value) {
  return String(value).replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

async function sendSmtpMail({ from, to, subject, text, html }) {
  const client = await openSmtpClient();
  try {
    await client.expect(220);
    await client.command("EHLO localhost", 250);

    if (!CONFIG.smtpSecure && CONFIG.smtpStartTls) {
      await client.command("STARTTLS", 220);
      client.upgradeToTls();
      await client.expectSecure();
      await client.command("EHLO localhost", 250);
    }

    if (CONFIG.smtpUser && CONFIG.smtpPass) {
      await client.command("AUTH LOGIN", 334);
      await client.command(Buffer.from(CONFIG.smtpUser).toString("base64"), 334);
      await client.command(Buffer.from(CONFIG.smtpPass).toString("base64"), 235);
    }

    await client.command(`MAIL FROM:<${from}>`, 250);
    for (const recipient of to) {
      await client.command(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await client.command("DATA", 354);
    await client.data(buildMimeMessage({ from, to, subject, text, html }));
    await client.command("QUIT", 221).catch(() => {});
  } finally {
    client.close();
  }
}

function openSmtpClient() {
  const socketOptions = {
    host: CONFIG.smtpHost,
    port: CONFIG.smtpPort,
    servername: CONFIG.smtpHost,
    rejectUnauthorized: CONFIG.smtpRejectUnauthorized
  };
  const socket = CONFIG.smtpSecure ? tls.connect(socketOptions) : net.connect(socketOptions);
  return Promise.resolve(createSmtpClient(socket));
}

function createSmtpClient(initialSocket) {
  let socket = initialSocket;
  let buffer = "";
  let current = null;
  const responses = [];
  const waiters = [];

  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      const code = Number(line.slice(0, 3));
      if (!current) {
        current = { code, lines: [] };
      }
      current.lines.push(line);
      if (line[3] !== "-") {
        const response = current;
        current = null;
        if (waiters.length) {
          waiters.shift()(response);
        } else {
          responses.push(response);
        }
      }
    }
  };

  const attach = () => {
    socket.on("data", onData);
  };

  attach();

  const read = () =>
    new Promise((resolve, reject) => {
      if (responses.length) {
        resolve(responses.shift());
        return;
      }
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off("error", onError);
      };
      socket.once("error", onError);
      waiters.push((response) => {
        cleanup();
        resolve(response);
      });
    });

  const expect = async (expected) => {
    const response = await read();
    const codes = Array.isArray(expected) ? expected : [expected];
    if (!codes.includes(response.code)) {
      throw new Error(`SMTP expected ${codes.join("/")} but received ${response.lines.join(" | ")}`);
    }
    return response;
  };

  return {
    expect,
    command(command, expected) {
      socket.write(`${command}\r\n`);
      return expect(expected);
    },
    data(message) {
      const normalized = message.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
      socket.write(`${normalized}\r\n.\r\n`);
      return expect(250);
    },
    upgradeToTls() {
      socket.off("data", onData);
      socket = tls.connect({
        socket,
        servername: CONFIG.smtpHost,
        rejectUnauthorized: CONFIG.smtpRejectUnauthorized
      });
      buffer = "";
      current = null;
      responses.length = 0;
      attach();
    },
    expectSecure() {
      return new Promise((resolve, reject) => {
        if (socket.authorized || !CONFIG.smtpRejectUnauthorized) {
          resolve();
          return;
        }
        socket.once("secureConnect", resolve);
        socket.once("error", reject);
      });
    },
    close() {
      socket.destroy();
    }
  };
}

function buildMimeMessage({ from, to, subject, text, html }) {
  const boundary = `ops-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return [
    `From: ${sanitizeHeader(from)}`,
    `To: ${to.map(sanitizeHeader).join(", ")}`,
    `Subject: ${sanitizeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`
  ].join("\r\n");
}

function stripLargePayload(payload) {
  return {
    ok: payload.ok,
    mode: payload.mode,
    error: payload.error || null,
    totalCount: payload.totalCount ?? null,
    nextPageKey: payload.nextPageKey ?? null,
    resolution: payload.resolution ?? null
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(requestPath, res) {
  const pathname = requestPath === "/" ? "/index.html" : requestPath;
  const normalizedPath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { ok: false, error: "Forbidden" });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(content);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function cleanString(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseEmailList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,\n;]/);
  return uniqueEmails(values.map((item) => String(item).trim()).filter(Boolean));
}

function uniqueEmails(values) {
  const seen = new Set();
  const emails = [];
  for (const value of values) {
    const email = String(value || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      continue;
    }
    const key = email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      emails.push(email);
    }
  }
  return emails;
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function sanitizeHeader(value) {
  return String(value || "").replace(/[\r\n]/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return value;
  }
}

function formatDuration(startTime, endTime) {
  if (!startTime) {
    return "Unknown";
  }
  const end = endTime && endTime > 0 ? endTime : Date.now();
  const minutes = Math.max(1, Math.round((end - startTime) / 60000));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

function demoProblems() {
  const now = Date.now();
  return {
    totalCount: 3,
    nextPageKey: null,
    problems: [
      {
        problemId: "DEMO-001",
        displayId: "P-2401",
        title: "Checkout latency above baseline",
        status: "OPEN",
        severityLevel: "PERFORMANCE",
        impactLevel: "SERVICES",
        startTime: now - 42 * 60000,
        endTime: -1,
        rootCauseEntity: { name: "checkout-service" },
        affectedEntities: [{ name: "checkout-service" }],
        impactedEntities: [{ name: "web-store" }, { name: "mobile-api" }],
        recentComments: { comments: [] }
      },
      {
        problemId: "DEMO-002",
        displayId: "P-2402",
        title: "Payment error rate spike",
        status: "OPEN",
        severityLevel: "ERROR",
        impactLevel: "APPLICATION",
        startTime: now - 25 * 60000,
        endTime: -1,
        rootCauseEntity: { name: "payment-gateway" },
        affectedEntities: [{ name: "payment-gateway" }],
        impactedEntities: [{ name: "checkout" }],
        recentComments: { comments: [{ content: "Demo comment" }] }
      },
      {
        problemId: "DEMO-003",
        displayId: "P-2398",
        title: "Kubernetes node memory pressure",
        status: "CLOSED",
        severityLevel: "RESOURCE_CONTENTION",
        impactLevel: "INFRASTRUCTURE",
        startTime: now - 4 * 60 * 60000,
        endTime: now - 125 * 60000,
        rootCauseEntity: { name: "aks-nodepool-03" },
        affectedEntities: [{ name: "aks-nodepool-03" }],
        impactedEntities: [{ name: "inventory-api" }],
        recentComments: { comments: [] }
      }
    ]
  };
}

function demoMetrics() {
  const now = Date.now();
  const timestamps = Array.from({ length: 12 }, (_, index) => now - (11 - index) * 5 * 60000);
  return {
    totalCount: 3,
    nextPageKey: null,
    resolution: "5m",
    result: [
      {
        metricId: "builtin:host.cpu.usage:avg:fold",
        data: [{ timestamps, values: [41, 44, 48, 53, 61, 72, 78, 75, 69, 62, 58, 55] }]
      },
      {
        metricId: "builtin:service.response.time:avg:fold",
        data: [{ timestamps, values: [182, 188, 204, 230, 318, 410, 456, 421, 350, 280, 240, 218] }]
      },
      {
        metricId: "custom:service.error_rate:avg:fold",
        data: [{ timestamps, values: [0.2, 0.3, 0.4, 0.5, 1.2, 2.7, 4.1, 3.8, 2.1, 1.1, 0.6, 0.4] }]
      }
    ]
  };
}

function demoInodeMetrics(serverRecord) {
  const now = Date.now();
  const timestamps = Array.from({ length: 18 }, (_, index) => now - (17 - index) * 10 * 60000);
  const base =
    serverRecord.active === false
      ? 0
      : serverRecord.name.toLowerCase().includes("database")
        ? 83
        : 58;
  const values = timestamps.map((_, index) => {
    if (!base) {
      return null;
    }
    const drift = Math.sin(index / 2.2) * 3 + index * 0.35;
    return Math.max(0, Math.min(99, Number((base + drift).toFixed(2))));
  });
  return {
    totalCount: 1,
    nextPageKey: null,
    resolution: "10m",
    result: [
      {
        metricId: serverRecord.inode?.metricSelector || CONFIG.defaultInodeMetricSelector,
        data: [{ timestamps, values }]
      }
    ]
  };
}

function demoAnalysis(context) {
  const summary = context?.summary || {};
  return [
    `Operational posture: ${summary.posture || "Watch"}.`,
    `Open problems: ${summary.openProblems ?? 2}; critical signals: ${
      summary.criticalProblems ?? 1
    }.`,
    "Most likely focus areas are checkout latency, payment errors, and infrastructure pressure. Validate the latest deployment, inspect service dependencies, and compare error rate with request volume before declaring root cause.",
    "Azure OpenAI is not configured, so this is deterministic demo guidance from the local backend."
  ].join("\n\n");
}

function demoServerConversation(question, context) {
  const server = context.server || {};
  const inode = context.inodeCheck || {};
  const latest =
    inode.latestUsagePercent === null || inode.latestUsagePercent === undefined
      ? "not available"
      : `${formatNumber(inode.latestUsagePercent)}%`;
  return [
    `Server: ${server.name || "Monitored server"} (${server.environment || "environment not set"}).`,
    `Inode status is ${inode.status || "unknown"} with latest usage at ${latest}.`,
    `Question: ${question || "Summarize this server's current health."}`,
    "Azure OpenAI is not configured, so this is a deterministic local response. Configure Azure OpenAI to ask natural-language questions over the server, inode, metric, and Dynatrace problem context.",
    "Next actions: confirm the Dynatrace host entity ID, validate the inode metric selector, and review top directories or workloads creating many files if usage is warning or critical."
  ].join("\n\n");
}
