# iOS Keyboard & Viewport Fix for Mobile-First Web Apps

A drop-in compatibility shim for mobile-first PWAs that need stable layout
when the iOS virtual keyboard opens. No framework dependencies — plain JS +
CSS, tested inside a SvelteKit SPA but framework-agnostic.

## What this fixes

- **App header / UI chrome disappearing** when keyboard opens (iOS pans visual viewport)
- **Focused input ending up behind the keyboard** (browser's auto-scroll fails with fixed layouts)
- **Layout breaking after app background → foreground** on iOS PWA (iOS restores scrolled state)
- **Drag gestures on chrome scrolling the whole page** once keyboard is open
- **Modal backdrop not covering fixed app bars** (z-index hierarchy)
- **Scroll chain bubbling from inner containers** to the document

## Prerequisites — layout invariants

Your app must follow these rules (they are standard for mobile-first PWAs):

| Invariant | Why |
|---|---|
| `html, body { overflow: hidden; height: 100dvh }` | Only the app container scrolls |
| `.app-header` / `.app-bar-wrapper` are `position: fixed` | Anchored to viewport |
| Sheets / drawers are `position: fixed; bottom: 0` | Modal layer |
| Real scrolling happens inside `.app-content` and `.sheet-content` | Not on html/body |

If your layout doesn't match, adapt the class names in `styles.css` — the
technique is the same regardless of what you call things.

## The four-layer solution

All four layers are in **[`viewport.js`](./viewport.js)** as `setupViewport()`.
Each layer handles a distinct iOS quirk:

### 1. `visualViewport` → `--kb-inset` CSS variable
Keyboard height is measured via `window.visualViewport` and written to
`--kb-inset` on `<html>`. CSS consumes it:
- `.sheet-content padding-bottom` expands so scroll content has space
- `.sheet-content scroll-padding-bottom` tells browser "this much is behind keyboard"
- `.app-content scroll-padding-bottom` same for main scroll container

**Critical detail:** when `--kb-inset` transitions `0 → >0` (keyboard just
finished opening), the currently-focused input is re-scrolled into view.
The initial scroll from the focus event fires *before* the keyboard is fully
open, so scroll-padding-bottom is still 0 and the browser has no reason to
scroll. The second scroll catches the real geometry.

### 2. `touchstart` → preemptive `focus({preventScroll: true})`
When user taps an input, iOS synthesizes a native focus event and
auto-scrolls / pans to bring the input into view — which breaks the fixed
layout. We pre-focus in the `touchstart` capture phase with
`preventScroll: true`. By the time the native tap flow fires focus, the
element is already focused and iOS skips its auto-scroll logic.

### 3. Prototype monkey-patch on `.focus()`
`HTMLInputElement / HTMLTextAreaElement / HTMLSelectElement .prototype.focus`
is patched to always set `preventScroll: true` and then explicitly call
`scrollIntoView({block: 'center'})`. This covers all programmatic focus paths:
- onclick handlers calling `inputEl.focus()`
- Autofocus on mount / sheet open
- Any third-party code invoking `.focus()`

`scrollIntoView({block: 'center'})` combined with `scroll-padding-bottom:
var(--kb-inset)` positions the target in the center of the *compressed*
optimal region — in practice the upper quarter of visible area above the
keyboard, with breathing room.

### 4. `visibilitychange` + `pagehide` / `pageshow` → blur + scroll reset
When the app is backgrounded with a focused input and open keyboard, iOS
takes a snapshot. On restore it actively maintains scroll position to keep
the input visible — which breaks `body{overflow:hidden}` (document scroll
becomes non-zero, visual viewport pans, fixed elements shift).

`scrollTo(0, 0)` alone doesn't stick — iOS immediately re-scrolls. The fix
is to **blur** the focused form control on hide (preemptive, before snapshot)
and on show (fallback if iOS restored with focus set). Blurring closes the
keyboard and releases iOS' "maintain focus visibility" loop, after which
the scroll reset sticks.

## Touch-action on fixed chrome

See [`styles.css`](./styles.css). When keyboard is open on iOS, the document
becomes scrollable (due to the same "maintain focus visibility" behavior as
above). Dragging a finger on `.app-header` or `.app-bar-wrapper` would bubble
the gesture to document scroll and shift everything.

`touch-action: none` on fixed non-scrollable chrome blocks the default gesture.
JS touch events (for swipe-to-close sheets, etc.) still fire — only browser's
default pan/scroll behavior is suppressed. `.sheet-content` overrides to
`touch-action: pan-y` so native vertical scroll works inside.

## Files

| File | Purpose |
|---|---|
| [`viewport.js`](./viewport.js) | Drop-in compatibility shim — import once, call `setupViewport()` on mount. Returns a teardown function. |
| [`styles.css`](./styles.css) | Essential CSS rules — copy/adapt to your own class names. |
| [`ViewportDebug.svelte`](./ViewportDebug.svelte) | Dev-only diagnostic overlay (Svelte 5). See below. |

## Integration

**1.** Import `viewport.js` and call `setupViewport()` once from your root
component's mount lifecycle:

```js
import { setupViewport } from './viewport.js';

// React:
useEffect(() => setupViewport(), []);

// Svelte:
onMount(() => setupViewport());

// Vue:
onMounted(() => { const teardown = setupViewport(); onUnmounted(teardown); });
```

**2.** Copy the rules from `styles.css` into your global stylesheet. Adapt
class names if yours differ — the CSS property combinations (`touch-action`,
`scroll-padding-bottom`, `overscroll-behavior`) are the active ingredients,
not the specific selectors.

**3.** (Optional) Add `ViewportDebug.svelte` in dev mode for real-time
diagnostics — see below.

## Debug overlay

`ViewportDebug.svelte` renders a small overlay in the bottom-right corner
showing every relevant value per animation frame. Use it when debugging a
specific bug on a real device (iOS Safari remote DevTools via USB is limited;
this overlay gives you ground truth).

Render only in dev builds:

```svelte
{#if import.meta.env.DEV}
  <ViewportDebug />
{/if}
```

### What it displays

- **Versions** — overlay version, viewport.js version (`VIEWPORT_VERSION`), load time.
  Bump constants when you modify the code; overlay shows which build is running.
- **Frame counter + visibility state** — useful for catching bugs in
  background/restore transitions.
- **Window / visual viewport geometry** — scroll, innerHeight, vv.height, offsetTop, scale.
- **`document.documentElement.scrollTop` + `body.scrollTop`** — alternative
  scroll paths iOS sometimes uses.
- **`--kb-inset` live value** — sanity-check keyboard height measurement.
- **`.app-header` / `.app-sheet` `getBoundingClientRect()`** — verify fixed
  elements are positioned as expected.
- **`.sheet-content` scrollTop / scrollHeight / clientHeight +
  computed `scroll-padding-bottom`** — useful when scrollIntoView isn't behaving.
- **Focus event counter + active element** — verify focus is actually
  happening on the element you expect.
- **MAX tracker** — retains peak values (vv.offsetTop, scrollY,
  sheet-content scrollTop) until you tap to reset. Catches anomalies that
  appear for one frame and disappear.

### Yellow warnings

Any row highlighted yellow indicates a violation of the layout invariants:

| Row | Yellow when |
|---|---|
| `win ... scroll y=X x=Y` | `window.scrollY !== 0` or `scrollX !== 0` |
| `vv ... top=T left=L s=S` | `vv.offsetTop !== 0`, `vv.offsetLeft !== 0`, or `vv.scale !== 1` |
| `doc.sT=X body.sT=Y` | `document.documentElement.scrollTop !== 0` or `body.scrollTop !== 0` |
| `.app-header top=X bot=Y` | `rect.top < 0` (header shifted above viewport) |
| `.app-sheet top=X bot=Y` | `rect.top < 0` (sheet extends above viewport) |
| `.sheet-content scroll-padding-bot=W` | kb-inset > 0 but scroll-padding-bottom is `0px` (CSS not applied) |
| `MAX vvt=X sy=Y scST=M` | Peak values captured something nonzero |

**Tap the overlay to reset max counters.** The overlay is a `<button>` —
regular tap works even with touch-action settings elsewhere.

### Position

The overlay is anchored to `bottom: calc(env(safe-area-inset-bottom) +
var(--kb-inset) + 1.5rem)` so it floats above the home indicator and
automatically rises above the keyboard when it opens.

## Behavior versioning

Both files export / declare a version constant (`VIEWPORT_VERSION` in
`viewport.js`, `OVERLAY_VERSION` in the `.svelte` file). Bump them whenever
you change behavior — the overlay displays both plus `loaded HH:MM:SS`
(time the component module was evaluated), so you can confirm HMR / hard
reload picked up the latest code on-device.

## Known limitations

- **Chrome's `VirtualKeyboard API`** (`navigator.virtualKeyboard.overlaysContent`) is not used — it's not supported on iOS Safari, and our shim already handles what it would provide via `--kb-inset`. You can layer it on if you want parity on Chrome-based platforms.
- **Very old iOS (< 14)** may lack `visualViewport` support; the shim falls
  back to leaving `--kb-inset: 0` which is the same as no-keyboard state.
- **The monkey-patch is invisible** — a developer reading `input.focus()`
  elsewhere in the codebase won't see `preventScroll` being forced. Document
  that `viewport.js` exists and is the single source of truth for form-focus
  behavior.

## License

MIT — use, adapt, republish as you see fit.

## Credits

Extracted from the [Spevník](https://spevnik.online) mobile-first PWA. The
iteration history is visible in the git log of the containing project if you
want to see the dead ends (rAF polling, ghost-click suppression, manual
scrollTop calculations) that got pruned as we understood the problem better.
