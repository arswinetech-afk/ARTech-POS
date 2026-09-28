import { useEffect, useRef } from 'react'

/**
 * Invisible input that quietly holds keyboard focus while the POS is idle, so a
 * Bluetooth/USB HID scanner always has a text field to "type" into — required on
 * Android, where physical-keyboard input only reliably reaches the page through
 * a focused editable element (it is routed via the IME).
 *
 * - `inputMode="none"` keeps the on-screen keyboard away.
 * - It never steals focus from a real input/textarea/select the user is using.
 * - The scanner wedge (lib/scanner.ts) recognises it via `data-scan-trap`,
 *   emits the scanned code and clears it, even when the scanner sends no
 *   Enter suffix.
 */
export default function ScanTrap({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!enabled) return
    const isEditing = () => {
      const ae = document.activeElement as HTMLElement | null
      return !!ae && ae !== ref.current && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)
    }
    const grab = () => { if (ref.current && !isEditing()) ref.current.focus({ preventScroll: true }) }
    grab()
    const onFocusOut = () => window.setTimeout(grab, 200)
    document.addEventListener('focusout', onFocusOut)
    const iv = window.setInterval(grab, 2500)
    return () => { document.removeEventListener('focusout', onFocusOut); window.clearInterval(iv) }
  }, [enabled])

  if (!enabled) return null
  return (
    <input
      ref={ref}
      data-scan-trap=""
      aria-hidden
      tabIndex={-1}
      inputMode="none"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className="fixed top-0 left-0 w-px h-px opacity-0 pointer-events-none"
    />
  )
}
