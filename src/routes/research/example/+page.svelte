<script lang="ts">
  import { bandTone, tierLabel, tierTone, verdictLabel, verdictTone } from "$lib/format";

  let { data } = $props();
  const sample = $derived(data.sample);

  let openClaim = $state<string | null>(null);
  const claimById = $derived(new Map(sample.claims.map((c) => [c.id, c])));
  const conflictCount = $derived(sample.facts.filter((f) => f.status === "conflict").length);

  function jump(id: string) {
    openClaim = id;
    document.getElementById(`claim-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
</script>

<svelte:head><title>Example report · Verifin</title></svelte:head>

<div class="wrap page">
  <header class="head">
    <a class="back" href="/research">&larr; Back to Research</a>
    <p class="eyebrow">Example of a finished report</p>
    <h1>What a checked report will look like</h1>
  </header>

  <p class="notice warn">
    <b>Example only.</b> This report is about a fictional company ("{sample.company}") so no real company gets invented numbers.
    The checking, conflict detection, scoring and report guard below are the <b>real engine</b>. The AI steps (reading the sources, the judge's opinion and the draft text) are
    <b>recorded examples</b>, because they need a Gemini key that is not connected yet.
  </p>

  <div class="stats">
    <div class="card stat"><b>{sample.claims.length}</b><span>claims checked</span></div>
    <div class="card stat"><b>{Math.round(sample.verifiedShare * 100)}%</b><span>verified or partly verified</span></div>
    <div class="card stat"><b>{conflictCount}</b><span>source disagreement{conflictCount === 1 ? "" : "s"}</span></div>
    <div class="card stat"><b>{sample.removed.length}</b><span>report sentences removed by the guard</span></div>
  </div>

  <section class="card">
    <h2>Report</h2>
    <p class="muted small">Every sentence carries the claims behind it. Click a tag to see the evidence.</p>
    {#each sample.sections as sec}
      <h3 class="sec">{sec.title}</h3>
      <p class="body">
        {#each sec.sentences as s}
          {s.text}
          {#each s.claimIds as id}
            <button class="tag chip {verdictTone[claimById.get(id)?.verdict ?? 'unverified']}" type="button" onclick={() => jump(id)} aria-label="Show evidence for claim {id}">{id}</button>
          {/each}
          {" "}
        {/each}
      </p>
    {/each}
    {#if sample.removed.length}
      <div class="notice removed">
        <b>The guard removed {sample.removed.length} sentence{sample.removed.length === 1 ? "" : "s"} the AI wrote</b>, because the evidence does not support them:
        <ul>
          {#each sample.removed as r}
            <li>&ldquo;{r.text}&rdquo; <span class="muted">({r.reason})</span></li>
          {/each}
        </ul>
      </div>
    {/if}
    <div class="gaps">
      <b>Not found (said openly instead of guessed):</b>
      {#each sample.gaps as g}<span class="chip warn">{g}</span>{/each}
    </div>
  </section>

  <section class="card">
    <h2>Numbers compared across sources</h2>
    <p class="muted small">Copies of one story count once. Both sides are always shown; the more authoritative source is marked as the one we lean towards.</p>
    <div class="scroll-x">
      <table>
        <thead><tr><th>Metric</th><th>What each source says</th><th>Gap</th><th>Result</th></tr></thead>
        <tbody>
          {#each sample.facts as f}
            <tr>
              <td><b>{f.metric}</b><br /><span class="muted small">{f.period}</span></td>
              <td>
                {#each f.values as v}
                  <div class="val">{v.display} <span class="muted small">· {v.source}</span> <span class="chip {tierTone[v.tier]}">{tierLabel[v.tier]}</span></div>
                {/each}
              </td>
              <td>{f.diffPct}%</td>
              <td>
                {#if f.status === "agree"}<span class="chip good">Agree</span>
                {:else if f.status === "minor"}<span class="chip warn">Minor difference</span>
                {:else}<span class="chip bad">Conflict</span>{/if}
                {#if f.lean}<p class="small muted lean">Leaning towards: {f.lean}. {f.reason}</p>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <h2>Every claim, and how it was checked</h2>
    <p class="muted small">A claim is <b>Verified</b> only if the code checks pass and the AI judge agrees. The judge's answers here are recorded.</p>
    <div class="claims">
      {#each sample.claims as c}
        <article class="claim" class:open={openClaim === c.id} id="claim-{c.id}">
          <div class="claim-top">
            <span class="chip">{c.id}</span>
            <p class="claim-text">{c.text}</p>
            <span class="chip {verdictTone[c.verdict]}">{verdictLabel[c.verdict]}</span>
          </div>
          <div class="claim-meta">
            <span class="muted small">Source: {c.source}</span>
            <span class="chip {tierTone[c.tier]}">{tierLabel[c.tier]}</span>
            {#if c.confidence}
              <span class="chip {bandTone[c.confidence.band]}" title="Trust score from source type, independent sources, freshness and conflicts">Trust {c.confidence.score}/100 · {c.confidence.band}</span>
            {:else}
              <span class="chip">No trust score (not verified)</span>
            {/if}
          </div>
          <p class="quote">&ldquo;{c.quote}&rdquo;</p>
          <div class="checks">
            {#each c.checks as k}
              <span class="chk" class:fail={!k.passed}>{k.passed ? "✓" : "✕"} {k.label}</span>
            {/each}
            <span class="chk judge">AI judge (recorded): {c.judge.verdict.replace("_", " ")}</span>
          </div>
          {#if c.problems.length}
            <p class="problem">Why it failed: {c.problems.join(" ")}</p>
          {/if}
          {#if c.confidence}
            <details>
              <summary>How the trust score was made</summary>
              <ul class="comp">
                <li>Source type: {Math.round(c.confidence.components.authority * 100)}%</li>
                <li>Independent sources agreeing: {Math.round(c.confidence.components.corroboration * 100)}%</li>
                <li>Freshness: {Math.round(c.confidence.components.recency * 100)}%</li>
                <li>Verification strength: {Math.round(c.confidence.components.verification * 100)}%</li>
                <li>Conflict penalty: −{Math.round(c.confidence.components.conflictPenalty * 100)} points</li>
              </ul>
            </details>
          {/if}
        </article>
      {/each}
    </div>
  </section>
</div>

<style>
  .page {
    padding-top: 40px;
    display: grid;
    gap: 22px;
  }
  .head {
    display: grid;
    gap: 8px;
  }
  .back {
    font-weight: 700;
    color: var(--accent);
    text-decoration: none;
  }
  .small {
    font-size: 0.85rem;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 14px;
  }
  .stat {
    display: grid;
    gap: 2px;
    padding: 16px 18px;
  }
  .stat b {
    font-family: var(--font-serif);
    font-size: 2rem;
    font-weight: 500;
  }
  .stat span {
    color: var(--muted);
    font-size: 0.86rem;
  }
  .card h2 {
    margin-bottom: 6px;
  }
  .sec {
    margin-top: 18px;
    margin-bottom: 6px;
  }
  .body {
    line-height: 1.85;
  }
  .tag {
    cursor: pointer;
    border: 0;
    font: inherit;
    font-size: 0.72rem;
    padding: 1px 8px;
    vertical-align: middle;
  }
  .removed {
    margin-top: 16px;
  }
  .removed ul {
    margin: 8px 0 0;
    padding-left: 20px;
  }
  .gaps {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin-top: 16px;
  }
  .val {
    margin-bottom: 6px;
  }
  .lean {
    margin-top: 6px;
    max-width: 280px;
  }
  .claims {
    display: grid;
    gap: 12px;
    margin-top: 14px;
  }
  .claim {
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 14px;
    display: grid;
    gap: 8px;
    background: var(--surface-soft);
  }
  .claim.open {
    outline: 3px solid var(--accent);
  }
  .claim-top {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .claim-text {
    flex: 1;
    font-weight: 600;
  }
  .claim-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .quote {
    font-style: italic;
    color: var(--muted);
    border-left: 3px solid var(--line);
    padding-left: 12px;
    font-size: 0.93rem;
  }
  .checks {
    display: flex;
    gap: 6px 14px;
    flex-wrap: wrap;
    font-size: 0.84rem;
  }
  .chk {
    color: var(--good);
    font-weight: 600;
  }
  .chk.fail {
    color: var(--bad);
  }
  .chk.judge {
    color: var(--muted);
  }
  .problem {
    color: var(--bad);
    font-size: 0.88rem;
  }
  details {
    font-size: 0.88rem;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--accent);
  }
  .comp {
    margin: 8px 0 0;
    padding-left: 18px;
  }
</style>
