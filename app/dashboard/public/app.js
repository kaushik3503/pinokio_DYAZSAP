const state = {
  dashboard: null,
  monitoredServers: [],
  selectedServerId: null,
  flowAnimation: null
};

const els = {
  dynatraceDot: document.querySelector("#dynatrace-dot"),
  azureDot: document.querySelector("#azure-dot"),
  emailDot: document.querySelector("#email-dot"),
  lastUpdated: document.querySelector("#last-updated"),
  timeRange: document.querySelector("#time-range"),
  customRange: document.querySelector("#custom-range"),
  customFrom: document.querySelector("#custom-from"),
  customTo: document.querySelector("#custom-to"),
  refreshBtn: document.querySelector("#refresh-btn"),
  serversStatus: document.querySelector("#servers-status"),
  serverSummary: document.querySelector("#server-summary"),
  serverList: document.querySelector("#server-list"),
  newServerBtn: document.querySelector("#new-server-btn"),
  monitorServerForm: document.querySelector("#monitor-server-form"),
  monitorServerStatus: document.querySelector("#monitor-server-status"),
  monitorServerId: document.querySelector("#monitor-server-id"),
  monitorServerActive: document.querySelector("#monitor-server-active"),
  monitorServerActiveLabel: document.querySelector("#monitor-server-active-label"),
  monitorServerName: document.querySelector("#monitor-server-name"),
  monitorServerEnvironment: document.querySelector("#monitor-server-environment"),
  monitorServerHost: document.querySelector("#monitor-server-host"),
  monitorServerEntity: document.querySelector("#monitor-server-entity"),
  monitorServerOs: document.querySelector("#monitor-server-os"),
  monitorServerOwner: document.querySelector("#monitor-server-owner"),
  monitorServerZone: document.querySelector("#monitor-server-zone"),
  monitorServerTags: document.querySelector("#monitor-server-tags"),
  monitorServerProblemSelector: document.querySelector("#monitor-server-problem-selector"),
  monitorServerInodeMetric: document.querySelector("#monitor-server-inode-metric"),
  monitorServerInodeWarning: document.querySelector("#monitor-server-inode-warning"),
  monitorServerInodeCritical: document.querySelector("#monitor-server-inode-critical"),
  monitorServerInodeEnabled: document.querySelector("#monitor-server-inode-enabled"),
  monitorServerDetails: document.querySelector("#monitor-server-details"),
  saveMonitorServerBtn: document.querySelector("#save-monitor-server-btn"),
  deleteMonitorServerBtn: document.querySelector("#delete-monitor-server-btn"),
  serverSelect: document.querySelector("#server-select"),
  checkInodesBtn: document.querySelector("#check-inodes-btn"),
  inodeStatus: document.querySelector("#inode-status"),
  inodeDetails: document.querySelector("#inode-details"),
  serverQuestion: document.querySelector("#server-question"),
  askServerBtn: document.querySelector("#ask-server-btn"),
  serverAiOutput: document.querySelector("#server-ai-output"),
  analyzeBtn: document.querySelector("#analyze-btn"),
  configForm: document.querySelector("#config-form"),
  saveConfigBtn: document.querySelector("#save-config-btn"),
  configStatus: document.querySelector("#config-status"),
  serverActive: document.querySelector("#server-active"),
  serverActiveLabel: document.querySelector("#server-active-label"),
  serverName: document.querySelector("#server-name"),
  serverEnvironment: document.querySelector("#server-environment"),
  serverHost: document.querySelector("#server-host"),
  serverOwner: document.querySelector("#server-owner"),
  serverDetails: document.querySelector("#server-details"),
  recipientDls: document.querySelector("#recipient-dls"),
  recipientIndividuals: document.querySelector("#recipient-individuals"),
  reportPrefix: document.querySelector("#report-prefix"),
  reportIncludeAi: document.querySelector("#report-include-ai"),
  generateReportBtn: document.querySelector("#generate-report-btn"),
  sendReportBtn: document.querySelector("#send-report-btn"),
  reportStatus: document.querySelector("#report-status"),
  reportOutput: document.querySelector("#report-output"),
  smtpState: document.querySelector("#smtp-state"),
  recipientSummary: document.querySelector("#recipient-summary"),
  serverStatusSummary: document.querySelector("#server-status-summary"),
  question: document.querySelector("#question"),
  analysisOutput: document.querySelector("#analysis-output"),
  dataMode: document.querySelector("#data-mode"),
  problemCount: document.querySelector("#problem-count"),
  problemTable: document.querySelector("#problem-table"),
  metricGrid: document.querySelector("#metric-grid"),
  metricInsightStrip: document.querySelector("#metric-insight-strip"),
  metricDetailTable: document.querySelector("#metric-detail-table"),
  trendChart: document.querySelector("#trend-chart"),
  flowCanvas: document.querySelector("#flow-canvas"),
  azureModel: document.querySelector("#azure-model"),
  kpiPosture: document.querySelector("#kpi-posture"),
  kpiOpen: document.querySelector("#kpi-open"),
  kpiCritical: document.querySelector("#kpi-critical"),
  kpiImpacted: document.querySelector("#kpi-impacted")
};

