<script lang="ts">
  import { onMount } from "svelte";
  import IndiaNews from "$lib/components/IndiaNews.svelte";
  import { bestQuoteFor, relatedStories } from "$engine/claims/related.ts";
  import { approxEqual, extractNumbers } from "$engine/lib/numbers.ts";
  import { eventLabel, formatDate, timeAgo, tierLabel, tierTone } from "$lib/format";
  import type { AskResponse, DocumentText, EvidenceResponse, EvidenceSource, StoryView } from "$lib/types";

  // ---------- what the user is looking at ----------
  // What is typed in the box (a name, a question or a claim), and the company the briefing is for.
  let query = $state("");
  let company = $state("");
  // The official answer to a question or claim, when the box held one.
  let ask = $state<AskResponse | null>(null);
  // Fixed settings (the filter controls were removed): most important first, recognised sources only.
  // A plain briefing covers the last 7 days; a question or claim looks back 30 days, because results pages are not always new.
  let days = $state(7);
  // True once the user asks to see every story about the company instead of only those related to their search.
  let showEverything = $state(false);
  const recognisedOnly: boolean = true;
  let loading = $state(false);
  let evidence = $state<EvidenceResponse | null>(null);
  let error = $state("");
  let showAll = $state(false);
  let open = $state<Record<string, boolean>>({});
  let copied = $state<string | null>(null);

  // The reader panel (full article beside the list)
  let dlg = $state<HTMLDialogElement>();
  let reader = $state<{ item: EvidenceSource; loading: boolean; doc?: DocumentText } | null>(null);
  const docCache: Record<string, DocumentText> = {};

  // ---------- what we remember about this visitor (kept in this browser only) ----------
  const KEYS = { followed: "verifin.research.followed", recents: "verifin.research.recents", visits: "verifin.research.visits", last: "verifin.research.last" };
  type Visit = { at: number; seen: string[] };
  let followed = $state<string[]>([]);
  let recents = $state<string[]>([]);
  let visits: Record<string, Visit> = {};
  let newKeys = $state<Set<string>>(new Set());
  let lastVisitAt = $state<number | undefined>(undefined);

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
  const norm = (s: string) => s.trim().toLowerCase();

  onMount(() => {
    followed = read<string[]>(KEYS.followed, []);
    recents = read<string[]>(KEYS.recents, []);
    visits = read<Record<string, Visit>>(KEYS.visits, {});
    const start = read<string>(KEYS.last, "") || followed[0] || "";
    if (start) {
      query = company = start;
      gather();
    }
  });

  // ---------- wording ----------
  const trustText: Record<StoryView["trust"], { label: string; tone: string; level: number; help: string }> = {
    well_reported: { label: "Well reported", tone: "good", level: 4, help: "Covered by 3 or more separate outlets, including at least one major outlet." },
    major_outlet: { label: "Major outlet", tone: "info", level: 3, help: "A major outlet covered it, but fewer than 3 separate outlets did." },
    single_outlet: { label: "Single outlet", tone: "warn", level: 2, help: "Only one recognised outlet covered it so far. Treat it with care." },
    weak_only: { label: "Not recognised", tone: "warn", level: 1, help: "Only social posts, forums or publishers we do not recognise covered it." },
  };
  const tierRank = { primary: 3, wire: 2, trade: 1, unknown: 0 } as const;

  // ---------- derived views ----------
  const counts = $derived.by(() => {
    const c = { announcement: 0, annual_report: 0, news: 0 };
    for (const s of evidence?.sources ?? []) c[s.kind]++;
    return c;
  });

  /** Stories from social posts, forums and unrecognised publishers are left out. */
  const afterRecognised = $derived.by(() => {
    const all = evidence?.stories ?? [];
    return recognisedOnly ? all.filter((s) => s.trust !== "weak_only") : all;
  });
  /** For a question or claim: only the stories about what was asked (plain scoring, see related.ts). */
  const searchInput = $derived(
    ask?.search ? { company, terms: ask.search.terms, keywords: ask.search.keywords, year: ask.search.year, numbers: ask.claimNumbers ?? [] } : undefined,
  );
  const related = $derived(searchInput ? relatedStories(afterRecognised, searchInput, 6) : []);
  /** The words shown under a headline. For a question or claim, the outlet text that fits the search best. */
  const quoteOf = (s: StoryView) => (searchInput ? bestQuoteFor(s, searchInput) : undefined) ?? s.quote;
  /** True while only the related stories are shown. */
  const focused = $derived(Boolean(ask?.search) && !showEverything);
  const shown = $derived(focused ? related : afterRecognised);
  const visible = $derived(showAll ? shown : shown.slice(0, 12));

  const isFollowed = $derived(followed.some((f) => norm(f) === norm(company)));
  const newCount = $derived(afterRecognised.filter((s) => newKeys.has(s.key)).length);

  // ---------- small helpers ----------
  const initials = (name: string) =>
    name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

  function outlets(s: StoryView) {
    const seen = new Map<string, { name: string; tier: EvidenceSource["tier"] }>();
    for (const i of itemsOf(s)) {
      const name = i.publisher ?? "Unknown";
      const k = name.toLowerCase();
      const cur = seen.get(k);
      if (!cur || tierRank[i.tier] > tierRank[cur.tier]) seen.set(k, { name, tier: i.tier });
    }
    return [...seen.values()].sort((a, b) => tierRank[b.tier] - tierRank[a.tier]);
  }
  const itemsOf = (s: StoryView) => (recognisedOnly ? s.items.filter((i) => !i.weak) : s.items);
  const timeline = (s: StoryView) => [...itemsOf(s)].sort((a, b) => (a.publishedAt ?? Infinity) - (b.publishedAt ?? Infinity));

  function whyLabel(s: StoryView): string {
    const majors = outlets(s).filter((o) => o.tier === "primary" || o.tier === "wire").map((o) => o.name);
    if (s.trust === "well_reported") return `Covered by ${s.trustedOutlets} separate outlets, including ${majors.slice(0, 3).join(", ")}.`;
    if (s.trust === "major_outlet") return `Covered by ${majors.slice(0, 3).join(" and ")}. Fewer than 3 separate outlets so far.`;
    if (s.trust === "single_outlet") return "Only one recognised outlet has covered it so far.";
    return "Only social posts, forums or publishers we do not recognise have covered it.";
  }

  /** Splits a quote so numbers can be shown in bold. Nothing is changed or removed. */
  function parts(text: string): Array<{ t: string; n: boolean }> {
    const out: Array<{ t: string; n: boolean }> = [];
    let idx = 0;
    for (const m of extractNumbers(text)) {
      // Only numbers that mean something: percentages, money, units (crore, million), decimals, large figures.
      const meaningful = m.isPercent || m.scaled || /[₹$€£.,]|\b(rs|inr|usd|eur)\b/i.test(m.raw) || m.value >= 1000;
      if (!meaningful) continue;
      const at = text.indexOf(m.raw, idx);
      if (at < 0) continue;
      // Skip fragments of codes and ranges such as "H-1B" or "2-3".
      if (at > 0 && /[A-Za-z]-$/.test(text.slice(Math.max(0, at - 2), at))) continue;
      if (at > idx) out.push({ t: text.slice(idx, at), n: false });
      out.push({ t: m.raw, n: true });
      idx = at + m.raw.length;
    }
    if (idx < text.length) out.push({ t: text.slice(idx), n: false });
    return out;
  }

  const isGoogle = (i: EvidenceSource) => i.url.includes("news.google.com");
  const canReadFull = (i: EvidenceSource) => Boolean(evidence?.canReadArticles) && !isGoogle(i) && i.kind === "news" && !i.weak;

  // ---------- actions ----------
  /** Reads the box: a company name goes straight to the briefing; a question or claim is answered first. */
  async function submit() {
    const text = query.trim();
    if (!text) return;
    loading = true;
    error = "";
    ask = null;
    showEverything = false;
    try {
      const res = await fetch(`/api/ask?q=${encodeURIComponent(text)}`);
      const a: AskResponse = await res.json();
      if (a.error) {
        error = a.error;
        loading = false;
        return;
      }
      ask = a.kind === "company" ? null : a;
      company = a.company;
    } catch {
      error = "Could not reach the server. Check that the website is still running.";
      loading = false;
      return;
    }
    await gather();
  }

  /** Does this story mention a figure from the user's sentence (for example "50%")? */
  function mentionsFigure(s: StoryView): boolean {
    const nums = ask?.claimNumbers;
    if (!nums?.length) return false;
    const found = extractNumbers(`${s.head.title} ${quoteOf(s)?.text ?? ""}`);
    return nums.some((n) => found.some((f) => f.isPercent === n.isPercent && approxEqual(f.value, n.value)));
  }
  const mentionCount = $derived(ask?.claimNumbers?.length ? shown.filter(mentionsFigure).length : 0);

  const fitText = { match: { label: "Matches", tone: "good" }, close: { label: "Close", tone: "warn" }, differs: { label: "Does not match", tone: "bad" } } as const;

  async function gather(scrip?: string) {
    const name = company.trim();
    if (!name) return;
    loading = true;
    error = "";
    open = {};
    showAll = false;
    showEverything = false;
    // A question or claim searches for the company AND its topic, so the stories about it are found.
    const focus = ask?.search?.focus ?? "";
    days = ask?.search ? 30 : 7;
    try {
      const res = await fetch(`/api/evidence?company=${encodeURIComponent(name)}&days=${days}${scrip ? `&scrip=${scrip}` : ""}${focus ? `&focus=${encodeURIComponent(focus)}` : ""}`);
      const d = await res.json();
      if (d.error) {
        error = d.error;
        evidence = null;
      } else {
        evidence = d;
        // A focused search is not the company's usual briefing, so it does not change "new since your last visit".
        if (!ask?.search) remember(name, d);
      }
    } catch {
      error = "Could not reach the server. Check that the website is still running.";
    } finally {
      loading = false;
    }
  }

  /** Work out what is new since the last visit, then save this visit. */
  function remember(name: string, d: EvidenceResponse) {
    const key = norm(name);
    const before = visits[key];
    lastVisitAt = before?.at;
    newKeys = before ? new Set(d.stories.filter((s) => !before.seen.includes(s.key)).map((s) => s.key)) : new Set();
    const seen = [...new Set([...(before?.seen ?? []), ...d.stories.map((s) => s.key)])].slice(-500);
    visits = { ...visits, [key]: { at: Date.now(), seen } };
    write(KEYS.visits, visits);
    recents = [name, ...recents.filter((r) => norm(r) !== key)].slice(0, 8);
    write(KEYS.recents, recents);
    write(KEYS.last, name);
  }

  function toggleFollow() {
    const name = company.trim();
    followed = isFollowed ? followed.filter((f) => norm(f) !== norm(name)) : [...followed, name].slice(0, 12);
    write(KEYS.followed, followed);
  }

  const pick = (name: string) => {
    query = company = name;
    ask = null;
    gather();
  };
  const tryQuery = (text: string) => {
    query = text;
    submit();
  };
  /** Clicking empty space on a card opens or closes its details (links and buttons keep their own action). */
  function cardClick(e: MouseEvent, key: string) {
    if ((e.target as HTMLElement).closest("a,button,input,label")) return;
    open[key] = !open[key];
  }

  async function copyQuote(s: StoryView) {
    const q = quoteOf(s);
    if (!q) return;
    const text = `“${q.text}” — ${q.publisher ?? "source"}${q.publishedAt ? `, ${formatDate(q.publishedAt)}` : ""}. ${q.url}`;
    let done = false;
    try {
      await navigator.clipboard.writeText(text);
      done = true;
    } catch {
      // The modern clipboard can be blocked (for example inside a preview): fall back to the older way.
      const box = document.createElement("textarea");
      box.value = text;
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      try {
        done = document.execCommand("copy");
      } catch {
        done = false;
      }
      box.remove();
    }
    copied = done ? s.key : null;
    if (done) setTimeout(() => (copied = copied === s.key ? null : copied), 1800);
  }

  async function openReader(item: EvidenceSource) {
    reader = { item, loading: true };
    dlg?.showModal();
    const cached = docCache[item.url];
    if (cached) {
      reader = { item, loading: false, doc: cached };
      return;
    }
    try {
      const res = await fetch(`/api/document?kind=article&url=${encodeURIComponent(item.url)}`);
      const doc: DocumentText = await res.json();
      docCache[item.url] = doc;
      if (reader?.item.url === item.url) reader = { item, loading: false, doc };
    } catch {
      if (reader?.item.url === item.url) reader = { item, loading: false, doc: { text: "", truncated: false, chars: 0, error: "Could not reach the server." } };
    }
  }

  const suggestions = ["Tata Motors", "Reliance Industries", "Infosys", "Apple"];
  const examples = ["Oracle last year profit", "Oracle had a profit of 50%", "Apple revenue in 2024"];
