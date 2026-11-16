<script lang="ts">
  import { onMount } from "svelte";

  // The flowing colour is animated inside the SVG filter. CSS cannot switch that off, so for visitors who asked
  // their system for reduced motion the animation element is removed here.
  onMount(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) document.querySelector("#marble animate")?.remove();
  });

  const features = [
    { href: "/research", tone: "green", tag: "Research", title: "Company research", text: "Every claim linked to its source, with disagreements shown side by side." },
    { href: "/watch", tone: "cream", tag: "Watch", title: "Alerts without the noise", text: "Follow companies and see important events only. Repeated stories are merged, so one event is one alert." },
    { href: "/invest", tone: "teal", tag: "Invest Discovery", title: "Investment Ranking", text: "SIP mutual funds ranked by clear rules, with the reasons and risks for every pick. Stocks are coming soon." },
  ];
</script>

<svelte:head>
  <title>Verifin: every claim checked against its source</title>
  <meta name="description" content="Financial research where every claim is checked against its source." />
</svelte:head>

<section class="hero wrap">
  <h1>Every claim,<br />checked against its source.</h1>
  <p class="lead">
    Your trust is what our research is built on.<br />
    Every answer shows where it came from, so you can check it yourself.
  </p>
</section>

<section class="wrap block">
  <h2>Three tools, one engine</h2>
  <!-- The marbled colour of each card is made by bending soft colour blobs with this filter (no image files). -->
  <svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
    <filter id="marble" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.011 0.019" numOctaves="3" seed="7" result="noise">
        <!-- Slowly changes the swirl pattern, so the colour flows like liquid. -->
        <animate attributeName="baseFrequency" dur="22s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" values="0.011 0.019;0.017 0.012;0.011 0.019" />
      </feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="150" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
  <div class="stage">
    <div class="deck">
      {#each features as f}
        <a class="tile {f.tone}" href={f.href}>
          <div class="shader" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          <span class="dots" aria-hidden="true"></span>
          <span class="tag">{f.tag}</span>
          <div class="copy">
            <h3>{f.title}</h3>
            <p>{f.text}</p>
            <span class="go">Open {f.tag} &rarr;</span>
          </div>
        </a>
      {/each}
    </div>
  </div>
</section>

<style>
  /* The first screen holds only the headline. The tools section starts below it, so it appears on scroll. */
  .hero {
    text-align: center;
    min-height: calc(100svh - 74px); /* the full screen minus the header */
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding-block: 40px;
  }
  .lead {
    max-width: 640px;
    margin: 18px auto 0;
    color: var(--muted);
    font-size: 1.1rem;
  }
  h1 {
    margin-top: 10px;
  }
  /* The two big headings use the logo's style: thin, capital, widely spaced letters. */
  h1,
  .block h2 {
    font-family: var(--font-brand);
    font-weight: 300;
    text-transform: uppercase;
  }
  h1 {
    font-size: clamp(1.7rem, 4.4vw, 3.3rem);
    letter-spacing: 0.12em;
    line-height: 1.3;
    margin-right: -0.12em; /* cancels the trailing letter-spacing so the line stays centred */
  }
  .block h2 {
    font-size: clamp(1.3rem, 2.6vw, 1.75rem);
    letter-spacing: 0.16em;
  }
  .block {
    margin-top: 90px;
    display: grid;
    gap: 22px;
  }
  .defs {
    position: absolute;
  }

  /* ---------- the stage: a glowing green grid that fades into the page ---------- */
  .stage {
    position: relative;
    padding: 76px 24px;
    isolation: isolate;
  }
  .stage::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background:
      linear-gradient(rgb(255 255 255 / 7%) 1px, transparent 1px) 0 0 / 34px 34px,
      linear-gradient(90deg, rgb(255 255 255 / 7%) 1px, transparent 1px) 0 0 / 34px 34px,
      radial-gradient(ellipse 62% 72% at 50% 50%, #000000 0%, #000000 60%, #040806 100%);
    -webkit-mask-image: radial-gradient(ellipse 54% 50% at 50% 50%, #000 60%, transparent 100%);
    mask-image: radial-gradient(ellipse 54% 50% at 50% 50%, #000 60%, transparent 100%);
  }
  .deck {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 296px));
    gap: 30px;
    justify-content: center;
  }

  /* ---------- one card ---------- */
  .tile {
    --base: #4fb98a;
    --c1: #9be3c0;
    --c2: #1b8458;
    --c3: #cdeedd;
    --c4: #5ec99a;
    --ink: #ffffff;
    position: relative;
    display: block;
    aspect-ratio: 2 / 3;
    border-radius: 30px;
    overflow: hidden;
    background: var(--base);
    color: var(--ink);
    text-decoration: none;
    box-shadow: 0 24px 50px -22px rgb(8 60 40 / 55%), 0 2px 6px rgb(8 60 40 / 18%);
    transition: transform 0.25s ease, box-shadow 0.25s ease;
    animation: float 8s ease-in-out infinite;
  }
  /* The cards rise and settle one after another, like floating on water. (`translate` stacks with the hover lift.) */
  .tile:nth-child(2) {
    animation-delay: -2.6s;
  }
  .tile:nth-child(3) {
    animation-delay: -5.2s;
  }
  @keyframes float {
    0%,
    100% {
      translate: 0 0;
    }
    50% {
      translate: 0 -12px;
    }
  }
  .tile.cream {
    --base: #e1f3da;
    --c1: #f8fcea;
    --c2: #a6dcb8;
    --c3: #ffffff;
    --c4: #a3dabd;
    --ink: #12301f;
  }
  .tile.teal {
    --base: #46a597;
    --c1: #8fd9cb;
    --c2: #145f56;
    --c3: #bdeee3;
    --c4: #2d978a;
  }
  .tile:hover,
  .tile:focus-visible {
    transform: translateY(-7px);
    box-shadow: 0 32px 60px -22px rgb(8 60 40 / 60%), 0 2px 6px rgb(8 60 40 / 18%);
  }
  .tile:focus-visible {
    outline: 3px solid var(--ink);
    outline-offset: -6px;
  }

  /* the moving colour */
  .shader {
    position: absolute;
    inset: -14%;
    filter: url(#marble);
  }
  .shader i {
    position: absolute;
    border-radius: 50%;
    filter: blur(16px);
    animation: drift 11s ease-in-out infinite alternate;
  }
  .shader i:nth-child(1) {
    width: 95%;
    aspect-ratio: 1;
    top: -8%;
    left: -12%;
    background: radial-gradient(circle, var(--c1) 0%, transparent 62%);
  }
  .shader i:nth-child(2) {
    width: 90%;
    aspect-ratio: 1;
    bottom: -10%;
    right: -14%;
    background: radial-gradient(circle, var(--c2) 0%, transparent 64%);
    animation-duration: 20s;
    animation-direction: alternate-reverse;
  }
  .shader i:nth-child(3) {
    width: 70%;
    aspect-ratio: 1;
    top: 30%;
    right: -6%;
    background: radial-gradient(circle, var(--c3) 0%, transparent 60%);
    animation-duration: 13s;
  }
  .shader i:nth-child(4) {
    width: 66%;
    aspect-ratio: 1;
    bottom: 6%;
    left: -4%;
    background: radial-gradient(circle, var(--c4) 0%, transparent 62%);
    animation-duration: 18s;
    animation-direction: alternate-reverse;
  }
  .tile:hover .shader i {
    animation-duration: 5s;
  }
  @keyframes drift {
    from {
      transform: translate(-16%, -12%) scale(0.95) rotate(0deg);
    }
    to {
      transform: translate(18%, 14%) scale(1.35) rotate(60deg);
    }
  }

  /* fine grain, like frosted glass */
  .tile::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0.22;
    mix-blend-mode: soft-light;
    background-image: url("data:image/svg+xml;utf8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%27.9%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix values=%270 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E");
  }

  /* the dotted circle in the corner */
  .dots {
    position: absolute;
    top: 22px;
    right: 22px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    opacity: 0.85;
    background: radial-gradient(circle, currentColor 0.9px, transparent 1.4px) 0 0 / 5px 5px;
    -webkit-mask-image: radial-gradient(circle, #000 30%, transparent 74%);
    mask-image: radial-gradient(circle, #000 30%, transparent 74%);
    animation: turn 40s linear infinite;
  }
  @keyframes turn {
    to {
      transform: rotate(360deg);
    }
  }

  /* the words */
  .tag {
    position: absolute;
    top: 26px;
    left: 26px;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    opacity: 0.9;
  }
  .copy {
    position: absolute;
    left: 26px;
    right: 26px;
    bottom: 26px;
    display: grid;
    gap: 10px;
    text-shadow: 0 1px 14px rgb(0 40 25 / 22%);
  }
  .tile.cream .copy {
    text-shadow: none;
  }
  .copy h3 {
    font-family: var(--font-brand);
    font-weight: 700;
    font-size: clamp(1.8rem, 2.4vw, 2.35rem);
    line-height: 1.04;
    letter-spacing: -0.01em;
    text-transform: lowercase;
    color: inherit;
  }
  .copy p {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.45;
    opacity: 0.92;
    color: inherit;
  }
  .go {
    margin-top: 2px;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    opacity: 0.95;
  }
  .tile:hover .go {
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  @media (max-width: 1000px) {
    .deck {
      grid-template-columns: minmax(0, 330px);
    }
    .stage {
      padding: 44px 16px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tile {
      transition: none;
      animation: none;
    }
    .shader i,
    .dots {
      animation: none;
    }
  }
</style>