els.refreshBtn.addEventListener("click", () => loadDashboard());
els.timeRange.addEventListener("change", () => {
  updateCustomRangeVisibility(true);
  loadDashboard();
});
els.customFrom.addEventListener("change", () => {
  if (els.timeRange.value === "custom") {
    loadDashboard();
  }
});
els.customTo.addEventListener("change", () => {
  if (els.timeRange.value === "custom") {
    loadDashboard();
  }
});
els.newServerBtn.addEventListener("click", () => clearServerForm());
els.monitorServerForm.addEventListener("submit", (event) => saveMonitoredServer(event));
els.monitorServerActive.addEventListener("change", () => updateMonitorServerActiveLabel());
els.deleteMonitorServerBtn.addEventListener("click", () => deleteSelectedServer());
els.serverSelect.addEventListener("change", () => selectServer(els.serverSelect.value));
els.checkInodesBtn.addEventListener("click", () => checkInodes());
els.askServerBtn.addEventListener("click", () => askServerQuestion());
els.analyzeBtn.addEventListener("click", () => runAnalysis());
els.configForm.addEventListener("submit", (event) => saveConfig(event));
els.serverActive.addEventListener("change", () => updateActiveLabel());
els.generateReportBtn.addEventListener("click", () => generateReport());
els.sendReportBtn.addEventListener("click", () => sendReport());

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");
  });
});

initialize();

async function initialize() {
  initializeCustomRange();
  initFlowCanvas();
  await loadConfig();
  await loadServers();
  await loadDashboard();
}

async function loadConfig() {
  try {
    const payload = await fetchJson("/api/config");
    state.config = payload.config;
    renderConfig(payload.config, payload.email);
  } catch (error) {
    els.configStatus.textContent = `Config load failed: ${error.message}`;
  }
}

async function loadServers() {
  try {
    const payload = await fetchJson("/api/servers");
    state.monitoredServers = payload.servers || [];
    if (!state.selectedServerId && state.monitoredServers.length) {
      state.selectedServerId = state.monitoredServers[0].id;
    }
    renderServers(payload.summary || {});
  } catch (error) {
    els.serversStatus.textContent = `Server load failed: ${error.message}`;
  }
}

async function saveMonitoredServer(event) {
  event.preventDefault();
  setBusy(els.saveMonitorServerBtn, true, "Saving");
  try {
    const server = readMonitorServerForm();
    const id = els.monitorServerId.value;
    const payload = await fetchJson(id ? `/api/servers/${encodeURIComponent(id)}` : "/api/servers", {
      method: id ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ server })
    });
    state.selectedServerId = payload.server.id;
    els.monitorServerStatus.textContent = `Saved ${new Date().toLocaleTimeString()}`;
    await loadServers();
  } catch (error) {
    els.monitorServerStatus.textContent = `Save failed: ${error.message}`;
  } finally {
    setBusy(els.saveMonitorServerBtn, false, "Save Server");
  }
}

async function deleteSelectedServer() {
  const id = els.monitorServerId.value;
  if (!id) {
    clearServerForm();
    return;
  }

  setBusy(els.deleteMonitorServerBtn, true, "Removing");
  try {
    await fetchJson(`/api/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.selectedServerId = null;
    els.inodeDetails.innerHTML = "";
    els.serverAiOutput.textContent = "Ask a natural-language question about the selected server.";
    await loadServers();
  } catch (error) {
    els.monitorServerStatus.textContent = `Remove failed: ${error.message}`;
  } finally {
    setBusy(els.deleteMonitorServerBtn, false, "Remove");
  }
}

async function checkInodes() {
  const server = getSelectedServer();
  if (!server) {
    els.inodeStatus.textContent = "Select a server first.";
    return;
  }

  setBusy(els.checkInodesBtn, true, "Checking");
  try {
    const params = buildTimelineParams();
    const result = await fetchJson(
      `/api/servers/${encodeURIComponent(server.id)}/inodes?${params.toString()}`
    );
    renderInodeDetails(result);
  } catch (error) {
    els.inodeStatus.textContent = `Inode check failed: ${error.message}`;
  } finally {
    setBusy(els.checkInodesBtn, false, "Check Inodes");
  }
}

async function askServerQuestion() {
  const server = getSelectedServer();
  if (!server) {
    els.serverAiOutput.textContent = "Select a server before asking a question.";
    return;
  }

  setBusy(els.askServerBtn, true, "Asking");
  els.serverAiOutput.textContent = "Collecting Dynatrace context and asking Azure OpenAI...";
  try {
    const result = await fetchJson(`/api/servers/${encodeURIComponent(server.id)}/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...readTimelinePayload(false),
        question: els.serverQuestion.value
      })
    });
    els.serverAiOutput.textContent = result.answer || "No server analysis returned.";
  } catch (error) {
    els.serverAiOutput.textContent = `Server question failed: ${error.message}`;
  } finally {
    setBusy(els.askServerBtn, false, "Ask");
  }
}

