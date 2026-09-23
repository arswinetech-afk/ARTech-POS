import { useEffect, useRef } from 'react'

/**
 * Keyboard-wedge (HID) scanner support.
 * Bluetooth / USB barcode & QR scanners (e.g. cLabel, Netum, Eyoyo, Inateck)
 * behave like a keyboard: they type the code very fast and finish with Enter.
 * We detect that burst anywhere in the app and emit a `barcode` event.
 */
const MAX_GAP_MS = 60
const MIN_LEN = 3

let buffer = ''
let last = 0
let installed = false

function onKey(e: KeyboardEvent) {
  const now = performance.now()
  if (now - last > MAX_GAP_MS) buffer = ''
  last = now
  if (e.key === 'Enter' || e.key === 'Tab') {
    if (buffer.length >= MIN_LEN) {
      const code = buffer
      buffer = ''
      const target = e.target as HTMLElement | null
      // If the scanner typed into an input, clean it up so the code doesn't linger.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !(target as HTMLInputElement).dataset.keepScan) {
        const input = target as HTMLInputElement
        if (input.value.endsWith(code)) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          setter?.call(input, input.value.slice(0, -code.length))
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('barcode', { detail: { code, source: 'hid' } }))
    }
    buffer = ''
    return
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) buffer += e.key
}

export function installHidScanner() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('keydown', onKey, true)
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
