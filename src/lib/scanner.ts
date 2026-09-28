import { useEffect, useRef } from 'react'

/**
 * Keyboard-wedge (HID) scanner support.
 * Bluetooth / USB barcode & QR scanners (cLabel, Netum, Eyoyo, Inateck, generic
 * "BarCode Scanner HID" units…) pair in the phone's Bluetooth settings as a
 * keyboard: they "type" the code fast and usually finish with Enter.
 *
 * Two capture paths, because platforms behave differently:
 *
 *  1. keydown wedge — desktop Chrome/Edge and scanners that deliver real key
 *     events. Characters are collected from fast keydown bursts.
 *
 *  2. input wedge — Android. Mobile Chrome routes physical-keyboard input
 *     through the IME, so keydown reports keyCode 229 / key "Unidentified" and
 *     the characters ONLY appear via `input` events on the focused text field.
 *     We track fast text insertions per field and finalize on Enter
 *     (keydown 'Enter' or beforeinput 'insertLineBreak').
 *
 * A field marked `data-scan-trap` (see <ScanTrap/> on the POS) is an invisible
 * always-focused input that gives scans somewhere to land when the cashier is
 * not in a text box — there scans also finalize after a short idle even if the
 * scanner sends no Enter suffix.
 */

const KEY_GAP_MS = 100    // max gap between keydown chars of one scan burst
const INPUT_GAP_MS = 250  // Bluetooth HID via IME can pause 100–200 ms between chars
const MIN_LEN = 3
const TRAP_IDLE_MS = 350  // finalize trap scans that have no Enter suffix

type Editable = HTMLInputElement | HTMLTextAreaElement
const editable = (t: EventTarget | null): Editable | null => {
  const el = t as HTMLElement | null
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? (el as Editable) : null
}

let kbuf = ''
let klast = 0
interface Burst { text: string; last: number }
const bursts = new WeakMap<Editable, Burst>()
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
    if (el.dataset.scanTrap != null) setNativeValue(el, '')
    else if (el.dataset.keepScan == null && el.value.endsWith(code)) setNativeValue(el, el.value.slice(0, -code.length))
  }
  window.dispatchEvent(new CustomEvent('barcode', { detail: { code, source: 'hid' } }))
}

function onKeyDown(e: KeyboardEvent) {
  const now = performance.now()
  if (now - klast > KEY_GAP_MS) kbuf = ''
  klast = now
  if (e.key === 'Enter' || e.key === 'Tab') {
    const el = editable(e.target)
    const burst = el ? bursts.get(el) : undefined
    if (kbuf.length >= MIN_LEN) {
      const code = kbuf
      kbuf = ''
      e.preventDefault()
      emit(code, el)
    } else if (el && burst && burst.text.length >= MIN_LEN && now - burst.last <= INPUT_GAP_MS) {
      // Android IME path: the characters never reached keydown, but the burst
      // landed in the focused input just before this Enter.
      e.preventDefault()
      emit(burst.text, el)
    }
    kbuf = ''
    return
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) kbuf += e.key
}

/** Some scanners terminate with a newline that arrives as an input mutation, not a key. */
function onBeforeInput(e: Event) {
  const ie = e as InputEvent
  if (ie.inputType !== 'insertLineBreak') return
  const el = editable(e.target)
  if (!el) return
  const burst = bursts.get(el)
  if (burst && burst.text.length >= MIN_LEN && performance.now() - burst.last <= INPUT_GAP_MS) {
    e.preventDefault()
    emit(burst.text, el)
  }
}

function onInput(e: Event) {
  const ie = e as InputEvent
  const el = editable(e.target)
  if (!el) return
  const data = ie.data ?? ''
  // Deletions, IME junk, whitespace or our own synthetic events reset the burst —
  // barcodes are inserted as clean printable characters.
  if (!data || /\s/.test(data) || typeof ie.inputType !== 'string' || !ie.inputType.startsWith('insert')) {
    bursts.delete(el)
    scheduleTrapFlush(el)
    return
  }
  const now = performance.now()
  const b = bursts.get(el)
  if (!b || now - b.last > INPUT_GAP_MS) bursts.set(el, { text: data, last: now })
  else { b.text += data; b.last = now }
  scheduleTrapFlush(el)
}

/** The trap has no user typing, so scans there may finalize on idle (no-suffix scanners). */
function scheduleTrapFlush(el: Editable) {
  if (el.dataset.scanTrap == null) return
  window.clearTimeout(trapTimer)
  trapTimer = window.setTimeout(() => {
    const b = bursts.get(el)
    if (b && b.text.length >= MIN_LEN) emit(b.text, el)
    else if (el.value) setNativeValue(el, '')
    bursts.delete(el)
  }, TRAP_IDLE_MS)
}

export function installHidScanner() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('beforeinput', onBeforeInput, true)
  window.addEventListener('input', onInput, true)
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
