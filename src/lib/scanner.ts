import { useEffect, useRef } from 'react'

/**
 * Keyboard-wedge (HID) scanner support.
 * Bluetooth / USB barcode scanners pair in the phone's Bluetooth settings as a
 * keyboard: they "type" the code fast and usually finish with Enter.
 *
 * Android routes physical-keyboard input through the active IME (Gboard, vivo /
 * Samsung keyboards…), and every vendor behaves differently, so we listen on
 * EVERY channel the characters can arrive by and reconcile:
 *
 *  1. keydown  — desktop and devices that deliver real key events
 *  2. keypress — devices where keydown reports 229/"Unidentified" but keypress
 *                still carries the character (some Samsung/vivo keyboards)
 *  3. input    — IME-committed text: we diff the field's value on every input
 *                event, which also survives autocorrect/composition rewriting
 *
 * A scan is finalized by Enter/Tab (keydown, keypress, `insertLineBreak`, or a
 * newline committed as text) — or after a short idle for fields marked
 * `data-scan-trap` (the invisible POS trap and the Settings tester), so
 * scanners with no Enter suffix work there too.
 */

const KEY_GAP_MS = 100    // max gap between keydown/keypress chars of one burst
const INPUT_GAP_MS = 250  // Bluetooth HID via the IME can pause 100–200 ms
const MIN_LEN = 3
const TRAP_IDLE_MS = 400  // finalize trap scans that have no Enter suffix
const KBUF_FLUSH_LEN = 8  // no-suffix flush for raw-key bursts (EAN-8 and up)

type Editable = HTMLInputElement | HTMLTextAreaElement
const editable = (t: EventTarget | null): Editable | null => {
  const el = t as HTMLElement | null
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? (el as Editable) : null
}
const isTrap = (el: Editable) => el.dataset.scanTrap != null

let kbuf = ''
let klast = 0
let kTimer: number | undefined
let lastKeyWasIme = false // last keydown was 229/"Unidentified" → trust keypress for the char

interface Burst { text: string; last: number }
const bursts = new WeakMap<Editable, Burst>()
const snap = new WeakMap<Editable, string>() // last known value per field (for diffing)
let trapTimer: number | undefined
let installed = false

