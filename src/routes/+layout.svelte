<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";

  let { children } = $props();

  const links = [
    { href: "/news", label: "Daily news" },
    { href: "/research", label: "Research" },
    { href: "/watch", label: "Watch" },
    { href: "/invest", label: "Invest" },
  ];
</script>

<a class="skip" href="#main">Skip to content</a>

<header class="top">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="Verifin home">
      <span class="wordmark">Verifin</span>
    </a>
    <nav aria-label="Main">
      {#each links as l}
        <a href={l.href} aria-current={page.url.pathname.startsWith(l.href) ? "page" : undefined}>{l.label}</a>
      {/each}
    </nav>
  </div>
</header>

<main id="main">
  {@render children()}
</main>

<style>
  .skip {
    position: absolute;
    left: -999px;
    top: 8px;
    background: var(--brand);
    color: var(--brand-ink);
    padding: 8px 14px;
    border-radius: 8px;
    z-index: 10;
  }
  .skip:focus {
    left: 8px;
  }
  .top {
    position: sticky;
    top: 0;
    z-index: 5;
    backdrop-filter: blur(10px);
    background: color-mix(in srgb, var(--bg) 78%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-block: 12px;
    flex-wrap: wrap;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
    color: var(--text);
  }
  /* Thin, wide-spaced capitals: a light geometric sans, like the reference logo. */
  .wordmark {
    font-family: var(--font-brand);
    font-weight: 300;
    font-size: 1.6rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    line-height: 1;
    margin-right: -0.24em; /* cancels the trailing letter-spacing so the word stays visually centred */
  }
  nav {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  nav a {
    text-decoration: none;
    padding: 7px 13px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.93rem;
    color: var(--muted);
  }
  nav a:hover {
    background: var(--surface-soft);
    color: var(--text);
  }
  nav a[aria-current="page"] {
    background: var(--brand);
    color: var(--brand-ink);
  }
  main {
    min-height: 70vh;
    padding-bottom: 64px;
  }
</style>
