<script lang="ts">
  /**
   * "Indian market today": the top Indian finance stories as a single row of photo cards.
   * Free public feeds (Economic Times, Mint, Business Standard, BusinessLine, RBI, SEBI), picked by plain code.
   * Shows 6, with a button for up to 10. Clicking a card opens the outlet's own article in a new tab.
   */
  import { onMount } from "svelte";
  import { timeAgo } from "$lib/format";
  import type { DailyNewsResponse } from "$lib/types";
  import NewsArt from "./NewsArt.svelte";

  let data = $state<DailyNewsResponse | null>(null);
  let loading = $state(false);
  let error = $state("");
  let all = $state(false);
  let row = $state<HTMLElement>();

  const FIRST = 6;
  const items = $derived(data?.items ?? []);
  const shown = $derived(all ? items : items.slice(0, FIRST));

  async function load() {
    loading = true;
    error = "";
    try {
      const res = await fetch("/api/india-news");
      const d: DailyNewsResponse = await res.json();
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

  const slide = (dir: 1 | -1) => row?.scrollBy({ left: dir * 540, behavior: "smooth" });

  /** A click on empty card space opens the story. Links and buttons keep their own action. */
  function open(url: string, e: MouseEvent) {
    if ((e.target as HTMLElement).closest("a,button")) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }
</script>

<section class="india" aria-labelledby="india-title">
  <div class="top">
    <div class="titles">
      <p class="eyebrow">Indian market today</p>
      <h2 id="india-title">Top finance news from India</h2>
    </div>
    {#if items.length}
      <div class="ctrl">
        <button type="button" class="round" aria-label="Scroll left" onclick={() => slide(-1)}>&larr;</button>
        <button type="button" class="round" aria-label="Scroll right" onclick={() => slide(1)}>&rarr;</button>
        {#if items.length > FIRST}
          <button type="button" class="btn ghost small" onclick={() => (all = !all)}>{all ? `Show ${FIRST}` : `Show ${items.length}`}</button>
        {/if}
      </div>
    {/if}
  </div>

  {#if loading && !data}
    <div class="row" aria-busy="true" aria-label="Loading the news">
      {#each [1, 2, 3, 4] as n (n)}<div class="card tile skeleton"></div>{/each}
    </div>
  {:else if error}
    <p class="notice warn" role="status">{error} <button class="link" type="button" onclick={load}>Try again</button></p>
  {:else if data}
    {#if data.windowHours > 24}
      <p class="notice warn">Fewer than 5 separate stories in the last 24 hours, so this looks back {data.windowHours} hours.</p>
    {/if}
    <div class="row" bind:this={row} role="list" aria-label="Indian finance headlines">
      {#each shown as n (n.url)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
        <article class="card tile" role="listitem" onclick={(e) => open(n.url, e)}>
          <div class="pic"><NewsArt source={n.source} image={n.image} photo={n.photo} compact /></div>
          <div class="body">
            <p class="meta">
              <span class="src">{n.source}</span>
              {#if n.official}<span class="chip good">Official</span>{/if}
              <span class="muted">{timeAgo(n.publishedAt)}</span>
            </p>
            <h3><a href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a></h3>
          </div>
        </article>
      {:else}
        <p class="notice">No Indian finance stories came back just now. Try again in a few minutes.</p>
      {/each}
    </div>
    <p class="foot muted small">
      From {[...new Set(items.map((n) => n.source))].join(", ")}. Updated {timeAgo(data.fetchedAt)}.
      {#if data.notes?.length}{data.notes.join(" ")}{/if}
    </p>
  {/if}
</section>

<style>
  .india {
    display: grid;
    gap: 14px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 12px;
    flex-wrap: wrap;
  }
  .titles {
    display: grid;
    gap: 4px;
  }
  h2 {
    font-size: 1.3rem;
  }
  .ctrl {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .round {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    font-size: 1rem;
  }
  .round:hover {
    border-color: var(--accent);
  }
  .row {
    display: flex;
    gap: 14px;
    overflow-x: auto;
    padding-bottom: 8px;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
  }
  .tile {
    flex: 0 0 262px;
    scroll-snap-align: start;
    display: grid;
    grid-template-rows: 150px auto;
    padding: 0;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .tile:hover {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
  }
  .tile.skeleton {
    min-height: 260px;
    cursor: default;
    background: var(--surface-soft);
  }
  .pic {
    position: relative;
    min-height: 0;
  }
  .body {
    display: grid;
    gap: 6px;
    align-content: start;
    padding: 12px 14px 14px;
  }
  .meta {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 0.78rem;
  }
  .src {
    font-weight: 700;
  }
  h3 {
    font-size: 0.98rem;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  h3 a {
    text-decoration: none;
  }
  h3 a:hover {
    text-decoration: underline;
  }
  .foot {
    margin: 0;
  }
  .small {
    font-size: 0.85rem;
  }
</style>
