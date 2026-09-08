# InnoBeweegLab — Evidence Engine

**From data to evidence-based recommendations.**

A research pipeline for [InnoBeweegLab](https://www.innobeweeglab.nl), which studies how public
space can invite people to move, be active and stay healthy, and advises municipalities on it.
The system takes the raw material of a neighbourhood study — survey exports, interview
transcripts, expert site assessments and measurement datasets — and produces a structured draft
research report in which every claim can be traced back to the observation it came from.

It does not replace the researcher. It removes the reporting drudgery so more time goes into the
field, and it leaves interpretation, conclusions and policy recommendations where they belong.

---

## The pipeline

```
Excel / CSV ──────────────┐
Surveys ──────────────────┤
Interviews/transcripts ───┼─> Data ingestion
Expert assessments ───────┘
                              ↓
                     Standardized research model
                              ↓
        ┌─────────────────────┼────────────────────┐
        ↓                     ↓                    ↓
 Qualitative analysis   Expert analysis   Quantitative analysis
        └─────────────────────┼────────────────────┘
                              ↓
                    Evidence / finding store
                              ↓
                  Cross-source triangulation
                              ↓
                    Grounded LLM generation
                              ↓
                Draft report + source references
                              ↓
                     Researcher validation
```

The frontend is organised as those eight stages, in order. Each one is a page you can inspect,
re-run and correct before moving on.

| # | Stage | What happens |
|---|-------|--------------|
| 1 | **Data ingestion** | CSV, XLSX, DOCX and plain text are parsed **in the browser**, previewed, tagged with a perspective, then stored. |
| 2 | **Standardized research model** | Every source collapses to *observations*: perspective, design dimension, value, and a `locator` (`row:12:veiligheid_score`, `char:840-1024`) pointing back into the original file. |
| 3 | **Analysis lanes** | Three independent lanes run over the model — qualitative (thematic coding), expert (assessment structuring), quantitative (descriptive statistics). |
| 4 | **Evidence store** | One register of every finding with its support, strength and direction. Findings can be accepted or rejected here, before anything reaches the report. |
| 5 | **Cross-source triangulation** | Findings are grouped per dimension across the three perspectives and classified: converging, diverging, single-source, or an evidence gap. |
| 6 | **Grounded generation** | Claude drafts the report over the evidence pack with the Messages API's citations enabled. |
| 7 | **Draft report** | The draft, section by section, showing which evidence the model actually cited while writing each part. |
| 8 | **Researcher validation** | Edit, approve or reject each section; export Markdown or a standalone HTML document. |

## How grounding is enforced

The brief asks for outputs that stay rooted in the actual research data rather than drifting into
generic advice. Four mechanisms, in order of how much they do:

**Numbers are never generated.** The quantitative lane is plain TypeScript — means, standard
deviations, medians, distributions, sub-group comparisons. No language model touches a figure.
The model can only restate statistics that are already in the evidence store.

**Quotes are verified verbatim.** During thematic coding the model must attach a word-for-word
span from the observation it cites. Every span is checked against the source text; anything that
is not an exact match is discarded and the theme loses that support. A theme left with no
surviving evidence is dropped entirely rather than stored ungrounded.
See `verifyEvidence` in [`server/qual.ts`](server/qual.ts).

**Citations are structural, not decorative.** The evidence store is rendered into plain-text
documents whose block character ranges are recorded. Those documents are passed to the Messages
API as `document` blocks with `citations: { enabled: true }`, so each cited claim comes back with
an exact `char_location`. That range is resolved to the block it landed in, which is the finding.
A section that comes back with zero citations is flagged in the UI rather than silently accepted.
See `buildEvidencePack` and `resolveCitation` in [`server/report.ts`](server/report.ts).

**The verdicts are computed, not written.** Triangulation classifies convergence and confidence
deterministically; the model only writes the prose summary over the findings that are already
grouped. It cannot reclassify a contradiction into agreement.

Contradictions between perspectives are surfaced, not smoothed over — they are a research result,
and resolving them is the researcher's call.

## Running without an API key

With no `ANTHROPIC_API_KEY` the whole pipeline still runs, in **heuristic mode**: statistics,
triangulation, the evidence store and the report skeleton are all real, but thematic coding falls
back to a Dutch/English keyword lexicon and the draft is assembled from templates instead of
written. The recommendations section is then left deliberately unfinished — a generic
recommendation is worse than none. Useful for demos and for exercising the pipeline offline.

---

## Architecture

```
src/                React 18 + Vite frontend (the eight stages)
  stages/           one file per pipeline stage
  components/       design system, pipeline SVG diagram
  lib/              API client, browser-side file parsing, Markdown renderer
shared/             types and column inference used by BOTH frontend and API
server/             the API's logic — one module per pipeline stage
functions/api/      Cloudflare Pages Function entry point (single catch-all route)
migrations/         D1 schema
```

- **Frontend** — React 18, Vite, TypeScript, React Router. No UI framework; the design system is
  ~400 lines of CSS with light and dark themes.
- **API** — Cloudflare Pages Functions. One catch-all route (`functions/api/[[route]].ts`)
  delegating to a small hand-rolled router, so all the logic lives in plain testable modules.
- **Storage** — Cloudflare D1 (SQLite). Projects, sources, observations, findings, triangulations,
  reports, sections, and a `runs` audit log recording what ran, with which engine, and at what
  token cost.
- **LLM** — Anthropic Messages API via `@anthropic-ai/sdk`, `claude-opus-5` by default.
  Structured outputs (Zod) for extraction; document citations for generation.

File parsing runs in the browser, not the Worker: the researcher can check the column mapping
before anything is committed, and the Worker stays free of xlsx/docx decoding.

---

## Local development

```bash
npm install
npx wrangler d1 create innobeweeglab          # copy the printed database_id into wrangler.toml
npm run db:local                              # apply the schema to the local D1
cp .dev.vars.example .dev.vars                # add ANTHROPIC_API_KEY (optional)
npm run build && npx wrangler pages dev        # http://localhost:8788
```

`npx wrangler pages dev` serves the built frontend and the API together, which is the closest
match to production. For frontend iteration with hot reload, run `npm run dev` in a second
terminal — Vite proxies `/api` to port 8788.

## Deploying to Cloudflare Pages

**1. Create the database and apply the schema**

```bash
npx wrangler d1 create innobeweeglab
```

Put the printed `database_id` into `wrangler.toml`, then:

```bash
npm run db:remote
```

**2. Connect the repository** in the Cloudflare dashboard (Workers & Pages → Create → Pages →
Connect to Git), with:

- Build command: `npm run build`
- Build output directory: `dist`

The D1 binding is read from `wrangler.toml`. Alternatively deploy from the CLI:

```bash
npm run pages:deploy
```

**3. Set the secrets** (Settings → Variables and Secrets), as *encrypted* values:

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | no | Enables thematic coding and grounded generation. Without it the app runs in heuristic mode. |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5`. |
| `APP_PASSWORD` | no | If set, every API call requires a matching `x-app-password` header and the UI shows an unlock screen. |

`APP_PASSWORD` is a single shared secret — appropriate for a prototype behind a known URL, not a
substitute for real authentication. Research material about residents should not sit on a public
instance without it, and a production deployment should move to proper per-user auth.

---

## API

All routes are under `/api`. `POST /api/projects` with `{"demo": true}` seeds a complete worked
example — a Dutch neighbourhood study with a survey, resident interviews, an expert site
assessment and a counting dataset — so the pipeline can be exercised end to end immediately.

| Method | Path | |
|---|---|---|
| `GET` | `/api/health` | LLM availability, model, whether auth is required |
| `GET POST` | `/api/projects` | list / create (`{"demo": true}` to seed) |
| `GET PATCH DELETE` | `/api/projects/:id` | project status with all stage counters |
| `GET POST` | `/api/projects/:id/sources` | list / add a source |
| `GET PATCH DELETE` | `/api/projects/:id/sources/:sid` | inspect / remap columns / remove |
| `POST` | `/api/projects/:id/standardize` | stage 2 |
| `GET` | `/api/projects/:id/observations` | the standardized model |
| `POST` | `/api/projects/:id/analyse` | stage 3 — `{"lane": "all" \| "resident" \| "expert" \| "quantitative"}` |
| `GET` | `/api/projects/:id/findings` | the evidence store |
| `PATCH` | `/api/projects/:id/findings/:fid` | accept / reject a finding |
| `POST GET` | `/api/projects/:id/triangulate`, `/triangulations` | stage 5 |
| `POST GET PATCH` | `/api/projects/:id/report` | stages 6–7 |
| `PATCH` | `/api/projects/:id/report/sections/:sid` | stage 8 — edit, approve, reject |
| `GET` | `/api/projects/:id/export?format=md\|html` | export the validated draft |
| `GET` | `/api/projects/:id/runs` | audit log |

---

## Status and limitations

This is a proof of concept built to the case brief, not a production system.

- **The Claude path has not been exercised against the live API.** The request construction,
  Workers-runtime compatibility and error handling are verified (an invalid key produces a clean
  401 and a recorded failed run), and the full pipeline is verified end to end in heuristic mode.
  The quality of the generated draft itself is unmeasured — that needs a key and an evaluation
  against InnoBeweegLab's own past reports.
- **No InnoBeweegLab house style yet.** The report template distinguishes observations, findings,
  conclusions and recommendations, and splits recommendations into short and long term, but the
  actual tone of voice, branding and reporting format still need to be taken from their templates.
- **Dimension taxonomy is a placeholder.** The twelve active-friendly design dimensions in
  `shared/types.ts` are a plausible starting vocabulary, not InnoBeweegLab's own. Replacing them
  with the real one is a single edit and would materially improve triangulation.
- **No DOCX export.** Markdown and standalone HTML only; HTML prints to PDF acceptably.
- **Single shared password, no user accounts**, and no audit of who validated what beyond a
  free-text reviewer name.
