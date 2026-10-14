/**
 * LOCAL STATUS PAGE (developer tool, not the real website).
 *
 * Shows, in a browser, how far the backend build has got:
 *   - the roadmap (read from README.md)
 *   - the database tables (read live from convex/schema.ts)
 *   - a button that runs the automated tests and shows the result
 *   - what the data-source coverage tests found
 *
 * Run:  npm run status      then open http://localhost:4173
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import schema from "../../convex/schema.ts";
import { demoConflicts, demoInvest, demoVerify, demoWatch } from "./demos.ts";

const PORT = Number(process.env.PORT ?? 4173);
const root = new URL("../../", import.meta.url);

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---- roadmap: the checkbox lines under "## Progress" in README.md ---------
function roadmap() {
  const readme = readFileSync(new URL("README.md", root), "utf8");
  const section = readme.split("## Progress")[1] ?? "";
  return [...section.matchAll(/- \[( |x)\] (.+)/g)].map((m) => ({ done: m[1] === "x", text: m[2]!.replaceAll("**", "") }));
}

// ---- database tables, read from the real schema ---------------------------
const GROUPS: Record<string, string[]> = {
  "People & companies": ["users", "entities", "instruments"],
  "Research runs": ["researchRuns", "runSteps", "plans"],
  "Evidence (the proof)": ["sources", "snapshots", "chunks"],
  "Claims & checking": ["claims", "facts", "verifications", "conflicts", "confidences", "reports"],
  Watch: ["watchTargets", "watchSubs", "events", "alerts", "emailSuppressions"],
  "Invest Discovery": ["metrics", "rankings", "priceSeries"],
  Operations: ["runTraces", "providerHealth", "usage", "providerCache"],
};

function tableInfo(name: string) {
  try {
    const t = (schema as unknown as { tables: Record<string, any> }).tables[name];
    const fields = Object.keys(t.validator.fields).length;
    const indexes = (t.indexes?.length ?? 0) + (t.searchIndexes?.length ?? 0);
    return { fields, indexes };
  } catch {
    return { fields: 0, indexes: 0 };
  }
}

// ---- run the test suite on demand -----------------------------------------
function runTests(): Promise<unknown> {
  const outFile = join(tmpdir(), "verifin-vitest.json");
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["node_modules/vitest/vitest.mjs", "run", "--reporter=json", `--outputFile=${outFile}`],
      { cwd: fileURLToPath(root), maxBuffer: 10 * 1024 * 1024 },
      () => {
        try {
          const j = JSON.parse(readFileSync(outFile, "utf8"));
          resolve({
            total: j.numTotalTests,
            passed: j.numPassedTests,
            failed: j.numFailedTests,
            files: j.testResults.map((f: any) => ({
              name: f.name.split(/[\\/]/).pop(),
              tests: f.assertionResults.map((a: any) => ({ title: a.fullName, ok: a.status === "passed" })),
            })),
          });
        } catch {
          resolve({ error: "Could not read test output." });
        }
      },
    );
  });
}

function page() {
  const steps = roadmap();
  const doneCount = steps.filter((s) => s.done).length;
  const groups = Object.entries(GROUPS)
    .map(([title, names]) => {
      const rows = names
        .map((n) => {
          const i = tableInfo(n);
          return `<tr><td><code>${esc(n)}</code></td><td>${i.fields}</td><td>${i.indexes}</td></tr>`;
        })
        .join("");
      return `<div class="card"><h3>${esc(title)}</h3><table><tr><th>Table</th><th>Fields</th><th>Indexes</th></tr>${rows}</table></div>`;
    })
    .join("");
  const totalTables = Object.values(GROUPS).flat().length;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verifin Status</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1b1f27;--muted:#5d6675;--line:#e3e6ec;--accent:#2563eb;--good:#15803d;--bad:#b91c1c;--warn:#b45309}
@media(prefers-color-scheme:dark){:root{--bg:#0f1218;--card:#181c25;--text:#e8ebf1;--muted:#98a1b3;--line:#2a303d;--accent:#6ea0ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,Segoe UI,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 60px}
h1{margin:0 0 4px;font-size:26px}h2{margin:32px 0 12px;font-size:18px}h3{margin:0 0 8px;font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.sub{color:var(--muted);margin:0 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
code{font-family:ui-monospace,Consolas,monospace;font-size:13px}
.bar{height:10px;background:var(--line);border-radius:6px;overflow:hidden;margin:8px 0 14px}.bar>div{height:100%;background:var(--accent)}
ul.road{list-style:none;padding:0;margin:0}ul.road li{padding:6px 0;border-bottom:1px solid var(--line);display:flex;gap:10px}
.tick{font-weight:700}.done .tick{color:var(--good)}.todo .tick{color:var(--muted)}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:14px;cursor:pointer}button:disabled{opacity:.6;cursor:wait}
.ok{color:var(--good)}.no{color:var(--bad)}.warn{color:var(--warn)}
#out{margin-top:14px}#out li{list-style:none;padding:2px 0}
input,select{background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:14px;width:100%;margin:0 0 8px}
tr.row-ok td:first-child{border-left:3px solid var(--good)}tr.row-bad td:first-child{border-left:3px solid var(--bad)}tr.row-warn td:first-child{border-left:3px solid var(--warn)}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;font-size:12px;font-weight:600;border:1px solid currentColor}
</style></head><body><main>
<h1>Verifin: backend status</h1>
<p class="sub">Developer status page. This is not the real website; the SvelteKit frontend comes after the backend.</p>

<h2>Roadmap</h2>
<div class="card">
  <div><b>${doneCount} of ${steps.length}</b> steps done</div>
  <div class="bar"><div style="width:${Math.round((doneCount / Math.max(steps.length, 1)) * 100)}%"></div></div>
  <ul class="road">${steps.map((s) => `<li class="${s.done ? "done" : "todo"}"><span class="tick">${s.done ? "✔" : "○"}</span><span>${esc(s.text)}</span></li>`).join("")}</ul>
</div>

<h2>Automated tests</h2>
<div class="card">
  <button id="run">Run tests now</button>
  <div id="out" class="sub">Click the button to run all the tests.</div>
</div>

<h2>Try the engine live</h2>
<p class="sub">These run the real backend code. Nothing here needs a login or an API key.</p>
<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
  <div class="card"><h3>1. Citation check</h3><p class="sub">Can it catch false claims, wrong numbers and unit mix-ups?</p><button class="demo" data-url="/api/demo/verify">Run</button></div>
  <div class="card"><h3>2. Conflicts and scores</h3><p class="sub">Sources that disagree, and how trust scores work.</p><button class="demo" data-url="/api/demo/conflicts">Run</button></div>
  <div class="card"><h3>3. Watch (live news)</h3><p class="sub">Real headlines, duplicates merged, importance scored.</p>
    <input id="co" value="Tata Motors" aria-label="Company name"><button class="demo" data-url="/api/demo/watch" data-input="co">Run</button></div>
  <div class="card"><h3>4. Invest (live funds)</h3><p class="sub">Ranks real mutual funds from their NAV history.</p>
    <input id="fq" value="flexi cap direct growth" aria-label="Fund search"><select id="fp" aria-label="Profile"><option>balanced</option><option>growth</option><option>value</option><option>quality</option></select>
    <button class="demo" data-url="/api/demo/invest" data-input="fq" data-profile="fp">Run</button></div>
</div>
<div id="demoOut" class="card" style="margin-top:14px;display:none"></div>

<h2>Database design: ${totalTables} tables</h2>
<div class="grid">${groups}</div>

<h2>Do the data sources work?</h2>
<div class="card"><table>
<tr><th>Source</th><th>Used for</th><th>Result</th><th>What we saw</th></tr>
<tr><td>MFapi.in</td><td>Mutual-fund NAV history</td><td><span class="pill ok">Works</span></td><td>About 13 years of daily NAV, fresh to yesterday, with category and ISIN. No expense ratio or AUM.</td></tr>
<tr><td>Google News (RSS)</td><td>News discovery</td><td><span class="pill ok">Works</span></td><td>No key. About 100 recent stories each for Reliance and Tata Motors, with publisher and date. Headlines only, so full text is fetched separately.</td></tr>
<tr><td>Economic Times RSS</td><td>Market news</td><td><span class="pill ok">Works</span></td><td>50 items, no key. Not company-specific.</td></tr>
<tr><td>GDELT</td><td>News discovery</td><td><span class="pill warn">Weak</span></td><td>Rate-limited (429) on most requests, 0 results for Reliance, one irrelevant result for Infosys. Backup only.</td></tr>
<tr><td>Moneycontrol RSS</td><td>News</td><td><span class="pill no">Blocked</span></td><td>HTTP 403. Not usable.</td></tr>
<tr><td>Finnhub</td><td>News and market data</td><td><span class="pill">Not tested</span></td><td>Needs a free API key in <code>.env.local</code>.</td></tr>
<tr><td>AMFI, NSE/BSE, FMP</td><td>Fund data, announcements, statements</td><td><span class="pill">Not tested</span></td><td>Planned for Week 2.</td></tr>
</table></div>

<script>
const E=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const demoOut=document.getElementById('demoOut');
function renderDemo(t){
  if(t.error){return '<b class="no">Could not run: '+E(t.error)+'</b>'}
  const head='<h3 style="text-transform:none;font-size:16px;color:var(--text)">'+E(t.title)+'</h3><p class="sub">'+E(t.explain)+'</p>';
  const th='<tr>'+t.columns.map(c=>'<th>'+E(c)+'</th>').join('')+'</tr>';
  const tr=t.rows.map((r,i)=>'<tr>'+r.map((c,j)=>{const cls=(j===(t.status&&t.statusCol!==undefined?t.statusCol:-1))?'':'';return '<td style="white-space:pre-wrap;vertical-align:top">'+E(c)+'</td>'}).join('')+'</tr>').map((row,i)=>{const s=t.status&&t.status[i];return s?row.replace('<tr>','<tr class="row-'+s+'">'):row}).join('');
  return head+'<div style="overflow-x:auto"><table>'+th+tr+'</table></div><p style="margin-top:12px"><b>'+E(t.summary)+'</b></p>';
}
document.querySelectorAll('button.demo').forEach(b=>b.onclick=async()=>{
  const old=b.textContent;b.disabled=true;b.textContent='Running...';
  demoOut.style.display='block';demoOut.innerHTML='<span class="sub">Running. Live demos can take 10 to 30 seconds...</span>';
  try{
    const p=new URLSearchParams();
    if(b.dataset.input)p.set('q',document.getElementById(b.dataset.input).value);
    if(b.dataset.profile)p.set('profile',document.getElementById(b.dataset.profile).value);
    const t=await (await fetch(b.dataset.url+'?'+p)).json();
    demoOut.innerHTML=renderDemo(t);demoOut.scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(e){demoOut.innerHTML='<b class="no">The demo failed to run.</b>'}
  finally{b.disabled=false;b.textContent=old}
});
const btn=document.getElementById('run'),out=document.getElementById('out');
btn.onclick=async()=>{
  btn.disabled=true;out.textContent='Running tests...';
  try{
    const r=await (await fetch('/api/tests')).json();
    if(r.error){out.innerHTML='<span class="no">'+r.error+'</span>';return}
    const head='<b class="'+(r.failed?'no':'ok')+'">'+r.passed+' of '+r.total+' tests passed</b>';
    const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const body=r.files.map(f=>'<h3 style="margin-top:12px">'+esc(f.name)+'</h3><ul style="padding:0;margin:0">'+f.tests.map(t=>'<li><span class="'+(t.ok?'ok':'no')+'">'+(t.ok?'✔':'✘')+'</span> '+esc(t.title)+'</li>').join('')+'</ul>').join('');
    out.innerHTML=head+body;
  }catch(e){out.textContent='Failed to run tests.'}
  finally{btn.disabled=false}
};
</script>
</main></body></html>`;
}

const json = (res: import("node:http").ServerResponse, body: unknown) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/demo/")) {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    try {
      if (url.pathname.endsWith("/verify")) return json(res, demoVerify());
      if (url.pathname.endsWith("/conflicts")) return json(res, demoConflicts());
      if (url.pathname.endsWith("/watch")) return json(res, await demoWatch(q || "Tata Motors"));
      if (url.pathname.endsWith("/invest")) {
        const p = url.searchParams.get("profile");
        const profile = p === "growth" || p === "value" || p === "quality" ? p : "balanced";
        return json(res, await demoInvest(q || "flexi cap direct growth", profile));
      }
    } catch (e) {
      return json(res, { title: "Demo failed", explain: "", columns: [], rows: [], summary: "", error: (e as Error).message });
    }
  }
  if (req.url === "/api/tests") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(await runTests()));
  } else if (req.url === "/" || req.url?.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page());
  } else {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => console.log(`Verifin status page: http://localhost:${PORT}`));
