# 10. Responsive UI / UX Plan

## 10.1 Visual Identity (from LCM logo)

The ministry logo (cross + open book + dove, navy/teal/orange on white) drives the design tokens:

| Token | Value | Usage |
|---|---|---|
| `--navy` | `#14294d` | Primary surfaces, sidebar, headers |
| `--navy-deep` | `#0e1d38` | Footer, active states |
| `--gold` | `#d9a441` | Accent, CTAs, active nav, badges "Official" |
| `--teal` | `#1f9d8a` | Success, schedule confirmed, links |
| `--orange` | `#e8661f` | Warnings, "returned" states |
| `--red` | `#c0392b` | Errors, declined, destructive |
| `--ink` | `#1c2430` | Body text (high contrast on white) |
| `--paper` | `#f5f6f8` | Page background |
| `--white` | `#ffffff` | Cards, modals |
| Type | System font stack; 16px base; headings 600/700 | Readability for varied technical literacy |
| Radius | 10px cards, 8px inputs | Soft, modern, calm |

Logo usage: login screen hero, topbar brand mark, PDF report letterhead.

## 10.2 Layout & Navigation

- **Desktop (≥ 992 px)**: fixed left sidebar (logo, primary nav sections, user card, logout), topbar (page title, search where relevant, notifications bell, avatar menu).
- **Tablet (600–992 px)**: collapsed sidebar → icon rail; topbar retains bell + avatar.
- **Mobile (< 600 px)**: hamburger → slide-in drawer; topbar shows brand + bell; content single column; tables become stacked cards; forms full width.
- **Primary nav**: Dashboard · Schedule · Announcements · Messages · Profile · Evaluations · Notifications · Settings — filtered by role; admin portal additionally: Members, Roles, Committees, Terms, Approvals, Reports, Audit, System Settings (grouped in a "Management" section).
- Active section highlighted with gold underline + tinted background; keyboard focus visible.

## 10.3 Component Patterns

| Component | Behavior |
|---|---|
| Cards | White, subtle shadow, hover lift on actionable ones |
| Tables | Sticky header, zebra rows, responsive card fallback on mobile |
| Modals | Accessible (focus trap, Esc close, aria-labelledby), used for forms/confirmations |
| Toasts | Top-right, auto-dismiss, role="status" |
| Badges | Status colors (e.g., Published, Pending Review, Official/Approved) |
| Calendar | Month grid, day cells with assignment chips, month selector, today highlighted |
| Forms | Floating labels where compact; inline validation messages with `aria-describedby` |
| Rating input | 1–5 button group with labels (5 Highest … 1 Lowest), keyboard operable, shows chosen value |
| Charts | Hand-rolled SVG (bar/donut/line), title + accessible `<text>` labels, colorblind-safe palette (navy/gold/teal/orange/red) |

## 10.4 Accessibility

- WCAG AA: contrast ≥ 4.5:1 for text; focus indicators; semantic landmarks (`header/nav/main/footer`); skip-to-content link.
- All interactive elements keyboard-reachable; dialogs trap focus; tables have `scope` headers; images have `alt`.
- Form errors announced via `role="alert"`; toast announcements via `aria-live="polite"`.
- Reduced-motion media query disables transitions.

## 10.5 UX Principles

- **Progressive disclosure**: dashboards surface only what the role needs; management tools tucked under role-specific sections.
- **Confirmation for destructive actions** (delete, deactivate, cancel, release package) with a modal and plain-language explanation.
- **Empty states** with helpful next steps (e.g., "No assignments this month — check back soon").
- **Loading states** on every fetch; skeleton placeholders for lists.
- **Timezone-aware** display of all timestamps; dates always shown with weekday for calendars.
- Consistent empty/default avatar (initials in a navy circle) when no photo uploaded.
- Print stylesheet for schedules and reports (clean black-on-white, no sidebar).
