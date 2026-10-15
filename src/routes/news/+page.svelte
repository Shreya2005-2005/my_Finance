<script lang="ts">
  import { onMount } from "svelte";
  import NewsArt from "$lib/components/NewsArt.svelte";
  import { formatDate, timeAgo } from "$lib/format";
  import type { DailyNewsResponse } from "$lib/types";

  let data = $state<DailyNewsResponse | null>(null);
  let loading = $state(false);
  let error = $state("");
  // Which story is featured. The strip on the right lets the reader jump to any other.
  let at = $state(0);
  let strip = $state<HTMLElement>();

  const items = $derived(data?.items ?? []);
  const current = $derived(items[at]);

  async function load() {
    loading = true;
    error = "";
    try {
      const res = await fetch("/api/news");
      const d: DailyNewsResponse = await res.json();
      if (d.error) {
        error = d.error;
        data = null;
      } else {
        data = d;
        at = 0;
      }
    } catch {
      error = "Could not reach the server. Check that the website is still running.";
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function go(i: number) {
    const n = items.length;
    if (!n) return;
    at = (i + n) % n;
    // Keep the chosen small card in view inside the strip (scrolls the strip only, not the whole page).
    queueMicrotask(() => {
      const el = strip?.querySelector<HTMLElement>(`[data-i="${at}"]`);
      if (el && strip) strip.scrollTo({ top: el.offsetTop - strip.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
    });
  }

  function key(e: KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      go(at + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      go(at - 1);
    }
  }
</script>

<svelte:head><title>Daily news · Verifin</title></svelte:head>

<div class="wrap page">
  <header class="head">
    <h1>Today's market headlines</h1>
    <p class="muted lead">The day's money news from the last 24 hours, from outlets such as Reuters, CNBC and Bloomberg. One card for each event, newest first.</p>
  </header>

  {#if loading && !data}
    <div class="card"><span class="spinner"></span> Getting today's headlines...</div>
  {:else if error}
    <p class="notice bad" role="alert">{error}</p>
    <div><button class="btn" type="button" onclick={load} disabled={loading}>Try again</button></div>
  {:else if data}
    {#if data.windowHours > 24}
      <p class="notice warn">There were fewer than 5 separate stories in the last 24 hours, so this list looks back {data.windowHours} hours.</p>
    {/if}

    {#if current}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <section class="stage" aria-roledescription="carousel" aria-label="Today's headlines" tabindex="0" onkeydown={key}>
        {#key at}
          <div class="slide">
            <div class="copy">
              <p class="count" aria-live="polite">{at + 1} of {items.length}</p>
              <h2><a href={current.url} target="_blank" rel="noopener noreferrer">{current.headline}</a></h2>
              {#if current.summary}
                <p class="sum">{current.summary}</p>
              {:else if current.alsoBy.length}
                <p class="sum">Also reported by {current.alsoBy.join(", ")}.</p>
              {/if}
              <p class="meta">
                <span>{current.source}</span><i aria-hidden="true"></i><span>{timeAgo(current.publishedAt)}</span><i aria-hidden="true"></i><span>{formatDate(current.publishedAt)}</span>
              </p>
              <div class="ctrl">
                <button type="button" class="round" aria-label="Previous story" onclick={() => go(at - 1)}>&larr;</button>
                <button type="button" class="round" aria-label="Next story" onclick={() => go(at + 1)}>&rarr;</button>
                <a class="read" href={current.url} target="_blank" rel="noopener noreferrer">Read the story &nearr;</a>
              </div>
            </div>
            <div class="photo">
              <NewsArt source={current.source} image={current.image} photo={current.photo} />
            </div>
          </div>
        {/key}

        <div class="strip" bind:this={strip} role="group" aria-label="All of today's stories">
          {#each items as n, i (n.url)}
            <button type="button" class="thumb" class:on={i === at} data-i={i} aria-current={i === at ? "true" : undefined} aria-label={`Story ${i + 1}: ${n.headline}`} title={n.headline} onclick={() => go(i)}>
              <NewsArt source={n.source} image={n.image} photo={n.photo} small />
              <span class="n">{i + 1}</span>
            </button>
          {/each}
        </div>
      </section>
    {:else}
      <p class="notice">No headlines came back from Finnhub right now. Try again in a few minutes.</p>
    {/if}

    <div class="foot">
      <span class="muted small">Showing {items.length} {items.length === 1 ? "story" : "stories"}. Updated {timeAgo(data.fetchedAt)}. The list refreshes at most every 10 minutes. Use the arrow keys to move between stories.</span>
      <button class="btn ghost small" type="button" onclick={load} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button>
    </div>
  {/if}
</div>

<style>
  .page {
    padding-top: 40px;
    display: grid;
    gap: 20px;
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
    max-width: 660px;
  }
  .small {
    font-size: 0.85rem;
  }

  /* ---------- the featured story: always a black stage, like a magazine cover ---------- */
  .stage {
    --ink: #ffffff;
    --ink-soft: #c7d0cb;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 104px;
    gap: 24px;
    padding: 40px 36px 40px 48px;
    background: #000;
    color: var(--ink);
    border-radius: 28px;
    outline-offset: 4px;
    min-height: 560px;
  }
  .slide {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(220px, 320px);
    gap: 40px;
    align-items: stretch;
    animation: rise 0.45s ease both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .copy {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 22px;
    min-width: 0;
  }
  .count {
    margin: 0;
    font-size: 0.8rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .copy h2 {
    font-family: var(--font-brand);
    font-weight: 300;
    font-size: clamp(1.9rem, 3.6vw, 3.3rem);
    line-height: 1.1;
    letter-spacing: -0.01em;
    color: var(--ink);
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .copy h2 a {
    color: inherit;
    text-decoration: none;
  }
  .copy h2 a:hover {
    text-decoration: underline;
    text-underline-offset: 6px;
    text-decoration-thickness: 1px;
  }
  .sum {
    margin: 0;
    max-width: 470px;
    font-size: 0.92rem;
    line-height: 1.6;
    color: var(--ink-soft);
  }
  .meta {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .meta i {
    width: 1px;
    height: 12px;
    background: #4a524e;
  }
  .ctrl {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .round {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: 1px solid #3a413d;
    background: transparent;
    color: var(--ink);
    font-size: 1.1rem;
    cursor: pointer;
  }
  .round:hover {
    background: #1b211e;
  }
  .read {
    margin-left: 6px;
    color: var(--ink);
    font-weight: 700;
    font-size: 0.9rem;
    text-underline-offset: 4px;
  }
  .photo {
    display: block;
    border-radius: 6px;
    overflow: hidden;
    min-height: 420px;
  }

  /* the strip of the other stories, cut off at the edge like the reference */
  .strip {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 480px;
    overflow-y: auto;
    scrollbar-width: none;
    margin-right: -12px;
    padding-block: 2px;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .thumb {
    position: relative;
    flex: none;
    width: 92px;
    height: 124px;
    border: 2px solid transparent;
    border-radius: 6px;
    padding: 0;
    overflow: hidden;
    cursor: pointer;
    background: #111;
    opacity: 0.6;
    transition: opacity 0.2s, border-color 0.2s;
  }
  .thumb:hover,
  .thumb:focus-visible {
    opacity: 1;
  }
  .thumb.on {
    opacity: 1;
    border-color: #ffffff;
  }
  .thumb .n {
    position: absolute;
    left: 6px;
    bottom: 4px;
    font-size: 0.78rem;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 6px rgb(0 0 0 / 60%);
  }

  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  @media (max-width: 900px) {
    .stage {
      grid-template-columns: 1fr;
      padding: 28px 22px;
      min-height: 0;
    }
    .slide {
      grid-template-columns: 1fr;
      gap: 22px;
    }
    .photo {
      order: -1;
      min-height: 240px;
      height: 240px;
    }
    .strip {
      flex-direction: row;
      max-height: none;
      overflow-x: auto;
      overflow-y: hidden;
      margin-right: 0;
    }
    .thumb {
      width: 70px;
      height: 94px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .slide {
      animation: none;
    }
  }
</style>
