/** Bump on any behavior change (this file, AppSheet.svelte viewport CSS,
 *  app.css .app-content/scroll-padding rules) so overlay can display it. */
export const VIEWPORT_VERSION = '1.9';

/**
 * iOS/mobile viewport & keyboard compatibility shim.
 *
 * Context: this SPA is mobile-first with strict layout invariants —
 *   - html/body are non-scrollable (`overflow: hidden; height: 100dvh`)
 *   - `.app-header` (fixed top) and `.app-bar-wrapper` (fixed bottom) are
 *     anchored to the layout viewport
 *   - `.app-sheet` (fixed bottom) positions itself relative to the keyboard
 *   - real scrolling happens inside `.app-content` and `.sheet-content`
 *
 * iOS Safari doesn't respect `overflow: hidden` when a virtual keyboard
 * opens — it may auto-scroll the document and/or pan the visual viewport
 * to bring the focused element into view. Both break the layout invariants
 * above (e.g. app-header disappears off-screen during keyboard animation).
 *
 * This module installs four globally-active compensations. Call once from
 * the root `+layout.svelte onMount`; it returns a teardown function.
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ (1) visualViewport tracker → --kb-inset                            │
 *   │                                                                    │
 *   │   Measures keyboard height via visualViewport API and writes it    │
 *   │   to the CSS custom property `--kb-inset` on documentElement.      │
 *   │                                                                    │
 *   │   Consumer: `.app-sheet { bottom: var(--kb-inset, 0px); ... }`.    │
 *   │   Updates on vv 'resize' (keyboard open/close) and 'scroll' (pan). │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ (2) touchstart capture → preemptive focus({ preventScroll: true }) │
 *   │                                                                    │
 *   │   On a native tap of an input/textarea/select, the browser would   │
 *   │   synthesize a focus event which iOS handles by auto-scrolling/    │
 *   │   panning the visual viewport. By pre-focusing the target in the   │
 *   │   touchstart capture phase with `preventScroll: true`, the later   │
 *   │   native focus event sees the element as already focused and      │
 *   │   skips iOS' auto-scroll logic. No pan → no flash of app-header.   │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ (3) Prototype monkey-patch → .focus() on form controls always      │
 *   │     uses `preventScroll: true` + explicit scrollIntoView           │
 *   │                                                                    │
 *   │   After `focus({preventScroll:true})` we schedule scrollIntoView   │
 *   │   on the next frame. Reason: preventScroll blocks both iOS auto-  │
 *   │   pan AND browser's scroll-focused-element-into-view. The former  │
 *   │   is what we want to block; the latter we need to restore — so    │
 *   │   inputs at the bottom of scroll containers (e.g. textarea in a   │
 *   │   tall sheet-content) still end up visible above the keyboard.    │
 *   │                                                                    │
 *   │   The explicit scrollIntoView call scrolls only DOM scrollable    │
 *   │   ancestors; iOS does not intercept it as a pan trigger. Uses     │
 *   │   block:'center' + scroll-padding-bottom:var(--kb-inset) on       │
 *   │   .sheet-content/.app-content so the target lands in the center   │
 *   │   of the compressed optimal region (upper portion above keyboard) │
 *   │   with breathing room, not flush against the keyboard edge.       │
 *   │                                                                    │
 *   │   Covers programmatic focus paths that don't go through touch:     │
 *   │     - onclick handlers calling `inputEl.focus()`                   │
 *   │     - component autofocus on mount / open                          │
 *   │     - any third-party / future code that invokes .focus()          │
 *   │                                                                    │
 *   │   Affected prototypes: HTMLInputElement, HTMLTextAreaElement,      │
 *   │   HTMLSelectElement. Other elements (buttons, divs) are untouched. │
 *   │                                                                    │
 *   │   ⚠️ Invisible behavior — devs writing `input.focus()` will NOT    │
 *   │      see preventScroll+scrollIntoView running. This file is the    │
 *   │      single source of truth for that guarantee.                    │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ (4) background / restore lifecycle → blur + reset scroll           │
 *   │                                                                    │
 *   │   iOS Safari (PWA) snapshots the app with focused input + open     │
 *   │   keyboard when backgrounded. On restore it actively maintains     │
 *   │   scroll position to keep input visible above keyboard — breaking  │
 *   │   our body{overflow:hidden} invariant (doc.scrollTop != 0, visual  │
 *   │   viewport panned, fixed elements shifted).                        │
 *   │                                                                    │
 *   │   scrollTo(0,0) alone does not stick: iOS re-scrolls because the   │
 *   │   input is still focused. Fix: blur any focused form control on    │
 *   │   BOTH hide (preemptive) and show (fallback). Blurring closes the  │
 *   │   keyboard and releases iOS' "maintain focus visibility" loop so   │
 *   │   scroll state can reset.                                          │
 *   │                                                                    │
 *   │   Listens on: visibilitychange (hidden/visible), pagehide (fired   │
 *   │   before iOS snapshot + on bfcache save), pageshow (fired after    │
 *   │   bfcache restore).                                                │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * @returns {() => void} teardown — removes listeners and restores original
 *   .focus() implementations. Call from onMount's return.
 */
