<script lang="ts">
  import { onMount } from "svelte";
  import { FUND_TYPES, GROUPS, RANK_STYLES, RISK_TONE, typeById, type FundGroup } from "$lib/fund-types";
  import { formatDate, metricLabel, metricValue } from "$lib/format";
  import type { FundRow, FundsResponse } from "$lib/types";

  // The two things a person can invest in. Stocks has no data feed yet, and the page says so plainly.
  let kind = $state<"funds" | "stocks">("funds");

  let group = $state<FundGroup | "all">("all");
  let typeId = $state("flexi");
  let style = $state("balanced");
  let count = $state(5);
  let data = $state<FundsResponse | null>(null);
  let loading = $state(false);
  let error = $state("");
  let open = $state<FundRow | null>(null);

  const visibleTypes = $derived(FUND_TYPES.filter((t) => group === "all" || t.group === group));
  const type = $derived(typeById(typeId));
  const styleHint = $derived(RANK_STYLES.find((s) => s.id === style)?.hint);

  async function load() {
    loading = true;
    error = "";
    open = null;
    try {
      const res = await fetch(`/api/funds?type=${typeId}&profile=${style}&count=${count}`);
      const d: FundsResponse = await res.json();
      if (d.error) {
        error = d.error;
        data = null;
      } else data = d;
    } catch {
      error = "Could not reach the server. Check that the website is still running.";
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const pct = (key: string, v: number | undefined) => metricValue(key, v);

  // What the Stocks section will rank, shown so the person can see what is coming. Nothing here is real data.
  const stockKinds = [
    { label: "Big, steady companies", text: "Household names that have been around for decades. They usually move less.", risk: "Medium to high" },
    { label: "Growing companies", text: "Medium-sized businesses that can grow fast, and fall harder in bad times.", risk: "High" },
    { label: "Small, fast-moving companies", text: "Small businesses. Big gains are possible, and so are big losses.", risk: "Very high" },
    { label: "Companies that pay you regularly", text: "They share part of their profit with shareholders each year (a dividend).", risk: "Medium" },
    { label: "By industry", text: "Banks, software, medicines, cars, everyday goods. Pick an industry you understand.", risk: "Medium to high" },
  ];
</script>

<svelte:head><title>Invest Discovery · Verifin</title></svelte:head>

<div class="wrap page">
  <header class="head">
    <p class="eyebrow">Verifin Invest Discovery</p>
    <h1>Discover where you want to invest</h1>
    <p class="muted lead">Pick what you want to invest in. Every ranking shows why, and the risks right next to it.</p>
  </header>

  <p class="notice warn">
    <b>Information, not advice.</b> This ranks by past data using published rules. Past returns do not guarantee future returns, and markets can fall.
  </p>

  <div class="kinds" role="group" aria-label="What do you want to invest in?">
    <button type="button" class="kind" class:on={kind === "funds"} aria-pressed={kind === "funds"} onclick={() => (kind = "funds")}>
      <b>Mutual funds</b>
      <span>A ready-made basket of many companies, run by experts. The easiest way to start.</span>
    </button>
    <button type="button" class="kind" class:on={kind === "stocks"} aria-pressed={kind === "stocks"} onclick={() => (kind = "stocks")}>
      <b>Stocks</b>
      <span>A small piece of one company. It can grow more, and it can fall more.</span>
    </button>
  </div>

  {#if kind === "funds"}
    <div class="card controls">
      <div class="row">
        <span class="lbl">Kind</span>
        <div class="seg" role="group" aria-label="Kinds of fund">
          {#each GROUPS as g}
            <button type="button" aria-pressed={group === g.id} onclick={() => (group = g.id)}>{g.label}</button>
          {/each}
        </div>
      </div>
      <div class="row">
        <span class="lbl">Type</span>
        <div class="seg" role="group" aria-label="Fund type">
          {#each visibleTypes as t}
            <button type="button" aria-pressed={typeId === t.id} onclick={() => { typeId = t.id; load(); }}>{t.label}</button>
          {/each}
        </div>
      </div>
      {#if type}
        <p class="typebox">
          {type.description}
          <span class="chip {RISK_TONE[type.risk]}">Risk: {type.risk}</span>
          <span class="chip">Stay invested: {type.horizon}</span>
        </p>
      {/if}
      <div class="row">
        <span class="lbl">Style</span>
        <div class="seg" role="group" aria-label="Ranking style">
          {#each RANK_STYLES as s}
            <button type="button" aria-pressed={style === s.id} onclick={() => { style = s.id; load(); }}>{s.label}</button>
          {/each}
        </div>
        <span class="muted small">{styleHint}</span>
      </div>
    </div>

    {#if loading}
      <div class="card"><span class="spinner"></span> Fetching the price history of each {type?.label.toLowerCase() ?? "fund"} and ranking them. This takes a few seconds...</div>
    {:else if error}
      <p class="notice bad" role="alert">{error}</p>
    {:else if data}
      <section class="card">
        <div class="top">
          <h2>Top {data.funds.length} {type?.label.toLowerCase() ?? "funds"}</h2>
          {#if data.navAsOf}<span class="chip">Prices as of {formatDate(data.navAsOf)}</span>{/if}
        </div>
        <p class="muted small">
          We found {data.considered} funds of this kind. {data.ranked} had enough history and a recent price to be ranked, and are compared only with each other
          using the <b>{RANK_STYLES.find((s) => s.id === style)?.label.toLowerCase()}</b> weights. Click a row to see the full reasoning.
        </p>
        {#if !data.funds.length}
          <p class="notice">Not enough funds of this kind had the history we need. Try another type.</p>
        {:else}
          <div class="scroll-x">
            <table>
              <thead>
                <tr><th>#</th><th>Fund</th><th>Score</th><th>3-yr return / yr</th><th>3-yr SIP return / yr</th><th>Ups and downs</th><th>Worst fall</th><th>Risks</th></tr>
              </thead>
              <tbody>
                {#each data.funds as f}
                  <tr class="row" class:sel={open?.code === f.code} onclick={() => (open = open?.code === f.code ? null : f)}>
                    <td><b>{f.rank}</b></td>
                    <td>
                      <button class="link" type="button" aria-expanded={open?.code === f.code}>{f.name}</button>
                      <div class="muted small">{f.fundHouse ?? ""}</div>
                    </td>
                    <td><b>{f.score.toFixed(1)}</b></td>
                    <td>{pct("cagr_3y", f.metrics.cagr_3y)}</td>
                    <td>{pct("sip_xirr_3y", f.metrics.sip_xirr_3y)}</td>
                    <td>{pct("volatility", f.metrics.volatility)}</td>
                    <td>{pct("max_drawdown", f.metrics.max_drawdown)}</td>
                    <td>{#if f.flags.length}<span class="chip warn">{f.flags.length} flag{f.flags.length === 1 ? "" : "s"}</span>{:else}<span class="chip good">none</span>{/if}</td>
                  </tr>
                  {#if open?.code === f.code}
                    <tr class="detail">
                      <td colspan="8">
                        <div class="grid cols-2">
                          <div>
                            <h3>Why it ranked #{f.rank}</h3>
                            <p class="muted small">Each row shows how this fund compares with its peers on one measure (100% means the best), how much that measure counts, and the points it added.</p>
                            <table class="mini">
                              <thead><tr><th>Measure</th><th>Value</th><th>Better than</th><th>Counts</th><th>Points</th></tr></thead>
                              <tbody>
                                {#each [...f.contributions].sort((a, b) => b.contribution - a.contribution) as c}
                                  <tr>
                                    <td>{metricLabel[c.metric] ?? c.metric}</td>
                                    <td>{metricValue(c.metric, c.value)}</td>
                                    <td>{c.percentile.toFixed(0)}% of peers</td>
                                    <td>{(c.weight * 100).toFixed(0)}%</td>
                                    <td>+{c.contribution.toFixed(1)}</td>
                                  </tr>
                                {/each}
                              </tbody>
                            </table>
                          </div>
                          <div class="side">
                            <h3>Risks to know</h3>
                            {#if f.flags.length}
                              <ul>{#each f.flags as fl}<li>{fl}</li>{/each}</ul>
                            {:else}<p class="muted">No automatic risk flags. This does not mean the fund is risk-free.</p>{/if}
                            <h3>About the data</h3>
                            <ul>
                              <li>History used: {f.historyYears} years of daily prices</li>
                              <li>Data completeness: {Math.round(f.completeness * 100)}%</li>
                              {#if f.missing.length}<li>Not available: {f.missing.map((m) => metricLabel[m] ?? m).join(", ")}</li>{/if}
                              <li>Expense ratio and fund size: not available from this data source, so they are not used</li>
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
          <div class="more">
            {#if count === 5 && data.ranked > 5}
              <button class="btn ghost" type="button" onclick={() => { count = 10; load(); }}>Show top 10</button>
            {:else if count === 10}
              <button class="btn ghost" type="button" onclick={() => { count = 5; load(); }}>Show top 5 only</button>
            {/if}
          </div>
        {/if}
      </section>
    {/if}
  {:else}
    <section class="card stocks">
      <div class="top">
        <h2>Stocks</h2>
        <span class="chip warn">Not available yet</span>
      </div>
      <p>
        Ranking stocks needs a steady supply of prices, profits and debt figures for every Indian company. We have not found a free source that gives it, so we are not
        showing a stock ranking. We would rather show nothing than show numbers we cannot stand behind.
      </p>
      <p class="muted small">
        What we tested: Finnhub blocks Indian stocks on its free plan, Financial Modeling Prep wants payment, and Twelve Data's free plan covers only 1 of about 3,800 NSE stocks.
      </p>
      <h3>What this section will show once there is a data source</h3>
      <div class="grid cols-3 kindgrid">
        {#each stockKinds as s}
          <div class="preview">
            <b>{s.label}</b>
            <p class="muted small">{s.text}</p>
            <span class="chip">Risk: {s.risk}</span>
          </div>
        {/each}
      </div>
      <p class="muted small">Each type would show the top 5 companies ranked by published rules (profit growth, debt, price compared with profit), with the reasons and the risks next to each one, the same way the fund rankings do.</p>
      <button class="btn" type="button" onclick={() => (kind = "funds")}>See mutual funds instead</button>
    </section>
  {/if}
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
  .lead {
    max-width: 660px;
  }
  .small {
    font-size: 0.85rem;
  }
  .kinds {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
  }
  .kind {
    display: grid;
    gap: 6px;
    text-align: left;
    padding: 16px 18px;
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    cursor: pointer;
  }
  .kind b {
    font-size: 1.1rem;
  }
  .kind span {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .kind:hover {
    border-color: var(--accent);
  }
  .kind.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .controls {
    display: grid;
    gap: 14px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .lbl {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--muted);
    min-width: 66px;
  }
  .typebox {
    margin: 0;
    padding: 12px 14px;
    background: var(--surface-soft);
    border-radius: var(--radius-sm);
    display: flex;
    gap: 8px 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .more {
    margin-top: 14px;
  }
  tr.sel {
    background: var(--accent-soft);
  }
  tr.row {
    cursor: pointer;
  }
  tr.row:hover {
    background: var(--surface-soft);
  }
  .link {
    font: inherit;
    font-weight: 700;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    color: var(--text);
    cursor: pointer;
  }
  .detail td {
    background: var(--surface-soft);
    padding: 18px;
  }
  .mini {
    font-size: 0.85rem;
  }
  .side ul {
    margin: 6px 0 14px;
    padding-left: 18px;
  }
  .stocks {
    display: grid;
    gap: 14px;
  }
  .kindgrid {
    gap: 12px;
  }
  .preview {
    display: grid;
    gap: 6px;
    align-content: start;
    padding: 14px;
    border: 1px dashed var(--line);
    border-radius: var(--radius-sm);
    opacity: 0.85;
  }
  .preview p {
    margin: 0;
  }
</style>
