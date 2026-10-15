# The "AI template card": problem and solution

Decision: `docs/decisions/0005` §١٥٨ · Rule: `.claude/skills/ui-frame/SKILL.md` §٠ · Code: `packages/ui-web/src/styles.css` (`C-CARD`)

## The problem

On 2026-10-15 the owner looked at the service cards on the status page (PUB-03) and called them an **"AI template"**. The order was: never build cards like this again, always build a modern card with good motion that works at every size, and fix every page that uses the pattern.

### What the template card looks like

You see the same card in thousands of generated dashboards:

- A flat white rectangle with a 1px grey border and the same radius everywhere.
- **A thin coloured stripe down one edge**: green for OK, red for down, amber for warning. It was drawn as `border-inline-start: 4px solid …` or as a 4px `::before` bar the full height of the card. A variant puts the stripe across the top (`border-block-start: 4px`).
- A small coloured pill in the corner that repeats what the stripe already says.
- A title squeezed between the pill and the edge, so on a narrow card it breaks over three lines ("بوابة / الزبون / الحملات").
- No depth, no motion, no difference between a card that is alive and one that is idle.

### Why it is a problem

1. **It looks generated.** The coloured edge stripe is the most recognisable sign of template UI. A product that has to earn shop owners' trust can't look assembled from defaults.
2. **Meaning rides on colour alone.** The stripe is the loudest element and says nothing a colour-blind user can read. The text pill carries the real meaning, but it's smaller and quieter.
3. **It breaks in RTL and at narrow widths.** On the inline-start edge in Arabic the stripe reads as a rendering artefact. Next to the pill, it pushes the title into awkward wraps on phones and in four-column grids.
4. **Every card is the same card.** A status card, a plan card, a request card and a login card were all one rectangle with a different stripe colour. There was no hierarchy.
5. **Nothing stopped it.** The pattern came from the drawn frames and from habit, and no rule or check existed, so it spread to eight places.

### Where it was

| Screen | Element | Form |
|---|---|---|
| PUB-03 status page | service cards | 4px `::before` side bar, coloured by state |
| PLT-14 tour requests | request items | 4px `border-inline-start`, coloured by status |
| Operators list | operator items | same, active/inactive |
| PLT plans | plan cards | 4px `border-inline-start`, green or grey |
| PLT-14 / PUB-06 | team comments | 3px brand-coloured side border |
| Operator login, password change | login card | 4px amber top border |
| PUB-06 request tracking | main card | 4px brand top border |
| PLT overview | tiles | dead stripe rules, already overridden |

## The solution

### One shared card: `c-card`

There is now one modern card in the shared component library. Screens use it instead of styling their own cards:

```html
<li class="pb-service c-card" data-tone="ok">
  <div class="pb-service__top">
    <span class="c-card__chip c-card__chip--live" aria-hidden="true">✓</span>
    <Status … label="يعمل" />
  </div>
  <strong>البيع على الأجهزة المثبَّتة</strong>
  <p>محلي — لا يعتمد على الخادم</p>
</li>
```

| Part | What it does | Values |
|---|---|---|
| Tone | `data-tone="ok \| info \| warn \| danger \| neutral"` sets `--tone` from the semantic colour tokens | `--color-ok`, `--color-brand-primary`, `--color-warn`, `--color-danger`, `--color-ink-faint` |
| Status chip | `c-card__chip`: a 32px circle in the tone with an icon (✓ ! × ·). It **replaces the stripe** as the state signal, and the text pill stays beside it | background `color-mix(tone 14%)` |
| Tint | a faint radial wash of the tone from the starting corner | `radial-gradient(… tone 9% …)` |
| Border | 1px, tinted toward the tone rather than flat grey | `color-mix(tone 22%, border)` |
| Depth | a layered soft shadow instead of a hard outline | `0 1px 2px …/.04, 0 10px 28px -16px …/.22` |
| Hero variant | `c-card--hero` for the single card centred on a page (login, tracking): larger radius, deeper shadow, brand tone; the operator login uses the warning tone | radius 22px, `0 24px 60px -28px` |
| Comments | speech bubbles, not stripes: thin tinted border, small starting corner | `border-start-start-radius: 4px` |

### Motion

All of it is gated by `prefers-reduced-motion: no-preference`, so users who ask for less motion get a still page, and the tests run without it.

- **Entrance**: cards rise and fade in over 420ms (`vz-card-in`: 10px up, scale 0.985), staggered 50ms per card and capped at 350ms. The fill mode is `backwards`, so the animation doesn't fight the hover state afterwards.
- **Hover**: an interactive card (`c-card--interactive`, or a card that is an `a` or `button`) lifts 2px, deepens its shadow and strengthens its tinted border. This applies only on devices that can hover.
- **Live pulse**: a working service gets `c-card__chip--live`, a slow 2.4s pulse ring, so "alive" looks different from "fine but static".

### Responsive

- Grids use `repeat(auto-fit, minmax(min(100%, 255px), 1fr))`: four cards on desktop, two on tablet, one on phone, with no lone card on the last row.
- **The title gets its own line** under the chip and pill row, so long names never wrap into a narrow gap.
- Dark mode works without extra rules, because everything is derived from tokens through `color-mix`.

### Accessibility

- State is never shown by colour alone. Each card carries an icon (✓ ! ×) and a text pill («يعمل», «متوقفة»). The chip is `aria-hidden`, so screen readers hear the text once.
- The literal texts and the 17 drawn states are unchanged. Only the shape changed.

## Guardrails, so it doesn't come back

1. **Rule in the UI skill** (`ui-frame` §٠). That skill is loaded before any screen is built: side or top stripes are banned, `c-card` is required, and screen CSS must not set `border`, `background` or `box-shadow` on a `c-card`.
2. **A check before every CSS change**. It must print nothing:
   ```bash
   grep -rnE "border-(inline|left|right)[a-z-]*:\s*[2-9]px|inset [3-9]px 0" apps/web/src packages/ui-web/src | grep -vE "currentColor|var\(--color-border\)"
   ```
   Two neutral lines are allowed: the timeline axis and the sub-menu guide. Neither is a card.
3. **Decision recorded** in `0005` §١٥٨. The owner's order takes precedence over the card shape in the drawn frames.
4. **Kept on purpose**: the warning bar at the top of the operator frame (`.plt-frame`). It is a frame, not a card, and it marks "you are in the operator space".

## How it was verified

- The specs for every affected screen pass at 390, 834 and 1440: 81 operator and public specs, plus 24 for the public pages.
- Screenshots at all three sizes were reviewed:
  - the status page in its outage and stale states;
  - tour requests and plans;
  - operator login;
  - request tracking on a phone.
- The check above prints nothing.
