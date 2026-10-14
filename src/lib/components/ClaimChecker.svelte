<script lang="ts">
  import type { VerifyResponse } from "$lib/types";

  const SOURCE =
    "Northwind Motors Ltd reported consolidated revenue of Rs 1,20,000 crore for FY2025, up 12.5% from FY2024. Net profit stood at Rs 17,500 crore. The company plans to open two new plants by 2027.";

  const samples = [
    { id: "ok", label: "Correct claim", claim: "Northwind Motors net profit stood at Rs 17,500 crore in FY2025", quote: "Net profit stood at Rs 17,500 crore" },
    { id: "num", label: "Wrong number", claim: "Northwind Motors net profit stood at Rs 27,500 crore in FY2025", quote: "Net profit stood at Rs 17,500 crore" },
    { id: "unit", label: "Unit mix-up", claim: "Northwind Motors net profit stood at 17,500 million in FY2025", quote: "Net profit stood at Rs 17,500 crore" },
    { id: "year", label: "Wrong year", claim: "Northwind Motors plans to open two new plants by 2030", quote: "plans to open two new plants by 2027" },
    { id: "fake", label: "Invented quote", claim: "Northwind Motors will pay a dividend of Rs 12 per share", quote: "The board recommended a dividend of Rs 12 per share" },
  ];

  let company = $state("Northwind Motors");
  let source = $state(SOURCE);
  let claim = $state(samples[0]!.claim);
  let quote = $state(samples[0]!.quote);
  let active = $state("ok");
  let loading = $state(false);
  let result = $state<VerifyResponse | null>(null);
  let error = $state("");

  function pick(s: (typeof samples)[number]) {
    active = s.id;
    claim = s.claim;
    quote = s.quote;
    result = null;
    error = "";
  }

  async function check() {
    loading = true;
    error = "";
    try {
      const res = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company, source, claim, quote }) });
      const data = await res.json();
      if (!res.ok) error = data.error ?? "Something went wrong.";
      else result = data;
    } catch {
      error = "Could not reach the server.";
    } finally {
      loading = false;
    }
  }
</script>

<div class="card checker">
  <div class="samples">
    <span class="muted label">Try an example</span>
    <div class="seg" role="group" aria-label="Example claims">
      {#each samples as s}
        <button type="button" aria-pressed={active === s.id} onclick={() => pick(s)}>{s.label}</button>
      {/each}
    </div>
  </div>

  <div class="fields">
    <label class="field">
      <span>Source text (what the document says)</span>
      <textarea bind:value={source} rows="4" oninput={() => (active = "")}></textarea>
    </label>
    <label class="field">
      <span>Claim to check (what someone wrote)</span>
      <textarea bind:value={claim} rows="2" oninput={() => (active = "")}></textarea>
    </label>
    <div class="two">
      <label class="field">
        <span>Quote the claim cites</span>
        <input type="text" bind:value={quote} oninput={() => (active = "")} />
      </label>
      <label class="field">
        <span>Company name</span>
        <input type="text" bind:value={company} />
      </label>
    </div>
  </div>

  <button class="btn" type="button" onclick={check} disabled={loading}>
    {#if loading}<span class="spinner"></span> Checking...{:else}Check this claim &rarr;{/if}
  </button>

  {#if error}<p class="notice bad" role="alert">{error}</p>{/if}

  {#if result}
    <div class="result" aria-live="polite">
      <div class="notice" class:good-b={result.passed} class:bad-b={!result.passed}>
        {#if result.passed}
          <b>Passes the code checks.</b> In the full pipeline an AI judge now reads the passage, and only if it agrees is the claim called <i>Verified</i>.
        {:else}
          <b>Rejected: this claim cannot be verified.</b> The AI can not rescue a claim that fails these checks.
        {/if}
      </div>
      <ul class="checks">
        {#each result.checks as c}
          <li>
            <span class="mark" class:ok={c.passed} aria-hidden="true">{c.passed ? "✓" : "✕"}</span>
            <div>
              <b>{c.label}</b>
              <span class="sr-only">{c.passed ? "passed" : "failed"}</span>
              <p class="muted">{c.detail}</p>
            </div>
          </li>
        {/each}
      </ul>
      {#if result.context}
        <p class="muted ctx-label">Where the quote was found:</p>
        <p class="ctx">&hellip;{result.context.before}<mark>{result.context.match}</mark>{result.context.after}&hellip;</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .checker {
    display: grid;
    gap: 16px;
    padding: 22px;
    text-align: left;
  }
  .label {
    font-size: 0.82rem;
    font-weight: 700;
    margin-right: 8px;
  }
  .samples {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .fields {
    display: grid;
    gap: 12px;
  }
  .two {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 12px;
  }
  @media (max-width: 640px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
  .btn {
    justify-self: stretch;
    padding: 15px;
    font-size: 1.05rem;
  }
  .result {
    display: grid;
    gap: 12px;
    border-top: 1px dashed var(--line);
    padding-top: 16px;
  }
  .good-b {
    background: var(--good-soft);
    border-color: transparent;
    color: var(--good);
  }
  .bad-b {
    background: var(--bad-soft);
    border-color: transparent;
    color: var(--bad);
  }
  .checks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .checks li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .mark {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 800;
    background: var(--bad-soft);
    color: var(--bad);
  }
  .mark.ok {
    background: var(--good-soft);
    color: var(--good);
  }
  .checks p {
    font-size: 0.9rem;
  }
  .ctx-label {
    font-size: 0.82rem;
    font-weight: 700;
  }
  .ctx {
    background: var(--surface-soft);
    border-radius: var(--radius-sm);
    padding: 12px 14px;
    font-size: 0.92rem;
    line-height: 1.7;
  }
</style>
