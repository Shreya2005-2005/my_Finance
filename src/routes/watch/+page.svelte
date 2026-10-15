<script lang="ts">
  import { onMount } from "svelte";
  import { eventLabel, timeAgo } from "$lib/format";
  import type { WatchAlertsResponse } from "$lib/types";

  const STORE = "verifin.watchlist";
  const LAST_SEARCHED = "verifin.research.last"; // written by the Research page
  const SEEN = "verifin.watch.seen";

  let list = $state<string[]>([]);
  let selected = $state("");
  let input = $state("");
  let data = $state<WatchAlertsResponse | null>(null);
  let loading = $state(false);
  let error = $state("");
  let newKeys = $state<Set<string>>(new Set());
  let seen: Record<string, string[]> = {};

  const norm = (s: string) => s.trim().toLowerCase();
  const read = <T,>(key: string, fallback: T): T => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key: string, value: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage can be blocked: the page still works, it just will not remember */
    }
  };

  onMount(() => {
    list = read<string[]>(STORE, []);
    seen = read<Record<string, string[]>>(SEEN, {});
    // Start with the company the user searched for last in Research.
    const last = read<string>(LAST_SEARCHED, "");
    if (last && !list.some((x) => norm(x) === norm(last))) {
      list = [last, ...list].slice(0, 12);
      write(STORE, list);
    }
    const start = last || list[0] || "";
    if (start) load(start);
  });

  async function load(company: string) {
    selected = company;
    loading = true;
    error = "";
    try {
      const res = await fetch(`/api/watch?company=${encodeURIComponent(company)}`);
      const d: WatchAlertsResponse = await res.json();
      if (d.error) {
        error = d.error;
        data = null;
      } else {
        data = d;
        markNew(company, d);
      }
    } catch {
      error = "Could not reach the server. Check that the website is still running.";
    } finally {
      loading = false;
    }
  }

  /** The first time you look at a company nothing is flagged. After that, alerts you have not read show "New". */
  function markNew(company: string, d: WatchAlertsResponse) {
    const key = norm(company);
    const keys = d.alerts.map((a) => a.key);
    if (!seen[key]) {
      seen[key] = keys;
      write(SEEN, seen);
      newKeys = new Set();
    } else {
      newKeys = new Set(keys.filter((k) => !seen[key]!.includes(k)));
    }
  }

  function markAllRead() {
    if (!data) return;
    const key = norm(selected);
    seen[key] = [...new Set([...(seen[key] ?? []), ...data.alerts.map((a) => a.key)])].slice(-100);
    write(SEEN, seen);
    newKeys = new Set();
  }

  function add() {
    const name = input.trim().slice(0, 60);
    if (!name) return;
    if (!list.some((x) => norm(x) === norm(name))) {
      list = [...list, name].slice(0, 12);
      write(STORE, list);
    }
    input = "";
    load(name);
  }

  function remove(name: string) {
    list = list.filter((x) => x !== name);
    write(STORE, list);
    if (norm(selected) === norm(name)) {
      selected = "";
      data = null;
      if (list[0]) load(list[0]);
    }
  }

  const level = {
    important: { label: "Important", help: "A major event: results, a deal, a legal or regulatory matter." },
    worth: { label: "Worth a look", help: "Useful to know, but not urgent." },
    fyi: { label: "For your information", help: "Background news." },
  } as const;
</script>

<svelte:head><title>Watch · Verifin</title></svelte:head>

