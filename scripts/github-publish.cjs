const fs = require('node:fs');
const path = require('node:path');
const MARKER = '<!-- harrier-quality-gate -->';
const INLINE = '<!-- harrier-finding:';

async function publish({ github, context, core, outDir }) {
  const md = path.join(outDir, 'report.md');
  if (!fs.existsSync(md)) { core.warning('Harrier produced no report; final gate step will fail'); return; }
  const body = fs.readFileSync(md, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
  const pr = context.payload.pull_request;
  if (!pr || pr.head.repo.full_name !== context.repo.owner + '/' + context.repo.repo) return;
  const params = { owner: context.repo.owner, repo: context.repo.repo, issue_number: pr.number };
  try {
    const comments = await github.paginate(github.rest.issues.listComments, { ...params, per_page: 100 });
    const existing = comments.find(c => c.user?.type === 'Bot' && c.body?.includes(MARKER));
    const summary = body.length > 60000 ? body.slice(0, 60000) + '\n\nReport truncated; download the full artifact.' : body;
    if (existing) await github.rest.issues.updateComment({ owner: params.owner, repo: params.repo, comment_id: existing.id, body: summary });
    else await github.rest.issues.createComment({ ...params, body: summary });
    const json = path.join(outDir, 'report.json');
    if (!fs.existsSync(json)) return;
    const report = JSON.parse(fs.readFileSync(json, 'utf8'));
    if (!report.gate) return;
    const files = await github.paginate(github.rest.pulls.listFiles, { owner: params.owner, repo: params.repo, pull_number: pr.number, per_page: 100 });
    const rightLines = new Map();
    for (const f of files) {
      const lines = new Set();
      let right = 0;
      for (const line of (f.patch ?? '').split('\n')) {
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) { right = Number(hunk[1]); continue; }
        if (line.startsWith('+')) { lines.add(right++); }
        else if (line.startsWith(' ')) { right++; }
      }
      rightLines.set(f.filename, lines);
    }
    const old = await github.paginate(github.rest.pulls.listReviewComments, { owner: params.owner, repo: params.repo, pull_number: pr.number, per_page: 100 });
    const posted = new Set(old.filter(c => c.user?.type === 'Bot' && c.commit_id === pr.head.sha).map(c => c.body));
    let count = 0;
    for (const finding of report.findings) {
      if (!report.gate.blockers.includes(finding.id)) continue;
      const loc = finding.locations?.[0];
      if (!loc || !rightLines.get(loc.path)?.has(loc.startLine)) continue;
      const change = report.gate.changes.find(c => c.findingId === finding.id);
      const marker = `${INLINE}${change?.identity ?? finding.id} -->`;
      if ([...posted].some(b => b?.includes(marker))) continue;
      if (count++ >= 20) break;
      await github.rest.pulls.createReviewComment({ owner: params.owner, repo: params.repo, pull_number: pr.number, commit_id: pr.head.sha, path: loc.path, line: loc.startLine, side: 'RIGHT', body: `${marker}\n**Harrier blocker · ${finding.severity} · ${finding.ruleId}**\n\n${finding.message}${finding.fixHint ? '\n\nSuggested fix: ' + finding.fixHint : ''}` });
    }
  } catch (error) {
    core.warning(`PR feedback unavailable: ${error.message}. Job summary and artifacts remain available.`);
  }
}
module.exports = { publish };