</script>

<svelte:head><title>Research any company · Verifin</title></svelte:head>

<div class="wrap page">
  <header class="head">
    <p class="eyebrow">Verifin Research</p>
    <h1>Research any company</h1>
    <p class="muted lead">Type a company name for a briefing, ask a question like “Oracle last year profit”, or paste a claim you saw, like “Oracle had a profit of 50%”, to check it against the company's official figures.</p>
  </header>

  <IndiaNews />

  <form class="card form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <label class="field grow">
      <span>Company, question or claim</span>
      <input type="text" bind:value={query} maxlength="300" placeholder="e.g. Reliance Industries, or Oracle had a profit of 50%" />
    </label>
    <button class="btn" type="submit" disabled={loading}>
      {#if loading}<span class="spinner"></span> Working...{:else}Search &rarr;{/if}
    </button>
  </form>

  {#if !ask && !evidence}
    <div class="yours">
      <span class="lbl">Or ask</span>
      {#each examples as ex}<button class="chip pick" type="button" onclick={() => tryQuery(ex)}>{ex}</button>{/each}
    </div>
  {/if}

  {#if followed.length || recents.length || !evidence}
    <div class="yours">
      {#if followed.length}
        <span class="lbl">Following</span>
        {#each followed as f}<button class="chip pick" type="button" onclick={() => pick(f)}>★ {f}</button>{/each}
      {/if}
      {#if recents.filter((r) => !followed.some((f) => norm(f) === norm(r))).length}
        <span class="lbl">Recent</span>
        {#each recents.filter((r) => !followed.some((f) => norm(f) === norm(r))).slice(0, 5) as r}<button class="chip pick" type="button" onclick={() => pick(r)}>{r}</button>{/each}
      {/if}
      {#if !followed.length && !recents.length}
        <span class="lbl">Try</span>
        {#each suggestions as s}<button class="chip pick" type="button" onclick={() => pick(s)}>{s}</button>{/each}
      {/if}
    </div>
  {/if}

  {#if error}<p class="notice bad" role="alert">{error}</p>{/if}
  {#if ask?.note}<p class="notice warn" role="status">{ask.note}</p>{/if}

  {#if ask?.answer}
    {@const a = ask.answer}
    {@const compared = a.checks.some((c) => c.claimed)}
    <section class="card answer" aria-live="polite">
      <div class="a-head">
        <span class="eyebrow">{ask.kind === "claim" ? "Claim check" : "Official answer"}</span>
        {#if a.verdictLabel}<span class="verdict v-{a.verdict}">{a.verdictLabel}</span>{/if}
      </div>
      {#if ask.kind === "claim"}<p class="you muted">You wrote: &ldquo;{ask.query}&rdquo;</p>{/if}
      <h2 class="a-title">{a.headline}</h2>
      {#each a.details as d}<p class="a-detail">{d}</p>{/each}

      {#if a.checks.length}
        <div class="tablewrap">
          <table class="checks">
            <thead>
              <tr>
                <th>What was compared</th>
                {#if compared}<th>You wrote</th>{/if}
                <th>Official figure</th>
                {#if compared}<th>Result</th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each a.checks as c}
                <tr>
                  <td>{c.label}{#if c.note}<div class="muted small">{c.note}</div>{/if}</td>
                  {#if compared}<td>{c.claimed ?? "–"}</td>{/if}
                  <td><b>{c.official}</b></td>
                  {#if compared}
                    <td>{#if c.fit !== "info"}<span class="chip {fitText[c.fit].tone}">{fitText[c.fit].label}</span>{:else}<span class="muted small">Not compared</span>{/if}</td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if a.period && ask.record}
        <p class="source small">
          <b>Source:</b> {ask.record.name}{ask.record.ticker ? " (" + ask.record.ticker + ")" : ""} annual report (Form 10-K), filed {a.period.filedOn} with the US SEC.
          <a href={a.period.url} target="_blank" rel="noopener noreferrer">Open the filing ↗</a> ·
          <a href={ask.record.filingsUrl} target="_blank" rel="noopener noreferrer">All annual reports ↗</a>
        </p>
        {#if ask.record.how === "close"}
          <p class="muted small">We matched “{ask.company}” to {ask.record.name}. If you meant a different company, type its full name.</p>
        {/if}
      {/if}

      {#if a.table}
        <details class="years">
          <summary>See the last {a.table.columns.length} years</summary>
          <div class="tablewrap">
            <table class="checks">
              <thead><tr><th></th>{#each a.table.columns as c}<th>{c}</th>{/each}</tr></thead>
              <tbody>
                {#each a.table.rows as r}<tr><td>{r.label}</td>{#each r.cells as cell}<td>{cell}</td>{/each}</tr>{/each}
              </tbody>
            </table>
          </div>
        </details>
      {/if}

      {#if a.notes.length}
        <ul class="a-notes muted small">{#each a.notes as n}<li>{n}</li>{/each}</ul>
      {/if}
    </section>
  {:else if ask?.unavailable}
    <section class="card answer" aria-live="polite">
      <div class="a-head">
        <span class="eyebrow">{ask.kind === "claim" ? "Claim check" : "Official answer"}</span>
        <span class="verdict v-unknown">{ask.unavailable.label ?? "Can't confirm"}</span>
      </div>
      {#if ask.kind === "claim"}<p class="you muted">You wrote: &ldquo;{ask.query}&rdquo;</p>{/if}
      <h2 class="a-title">{ask.unavailable.title ?? "We could not check this against official filings."}</h2>
      <p class="a-detail">{ask.unavailable.reason}</p>
    </section>
  {/if}

  {#if loading && !evidence}
    <div class="card"><span class="spinner"></span> Gathering sources for {company}. This takes a few seconds the first time, and is instant when repeated.</div>
  {/if}

  {#if evidence}
    {#if !focused}
    <section class="card summary">
      <div class="sum-top">
        <div>
          <span class="eyebrow">Briefing</span>
          <h2>{evidence.company}</h2>
          {#if evidence.match}<p class="muted small">Listed as {evidence.match.name} ({evidence.match.symbol})</p>{/if}
        </div>
        <button class="btn ghost small" type="button" aria-pressed={isFollowed} onclick={toggleFollow}>{isFollowed ? "★ Following" : "☆ Follow this company"}</button>
      </div>
      <p>
        Built from <b>{evidence.coverage.items} items</b> by <b>{evidence.coverage.publishers} publishers</b>, grouped into
        <b>{evidence.coverage.stories} stories</b>, covering the last {days === 1 ? "24 hours" : `${days} days`}.
        {#if evidence.coverage.newest}Newest item: {timeAgo(evidence.coverage.newest)}.{/if}
        {#if evidence.coverage.undated}<span class="muted"> {evidence.coverage.undated} items did not give a date.</span>{/if}
      </p>
      {#if lastVisitAt}
        <p class="visit">
          {#if newCount > 0}<span class="chip good">{newCount} new</span> {newCount === 1 ? "story" : "stories"} since your last visit ({timeAgo(lastVisitAt)}).
          {:else}Nothing new since your last visit ({timeAgo(lastVisitAt)}).{/if}
        </p>
      {/if}
      {#if evidence.candidates.length > 1}
        <div>
          <p class="muted small">Could mean a different listed company? Pick one:</p>
          <div class="chips">
            {#each evidence.candidates.filter((c) => c.scripCode !== evidence?.match?.scripCode) as c}
              <button class="chip pick" type="button" onclick={() => gather(c.scripCode)}>{c.name}</button>
            {/each}
          </div>
        </div>
      {/if}
    </section>

    <div class="stats">
      <div class="card stat"><b>{counts.announcement}</b><span>official filings (last 90 days)</span></div>
      <div class="card stat"><b>{counts.annual_report}</b><span>annual reports</span></div>
      <div class="card stat"><b>{counts.news}</b><span>news items</span></div>
      <div class="card stat"><b>{evidence.stories.length}</b><span>separate stories (copies grouped)</span></div>
    </div>
    {/if}

    <section class="stories" aria-live="polite">
      <h2>{focused ? "News about your search" : ask ? `All news about ${company}` : "What is happening"}</h2>
      {#if ask?.search}
        <p class="muted small scope">
          {#if focused}
            Showing {related.length} of the {afterRecognised.length} stories we found about {company}: only those that match your search.
            <button class="link" type="button" onclick={() => (showEverything = true)}>Show all news about {company}</button>
          {:else}
            Showing every story we found about {company}.
            <button class="link" type="button" onclick={() => (showEverything = false)}>Show only what matches my search</button>
          {/if}
        </p>
      {/if}
      {#if ask?.claimNumbers?.length && shown.length}
        <p class="muted small">
          {#if mentionCount}{mentionCount} {mentionCount === 1 ? "story mentions" : "stories mention"} a figure from your sentence (marked). A story that repeats a number is not proof that it is right.
          {:else}No story below mentions a figure from your sentence.{/if}
        </p>
      {/if}

      {#each visible as s (s.key)}
          {@const trust = trustText[s.trust]}
          {@const outs = outlets(s)}
          {@const single = itemsOf(s).length === 1}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <article class="card story" class:fresh={newKeys.has(s.key)} class:expanded={open[s.key]} onclick={(e) => cardClick(e, s.key)}>
            <div class="story-top">
              <span class="chip info">{eventLabel[s.type] ?? s.type}</span>
              {#if newKeys.has(s.key)}<span class="chip good">New</span>{/if}
              {#if mentionsFigure(s)}<span class="chip warn">Mentions your figure</span>{/if}
            </div>

            <h3 class="headline"><a href={s.head.url} target="_blank" rel="noopener noreferrer">{s.head.title}</a></h3>

            {#if quoteOf(s)}
              {@const q = quoteOf(s)!}
              <blockquote>
                <p>
                  &ldquo;{#each parts(q.text) as p}{#if p.n}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}&rdquo;
                </p>
                <footer>
                  <span>— <b>{q.publisher ?? "the publisher"}</b>{q.publishedAt ? `, ${formatDate(q.publishedAt)}` : ""}</span>
                  <span class="acts">
                    <a href={q.url} target="_blank" rel="noopener noreferrer">Open source ↗</a>
                    <button type="button" onclick={() => copyQuote(s)}>{copied === s.key ? "Copied ✓" : "Copy quote"}</button>
                  </span>
                </footer>
              </blockquote>
            {/if}

            <div class="cover">
              <div class="avatars" aria-label="Outlets">
                {#each outs.slice(0, 8) as o}
                  <span class="av t-{o.tier}" title="{o.name} · {tierLabel[o.tier]}">{initials(o.name)}</span>
                {/each}
                {#if outs.length > 8}<span class="av more-av" title={outs.slice(8).map((o) => o.name).join(", ")}>+{outs.length - 8}</span>{/if}
              </div>
              <p class="cover-text"><b>{outs.length} {outs.length === 1 ? "outlet" : "outlets"}</b><span class="muted"> · {outs.slice(0, 3).map((o) => o.name).join(", ")}{outs.length > 3 ? " …" : ""}</span></p>

              <div class="row-acts">
                {#if single}
                  {#if canReadFull(itemsOf(s)[0]!)}<button class="btn small" type="button" onclick={() => openReader(itemsOf(s)[0]!)}>Read the article</button>{/if}
                  <a class="btn ghost small" href={itemsOf(s)[0]!.url} target="_blank" rel="noopener noreferrer">Open original ↗</a>
                {:else}
                  <button class="btn ghost small" type="button" aria-expanded={open[s.key] ?? false} onclick={() => (open[s.key] = !open[s.key])}>
                    {open[s.key] ? "Hide details" : `How it was reported (${itemsOf(s).length})`} <span class="chev" class:up={open[s.key]}>▾</span>
                  </button>
                {/if}
              </div>
            </div>

            {#if !single}
              <div class="panel" class:open={open[s.key]}>
                <div class="panel-in">
                  <p class="why"><b>Why “{trust.label}”?</b> {whyLabel(s)}</p>
                  <ol class="timeline">
                    {#each timeline(s) as i, n (i.url)}
                      <li>
                        <span class="dot t-{i.tier}"></span>
                        <div>
                          <div class="small muted">
                            {i.publishedAt ? `${formatDate(i.publishedAt)}, ${timeAgo(i.publishedAt)}` : "date not given"}{n === 0 && i.publishedAt ? " · first reported" : ""}
                          </div>
                          <a href={i.url} target="_blank" rel="noopener noreferrer">{i.title}</a>
                          <div class="small">
                            <b>{i.publisher ?? "unknown"}</b>
                            <span class="chip {tierTone[i.tier]}">{tierLabel[i.tier]}</span>
                            {#if canReadFull(i)}<button class="link" type="button" onclick={() => openReader(i)}>Read here</button>{/if}
                          </div>
                        </div>
                      </li>
                    {/each}
                  </ol>
                </div>
              </div>
            {/if}
          </article>
      {:else}
        {#if focused}
          <p class="notice">None of the stories we could find mention what you searched for. That does not mean it is false. It means these sources do not cover it.</p>
        {:else}
          <p class="notice">No stories from recognised sources were found for this company in the last {days} days.</p>
        {/if}
      {/each}

      {#if shown.length > 12 && !showAll}
        <button class="btn ghost" type="button" onclick={() => (showAll = true)}>Show {shown.length - 12} more stories</button>
      {/if}
    </section>

    {#if !focused}
    <details class="card">
      <summary>Every source in one list ({evidence.sources.length})</summary>
      <p class="muted small">Retrieved {timeAgo(evidence.fetchedAt)}. The fingerprint is a short hash of the saved text, so any later change can be detected.</p>
      <div class="scroll-x">
        <table>
          <thead><tr><th>Title</th><th>Source</th><th>Published</th><th>Story</th><th>Fingerprint</th></tr></thead>
          <tbody>
            {#each evidence.sources.slice(0, 120) as s (s.url)}
              <tr>
                <td><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></td>
                <td>{s.publisher ?? "unknown"}<br /><span class="chip {tierTone[s.tier]}">{s.weak ? "Social or forum" : tierLabel[s.tier]}</span></td>
                <td class="nowrap">{s.publishedAt ? formatDate(s.publishedAt) : "date not given"}</td>
                <td>#{s.origin}</td>
                <td class="mono">{s.fingerprint}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
    {/if}
  {/if}

  <p class="muted small more">Curious what the finished product will look like? <a href="/research/example">See an example report (fictional company)</a>.</p>
</div>

<!-- The reader: full article beside the list. Esc or a click outside closes it. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dlg} class="reader" aria-label="Article reader" onclose={() => (reader = null)} onclick={(e) => e.target === dlg && dlg?.close()}>
  {#if reader}
    <header>
      <div>
        <span class="chip {tierTone[reader.item.tier]}">{tierLabel[reader.item.tier]}</span>
        <p class="small muted">{reader.item.publisher ?? "unknown"} · {reader.item.publishedAt ? formatDate(reader.item.publishedAt) : "date not given"}</p>
        <h2>{reader.item.title}</h2>
      </div>
      <button class="x" type="button" onclick={() => dlg?.close()} aria-label="Close the reader">×</button>
    </header>
    <div class="body">
      {#if reader.loading}
        <p><span class="spinner"></span> Reading the article...</p>
      {:else if reader.doc?.error}
        <p class="notice bad">Could not read it here: {reader.doc.error}</p>
      {:else if reader.doc}
        {#each reader.doc.text.split("\n\n") as para}<p>{para}</p>{/each}
        {#if reader.doc.truncated}<p class="muted small">This is the first part of a longer article ({reader.doc.chars.toLocaleString("en-IN")} characters). Open the original to read the rest.</p>{/if}
      {/if}
    </div>
    <footer>
      <p class="small muted">Text is shown as published, with page menus and images removed.</p>
      <a class="btn small" href={reader.item.url} target="_blank" rel="noopener noreferrer">Open original ↗</a>
    </footer>
  {/if}
</dialog>

<style>
  .answer {
    display: grid;
    gap: 12px;
    padding: 22px 24px;
    border-width: 2px;
  }
  .a-head {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .a-title {
    font-size: 1.45rem;
    line-height: 1.3;
  }
  .a-detail,
  .you {
    margin: 0;
  }
  .verdict {
    font-weight: 800;
    font-size: 0.85rem;
    padding: 5px 14px;
    border-radius: 999px;
    border: 1px solid transparent;
  }
  .v-correct {
    background: var(--good-soft);
    color: var(--good);
    border-color: var(--good);
  }
  .v-close,
  .v-partly {
    background: var(--warn-soft);
    color: var(--warn);
    border-color: var(--warn);
  }
  .v-wrong {
    background: var(--bad-soft);
    color: var(--bad);
    border-color: var(--bad);
  }
  .v-unknown {
    background: var(--info-soft);
    color: var(--info);
    border-color: var(--info);
  }
  .tablewrap {
    overflow-x: auto;
  }
  .checks {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }
  .checks th {
    text-align: left;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .checks td {
    padding: 10px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  .source {
    margin: 0;
  }
  .years summary {
    cursor: pointer;
    font-weight: 700;
    padding: 4px 0;
  }
  .a-notes {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 4px;
  }
  .page {
    padding-top: 40px;
    display: grid;
    gap: 20px;
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
  .form {
    display: flex;
    gap: 14px;
    align-items: end;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
    min-width: 240px;
  }
  .yours {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .lbl {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-right: 2px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .pick {
    cursor: pointer;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 700;
    border: 1px solid var(--line);
    min-height: 34px;
  }
  .pick:hover {
    background: var(--accent-soft);
  }
  .pick.on {
    background: var(--brand);
    color: var(--brand-ink);
    border-color: var(--brand);
  }
  .summary {
    display: grid;
    gap: 12px;
  }
  .sum-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
    flex-wrap: wrap;
  }
  .visit {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 14px;
  }
  .stat {
    display: grid;
    gap: 2px;
    padding: 16px 18px;
  }
  .stat b {
    font-family: var(--font-serif);
    font-size: 2rem;
    font-weight: 500;
  }
  .stat span {
    color: var(--muted);
    font-size: 0.86rem;
  }

  /* ---------- story cards ---------- */
  .stories {
    display: grid;
    gap: 14px;
  }
  .story {
    display: grid;
    gap: 12px;
    padding: 18px 20px;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .story:hover {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
  }
  .story.fresh {
    border-color: var(--accent);
  }
  .story.expanded {
    box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow);
  }
  .story-top {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .headline {
    font-size: 1.25rem;
  }
  .headline a {
    text-decoration: none;
  }
  .headline a:hover {
    text-decoration: underline;
  }
  blockquote {
    margin: 0;
    padding: 12px 16px;
    border-left: 4px solid var(--accent);
    background: var(--surface-soft);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    display: grid;
    gap: 8px;
    cursor: default;
  }
  blockquote p {
    font-size: 1.02rem;
    line-height: 1.6;
  }
  blockquote mark {
    font-weight: 800;
    font-style: normal;
    background: var(--accent-soft);
    padding: 0 3px;
  }
  blockquote footer {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 0.84rem;
    color: var(--muted);
  }
  .acts {
    display: inline-flex;
    gap: 14px;
    align-items: center;
  }
  .acts a,
  .acts button,
  .link {
    font: inherit;
    font-size: 0.84rem;
    font-weight: 700;
    color: var(--accent);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-decoration: none;
  }
  .acts a:hover,
  .acts button:hover,
  .link:hover {
    text-decoration: underline;
  }
  .cover {
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
  }
  .avatars {
    display: flex;
  }
  .av {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.72rem;
    font-weight: 800;
    margin-left: -8px;
    border: 2px solid var(--surface);
    background: var(--surface-soft);
    color: var(--text);
    box-shadow: 0 0 0 1.5px var(--line);
  }
  .av:first-child {
    margin-left: 0;
  }
  .av.t-primary,
  .av.t-wire {
    box-shadow: 0 0 0 2px var(--good);
  }
  .av.t-trade {
    box-shadow: 0 0 0 2px var(--info);
  }
  .av.t-unknown {
    box-shadow: 0 0 0 2px var(--warn);
  }
  .more-av {
    background: var(--line);
    color: var(--muted);
    box-shadow: none;
  }
  .cover-text {
    flex: 1;
    min-width: 160px;
    font-size: 0.9rem;
  }
  .row-acts {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-left: auto;
  }
  .chev {
    display: inline-block;
    transition: transform 0.2s;
  }
  .chev.up {
    transform: rotate(180deg);
  }

  /* expanding details */
  .panel {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.28s ease;
    cursor: default;
  }
  .panel.open {
    grid-template-rows: 1fr;
  }
  .panel-in {
    overflow: hidden;
    min-height: 0;
  }
  .panel.open .panel-in {
    padding-top: 6px;
    border-top: 1px dashed var(--line);
  }
  .why {
    margin: 12px 0;
    font-size: 0.92rem;
  }
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0 0 4px 6px;
    display: grid;
    gap: 14px;
    border-left: 2px solid var(--line);
  }
  .timeline li {
    display: flex;
    gap: 12px;
    position: relative;
    margin-left: -7px;
  }
  .dot {
    flex: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    margin-top: 5px;
    background: var(--warn);
    border: 2px solid var(--surface);
  }
  .dot.t-primary,
  .dot.t-wire {
    background: var(--good);
  }
  .dot.t-trade {
    background: var(--info);
  }
  .timeline a {
    font-weight: 600;
  }

  details.card summary {
    cursor: pointer;
    font-weight: 700;
    color: var(--accent);
  }
  .nowrap {
    white-space: nowrap;
  }
  p.more {
    text-align: center;
  }
  p.more a {
    color: var(--accent);
    font-weight: 600;
  }

  /* ---------- reader panel ---------- */
  .reader {
    width: min(760px, 94vw);
    max-height: 88vh;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 24px 60px rgb(0 0 0 / 45%);
    display: none;
    flex-direction: column;
  }
  .reader[open] {
    display: flex;
  }
  .reader::backdrop {
    background: rgb(0 0 0 / 58%);
  }
  .reader header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 22px 14px;
    border-bottom: 1px solid var(--line);
  }
  .reader h2 {
    font-size: 1.35rem;
    margin-top: 6px;
  }
  .reader .x {
    flex: none;
    font: inherit;
    font-size: 1.8rem;
    line-height: 1;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--surface-soft);
    color: var(--text);
    cursor: pointer;
  }
  .reader .body {
    padding: 16px 22px;
    overflow: auto;
    display: grid;
    gap: 14px;
    line-height: 1.75;
    font-size: 1.02rem;
  }
  .reader footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 22px 16px;
    border-top: 1px solid var(--line);
    flex-wrap: wrap;
  }

  @media (max-width: 560px) {
    .row-acts {
      margin-left: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel,
    .chev,
    .story {
      transition: none;
    }
  }
</style>
