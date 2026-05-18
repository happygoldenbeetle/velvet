---
name: skeleton-loading
description: create or improve skeleton loading placeholders with discord-style shimmer animations for web ui. use when asked to add loading skeletons, shimmer effects, placeholder cards, content loaders, loading states, or animated glow/shine placeholders in html/css, react, next.js, tailwind, vue, svelte, or component libraries. apply this skill when the user wants skeletons that match existing layouts, replace spinners, show realistic loading rows/cards/avatars/text, or add accessible, performant loading animations.
---

# Skeleton Loading

## Core behavior

Create skeleton loaders that mirror the final content layout instead of generic blocks. Prefer a Discord-style shimmer: a soft diagonal or horizontal highlight moves across the whole placeholder surface, making the element feel active without being distracting.

When implementing skeleton loading:
1. Identify the final content structure: avatar, title, metadata, body text, media, buttons, cards, lists, tables, or chat messages.
2. Build skeleton shapes with the same spacing, border radius, and approximate dimensions as the real content.
3. Use a shared skeleton utility class or component instead of repeating animation code.
4. Add the shimmer with a pseudo-element or background gradient that crosses the full skeleton element.
5. Respect accessibility and motion preferences.
6. Keep the skeleton visible only while data is actually loading.

## Default visual standard

Use these defaults unless the user's app has design tokens or existing styles:

- Base color: a muted surface color slightly lighter or darker than the page background.
- Highlight: a soft translucent band, not a hard white stripe.
- Animation duration: 1.2s to 1.8s, infinite linear or ease-in-out.
- Shape radius: inherit or match target content; avatars should be circular.
- The shimmer should pass through the entire element, including cards with nested skeleton lines.
- Avoid high-contrast flashes.

For ready-to-copy CSS patterns, consult `references/skeleton-patterns.md`. For a reusable CSS asset that can be copied into projects, use `assets/skeleton-shimmer.css`.

## Implementation rules

### Plain CSS / HTML

Use a `.skeleton` base class with `position: relative`, `overflow: hidden`, and a `::after` shimmer layer. Create modifier classes for text, avatar, thumbnail, button, card, row, and table states.

### React / Next.js

Prefer a small reusable `Skeleton` component plus composition-specific components such as `MessageSkeleton`, `CardSkeleton`, `TableSkeleton`, or `ProfileSkeleton`.

Use `aria-busy="true"` on the loading region when appropriate. Mark decorative skeleton shapes with `aria-hidden="true"`. Avoid announcing every skeleton block to screen readers.

For Next.js route or data loading, place skeletons in `loading.tsx`, Suspense fallbacks, or local loading branches as appropriate.

### Tailwind CSS

Use `relative overflow-hidden` plus a `before:` or `after:` pseudo-element shimmer when pseudo-element support is available. If the project has custom Tailwind config access, add keyframes and animation tokens. If not, provide component-scoped CSS or inline `<style jsx>`/CSS module alternatives.

### Component libraries

If the project already uses a library skeleton component, extend its styles instead of replacing it. Add the shimmer only if the built-in component lacks a Discord-like shine and the customization path is clean.

## Accessibility and performance checklist

Always check:

- Add `prefers-reduced-motion: reduce` handling to disable shimmer animation.
- Do not use skeletons for actions that complete instantly; avoid unnecessary layout flicker.
- Keep dimensions stable to prevent layout shift.
- Do not animate expensive properties like width, height, top, or left. Animate `transform` or `background-position`.
- Use one shimmer overlay per skeleton container when possible, not hundreds of independent animations in long lists.
- Remove skeletons from the accessibility tree with `aria-hidden="true"` unless the loading region needs a single status label.
- Preserve dark mode by using CSS variables or current design tokens.

## Output style

When responding to implementation requests:

1. Provide the smallest complete change that fits the user's stack.
2. Include copy-paste-ready code.
3. Explain exactly where to place each file or snippet.
4. Include reduced-motion CSS.
5. If editing an existing codebase, match its naming, framework conventions, and styling system.

## Common examples

### Chat/message skeleton

Create a row with a circular avatar skeleton and three text-line skeletons. Use staggered widths such as 60%, 92%, and 75% to mimic real text.

### Card skeleton

Create a card with an image/thumbnail block, title line, description lines, and footer/button placeholders. Use one shimmer overlay on each major block or the whole card wrapper.

### Table skeleton

Create 5-8 rows with stable column widths. Avoid over-animating every cell; a row-level shimmer is usually enough.

### Discord-style shimmer

Use a highlight gradient that starts outside the left edge and translates beyond the right edge:

```css
.skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent);
  animation: skeleton-shimmer 1.4s infinite;
}
```