async function loadDashboard() {
  setBusy(els.refreshBtn, true, "Refreshing");
  try {
    const params = buildTimelineParams();
    const dashboard = await fetchJson(`/api/dashboard?${params.toString()}`);
    state.dashboard = dashboard;
    renderDashboard(dashboard);
  } catch (error) {
    els.analysisOutput.textContent = `Dashboard load failed: ${error.message}`;
  } finally {
    setBusy(els.refreshBtn, false, "Refresh");
  }
}

async function saveConfig(event) {
  event.preventDefault();
  setBusy(els.saveConfigBtn, true, "Saving");
  try {
    const payload = await fetchJson("/api/config", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        config: readConfigForm()
      })
    });
    state.config = payload.config;
    renderConfig(payload.config, payload.email);
    els.configStatus.textContent = `Saved ${new Date().toLocaleTimeString()}`;
    await loadDashboard();
  } catch (error) {
    els.configStatus.textContent = `Save failed: ${error.message}`;
  } finally {
    setBusy(els.saveConfigBtn, false, "Save Details");
  }
}

async function runAnalysis() {
  if (!state.dashboard) {
    await loadDashboard();
  }

  setBusy(els.analyzeBtn, true, "Analyzing");
  els.analysisOutput.textContent = "Analyzing current dashboard context...";

  try {
    const result = await fetchJson("/api/ai/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question: els.question.value,
        context: state.dashboard
      })
    });
    els.analysisOutput.textContent = result.answer || "No analysis returned.";
  } catch (error) {
    els.analysisOutput.textContent = `Analysis failed: ${error.message}`;
  } finally {
    setBusy(els.analyzeBtn, false, "Analyze");
  }
}

async function generateReport() {
  setBusy(els.generateReportBtn, true, "Generating");
  try {
    const params = buildTimelineParams({
      includeAiAnalysis: String(els.reportIncludeAi.checked)
    });
    const result = await fetchJson(`/api/reports/performance?${params.toString()}`);
    renderReportResult(result, "Generated");
  } catch (error) {
    els.reportStatus.textContent = `Report failed: ${error.message}`;
  } finally {
    setBusy(els.generateReportBtn, false, "Generate Report");
  }
}

async function sendReport() {
  setBusy(els.sendReportBtn, true, "Sending");
  try {
    const response = await fetch("/api/reports/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...readTimelinePayload(true),
        includeAiAnalysis: els.reportIncludeAi.checked
      })
    });
    const result = await response.json();
    renderReportResult(result, result.mode || "Email");
    if (!response.ok || result.ok === false) {
      els.reportStatus.textContent = result.error || response.statusText;
    }
  } catch (error) {
    els.reportStatus.textContent = `Email failed: ${error.message}`;
  } finally {
    setBusy(els.sendReportBtn, false, "Send Email");
  }
}

function renderDashboard(dashboard) {
  const summary = dashboard.summary || {};
  els.lastUpdated.textContent = `Last updated ${new Date(dashboard.generatedAt).toLocaleString()}`;
  els.kpiPosture.textContent = summary.posture || "--";
  els.kpiOpen.textContent = summary.openProblems ?? "--";
  els.kpiCritical.textContent = summary.criticalProblems ?? "--";
  els.kpiImpacted.textContent = summary.impactedEntities ?? "--";

  const mode = dashboard.mode || "demo";
  els.dataMode.textContent = mode;
  els.dataMode.classList.toggle("live", mode === "live");

  const health = dashboard.health || {};
  els.dynatraceDot.className = `dot ${health.dynatrace?.configured ? "live" : "demo"}`;
  els.azureDot.className = `dot ${health.azureOpenAI?.configured ? "live" : "demo"}`;
  els.emailDot.className = `dot ${health.email?.configured ? "live" : "demo"}`;
  els.azureModel.textContent = health.azureOpenAI?.deployment || "Not configured";

  renderProblems(dashboard.problems || []);
  const metrics = dashboard.metrics || [];
  renderTrendChart(metrics);
  renderMetrics(metrics);
}

