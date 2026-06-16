# Trackie Design System

The visual design system and brand identity for **Trackie** — the money-tracking
tool for **Datagami**. This system covers brand identity (a new Trackie logo),
design tokens (color, type, spacing, elevation), and a component library mapped
to **Next.js + TypeScript + Tailwind + shadcn/ui**.

> Scope of this pass (per brief): **identity, tokens, and components only.** Full
> application screens / UI kits are intentionally *not* built yet.

---

## 1 · Product & brand context

**Trackie** tracks money for **Datagami**, a sales partner of OEMs (IBM, AAFM, …).
It records collections from universities, payments to OEMs, GST, TDS, advances,
and net margin — **per university, per academic year**. It is a *trustworthy
fintech tool*: clean, data-dense, calm, precise. Reference points: Stripe
Dashboard, Linear, modern banking — never a playful consumer app.

**Datagami (parent brand)** — Trackie is a sub-product and must read as family:
- Mark: a **golden infinity (∞)** above a black "Datagami" wordmark.
- Tagline: *"Lead Digital Technology"* (italic serif, in quotes).
- Palette: **gold/amber** signature (~#E5A50A–#F2B705), black/near-black text,
  white background. Premium, simple, confident.

**The family tie:** Trackie keeps Datagami's **gold accent + clean black/white
foundation**, but earns its own identity — a precise, geometric *tracked-value*
mark (not the friendly rounded wordmark / infinity loop) and a UI palette tuned
for dense financial data (slate neutrals + a semantic money palette).

### Sources given
- `uploads/Datagami Logo.pdf` — the parent logo (embedded raster extracted to
  `assets/datagami-logo.png` and the isolated mark `assets/datagami-infinity.png`).
  Sampled brand gold ≈ `#FFC242` (bright) / anchored to `#E5A50A` for the scale;
  wordmark near-black ≈ `#2A2C2F`.
- No codebase, Figma, or decks were provided. Stack target (Next.js + TS +
  Tailwind + shadcn/ui) is from the brief.

---

## 2 · Content fundamentals (voice & copy)

Trackie's copy is **precise, calm, and operational** — it talks about money and
actions, never marketing fluff.

- **Tone:** factual, confident, quiet. No exclamation, no hype, no emoji.
- **Person:** address the user implicitly through actions/objects ("Record a
  payment", "Outstanding balance"), not "you/we". Imperative verbs for actions.
- **Casing:** **Sentence case** everywhere — buttons, headings, menu items
  ("Record payment", not "Record Payment"). Only proper nouns capitalize
  (Datagami, IBM, AAFM, university names, "GST", "TDS", "FY24–25").
- **Labels:** short noun phrases ("Net margin", "Collections", "Outstanding").
  Overlines are UPPERCASE with wide tracking, used sparingly above figures.
- **Money:** always Indian formatting — `₹`, lakh/crore grouping (`₹12,40,000`),
  compact form for KPIs (`₹48.2L`, `₹4.82Cr`). Negative values use a minus
  (`−₹6,40,000`), never parentheses. Figures are right-aligned.
- **Status language:** fixed vocabulary — *Draft · Raised · Partially Paid ·
  Pending · Paid · Overdue*. Use these exact terms.
- **Numbers > adjectives:** prefer a precise figure or delta ("−3.1%") over
  words like "lots"/"significant". Don't invent data; show "—" for empty.
- **Examples:** "Record a payment to IBM" · "This reduces the outstanding balance
  for FY24–25." · "42 invoices" · "vs last year".

---

## 3 · Visual foundations

**Overall vibe:** premium, minimal, trustworthy. Neutrals + semantic color carry
the data; **gold is a disciplined accent** (primary button, brand mark, focus
ring) — never a background wash.

- **Color:** gold primary (`--gold-500` `#E5A50A`, dark text on it); slate
  neutral scale for text/borders/surfaces; semantic money palette — green
  positive, red negative, **amber** pending (deliberately warmer/oranger than
  brand gold so "pending" never reads as brand), blue info. Full light **and**
  dark mode via a `.dark` class (shadcn convention). All money text colors meet
  WCAG AA on white (notes in the "Money color rules" card).
- **Type:** **Hanken Grotesk** for all UI (a clean, credible grotesk — not Inter).
  **IBM Plex Mono** for every currency/figure (tabular numerals; the IBM tie is
  intentional — IBM is an OEM). Modular ~1.2 scale; tight tracking on large
  headings; UPPERCASE wide-tracked overlines.
- **Spacing:** 8px base grid with 2/4px micro-steps for dense tables.
- **Corner radius:** small and controlled — 6px controls, 8px menus, 12px cards
  & dialogs, full pills/avatars. Nothing looks bubbly.
- **Cards:** white surface, 1px `--border` (slate-200) hairline, `--shadow-sm`
  (soft, cool-tinted, low-spread), 12px radius. Calm, never heavy.
- **Elevation:** a 5-step soft shadow scale (xs→xl), cool slate-tinted on light,
  deeper/darker on dark. Borders (not just shadow) define surfaces in dark mode.
- **Backgrounds:** flat. App canvas = slate-50 (light) / near-black `#0A0F1A`
  (dark). **No gradients, no textures, no imagery, no blur** beyond a faint
  dialog-overlay backdrop. The data is the texture.
- **Borders:** 1px hairlines (`--border`); 1.5px for input/control emphasis.
- **Motion:** quick and precise — 120–260ms, `cubic-bezier(0.2,0,0,1)` standard
  ease. **No bounce.** Hover = subtle background/color shift; press = 0.5px
  nudge + darker fill; focus = 3px gold ring (`--shadow-focus`). Fades only.
- **Hover/press states:** buttons darken (primary → gold-600/700), ghost gains a
  slate-100 wash, rows hover to slate-100, selected rows tint gold-subtle.
- **Transparency/blur:** reserved for the modal overlay only (rgba slate + 2px
  blur). Subtle semantic tints use rgba in dark mode.

---

## 4 · Iconography

- **System:** **Lucide** (`lucide-react` in production / `lucide` CDN in mocks) —
  it matches the line aesthetic (2px stroke, round caps/joins, 24px grid) and is
  the de-facto shadcn/ui icon set. **No icon assets were provided**, so Lucide is
  the recommended substitution — flagged here for confirmation.
- **Usage:** functional icons only — 16px inside buttons, 17px in KPI corners,
  13–14px in table headers/deltas. Stroke `currentColor` so they inherit text
  color. Decorative icons get a muted/brand-subtle treatment.
- **Inline SVGs:** the few glyphs baked into components (check, chevrons, sort,
  trend arrows, close) are hand-set to match Lucide's 2–2.5px round style so
  there's no dependency for core primitives.
- **Emoji / unicode:** **never** used as icons. The only unicode glyph in regular
  use is the rupee sign **₹**. Status uses colored dots + text, not emoji.
- **Brand mark** is not an icon — use the `TrackieLogo` component (`assets/`
  holds `trackie-mark.svg`, `trackie-mark-mono.svg`, `trackie-icon-*.svg`,
  `trackie-logo*.svg`, `favicon.svg`).

---

## 5 · Index / manifest

**Root**
- `styles.css` — global entry point (import-only). Link this one file.
- `Trackie Styleguide.html` — the one-page brand & UI summary board (Deliverable 5).
- `readme.md` — this guide. · `SKILL.md` — Agent-Skill wrapper.

**`tokens/`** (all `@import`ed by `styles.css`)
- `fonts.css` · `colors.css` · `typography.css` · `spacing.css` · `base.css` ·
  `components.css` (class-based component styling).

**`assets/`** — logos & marks: `trackie-logo.svg` / `-dark`, `trackie-mark.svg` /
`-mono`, `trackie-icon-dark.svg` / `-gold`, `favicon.svg`, plus parent
`datagami-logo.png` / `datagami-infinity.png`.

**`components/`** (React primitives — `<Name>.jsx` + `.d.ts` + `.prompt.md`, one
`@dsCard` per dir). Namespace: `window.TrackieDesignSystem_25ca21`.
- `brand/` — TrackieLogo
- `buttons/` — Button, IconButton
- `forms/` — Input, Select, Checkbox, Switch
- `data-display/` — KpiCard, Card, Badge, StatusBadge, Avatar, MoneyText (+ `formatINR`, `formatINRCompact`)
- `data-table/` — DataTable
- `navigation/` — Tabs
- `overlay/` — Dialog, Tooltip
- `charts/` — BarChart, LineChart

**`guidelines/`** — foundation specimen cards (Colors, Type, Spacing, Brand) that
populate the Design System tab.

---

## 6 · Font substitution note

Fonts load from the **Google Fonts CDN** (`tokens/fonts.css`) — the binaries
could not be bundled locally in this environment. Hanken Grotesk and IBM Plex
Mono are both open-source (OFL). To fully self-host, drop the `.woff2` files into
`assets/fonts/` and swap the `@import` for `@font-face` rules. **Please confirm**
these font choices, or provide the brand's preferred fonts.
