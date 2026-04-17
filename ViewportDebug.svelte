<script>
  import { onMount } from 'svelte';
  import { VIEWPORT_VERSION } from '$lib/utils/viewport.js';

  /** Bump on any overlay change — helps verify HMR loaded latest. */
  const OVERLAY_VERSION = '1.5';
  const LOADED_AT = new Date().toTimeString().slice(0, 8);

  let state = $state({
    t: 0,
    frame: 0,
    sy: 0,
    sx: 0,
    iwh: 0,
    iww: 0,
    vvh: 0,
    vvw: 0,
    vvt: 0,
    vvl: 0,
    vvs: 1,
    dseT: 0,
    bseT: 0,
    kbi: '',
    hdrTop: 0,
    hdrBottom: 0,
    sheetTop: 0,
    sheetBottom: 0,
    sheetVisible: false,
    activeTag: '',
    activeRect: '',
    vis: 'visible',
    visChanged: 0,
    // Scroll container diagnostics for the open sheet
    scST: 0,       // scroll-content current scrollTop
    scSH: 0,       // scroll-content scrollHeight
    scCH: 0,       // scroll-content clientHeight
    scPadB: '',    // computed scroll-padding-bottom
    focusN: 0,     // count of focus events on form controls since mount
    focusLastAt: 0,
  });

  let maxVvt = $state(0);
  let maxSy = $state(0);
  let maxScST = $state(0);

  function read() {
    const vv = window.visualViewport;
    state.frame++;
    state.t = Math.round(performance.now());
    state.sy = Math.round(window.scrollY);
    state.sx = Math.round(window.scrollX);
    state.iwh = window.innerHeight;
    state.iww = window.innerWidth;
    state.vvh = vv ? Math.round(vv.height) : 0;
    state.vvw = vv ? Math.round(vv.width) : 0;
    state.vvt = vv ? Math.round(vv.offsetTop * 100) / 100 : 0;
    state.vvl = vv ? Math.round(vv.offsetLeft * 100) / 100 : 0;
    state.vvs = vv ? Math.round(vv.scale * 1000) / 1000 : 1;
    state.dseT = Math.round(document.documentElement.scrollTop);
    state.bseT = Math.round(document.body.scrollTop);
    state.kbi = getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim();
    const hdr = document.querySelector('.app-header');
    if (hdr) {
      const r = hdr.getBoundingClientRect();
      state.hdrTop = Math.round(r.top);
      state.hdrBottom = Math.round(r.bottom);
    }
    // Query the currently OPEN sheet (aria-modal="true") — a page may have
    // multiple closed sheets in DOM (translate-y-full) which would otherwise
    // match the generic .app-sheet selector and give wrong coordinates.
    const sheet = document.querySelector('.app-sheet[aria-modal="true"]');
    if (sheet) {
      const r = sheet.getBoundingClientRect();
      state.sheetTop = Math.round(r.top);
      state.sheetBottom = Math.round(r.bottom);
      state.sheetVisible = true;
      const sc = sheet.querySelector('.sheet-content');
      if (sc) {
        state.scST = Math.round(sc.scrollTop);
        state.scSH = Math.round(sc.scrollHeight);
        state.scCH = Math.round(sc.clientHeight);
        state.scPadB = getComputedStyle(sc).scrollPaddingBottom || '—';
        if (state.scST > maxScST) maxScST = state.scST;
      }
    } else {
      state.sheetVisible = false;
    }
    const a = document.activeElement;
    if (a && a !== document.body) {
      state.activeTag = a.tagName.toLowerCase();
      const r = a.getBoundingClientRect();
      state.activeRect = `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    } else {
      state.activeTag = '';
      state.activeRect = '';
    }
    if (state.vvt > maxVvt) maxVvt = state.vvt;
    if (state.sy > maxSy) maxSy = state.sy;
  }

  function resetMax() {
    maxVvt = 0;
    maxSy = 0;
    maxScST = 0;
    state.focusN = 0;
  }

  onMount(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      read();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const onVis = () => {
      state.vis = document.visibilityState;
      state.visChanged = Math.round(performance.now());
    };
    const onPageshow = (e) => {
      state.vis = `pageshow${e.persisted ? ':persisted' : ''}`;
      state.visChanged = Math.round(performance.now());
    };
    const onFocusIn = (e) => {
      if (e.target?.matches?.('input, textarea, select')) {
        state.focusN++;
        state.focusLastAt = Math.round(performance.now());
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onPageshow);
    document.addEventListener('focusin', onFocusIn, { capture: true });
    onVis();

    return () => {
      running = false;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onPageshow);
      document.removeEventListener('focusin', onFocusIn, { capture: true });
    };
  });
</script>

<button class="vp-debug" onclick={resetMax} type="button" aria-label="Reset viewport debug max values">
  <div><b>overlay v{OVERLAY_VERSION}</b> / viewport v{VIEWPORT_VERSION} / loaded {LOADED_AT}</div>
  <div><b>f#{state.frame}</b> t={state.t}ms vis={state.vis}@{state.visChanged}</div>
  <div class={state.sy !== 0 || state.sx !== 0 ? 'warn' : ''}>win {state.iww}x{state.iwh} scroll y={state.sy} x={state.sx}</div>
  <div class={state.vvt !== 0 || state.vvl !== 0 || state.vvs !== 1 ? 'warn' : ''}>vv {state.vvw}x{state.vvh} top={state.vvt} left={state.vvl} s={state.vvs}</div>
  <div class={state.dseT !== 0 || state.bseT !== 0 ? 'warn' : ''}>doc.sT={state.dseT} body.sT={state.bseT}</div>
  <div>--kb-inset={state.kbi || '—'}</div>
  <div class={state.hdrTop < 0 ? 'warn' : ''}>.app-header top={state.hdrTop} bot={state.hdrBottom}</div>
  {#if state.sheetVisible}
    <div class={state.sheetTop < 0 ? 'warn' : ''}>.app-sheet top={state.sheetTop} bot={state.sheetBottom}</div>
    <div>.sheet-content sT={state.scST} sH={state.scSH} cH={state.scCH}</div>
    <div class={state.kbi !== '0px' && state.kbi !== '' && state.scPadB === '0px' ? 'warn' : ''}>.sheet-content scroll-padding-bot={state.scPadB}</div>
  {/if}
  <div>focus n={state.focusN}@{state.focusLastAt}</div>
  {#if state.activeTag}
    <div>focus={state.activeTag} {state.activeRect}</div>
  {/if}
  <div class={maxVvt !== 0 || maxSy !== 0 ? 'max warn' : 'max'}>MAX vvt={maxVvt} sy={maxSy} scST={maxScST} (tap=reset)</div>
</button>

<style>
  .vp-debug {
    position: fixed;
    bottom: calc(env(safe-area-inset-bottom, 0px) + var(--kb-inset, 0px) + 1.5rem);
    right: 0.5rem;
    z-index: 99999;
    background: rgba(255, 0, 64, 0.92);
    color: white;
    font-family: ui-monospace, monospace;
    font-size: 10px;
    line-height: 1.3;
    padding: 4px 6px;
    max-width: calc(100vw - 1rem);
    text-align: left;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }
  .warn {
    background: yellow;
    color: black;
  }
  .max {
    margin-top: 2px;
    padding-top: 2px;
    border-top: 1px dashed rgba(255, 255, 255, 0.5);
  }
</style>
