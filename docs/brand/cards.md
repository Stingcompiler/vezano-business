# The "AI template card": problem and solution

Decisions: `docs/decisions/0005` §١٥٨ and §١٥٩ · Method: `docs/brand/ui-review-guide.md` · Project profile: `docs/ui-profile.md`
Report with screenshots: `docs/brand/ui-review/README.md` · Code: `packages/ui-web/src/styles.css` (`C-CARD`), `tools/ui-lint/`

## The problem

On 2026-10-15 the owner looked at the service cards on the status page and called them an **"AI template"**: never build cards like
this again, always build a modern card with good motion that works at every size, and fix every page that uses the pattern.

Then the owner supplied a review guide, which made clear the template is **a family of patterns, not one stripe**.

### The family

| Pattern | What it looks like | Why it fails |
|---|---|---|
| **Coloured stripe** | A thin coloured bar down one edge or across the top of a flat box (border, pseudo-element, inset shadow), plus a badge repeating the state | The most recognisable mark of generated UI; in RTL it reads as a rendering glitch |
| **Icon in a tinted circle** | An icon inside a round badge tinted with the state colour in the card corner | Adds no meaning; it just decorates |
| **Status said three times** | Icon, pill text and a dot all in one card | Noise; the reader has to reconcile three signals |
| **A card per number** | Every figure becomes a card with its own icon, title and big number | Flattens the page; nothing leads |
| **Equal rows** | Cards of equal size by default, whatever their importance (and an orphan on the last row) | No hierarchy: a broken service looks like a healthy one |
| **Tint and shadow on every card** | Every card gets a wash, a border colour and a shadow | If everything is emphasised, nothing is |
| **Motion on idle things** | Pulse, glow, hover lift on elements that aren't doing anything | Distracts, costs battery on weak phones, and cries wolf |
| **Card inside card** | A notice box nested in a panel box | Two borders for one idea |

### Where it was in this project

- Status page (PUB-03): services with a side bar, a circle badge, a pill and a dot; five equal cards with the fifth alone on its row; the outage notice nested in the header card.
- Tour requests, operators, plans, comments, operator login and request tracking: side or top stripes.
- Operator overview: icons in tinted rounded squares.
- My first fix (PR #172) **reproduced part of the family**: a tinted icon circle, a pulse on healthy services, and tint plus shadow on every card. The guide caught it, so that PR was never merged.

## The solution

### Direction chosen: B, "priority first" (2026-10-15)

Two decisions, kept independent as the guide asks:

1. **What gets emphasis:** only what needs attention. A broken service is a tinted card that says what is wrong; a healthy one is a row.
2. **What a card is:** a plain surface. Everything else is opt-in.

### The shared card (`c-card`)

| Class | Use | Look |
|---|---|---|
| `c-card` | Any card | Plain surface: card background, 1px border, 16px radius. No tint, no shadow |
| `c-card--attention` + `data-tone="ok\|info\|warn\|danger"` | Only what needs attention or an action | A faint wash of the tone on the surface, border leaning toward it |
| `c-card--hero` | The one card in the middle of a page (login, tracking) | Larger radius and a soft depth shadow |
| `c-card--interactive` (or an `a`/`button`) | Clickable cards | 2px lift and a tinted border **on hover with a mouse only** |
| `c-enter` | Content that arrives from the server | A 260ms rise and fade |

### On the status page

- **Problems first:** services that are stopped or degraded are `c-card--attention` cards, each showing its name, its state word and its detail.
- **Everything else is one quiet list:** healthy and not-yet-launched services are divided rows inside a single card.
- **The state is said once**, in its drawn wording («يعمل», «متوقفة», «متوقفة جزئياً», «لم يُفتح بعد»), coloured to support it. There is no icon, no pill and no dot.
- **The header is an open section**, not a card, so the notice inside it is the only framed element (no card inside a card).
- On a phone the cards stack and the name never wraps into a narrow gap. In dark mode the tones come from tokens through `color-mix`.

### Elsewhere

- Tour requests, operators and plans: plain `c-card`; the state sits in its drawn pill once, and nothing is tinted.
- Operator login, password change and request tracking: `c-card--hero`, neutral, with depth because each is the single card on its page.
- Team comments: speech bubbles with a thin tinted border and a small start corner, in place of a side stripe.
- Operator overview: icons stay but lose the tinted round square; the name and number carry the meaning.
- Landing page: the end node's endless glow is gone. The travelling data dot is kept and documented, because it depicts a process in motion.

### Motion

- Only for state change or interaction: a short entrance for server content, and hover or press feedback on clickable things.
- No pulse, glow or lift on static elements.
- Everything is under `prefers-reduced-motion: no-preference`.

### What was deliberately not changed

- The store dashboard (HOME-01) keeps its cards. Each figure repeats its own timestamp because the project rule says every number shows its source and time, and the locked margin card is drawn that way (`phase_locked`).
- The warning bar across the top of the operator frame, because it marks a space and is not a card. It is documented in the code.
- The numbered steps on the market page, because the numbers carry order.

## Guardrails

1. **The guide and the project profile** are read before any card work, and the UI skill (`ui-frame` §٠) says so.
2. **`pnpm lint:ui`** finds the known applications of the banned patterns and must finish with no output. It reports each place, fails the run, and accepts a documented exception with a `ui-allow: reason` comment on the line. It went from 8 hits to 0 here, with 3 documented exceptions.
3. **`pnpm shots`** captures the representative screens at 390, 834 and 1440, so every batch is reviewed by eye. The text check can be bypassed and has no taste, so it never replaces looking.
4. **Decisions recorded** in `0005` §١٥٨ and §١٥٩.

## How it was verified

- The specs for every touched screen pass at 390, 834 and 1440.
- The status page was reviewed by eye in its outage and all-clear states, on a phone and on a desktop, in light and dark.
- `pnpm lint:ui` prints nothing.
- Limits: the dark mode screenshots outside the status page were not captured, because the project's colour assertions are written for light.
