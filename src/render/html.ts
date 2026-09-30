import type { Report, Finding } from "../findings.ts";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderHtml(report: Report): string {
  const { summary, target, probes = [], findings = [], overview } = report;

  const severityBadgeClass: Record<string, string> = {
    critical: "badge-critical",
    high: "badge-high",
    medium: "badge-medium",
    low: "badge-low",
    info: "badge-info",
  };

  const findingsJson = JSON.stringify(findings);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Harrier Review — ${escapeHtml(target.root)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --heading: #f0f6fc;
      --critical: #f85149;
      --high: #ff7b72;
      --medium: #d29922;
      --low: #58a6ff;
      --info: #8b949e;
      --badge-bg: #21262d;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      margin: 0;
      padding: 24px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    h1, h2, h3 {
      color: var(--heading);
      margin-top: 0;
    }
    .meta {
      color: var(--text-muted);
      font-size: 0.9em;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
    }
    .metric-val {
      font-size: 2em;
      font-weight: bold;
      color: var(--heading);
    }
    .metric-label {
      color: var(--text-muted);
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .overview-box {
      background: var(--card-bg);
      border-left: 4px solid #1f6feb;
      border-radius: 4px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .overview-box pre {
      white-space: pre-wrap;
      margin: 0;
      font-family: inherit;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 24px;
      background: var(--card-bg);
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 6px;
      align-items: center;
    }
    .filters label {
      font-size: 0.9em;
      font-weight: 600;
    }
    select, input[type="text"] {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 10px;
      border-radius: 4px;
    }
    .finding-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .finding-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.75em;
      font-weight: 600;
      text-transform: uppercase;
      background: var(--badge-bg);
    }
    .badge-critical { color: var(--critical); border: 1px solid var(--critical); }
    .badge-high { color: var(--high); border: 1px solid var(--high); }
    .badge-medium { color: var(--medium); border: 1px solid var(--medium); }
    .badge-low { color: var(--low); border: 1px solid var(--low); }
    .badge-info { color: var(--info); border: 1px solid var(--info); }
    .finding-title {
      font-weight: 600;
      color: var(--heading);
      font-size: 1.1em;
    }
    .finding-loc {
      font-family: monospace;
      font-size: 0.9em;
      color: var(--text-muted);
    }
    .finding-evidence {
      background: var(--bg);
      border: 1px solid var(--border);
      padding: 8px 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.85em;
      white-space: pre-wrap;
      overflow-x: auto;
      margin-top: 8px;
    }
    .finding-fix {
      margin-top: 8px;
      font-size: 0.9em;
      color: #7ee787;
    }
    .probe-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 0.9em;
    }
    .probe-table th, .probe-table td {
      border: 1px solid var(--border);
      padding: 8px 12px;
      text-align: left;
    }
    .probe-table th {
      background: var(--card-bg);
      color: var(--heading);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Harrier Code Review</h1>
      <div class="meta">
        Target: <strong>${escapeHtml(target.root)}</strong> ·
        Generated: ${escapeHtml(report.startedAt)} · Tool: ${escapeHtml(report.tool.name)} ${escapeHtml(report.tool.version)}
      </div>
    </header>

    <div class="grid">
      <div class="card">
        <div class="metric-val">${summary.total}</div>
        <div class="metric-label">Total Findings</div>
      </div>
      <div class="card">
        <div class="metric-val" style="color: var(--critical)">${summary.bySeverity.critical}</div>
        <div class="metric-label">Critical</div>
      </div>
      <div class="card">
        <div class="metric-val" style="color: var(--high)">${summary.bySeverity.high}</div>
        <div class="metric-label">High</div>
      </div>
      <div class="card">
        <div class="metric-val" style="color: var(--medium)">${summary.bySeverity.medium}</div>
        <div class="metric-label">Medium</div>
      </div>
      <div class="card">
        <div class="metric-val" style="color: var(--low)">${summary.bySeverity.low + summary.bySeverity.info}</div>
        <div class="metric-label">Low & Info</div>
      </div>
    </div>

    ${overview ? `<div class="overview-box"><h3>LLM Overview</h3><pre>${escapeHtml(overview)}</pre></div>` : ""}

    <details style="margin-bottom: 24px;">
      <summary style="cursor: pointer; font-weight: 600; color: var(--heading);">Probes Run Status (${probes.length})</summary>
      <table class="probe-table">
        <thead>
          <tr>
            <th>Probe</th>
            <th>Categories</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${probes.map(p => `
            <tr>
              <td><code>${escapeHtml(p.probe)}</code></td>
              <td>${p.categories.map(c => escapeHtml(c)).join(", ")}</td>
              <td><span class="badge ${p.status === 'ok' ? 'badge-low' : 'badge-high'}">${escapeHtml(p.status)}</span></td>
              <td>${p.detail ? escapeHtml(p.detail) : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </details>

    <h2>Findings</h2>
    <div class="filters">
      <label>Severity:
        <select id="filter-severity">
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
      </label>
      <label>Category:
        <select id="filter-category">
          <option value="all">All Categories</option>
          <option value="bug">bug</option>
          <option value="security">security</option>
          <option value="dependency">dependency</option>
          <option value="quality">quality</option>
          <option value="structure">structure</option>
          <option value="secret">secret</option>
        </select>
      </label>
      <label>Source:
        <select id="filter-source">
          <option value="all">All Sources</option>
          <option value="probe">probe</option>
          <option value="llm">llm</option>
        </select>
      </label>
      <label>Search:
        <input type="text" id="filter-search" placeholder="Search message, rule, or path...">
      </label>
      <span id="filtered-count" style="margin-left: auto; color: var(--text-muted); font-size: 0.9em;"></span>
    </div>

    <div id="findings-list"></div>
  </div>

  <script>
    const allFindings = ${findingsJson};

    function renderList() {
      const sev = document.getElementById("filter-severity").value;
      const cat = document.getElementById("filter-category").value;
      const src = document.getElementById("filter-source").value;
      const search = document.getElementById("filter-search").value.toLowerCase();

      const filtered = allFindings.filter(f => {
        if (sev !== "all" && f.severity !== sev) return false;
        if (cat !== "all" && f.category !== cat) return false;
        if (src !== "all" && f.source !== src) return false;
        if (search) {
          const locStr = (f.locations || []).map(l => l.path).join(" ");
          const text = (f.ruleName + " " + f.message + " " + locStr + " " + (f.ruleId || "")).toLowerCase();
          if (!text.includes(search)) return false;
        }
        return true;
      });

      document.getElementById("filtered-count").textContent = 'Showing ' + filtered.length + ' of ' + allFindings.length + ' findings';

      const container = document.getElementById("findings-list");
      if (filtered.length === 0) {
        container.innerHTML = '<div class="card" style="text-align: center; color: var(--text-muted); padding: 32px;">No matching findings found.</div>';
        return;
      }

      container.innerHTML = filtered.map(f => {
        const loc = f.locations && f.locations[0] ? f.locations[0].path + (f.locations[0].startLine ? ':' + f.locations[0].startLine : '') : '';
        const badgeClass = "badge-" + f.severity;
        return \`
          <div class="finding-card">
            <div class="finding-header">
              <span class="badge \${badgeClass}">\${f.severity}</span>
              <span class="badge">\${f.category}</span>
              <span class="badge">\${f.source}</span>
              <span class="finding-title">\${escapeText(f.ruleName)}</span>
              <span class="finding-loc" style="margin-left: auto;">\${escapeText(loc)}</span>
            </div>
            <div class="finding-msg">\${escapeText(f.message)}</div>
            \${f.evidence ? \`<pre class="finding-evidence">\${escapeText(f.evidence)}</pre>\` : ''}
            \${f.fixHint ? \`<div class="finding-fix"><strong>Fix:</strong> \${escapeText(f.fixHint)}</div>\` : ''}
          </div>
        \`;
      }).join("");
    }

    function escapeText(str) {
      if (!str) return "";
      const div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    }

    document.getElementById("filter-severity").addEventListener("change", renderList);
    document.getElementById("filter-category").addEventListener("change", renderList);
    document.getElementById("filter-source").addEventListener("change", renderList);
    document.getElementById("filter-search").addEventListener("input", renderList);

    renderList();
  </script>
</body>
</html>
`;
}
