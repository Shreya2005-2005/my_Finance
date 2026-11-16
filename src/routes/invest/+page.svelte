<script lang="ts">
  import { onMount } from "svelte";
  import { FUND_TYPES, GROUPS, RANK_STYLES, RISK_TONE, typeById, type FundGroup } from "$lib/fund-types";
  import { formatDate, metricLabel, metricValue } from "$lib/format";
  import type { FundRow, FundsResponse, StockNewsResponse, StockRow, StocksResponse } from "$lib/types";

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

  // ---- Stocks: top Indian companies (Nifty 50) from a free price feed ----
  type StockList = "gainers" | "losers" | "active";
  let stocks = $state<StocksResponse | null>(null);
  let stocksLoading = $state(false);
  let stocksError = $state("");
  let list = $state<StockList>("gainers");
  let sector = $state("all");
  let openStock = $state<StockRow | null>(null);
  let news = $state<StockNewsResponse | null>(null);
  let newsLoading = $state(false);

  const LISTS: Array<{ id: StockList; label: string; hint: string }> = [
    { id: "gainers", label: "Top gainers", hint: "Rose the most since yesterday's close." },
    { id: "losers", label: "Top losers", hint: "Fell the most since yesterday's close." },
    { id: "active", label: "Most traded", hint: "The most rupees changed hands today. Busy stocks are easy to buy and sell." },
  ];
  const sectors = $derived(stocks ? [...new Set(stocks.all.map((s) => s.sector))].sort() : []);
  const shown = $derived.by(() => {
    if (!stocks) return [];
    if (sector === "all") return stocks[list];
    const key = list === "gainers" ? (r: StockRow) => r.changePct : list === "losers" ? (r: StockRow) => -r.changePct : (r: StockRow) => r.turnover ?? 0;
    return stocks.all.filter((r) => r.sector === sector).sort((a, b) => key(b) - key(a)).slice(0, 5);
  });

  async function loadStocks() {
    if (stocks || stocksLoading) return;
    stocksLoading = true;
    stocksError = "";
    try {
      const d: StocksResponse = await (await fetch("/api/stocks")).json();
      if (d.error) stocksError = d.error;
      else stocks = d;
    } catch {
      stocksError = "Could not reach the server. Check that the website is still running.";
    } finally {
      stocksLoading = false;
    }
  }

  async function toggleStock(s: StockRow) {
    if (openStock?.symbol === s.symbol) return void (openStock = null);
    openStock = s;
    news = null;
    newsLoading = true;
    try {
      const d: StockNewsResponse = await (await fetch(`/api/stocks?news=${encodeURIComponent(s.symbol)}`)).json();
      if (openStock?.symbol === s.symbol) news = d;
    } catch {
      if (openStock?.symbol === s.symbol) news = { symbol: s.symbol, items: [], error: "News could not be read just now." };
    } finally {
      newsLoading = false;
    }
  }

  const money = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const signed = (n: number | undefined) => (n === undefined ? "n/a" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
  const tone = (n: number | undefined) => (n === undefined ? "" : n > 0 ? "up" : n < 0 ? "down" : "");
  const crore = (n: number | undefined) => (n === undefined ? "n/a" : `₹${(n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`);

  $effect(() => {
    if (kind === "stocks") loadStocks();
  });
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
        <h2>Top Indian stocks</h2>
        {#if stocks?.asOf}<span class="chip">Prices as of {formatDate(stocks.asOf)}</span>{/if}
      </div>
      <p class="muted small">
        We look at the Nifty 50, India's 50 largest listed companies. Prices come from a free public feed and can be delayed, so use them to
        discover companies, not to time a trade. Click a company for its latest news.
      </p>

      <div class="row">
        <span class="lbl">List</span>
        <div class="seg" role="group" aria-label="Which list">
          {#each LISTS as l}
            <button type="button" aria-pressed={list === l.id} onclick={() => { list = l.id; openStock = null; }}>{l.label}</button>
          {/each}
        </div>
        <span class="muted small">{LISTS.find((l) => l.id === list)?.hint}</span>
      </div>
      {#if stocks}
        <div class="row">
          <span class="lbl">Industry</span>
          <div class="seg" role="group" aria-label="Industry">
            <button type="button" aria-pressed={sector === "all"} onclick={() => { sector = "all"; openStock = null; }}>All</button>
            {#each sectors as sc}
              <button type="button" aria-pressed={sector === sc} onclick={() => { sector = sc; openStock = null; }}>{sc}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if stocksLoading}
        <div><span class="spinner"></span> Reading today's prices for 50 companies. This takes a few seconds...</div>
      {:else if stocksError}
        <p class="notice bad" role="alert">{stocksError}</p>
      {:else if stocks}
        {#if !shown.length}
          <p class="notice">No stock in this list right now. Try another list or industry.</p>
        {:else}
          <div class="scroll-x">
            <table>
              <thead><tr><th>#</th><th>Company</th><th>Price</th><th>Today</th><th>1 month</th><th>1 year</th><th>Traded today</th><th>Vs 52-week high</th></tr></thead>
              <tbody>
                {#each shown as s, i}
                  <tr class="pick" class:sel={openStock?.symbol === s.symbol} onclick={() => toggleStock(s)}>
                    <td><b>{i + 1}</b></td>
                    <td>
                      <button class="link" type="button" aria-expanded={openStock?.symbol === s.symbol}>{s.name}</button>
                      <div class="muted small">{s.symbol} · {s.sector}</div>
                    </td>
                    <td>{money(s.price)}</td>
                    <td class={tone(s.changePct)}><b>{signed(s.changePct)}</b></td>
                    <td class={tone(s.return1m)}>{signed(s.return1m)}</td>
                    <td class={tone(s.return1y)}>{signed(s.return1y)}</td>
                    <td>{crore(s.turnover)}</td>
                    <td>{s.nearHigh === undefined ? "n/a" : `${s.nearHigh.toFixed(0)}% of high`}</td>
                  </tr>
                  {#if openStock?.symbol === s.symbol}
                    <tr class="detail">
                      <td colspan="8">
                        <h3>Latest news on {s.name}</h3>
                        {#if newsLoading}
                          <span class="spinner"></span> Finding recent stories...
                        {:else if news?.error}
                          <p class="muted">{news.error}</p>
                        {:else if news && !news.items.length}
                          <p class="muted">No recent stories found.</p>
                        {:else if news}
                          <ul class="newslist">
                            {#each news.items as n}
                              <li>
                                <a href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a>
                                <span class="muted small">{n.source}{n.publishedAt ? ` · ${formatDate(n.publishedAt)}` : ""}</span>
                              </li>
                            {/each}
                          </ul>
                        {/if}
                        <p class="muted small">
                          52-week range: {s.low52 ? money(s.low52) : "n/a"} to {s.high52 ? money(s.high52) : "n/a"}. Past moves do not predict future ones.
                        </p>
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
          <p class="muted small">
            Read {stocks.read} of {stocks.total} companies. Sources: Yahoo Finance public chart feed (prices) and Google News (headlines).
            {#if stocks.notes?.length}{stocks.notes.join(" ")}{/if}
          </p>
        {/if}
      {/if}
      <button class="btn ghost" type="button" onclick={() => (kind = "funds")}>See mutual funds instead</button>
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
  /* The page title uses the logo's style, like the home page headline: thin, capital, widely spaced letters. */
  h1 {
    font-family: var(--font-brand);
    font-weight: 300;
    text-transform: uppercase;
    font-size: clamp(1.4rem, 3.2vw, 2.6rem);
    letter-spacing: 0.12em;
    line-height: 1.25;
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
  tr.row,
  tr.pick {
    cursor: pointer;
  }
  tr.row:hover,
  tr.pick:hover {
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
  .up {
    color: var(--good);
  }
  .down {
    color: var(--bad);
  }
  .newslist {
    margin: 6px 0 12px;
    padding-left: 18px;
    display: grid;
    gap: 6px;
  }
  .newslist li {
    display: grid;
  }
</style>