function renderConfig(config, email) {
  const server = config.server || {};
  const recipients = config.recipients || {};
  const report = config.report || {};

  els.serverName.value = server.name || "";
  els.serverEnvironment.value = server.environment || "";
  els.serverHost.value = server.host || "";
  els.serverOwner.value = server.owner || "";
  els.serverDetails.value = server.details || "";
  els.serverActive.checked = Boolean(server.active);
  els.recipientDls.value = (recipients.dls || []).join("\n");
  els.recipientIndividuals.value = (recipients.individuals || []).join("\n");
  els.reportPrefix.value = report.subjectPrefix || "[Ops Intelligence]";
  els.reportIncludeAi.checked = Boolean(report.includeAiAnalysis);
  updateActiveLabel();

  const recipientCount = (recipients.dls || []).length + (recipients.individuals || []).length;
  els.smtpState.textContent = email?.configured
    ? `${email.host}:${email.port}`
    : "Not configured";
  els.recipientSummary.textContent = recipientCount ? `${recipientCount} configured` : "None";
  els.serverStatusSummary.textContent = server.active ? "Active" : "Inactive";
  els.emailDot.className = `dot ${email?.configured ? "live" : "demo"}`;
}

function renderServers(summary) {
  const servers = state.monitoredServers;
  els.serversStatus.textContent = `${summary.active ?? 0} active of ${summary.total ?? servers.length} monitored servers`;
  els.serverSummary.innerHTML = `
    <span><strong>${summary.total ?? servers.length}</strong>Total</span>
    <span><strong>${summary.active ?? 0}</strong>Active</span>
    <span><strong>${summary.dynatraceLinked ?? 0}</strong>Dynatrace linked</span>
    <span><strong>${summary.inodeEnabled ?? 0}</strong>Inode checks</span>
  `;

  if (!servers.length) {
    els.serverList.innerHTML = `<div class="server-card empty">No servers configured.</div>`;
    els.serverSelect.innerHTML = "";
    clearServerForm();
    return;
  }

  if (!servers.some((server) => server.id === state.selectedServerId)) {
    state.selectedServerId = servers[0].id;
  }

  els.serverList.innerHTML = servers
    .map((server) => {
      const selected = server.id === state.selectedServerId ? "selected" : "";
      const status = server.active ? "Active" : "Inactive";
      const tags = (server.tags || []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
      return `
        <button class="server-card ${selected}" type="button" data-server-id="${escapeHtml(server.id)}">
          <strong>${escapeHtml(server.name)}</strong>
          <small>${escapeHtml(server.environment || "Environment not set")} | ${escapeHtml(status)}</small>
          <span>${escapeHtml(server.host || "Host not set")}</span>
          <em>${escapeHtml(server.dynatraceEntityId || "No Dynatrace entity ID")}</em>
          <div class="tag-row">${tags || "<span>No tags</span>"}</div>
        </button>
      `;
    })
    .join("");

  els.serverList.querySelectorAll("[data-server-id]").forEach((item) => {
    item.addEventListener("click", () => selectServer(item.dataset.serverId));
  });

  els.serverSelect.innerHTML = servers
    .map(
      (server) =>
        `<option value="${escapeHtml(server.id)}">${escapeHtml(server.name)} (${escapeHtml(
          server.environment || "No environment"
        )})</option>`
    )
    .join("");
  els.serverSelect.value = state.selectedServerId;
  renderMonitorServerForm(getSelectedServer());
}

function selectServer(id) {
  state.selectedServerId = id;
  renderServers(summarizeServersClient(state.monitoredServers));
}

function getSelectedServer() {
  return state.monitoredServers.find((server) => server.id === state.selectedServerId) || null;
}

function clearServerForm() {
  state.selectedServerId = null;
  renderMonitorServerForm(null);
  document.querySelectorAll(".server-card").forEach((card) => card.classList.remove("selected"));
}

function renderMonitorServerForm(server) {
  const defaults = {
    id: "",
    name: "",
    environment: "Production",
    host: "",
    dynatraceEntityId: "",
    managementZone: "",
    os: "Linux",
    owner: "",
    details: "",
    tags: [],
    active: true,
    problemSelector: "",
    inode: {
      enabled: true,
      metricSelector: "builtin:host.disk.inodes.usage:avg",
      warningPercent: 75,
      criticalPercent: 90
    }
  };
  const value = server || defaults;
  const inode = value.inode || defaults.inode;

  els.monitorServerId.value = value.id || "";
  els.monitorServerName.value = value.name || "";
  els.monitorServerEnvironment.value = value.environment || "";
  els.monitorServerHost.value = value.host || "";
  els.monitorServerEntity.value = value.dynatraceEntityId || "";
  els.monitorServerOs.value = value.os || "Linux";
  els.monitorServerOwner.value = value.owner || "";
  els.monitorServerZone.value = value.managementZone || "";
  els.monitorServerTags.value = (value.tags || []).join(", ");
  els.monitorServerProblemSelector.value = value.problemSelector || "";
  els.monitorServerInodeMetric.value = inode.metricSelector || defaults.inode.metricSelector;
  els.monitorServerInodeWarning.value = inode.warningPercent ?? 75;
  els.monitorServerInodeCritical.value = inode.criticalPercent ?? 90;
  els.monitorServerInodeEnabled.checked = inode.enabled !== false;
  els.monitorServerDetails.value = value.details || "";
  els.monitorServerActive.checked = value.active !== false;
  updateMonitorServerActiveLabel();
  els.deleteMonitorServerBtn.disabled = !value.id;
  els.monitorServerStatus.textContent = value.id ? `Editing ${value.name}` : "Create a new monitored server";
}

function readMonitorServerForm() {
  return {
    id: els.monitorServerId.value,
    name: els.monitorServerName.value,
    environment: els.monitorServerEnvironment.value,
    host: els.monitorServerHost.value,
    dynatraceEntityId: els.monitorServerEntity.value,
    managementZone: els.monitorServerZone.value,
    os: els.monitorServerOs.value,
    owner: els.monitorServerOwner.value,
    details: els.monitorServerDetails.value,
    tags: splitList(els.monitorServerTags.value),
    active: els.monitorServerActive.checked,
    problemSelector: els.monitorServerProblemSelector.value,
    inode: {
      enabled: els.monitorServerInodeEnabled.checked,
      metricSelector: els.monitorServerInodeMetric.value,
      warningPercent: Number(els.monitorServerInodeWarning.value || 75),
      criticalPercent: Number(els.monitorServerInodeCritical.value || 90)
    }
  };
}

function updateMonitorServerActiveLabel() {
  els.monitorServerActiveLabel.textContent = els.monitorServerActive.checked ? "Active" : "Inactive";
}

function renderInodeDetails(result) {
  const status = result.status || "unknown";
  const latest = formatMetricValue(result.latestUsagePercent);
  const average = formatMetricValue(result.averageUsagePercent);
  els.inodeStatus.textContent = `${result.server?.name || "Server"} inode status: ${status}`;
  els.inodeDetails.innerHTML = `
    <div class="inode-grid">
      <span><strong>${escapeHtml(status)}</strong>Status</span>
      <span><strong>${latest}%</strong>Latest usage</span>
      <span><strong>${average}%</strong>Average usage</span>
      <span><strong>${escapeHtml(result.mode || "demo")}</strong>Data mode</span>
    </div>
    <div class="inode-thresholds">
      <span>Warning ${formatMetricValue(result.thresholds?.warningPercent)}%</span>
      <span>Critical ${formatMetricValue(result.thresholds?.criticalPercent)}%</span>
      <span>${escapeHtml(result.filters?.entitySelector || "No entity selector")}</span>
    </div>
    <div class="mini-chart">${renderMiniSeries(result.metrics || [])}</div>
  `;
}

function renderMiniSeries(metrics) {
  const metric = metrics[0];
  const points = sparklinePoints(metric?.series || []);
  if (!points) {
    return `<div class="chart-empty">No inode samples returned.</div>`;
  }
  return `
    <svg viewBox="0 0 320 80" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${scaleSparkline(points, 2)}" fill="none" stroke="#0f766e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
    </svg>
    <small>${escapeHtml(metric.id || "inode metric")}</small>
  `;
}

function summarizeServersClient(servers) {
  return {
    total: servers.length,
    active: servers.filter((server) => server.active).length,
    dynatraceLinked: servers.filter((server) => server.dynatraceEntityId).length,
    inodeEnabled: servers.filter((server) => server.inode?.enabled).length
  };
}

function readConfigForm() {
  return {
    server: {
      name: els.serverName.value,
      environment: els.serverEnvironment.value,
      host: els.serverHost.value,
      owner: els.serverOwner.value,
      details: els.serverDetails.value,
      active: els.serverActive.checked
    },
    recipients: {
      dls: splitEmailTextarea(els.recipientDls.value),
      individuals: splitEmailTextarea(els.recipientIndividuals.value)
    },
    report: {
      subjectPrefix: els.reportPrefix.value,
      includeAiAnalysis: els.reportIncludeAi.checked
    }
  };
}

function updateActiveLabel() {
  els.serverActiveLabel.textContent = els.serverActive.checked ? "Active" : "Inactive";
  els.serverStatusSummary.textContent = els.serverActive.checked ? "Active" : "Inactive";
}

function renderReportResult(result, label) {
  const report = result.report ? result.report : result;
  const mode = result.mode ? `${label}: ${result.mode}` : label;
  els.reportStatus.textContent = result.message || `${mode} ${new Date().toLocaleTimeString()}`;
  els.reportOutput.textContent = report.text || JSON.stringify(result, null, 2);
}

function renderProblems(problems) {
  els.problemCount.textContent = `${problems.length} problems in the selected range`;

  if (!problems.length) {
    els.problemTable.innerHTML = `<tr><td colspan="6">No problems returned.</td></tr>`;
    return;
  }

  els.problemTable.innerHTML = problems
    .map((problem) => {
      const severityClass = (problem.severity || "info").toLowerCase();
      return `
        <tr>
          <td>
            <strong>${escapeHtml(problem.title)}</strong><br>
            <span>${escapeHtml(problem.displayId)}</span>
          </td>
          <td><span class="severity ${escapeHtml(severityClass)}">${escapeHtml(problem.severity)}</span></td>
          <td>${escapeHtml(problem.impact)}</td>
          <td>${escapeHtml(problem.rootCause)}</td>
          <td>${escapeHtml(problem.duration)}</td>
          <td>${escapeHtml(problem.status)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderMetrics(metrics) {
  if (!metrics.length) {
    els.metricGrid.innerHTML = `<div class="metric-card"><h3>No metrics returned</h3><p>Set DYNATRACE_METRIC_SELECTOR to a valid metric selector.</p></div>`;
    els.metricInsightStrip.innerHTML = "";
    els.metricDetailTable.innerHTML = "";
    return;
  }

  renderMetricInsightStrip(metrics);
  els.metricGrid.innerHTML = metrics
    .map((metric) => {
      const value = formatMetricValue(metric.latest ?? metric.average);
      const delta = formatMetricDelta(metric);
      const statusClass = `status-${escapeHtml(metric.status || "unknown")}`;
      const trendClass = `trend-${escapeHtml(metric.trend || "unknown")}`;
      return `
        <article class="metric-card">
          <div class="metric-card-header">
            <div>
              <h3>${escapeHtml(metric.displayName || metric.id)}</h3>
              <small>${escapeHtml(metric.category || "Metric")}</small>
            </div>
            <span class="metric-status ${statusClass}">${escapeHtml(metric.status || "unknown")}</span>
          </div>
          <div class="metric-value">${value}${escapeHtml(metric.unit || "")}</div>
          <div class="metric-meta-row">
            <span class="${trendClass}">${escapeHtml(formatTrend(metric.trend))}</span>
            <span>${escapeHtml(delta)}</span>
          </div>
          <svg class="sparkline" viewBox="0 0 160 42" preserveAspectRatio="none" aria-hidden="true">
            <polyline points="${sparklinePoints(metric.series)}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
          </svg>
          <div class="metric-stat-grid">
            <span><strong>${formatMetricValue(metric.average)}</strong>Avg</span>
            <span><strong>${formatMetricValue(metric.min)}</strong>Min</span>
            <span><strong>${formatMetricValue(metric.max)}</strong>Max</span>
            <span><strong>${formatMetricValue(metric.p95)}</strong>P95</span>
          </div>
          <small>${metric.dimensions} dimensions, ${metric.points} points, ${escapeHtml(formatMetricWindow(metric))}</small>
        </article>
      `;
    })
    .join("");
  renderMetricDetailTable(metrics);
}

function renderMetricInsightStrip(metrics) {
  const warningCount = metrics.filter((metric) =>
    ["critical", "warning", "watch"].includes(metric.status)
  ).length;
  const risingCount = metrics.filter((metric) => metric.trend === "rising").length;
  const dimensionCount = metrics.reduce((sum, metric) => sum + (metric.dimensions || 0), 0);
  const sampleCount = metrics.reduce((sum, metric) => sum + (metric.points || 0), 0);

  els.metricInsightStrip.innerHTML = `
    <span><strong>${metrics.length}</strong>Signals</span>
    <span><strong>${warningCount}</strong>Need attention</span>
    <span><strong>${risingCount}</strong>Rising</span>
    <span><strong>${dimensionCount}</strong>Dimensions</span>
    <span><strong>${sampleCount}</strong>Samples</span>
  `;
}

function renderMetricDetailTable(metrics) {
  els.metricDetailTable.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Status</th>
            <th>Latest</th>
            <th>Trend</th>
            <th>Range</th>
            <th>Timing</th>
            <th>Dimensions</th>
          </tr>
        </thead>
        <tbody>
          ${metrics.map(renderMetricDetailRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMetricDetailRow(metric) {
  const dimensions = (metric.dimensionBreakdown || [])
    .slice(0, 3)
    .map((dimension) => `${dimension.label} (${dimension.points})`)
    .join("; ");
  return `
    <tr>
      <td>
        <strong>${escapeHtml(metric.displayName || metric.id)}</strong><br>
        <span>${escapeHtml(metric.id)}</span>
      </td>
      <td>
        <span class="metric-status status-${escapeHtml(metric.status || "unknown")}">${escapeHtml(
          metric.status || "unknown"
        )}</span><br>
        <span>${escapeHtml(metric.statusReason || "No status detail")}</span>
      </td>
      <td>${escapeHtml(formatMetricWithUnit(metric.latest, metric.unit))}</td>
      <td>
        ${escapeHtml(formatTrend(metric.trend))}<br>
        <span>${escapeHtml(formatMetricDelta(metric))}</span>
      </td>
      <td>
        Min ${escapeHtml(formatMetricWithUnit(metric.min, metric.unit))}<br>
        Max ${escapeHtml(formatMetricWithUnit(metric.max, metric.unit))}<br>
        P95 ${escapeHtml(formatMetricWithUnit(metric.p95, metric.unit))}
      </td>
      <td>
        Last ${escapeHtml(formatTimeLabel(metric.latestTimestamp))}<br>
        <span>${escapeHtml(formatMetricWindow(metric))}</span>
      </td>
      <td>${escapeHtml(dimensions || "All dimensions")}</td>
    </tr>
  `;
}

function renderTrendChart(metrics) {
  const chartSeries = metrics
    .map((metric) => ({
      id: metric.id,
      samples: sanitizeSeries(metric.series)
    }))
    .filter((metric) => metric.samples.length >= 2)
    .slice(0, 4);

  if (!chartSeries.length) {
    els.trendChart.innerHTML = `<div class="chart-empty">Metric history will appear when time-series samples are available.</div>`;
    return;
  }

  const width = 920;
  const height = 280;
  const padding = { top: 18, right: 22, bottom: 38, left: 64 };
  const allValues = chartSeries.flatMap((metric) => metric.samples.map((sample) => sample.value));
  const allTimestamps = chartSeries.flatMap((metric) =>
    metric.samples.map((sample) => sample.timestamp).filter((timestamp) => timestamp !== null)
  );
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const valueRange = maxValue - minValue || 1;
  const useTimeScale = allTimestamps.length >= 2;
  const minTime = useTimeScale ? Math.min(...allTimestamps) : null;
  const maxTime = useTimeScale ? Math.max(...allTimestamps) : null;
  const timeRange = useTimeScale ? maxTime - minTime || 1 : 1;
  const colors = ["#0f766e", "#d97706", "#2563eb", "#7c3aed"];

  const xFor = (sample, index, samples) => {
    if (useTimeScale && sample.timestamp !== null) {
      return padding.left + ((sample.timestamp - minTime) / timeRange) * (width - padding.left - padding.right);
    }
    const denominator = Math.max(1, samples.length - 1);
    return padding.left + (index / denominator) * (width - padding.left - padding.right);
  };

  const yFor = (value) =>
    height -
    padding.bottom -
    ((value - minValue) / valueRange) * (height - padding.top - padding.bottom);

  const paths = chartSeries
    .map((metric, seriesIndex) => {
      const points = metric.samples
        .map((sample, index) => `${xFor(sample, index, metric.samples).toFixed(1)},${yFor(sample.value).toFixed(1)}`)
        .join(" ");
      return `<polyline points="${points}" fill="none" stroke="${colors[seriesIndex]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
    })
    .join("");

  const legend = chartSeries
    .map(
      (metric, index) =>
        `<span><i style="background:${colors[index]}"></i>${escapeHtml(shortMetricName(metric.id))}</span>`
    )
    .join("");

  els.trendChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" class="axis"></line>
      <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" class="axis"></line>
      <line x1="${padding.left}" y1="${yFor(maxValue).toFixed(1)}" x2="${width - padding.right}" y2="${yFor(maxValue).toFixed(1)}" class="grid-line"></line>
      <line x1="${padding.left}" y1="${yFor(minValue).toFixed(1)}" x2="${width - padding.right}" y2="${yFor(minValue).toFixed(1)}" class="grid-line"></line>
      ${paths}
      <text x="18" y="${yFor(maxValue).toFixed(1)}" class="chart-label">${escapeHtml(formatMetricValue(maxValue))}</text>
      <text x="18" y="${yFor(minValue).toFixed(1)}" class="chart-label">${escapeHtml(formatMetricValue(minValue))}</text>
      <text x="${padding.left}" y="${height - 10}" class="chart-label">${escapeHtml(useTimeScale ? formatTimeLabel(minTime) : "Start")}</text>
      <text x="${width - padding.right - 110}" y="${height - 10}" class="chart-label">${escapeHtml(useTimeScale ? formatTimeLabel(maxTime) : "End")}</text>
    </svg>
    <div class="chart-legend">${legend}</div>
  `;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || response.statusText);
  }
  return payload;
}

function initializeCustomRange() {
  setDefaultCustomRange();
  updateCustomRangeVisibility(false);
}

function updateCustomRangeVisibility(resetEmptyValues) {
  const isCustom = els.timeRange.value === "custom";
  if (isCustom && resetEmptyValues && (!els.customFrom.value || !els.customTo.value)) {
    setDefaultCustomRange();
  }
  els.customRange.classList.toggle("hidden", !isCustom);
}

function setDefaultCustomRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 60 * 60 * 1000);
  els.customFrom.value = toDateTimeLocal(start);
  els.customTo.value = toDateTimeLocal(end);
}

function buildTimelineParams(extra = {}) {
  const params = new URLSearchParams(extra);
  const timeline = readTimelinePayload(false);
  params.set("from", timeline.from);
  if (timeline.to) {
    params.set("to", timeline.to);
  }
  return params;
}

function readTimelinePayload(emailPayload) {
  if (els.timeRange.value !== "custom") {
    return { from: els.timeRange.value };
  }

  const from = dateTimeLocalToIso(els.customFrom.value) || "now-2h";
  const to = dateTimeLocalToIso(els.customTo.value);
  const payload = { from };
  if (to) {
    payload[emailPayload ? "rangeTo" : "to"] = to;
  }
  return payload;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

function splitEmailTextarea(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatMetricValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMetricWithUnit(value, unit) {
  const formatted = formatMetricValue(value);
  return formatted === "--" ? formatted : `${formatted}${unit || ""}`;
}

function formatMetricDelta(metric) {
  if (!Number.isFinite(metric.delta)) {
    return "No delta";
  }
  const value = formatMetricWithUnit(metric.delta, metric.unit);
  const percent = Number.isFinite(metric.deltaPercent)
    ? `${metric.deltaPercent >= 0 ? "+" : ""}${metric.deltaPercent.toLocaleString(undefined, {
        maximumFractionDigits: 1
      })}%`
    : "n/a";
  return `${metric.delta >= 0 ? "+" : ""}${value} (${percent})`;
}

function formatTrend(trend) {
  const labels = {
    rising: "Rising",
    falling: "Falling",
    steady: "Steady",
    "insufficient-data": "Insufficient data"
  };
  return labels[trend] || "Unknown";
}

function formatMetricWindow(metric) {
  const parts = [];
  if (Number.isFinite(metric.sampleWindowMinutes)) {
    parts.push(`${metric.sampleWindowMinutes}m window`);
  }
  if (Number.isFinite(metric.sampleIntervalMinutes)) {
    parts.push(`${metric.sampleIntervalMinutes}m interval`);
  }
  if (Number.isFinite(metric.volatility)) {
    parts.push(`${formatMetricValue(metric.volatility)} avg change`);
  }
  return parts.join(", ") || "No timing detail";
}

function sparklinePoints(series) {
  const samples = sanitizeSeries(series);
  if (samples.length < 2) {
    return "";
  }
  const values = samples.map((sample) => sample.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return samples
    .map((sample, index) => {
      const x = (index / (samples.length - 1)) * 160;
      const y = 37 - ((sample.value - min) / range) * 30;
      return `${x.toFixed(1)},${Math.max(5, Math.min(38, y)).toFixed(1)}`;
    })
    .join(" ");
}

function scaleSparkline(points, multiplier) {
  return String(points || "")
    .split(" ")
    .map((point) => {
      const [x, y] = point.split(",").map(Number);
      return `${(x * multiplier).toFixed(1)},${(y * multiplier).toFixed(1)}`;
    })
    .join(" ");
}

function sanitizeSeries(series) {
  return (Array.isArray(series) ? series : [])
    .map((sample, index) => {
      const rawValue = sample?.value;
      const value =
        rawValue === null || rawValue === undefined || rawValue === "" ? Number.NaN : Number(rawValue);
      const timestamp = Number(sample?.timestamp);
      return {
        value,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        index
      };
    })
    .filter((sample) => Number.isFinite(sample.value));
}

function shortMetricName(value) {
  const parts = String(value || "").split(":").filter(Boolean);
  return parts.length > 2 ? parts.slice(1, 3).join(":") : String(value || "metric");
}

function formatTimeLabel(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "--";
  }
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function dateTimeLocalToIso(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function toDateTimeLocal(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function initFlowCanvas() {
  const canvas = els.flowCanvas;
  if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const context = canvas.getContext("2d");
  let phase = 0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const draw = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
    phase += 0.012;

    ["rgba(15, 118, 110, 0.26)", "rgba(217, 119, 6, 0.18)", "rgba(37, 99, 235, 0.16)"].forEach(
      (color, lane) => {
        const yBase = 28 + lane * 31;
        context.beginPath();
        for (let x = -20; x <= width + 20; x += 18) {
          const y = yBase + Math.sin(x * 0.018 + phase + lane * 1.7) * 10;
          if (x === -20) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }
        context.strokeStyle = color;
        context.lineWidth = 1.4;
        context.setLineDash([16, 18]);
        context.lineDashOffset = -phase * 42 * (lane + 1);
        context.stroke();
      }
    );

    context.setLineDash([]);
    state.flowAnimation = window.requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener("resize", resize);
  state.flowAnimation = window.requestAnimationFrame(draw);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
