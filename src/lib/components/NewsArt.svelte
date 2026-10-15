<script lang="ts">
  /**
   * The tall picture for one story, in this order:
   *   1. the story's own photo, when the outlet supplied one and it loads;
   *   2. otherwise a photo of the story's topic (a stock exchange for a market story ...), labelled as an illustration,
   *      with its author and licence as the Wikimedia licences require;
   *   3. otherwise a plain dark panel with the outlet's name (no decoration pretending to be a photo).
   */
  type Topic = { url: string; credit: string; license: string; pageUrl: string; title: string };
  let { source, image, photo, small = false, compact = false }: { source: string; image?: string; photo?: Topic; small?: boolean; compact?: boolean } = $props();

  let imageBroken = $state(false);
  let photoBroken = $state(false);
  const showReal = $derived(Boolean(image) && !imageBroken);
  const showTopic = $derived(!showReal && Boolean(photo) && !photoBroken);
</script>

<div class="art" class:small class:compact>
  {#if showReal}
    <img src={image} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (imageBroken = true)} />
  {:else if showTopic && photo}
    <img src={photo.url} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (photoBroken = true)} />
    {#if !small}
      <span class="tag">Illustration</span>
      <p class="credit">
        Photo: {photo.credit}, {photo.license},
        <a href={photo.pageUrl} target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>
      </p>
    {/if}
  {:else if !small}
    <span class="outlet">{source}</span>
  {/if}
</div>

<style>
  .art {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    background: #151a18;
    color: #fff;
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .tag {
    position: absolute;
    top: 12px;
    left: 12px;
    padding: 3px 10px;
    border-radius: 999px;
    background: rgb(0 0 0 / 55%);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .credit {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    margin: 0;
    padding: 8px 12px;
    background: rgb(0 0 0 / 62%);
    font-size: 0.7rem;
    line-height: 1.35;
    color: #e6ebe8;
  }
  .credit a {
    color: #fff;
    text-underline-offset: 2px;
  }
  .compact .tag {
    top: 8px;
    left: 8px;
    padding: 2px 8px;
    font-size: 0.6rem;
  }
  .compact .credit {
    padding: 4px 8px;
    font-size: 0.6rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .compact .outlet {
    left: 14px;
    bottom: 12px;
    font-size: 1.2rem;
  }
  .outlet {
    position: absolute;
    left: 22px;
    bottom: 20px;
    font-family: var(--font-brand);
    font-weight: 300;
    font-size: 1.8rem;
  }
</style>
