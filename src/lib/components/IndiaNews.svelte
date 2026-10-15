<script lang="ts">
  /**
   * "Indian market today": the top Indian finance stories as a magazine-style featured slider.
   *
   * A large photo with the headline over it slides through today's 5 to 10 stories; the next story waits in a smaller card
   * on the right. Free public feeds (Economic Times, Mint, Business Standard, BusinessLine, RBI, SEBI), picked by plain code.
   * The slider moves by itself every few seconds, and stops while the reader points at it, uses the keyboard in it, or has
   * asked their system for reduced motion. Clicking a headline opens the outlet's own article in a new tab.
   */
  import { onMount } from "svelte";
  import { formatDate, timeAgo } from "$lib/format";
  import type { DailyNewsResponse } from "$lib/types";
  import NewsArt from "./NewsArt.svelte";

  let data = $state<DailyNewsResponse | null>(null);
  let loading = $state(false);
  let error = $state("");
  let at = $state(0);
  let paused = $state(false);
  let reduceMotion = false;

  const items = $derived(data?.items ?? []);
  const current = $derived(items[at]);
  const next = $derived(items.length > 1 ? items[(at + 1) % items.length] : undefined);
  /** A stock photo (not the story's own) is on screen: it must be labelled and credited. */
  const illustrated = $derived(Boolean(current && !current.image && current.photo));

  async function load() {
    loading = true;
    error = "";
    try {
      const res = await fetch("/api/india-news");
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

  onMount(() => {
    reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    load();
  });

  function go(i: number) {
    const n = items.length;
    if (n) at = (i + n) % n;
  }

  // Slides by itself. Reading `at` here restarts the clock after every manual move, so a reader is never rushed.
  $effect(() => {
    void at;
    if (items.length < 2 || paused || reduceMotion) return;
    const t = setInterval(() => go(at + 1), 9000);
    return () => clearInterval(t);
  });

  function key(e: KeyboardEvent) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(at + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(at - 1);
    }
  }
</script>

<section
  class="india"
  aria-labelledby="india-title"
  onpointerenter={() => (paused = true)}
  onpointerleave={() => (paused = false)}
  onfocusin={() => (paused = true)}
  onfocusout={() => (paused = false)}
>
  <div class="head">
    <h2 id="india-title">Top finance news from India</h2>
  </div>
  <div class="rule" aria-hidden="true"></div>

  {#if loading && !data}
    <div class="grid" aria-busy="true" aria-label="Loading the news">
      <div class="hero skeleton"></div>
      <div class="side skeleton"></div>
    </div>
  {:else if error}
    <p class="notice warn" role="status">{error} <button class="link" type="button" onclick={load}>Try again</button></p>
  {:else if data}
    {#if data.windowHours > 24}
      <p class="notice warn">Fewer than 5 separate stories in the last 24 hours, so this looks back {data.windowHours} hours.</p>
    {/if}

    {#if current}
      <div class="grid">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div class="hero" role="group" aria-roledescription="carousel" aria-label="Indian finance headlines" tabindex="0" onkeydown={key}>
          {#key at}
            <div class="slide">
              <div class="photo"><NewsArt source={current.source} image={current.image} photo={current.photo} bare /></div>
              <div class="shade"></div>
              <div class="text">
                {#if current.official}<span class="badge">Official notice</span>{/if}
                <h3><a href={current.url} target="_blank" rel="noopener noreferrer">{current.headline}</a></h3>
                {#if current.summary}<p class="sum">{current.summary}</p>{/if}
                <p class="meta">
                  <span class="src">{current.source}</span><i aria-hidden="true"></i><span>{timeAgo(current.publishedAt)}</span><i aria-hidden="true"></i><span>{formatDate(current.publishedAt)}</span>
                </p>
              </div>
              {#if illustrated && current.photo}
                <p class="credit">
                  <b>Illustration</b> · Photo: {current.photo.credit}, {current.photo.license},
                  <a href={current.photo.pageUrl} target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>
                </p>
              {/if}
            </div>
          {/key}
          {#if items.length > 1}
            <button type="button" class="arrow left" aria-label="Previous story" onclick={() => go(at - 1)}>&#8249;</button>
            <button type="button" class="arrow right" aria-label="Next story" onclick={() => go(at + 1)}>&#8250;</button>
          {/if}
          <div class="dots" role="group" aria-label="Choose a story">
            {#each items as n, i (n.url)}
              <button type="button" class="dot" class:on={i === at} aria-label={`Story ${i + 1}: ${n.headline}`} aria-current={i === at ? "true" : undefined} onclick={() => go(i)}></button>
            {/each}
          </div>
        </div>

        {#if next}
          <article class="side">
            <p class="label">Up next</p>
            <div class="sphoto"><NewsArt source={next.source} image={next.image} photo={next.photo} bare /></div>
            <h4><a href={next.url} target="_blank" rel="noopener noreferrer">{next.headline}</a></h4>
            <p class="smeta"><b>{next.source}</b> · {timeAgo(next.publishedAt)}</p>
            <button type="button" class="more" onclick={() => go(at + 1)}>Show this story &rarr;</button>
          </article>
        {/if}
      </div>
    {:else}
      <p class="notice">No Indian finance stories came back just now. Try again in a few minutes.</p>
    {/if}

    <p class="foot muted small">
      From {[...new Set(items.map((n) => n.source))].join(", ")}. Updated {timeAgo(data.fetchedAt)}. Use the arrows, the dots or the left and right keys to move between stories.
      {#if data.notes?.length}{data.notes.join(" ")}{/if}
    </p>
  {/if}
</section>

<style>
  .india {
    --news-serif: "Playfair Display", var(--font-serif), Georgia, serif;
    display: grid;
    gap: 16px;
  }
  .head {
    display: grid;
    gap: 4px;
  }
  /* The heading uses the logo's style (as the home page headings do): thin, capital, widely spaced letters. */
  h2 {
    font-family: var(--font-brand);
    font-weight: 300;
    text-transform: uppercase;
    font-size: clamp(0.85rem, 1.4vw, 1.05rem);
    letter-spacing: 0.18em;
  }
  /* the fine double rule of a newspaper */
  .rule {
    height: 5px;
    border-top: 1px solid var(--muted);
    border-bottom: 1px solid var(--muted);
    opacity: 0.55;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 24px;
    align-items: start;
  }

  /* ---------- the big slider ---------- */
  .hero {
    position: relative;
    height: 230px;
    border-radius: 6px;
    overflow: hidden;
    background: #0a0f0d;
    box-shadow: 0 18px 40px -22px rgb(0 0 0 / 70%);
    outline-offset: 4px;
  }
  .hero.skeleton,
  .side.skeleton {
    background: var(--surface-soft);
    box-shadow: none;
    height: 230px;
  }
  .slide {
    position: absolute;
    inset: 0;
    animation: arrive 0.6s ease both;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: scale(1.015);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .photo {
    position: absolute;
    inset: 0;
  }
  .shade {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgb(0 0 0 / 82%) 0%, rgb(0 0 0 / 52%) 52%, rgb(0 0 0 / 8%) 100%),
      linear-gradient(0deg, rgb(0 0 0 / 60%) 0%, transparent 50%);
  }
  .text {
    position: absolute;
    left: 76px;
    right: 76px;
    bottom: 38px;
    display: grid;
    gap: 8px;
    max-width: 620px;
    color: #fff;
  }
  .badge {
    justify-self: start;
    padding: 3px 10px;
    border: 1px solid rgb(255 255 255 / 70%);
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .text h3 {
    font-family: var(--news-serif);
    font-weight: 600;
    font-size: clamp(1.1rem, 1.9vw, 1.55rem);
    line-height: 1.2;
    color: #fff;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .text h3 a {
    color: inherit;
    text-decoration: none;
  }
  .text h3 a:hover {
    text-decoration: underline;
    text-underline-offset: 5px;
    text-decoration-thickness: 1px;
  }
  .sum {
    margin: 0;
    max-width: 520px;
    font-size: 0.84rem;
    line-height: 1.5;
    color: rgb(255 255 255 / 82%);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    margin: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 12px;
    font-size: 0.8rem;
    color: rgb(255 255 255 / 80%);
  }
  .meta .src {
    font-weight: 700;
    color: #fff;
  }
  .meta i {
    width: 1px;
    height: 12px;
    background: rgb(255 255 255 / 45%);
  }
  .credit {
    position: absolute;
    right: 14px;
    top: 12px;
    max-width: 60%;
    margin: 0;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgb(0 0 0 / 55%);
    font-size: 0.62rem;
    color: #e9eeeb;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .credit a {
    color: #fff;
  }

  /* round white arrows, as in the reference */
  .arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    color: #111;
    font-size: 1.7rem;
    line-height: 1;
    padding-bottom: 3px;
    cursor: pointer;
    box-shadow: 0 6px 16px rgb(0 0 0 / 35%);
    transition: transform 0.15s;
  }
  .arrow:hover {
    transform: translateY(-50%) scale(1.08);
  }
  .arrow.left {
    left: 20px;
  }
  .arrow.right {
    right: 20px;
  }
  .dots {
    position: absolute;
    left: 76px;
    bottom: 18px;
    display: flex;
    gap: 6px;
  }
  .dot {
    width: 18px;
    height: 4px;
    padding: 0;
    border: 0;
    border-radius: 2px;
    background: rgb(255 255 255 / 40%);
    cursor: pointer;
    transition: width 0.25s, background 0.25s;
  }
  .dot.on {
    width: 34px;
    background: #fff;
  }
  .dot:hover {
    background: rgb(255 255 255 / 75%);
  }

  /* ---------- the next story ---------- */
  .side {
    display: grid;
    align-content: start;
    gap: 8px;
    padding-top: 0;
  }
  .label {
    margin: 0;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .sphoto {
    position: relative;
    height: 84px;
    border-radius: 4px;
    overflow: hidden;
    background: #0a0f0d;
  }
  .side h4 {
    font-family: var(--news-serif);
    font-weight: 700;
    font-size: 1rem;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .side h4 a {
    color: inherit;
    text-decoration: none;
  }
  .side h4 a:hover {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .smeta {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .more {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--accent);
    cursor: pointer;
  }
  .more:hover {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .foot {
    margin: 0;
  }
  .small {
    font-size: 0.85rem;
  }

  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
      gap: 20px;
    }
    .hero,
    .hero.skeleton {
      height: 290px;
    }
    /* On a phone the second photo only pushes the search box down: keep its headline, drop its picture. */
    .sphoto {
      display: none;
    }
    .side.skeleton {
      display: none;
    }
    .text {
      left: 18px;
      right: 18px;
      bottom: 42px;
    }
    .dots {
      left: 18px;
    }
    .arrow {
      top: 24%;
      width: 34px;
      height: 34px;
      font-size: 1.4rem;
    }
    .arrow.left {
      left: 10px;
    }
    .arrow.right {
      right: 10px;
    }
    .credit {
      max-width: 78%;
      right: 10px;
      top: 10px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .slide {
      animation: none;
    }
  }
</style>
