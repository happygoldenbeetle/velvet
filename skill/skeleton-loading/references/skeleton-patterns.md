# Skeleton Loading Patterns

## Reusable CSS foundation

```css
:root {
  --skeleton-base: rgba(127, 127, 127, 0.16);
  --skeleton-highlight: rgba(255, 255, 255, 0.22);
  --skeleton-radius: 0.5rem;
}

.skeleton {
  position: relative;
  overflow: hidden;
  background: var(--skeleton-base);
  border-radius: var(--skeleton-radius);
}

.skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(
    90deg,
    transparent,
    var(--skeleton-highlight),
    transparent
  );
  animation: skeleton-shimmer 1.4s infinite;
}

@keyframes skeleton-shimmer {
  100% {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton::after {
    animation: none;
  }
}
```

## Shape classes

```css
.skeleton-text { height: 0.875rem; width: 100%; }
.skeleton-text.short { width: 45%; }
.skeleton-text.medium { width: 70%; }
.skeleton-avatar { width: 2.5rem; height: 2.5rem; border-radius: 999px; }
.skeleton-thumbnail { aspect-ratio: 16 / 9; width: 100%; }
.skeleton-button { height: 2.25rem; width: 6rem; border-radius: 999px; }
```

## React component pattern

```tsx
import clsx from "clsx";
import "./skeleton.css";

type SkeletonProps = {
  className?: string;
  rounded?: "sm" | "md" | "lg" | "full";
};

export function Skeleton({ className, rounded = "md" }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={clsx("skeleton", `skeleton--${rounded}`, className)}
    />
  );
}
```

## React message skeleton

```tsx
export function MessageSkeleton() {
  return (
    <div className="message-skeleton" aria-busy="true" aria-label="Loading message">
      <Skeleton className="message-skeleton__avatar" rounded="full" />
      <div className="message-skeleton__content" aria-hidden="true">
        <Skeleton className="message-skeleton__line message-skeleton__line--name" />
        <Skeleton className="message-skeleton__line" />
        <Skeleton className="message-skeleton__line message-skeleton__line--short" />
      </div>
    </div>
  );
}
```

## Tailwind pattern with local CSS

Use Tailwind for layout and a small CSS class for the shimmer:

```tsx
<div className="flex gap-3" aria-busy="true" aria-label="Loading content">
  <div aria-hidden="true" className="skeleton h-10 w-10 rounded-full" />
  <div aria-hidden="true" className="flex flex-1 flex-col gap-2">
    <div className="skeleton h-4 w-2/3 rounded" />
    <div className="skeleton h-4 w-full rounded" />
    <div className="skeleton h-4 w-3/4 rounded" />
  </div>
</div>
```

## Common mistakes to avoid

- Do not use a spinner and skeleton for the same content unless the spinner communicates a separate blocking action.
- Do not make every text line the same width.
- Do not let skeleton dimensions depend on unloaded content.
- Do not use pure white shimmer on dark backgrounds without lowering opacity.
- Do not forget `prefers-reduced-motion`.