/** Set an input's value the React-friendly way (so controlled inputs update). */
function setNativeValue(el: Editable, value: string) {
  const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function emit(code: string, el: Editable | null) {
  if (el) {
    bursts.delete(el)
    // Clean the code out of the field so it doesn't linger (traps are always cleared).
    if (isTrap(el)) setNativeValue(el, '')
    else if (el.dataset.keepScan == null && el.value.endsWith(code)) setNativeValue(el, el.value.slice(0, -code.length))
  }
  window.dispatchEvent(new CustomEvent('barcode', { detail: { code, source: 'hid' } }))
}

/** Enter/Tab (however it arrived): emit the best buffer we have. */
function finalize(el: Editable | null, e?: Event): boolean {
  const now = performance.now()
  window.clearTimeout(kTimer)
  if (kbuf.length >= MIN_LEN && now - klast <= INPUT_GAP_MS) {
    const code = kbuf
    kbuf = ''
    e?.preventDefault()
    emit(code, el)
    return true
  }
  kbuf = ''
  const b = el ? bursts.get(el) : undefined
  if (el && b && b.text.length >= MIN_LEN && now - b.last <= INPUT_GAP_MS + 100) {
    e?.preventDefault()
    emit(b.text, el)
    return true
  }
  return false
}

function pushKey(ch: string) {
  const now = performance.now()
  if (now - klast > KEY_GAP_MS) kbuf = ''
  klast = now
  kbuf += ch
  // Scanners with no Enter suffix: flush a long fast burst after a short idle.
  window.clearTimeout(kTimer)
  if (kbuf.length >= KBUF_FLUSH_LEN) {
    kTimer = window.setTimeout(() => {
      if (kbuf.length >= KBUF_FLUSH_LEN) { const code = kbuf; kbuf = ''; emit(code, editable(document.activeElement)) }
    }, TRAP_IDLE_MS)
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Unidentified' || e.keyCode === 229) { lastKeyWasIme = true; return }
  lastKeyWasIme = false
  if (e.key === 'Enter' || e.key === 'Tab') { finalize(editable(e.target), e); return }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (/\s/.test(e.key)) { kbuf = ''; return }
    pushKey(e.key)
  } else if (e.key.length > 1) {
    klast = performance.now() // navigation keys break a burst window but keep timing sane
  }
}

/** Rescue path: some Android keyboards blank out keydown but still fire keypress with the char. */
function onKeyPress(e: KeyboardEvent) {
  const which = e.which || e.keyCode
  if (e.key === 'Enter' || which === 13) { finalize(editable(e.target), e); return }
  if (!lastKeyWasIme) return // real keydown already captured this char
  const ch = e.key && e.key.length === 1 ? e.key : which ? String.fromCharCode(which) : ''
  if (ch && !/\s/.test(ch)) pushKey(ch)
}

/** Some scanners terminate with a newline that arrives as an input mutation, not a key. */
function onBeforeInput(e: Event) {
  const ie = e as InputEvent
  if (ie.inputType !== 'insertLineBreak') return
  finalize(editable(e.target), e)
}

/** IME path: diff the field value on every input event — survives composition/autocorrect. */
function onInput(e: Event) {
  const el = editable(e.target)
  if (!el) return
  const cur = el.value
  const prev = snap.get(el) ?? ''
  snap.set(el, cur)
  if (cur === prev) {
    // No visible change — e.g. the scanner's CR suffix, which <input> sanitizes away.
    if ((e as InputEvent).inputType === 'insertLineBreak') finalize(el)
    else if (isTrap(el)) scheduleTrapFlush(el)
    return
  }
  if (cur.length < prev.length) { // deletion / clear
    bursts.delete(el)
    if (isTrap(el)) scheduleTrapFlush(el)
    return
  }
  let inserted: string
  if (cur.startsWith(prev)) inserted = cur.slice(prev.length)
  else { // composition rewrote earlier text — take everything past the common prefix
    let i = 0
    while (i < prev.length && prev[i] === cur[i]) i++
    inserted = cur.slice(i)
  }
  const nl = inserted.search(/[\r\n]/)
  if (nl >= 0) { // newline committed as text = the scanner's Enter suffix
    appendBurst(el, inserted.slice(0, nl))
    finalize(el)
    return
  }
  if (/\s/.test(inserted)) { bursts.delete(el); return } // barcodes have no spaces
  appendBurst(el, inserted)
  if (isTrap(el)) scheduleTrapFlush(el)
}

function appendBurst(el: Editable, text: string) {
  if (!text) return
  const now = performance.now()
  const b = bursts.get(el)
  if (!b || now - b.last > INPUT_GAP_MS) bursts.set(el, { text, last: now })
  else { b.text += text; b.last = now }
}

/** Trap fields have no human typing, so scans there may finalize on idle (no-suffix scanners). */
function scheduleTrapFlush(el: Editable) {
  window.clearTimeout(trapTimer)
  trapTimer = window.setTimeout(() => {
    const b = bursts.get(el)
    if (b && b.text.length >= MIN_LEN) emit(b.text, el)
    else if (el.value) setNativeValue(el, '')
    bursts.delete(el)
  }, TRAP_IDLE_MS)
}

function onFocusIn(e: FocusEvent) {
  const el = editable(e.target)
  if (el) { snap.set(el, el.value); bursts.delete(el) }
}

export function installHidScanner() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keypress', onKeyPress, true)
  window.addEventListener('beforeinput', onBeforeInput, true)
  window.addEventListener('input', onInput, true)
  window.addEventListener('focusin', onFocusIn, true)
}

export function emitBarcode(code: string, source: 'camera' | 'hid' | 'manual' = 'manual') {
  window.dispatchEvent(new CustomEvent('barcode', { detail: { code, source } }))
}

/** Subscribe to scans from any source (HID wedge, camera, manual). */
export function useBarcode(handler: (code: string, source: string) => void, enabled = true) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    const fn = (e: Event) => { const d = (e as CustomEvent).detail; ref.current(d.code, d.source) }
    window.addEventListener('barcode', fn)
    return () => window.removeEventListener('barcode', fn)
  }, [enabled])
}

let audioCtx: AudioContext | null = null
export function beep(ok = true) {
  try {
    audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain()
    o.type = 'square'; o.frequency.value = ok ? 1800 : 300
    g.gain.value = 0.06
    o.connect(g); g.connect(audioCtx.destination)
    o.start(); o.stop(audioCtx.currentTime + (ok ? 0.08 : 0.25))
    if (navigator.vibrate) navigator.vibrate(ok ? 30 : [80, 40, 80])
  } catch { /* ignore */ }
}