<div class="wrap page">
  <header class="head">
    <p class="eyebrow">Verifin Watch</p>
    <h1>Your top 5 alerts</h1>
    <p class="muted lead">
      For each company you follow, we pick the <b>5 most important</b> recent stories. Repeated stories are merged, so one event is one alert.
    </p>
  </header>

  <section class="card follow">
    <div class="chips">
      {#each list as name}
        <span class="co" class:on={norm(name) === norm(selected)}>
          <button class="pick" type="button" onclick={() => load(name)} aria-pressed={norm(name) === norm(selected)}>{name}</button>
          <button class="x" type="button" onclick={() => remove(name)} aria-label="Stop following {name}">×</button>
        </span>
      {:else}
        <span class="muted small">You are not following any company yet. Add one to see its alerts.</span>
      {/each}
    </div>
    <form class="add" onsubmit={(e) => { e.preventDefault(); add(); }}>
      <input type="text" bind:value={input} placeholder="Add a company, e.g. Infosys" aria-label="Company to follow" />
      <button class="btn small" type="submit">Follow</button>
    </form>
  </section>

  {#if loading}
    <div class="card"><span class="spinner"></span> Finding the latest alerts for {selected}...</div>
  {:else if error}
    <p class="notice bad" role="alert">{error}</p>
  {:else if data}
    <section class="alerts" aria-live="polite">
      <div class="bar">
        <div>
          <h2>{data.company}</h2>
          <p class="muted small">
            {#if data.alerts.length === 0}
              No important stories found recently.
            {:else}
              Showing the {data.alerts.length} most important of {data.totalStories} recent {data.totalStories === 1 ? "story" : "stories"}. Updated {timeAgo(data.fetchedAt)}.
            {/if}
          </p>
        </div>
        {#if newKeys.size > 0}
          <button class="btn ghost small" type="button" onclick={markAllRead}>Mark {newKeys.size} new as read</button>
        {/if}
      </div>

      {#each data.alerts as a, i (a.key)}
        <article class="card alert {a.level}" class:fresh={newKeys.has(a.key)}>
          <span class="num" aria-hidden="true">{i + 1}</span>
          <div class="body">
            <div class="tags">
              <span class="level {a.level}" title={level[a.level].help}>{level[a.level].label}</span>
              <span class="chip">{eventLabel[a.type] ?? a.type}</span>
              {#if newKeys.has(a.key)}<span class="chip good">New</span>{/if}
              {#if a.publishedAt}<span class="when">{timeAgo(a.publishedAt)}</span>{/if}
            </div>
            <h3><a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a></h3>
            <p class="why">{a.why}</p>
            <a class="read" href={a.url} target="_blank" rel="noopener noreferrer">Read the story ↗</a>
          </div>
        </article>
      {:else}
        <p class="notice">Nothing important in the last 7 days for {data.company}. Check back later, or follow another company.</p>
      {/each}

      {#if data.alerts.length > 0}
        <p class="muted small foot">
          Only recognised news sources are used, and never more than 5 alerts per company, so nothing important gets lost in noise.
          You can read about the sources on the <a href="/research">Research</a> page.
        </p>
      {/if}
    </section>
  {:else if list.length === 0}
    <div class="card empty">
      <h2>Start by following a company</h2>
      <p class="muted">Type a company name above, or research one first. We will show its 5 most important alerts here.</p>
    </div>
  {/if}
</div>

<style>
  .page {
    padding-top: 40px;
    display: grid;
    gap: 20px;
    max-width: 860px;
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
    font-size: clamp(1.7rem, 3.8vw, 3rem);
    letter-spacing: 0.12em;
    line-height: 1.25;
  }
  .lead {
    max-width: 620px;
  }
  .small {
    font-size: 0.85rem;
  }
  .follow {
    display: grid;
    gap: 14px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .co {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: 999px;
    overflow: hidden;
    background: var(--surface-soft);
  }
  .co.on {
    background: var(--brand);
    border-color: var(--brand);
  }
  .co.on .pick,
  .co.on .x {
    color: var(--brand-ink);
  }
  .pick {
    font: inherit;
    font-weight: 700;
    font-size: 0.92rem;
    background: none;
    border: 0;
    color: var(--text);
    padding: 8px 6px 8px 16px;
    cursor: pointer;
  }
  .x {
    font: inherit;
    font-size: 1.1rem;
    background: none;
    border: 0;
    color: var(--muted);
    padding: 0 12px 0 4px;
    cursor: pointer;
  }
  .add {
    display: flex;
    gap: 8px;
  }
  .alerts {
    display: grid;
    gap: 14px;
  }
  .bar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: end;
    flex-wrap: wrap;
  }
  .alert {
    display: flex;
    gap: 16px;
    padding: 18px 20px;
    border-left: 5px solid var(--line);
  }
  .alert.important {
    border-left-color: var(--bad);
  }
  .alert.worth {
    border-left-color: var(--warn);
  }
  .alert.fyi {
    border-left-color: var(--info);
  }
  .alert.fresh {
    box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
  }
  .num {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-family: var(--font-serif);
    font-size: 1.1rem;
    background: var(--surface-soft);
    border: 1px solid var(--line);
  }
  .body {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .tags {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .level {
    font-size: 0.8rem;
    font-weight: 800;
    padding: 3px 11px;
    border-radius: 999px;
  }
  .level.important {
    background: var(--bad-soft);
    color: var(--bad);
  }
  .level.worth {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .level.fyi {
    background: var(--info-soft);
    color: var(--info);
  }
  .when {
    margin-left: auto;
    font-size: 0.82rem;
    color: var(--muted);
  }
  h3 {
    font-size: 1.15rem;
    line-height: 1.3;
  }
  h3 a {
    text-decoration: none;
  }
  h3 a:hover {
    text-decoration: underline;
  }
  .why {
    color: var(--muted);
    font-size: 0.93rem;
  }
  .read {
    justify-self: start;
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--accent);
    text-decoration: none;
  }
  .read:hover {
    text-decoration: underline;
  }
  .foot a {
    color: var(--accent);
    font-weight: 600;
  }
  .empty {
    display: grid;
    gap: 6px;
  }
  @media (max-width: 560px) {
    .alert {
      gap: 12px;
      padding: 16px;
    }
    .when {
      margin-left: 0;
      width: 100%;
    }
  }
</style>