export function setupViewport() {
  // (1) visualViewport → --kb-inset
  // When kb-inset transitions 0 → >0 (keyboard finishing open), also re-scroll
  // the focused input into view: the first scrollIntoView from the focus event
  // runs BEFORE --kb-inset updates, so scroll-padding-bottom is still 0 and
  // sheet-content has no scroll range yet (padding-bottom hasn't expanded).
  let lastInset = 0;
  const syncKbInset = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb-inset', `${inset}px`);
    if (inset > 0 && lastInset === 0) {
      const a = document.activeElement;
      if (a?.matches?.('input, textarea, select')) {
        requestAnimationFrame(() => a.scrollIntoView?.({ block: 'center' }));
      }
    }
    lastInset = inset;
  };
  syncKbInset();
  window.visualViewport?.addEventListener('resize', syncKbInset);
  window.visualViewport?.addEventListener('scroll', syncKbInset);

  // (2) touchstart → preemptive focus(preventScroll) for native input taps
  const preemptFocus = (e) => {
    const t = e.target;
    if (t?.matches?.('input, textarea, select') && document.activeElement !== t) {
      t.focus({ preventScroll: true });
    }
  };
  document.addEventListener('touchstart', preemptFocus, { capture: true, passive: true });

  // (3) Monkey-patch .focus() on form-control prototypes
  const FORM_PROTOS = [HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement];
  const originals = FORM_PROTOS.map((Proto) => {
    const orig = Proto.prototype.focus;
    Proto.prototype.focus = function (opts) {
      const result = orig.call(this, { ...opts, preventScroll: true });
      requestAnimationFrame(() => this.scrollIntoView?.({ block: 'center' }));
      return result;
    };
    return [Proto, orig];
  });

  // (4) Background/restore lifecycle — blur + reset.
  //
  // When app is backgrounded with a focused input+open keyboard, iOS takes
  // a snapshot of that state and actively maintains scroll position on
  // restore to keep the input visible above keyboard. That breaks our
  // body{overflow:hidden} invariant — doc.scrollTop != 0, visualViewport
  // panned, fixed elements shifted. scrollTo(0,0) alone doesn't stick:
  // iOS immediately re-scrolls because the textarea is still focused.
  //
  // Fix: blur any focused form control on hide AND on show. Blurring
  // closes the keyboard and releases iOS' "maintain focus visibility"
  // loop, letting scroll state reset stick.
  const blurActiveFormControl = () => {
    const a = document.activeElement;
    if (a?.matches?.('input, textarea, select')) a.blur();
  };
  const resetScroll = () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
  };
  const onShow = () => {
    blurActiveFormControl();
    resetScroll();
    syncKbInset();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') blurActiveFormControl();
    else if (document.visibilityState === 'visible') onShow();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', blurActiveFormControl);
  window.addEventListener('pageshow', onShow);

  return () => {
    window.visualViewport?.removeEventListener('resize', syncKbInset);
    window.visualViewport?.removeEventListener('scroll', syncKbInset);
    document.removeEventListener('touchstart', preemptFocus, { capture: true });
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', blurActiveFormControl);
    window.removeEventListener('pageshow', onShow);
    originals.forEach(([Proto, orig]) => {
      Proto.prototype.focus = orig;
    });
  };
}
