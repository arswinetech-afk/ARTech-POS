import { useEffect, useRef, useState } from 'react'
import { X, Zap, ZapOff, SwitchCamera } from 'lucide-react'
import { beep } from '../lib/scanner'

interface Props {
  onScan: (code: string) => void | boolean   // return false to keep scanning without cooldown
  onClose: () => void
  continuous?: boolean
  title?: string
}

/**
 * Camera barcode / QR scanner.
 * Uses the native BarcodeDetector API (fast, Chrome/Android) and falls back to
 * ZXing (loaded on demand) on browsers without it (iOS Safari, Firefox).
 */
export default function CameraScanner({ onScan, onClose, continuous = false, title = 'Scan barcode or QR' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [torch, setTorch] = useState(false)
  const [torchOk, setTorchOk] = useState(false)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [last, setLast] = useState<string | null>(null)
  const [engine, setEngine] = useState<'native' | 'zxing' | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)

  useEffect(() => {
    let stop = false
    let stream: MediaStream | null = null
    let raf = 0
    let zxingControls: { stop: () => void } | null = null
    let lastCode = ''
    let lastAt = 0

    const handle = (code: string) => {
      const now = Date.now()
      if (code === lastCode && now - lastAt < 1800) return
      lastCode = code; lastAt = now
      beep(true)
      setLast(code)
      const r = onScan(code)
      if (!continuous && r !== false) onClose()
    }

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        })
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return }
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        const track = stream.getVideoTracks()[0]
        trackRef.current = track
        const caps = (track.getCapabilities?.() || {}) as MediaTrackCapabilities & { torch?: boolean }
        setTorchOk(!!caps.torch)

        if ('BarcodeDetector' in window) {
          setEngine('native')
          const formats = await BarcodeDetector.getSupportedFormats().catch(() => [] as string[])
          const detector = new BarcodeDetector(formats.length ? { formats } : undefined)
          const loop = async () => {
            if (stop) return
            if (video.readyState >= 2) {
              try {
                const codes = await detector.detect(video)
                if (codes.length && codes[0].rawValue) handle(codes[0].rawValue)
              } catch { /* frame skipped */ }
            }
            raf = window.setTimeout(loop, 120) as unknown as number
          }
          loop()
        } else {
          setEngine('zxing')
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          zxingControls = await reader.decodeFromStream(stream, video, (result) => {
            if (result) handle(result.getText())
          })
        }
      } catch (e) {
        setError((e as Error).message?.includes('Permission') || (e as Error).name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access in your browser settings.'
          : `Camera unavailable: ${(e as Error).message}`)
      }
    }
    start()
    return () => {
      stop = true
      if (raf) clearTimeout(raf)
      zxingControls?.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [facing]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTorch = async () => {
    const track = trackRef.current
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] })
      setTorch(!torch)
    } catch { /* unsupported */ }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black text-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/60 backdrop-blur">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-white/60">{engine === 'native' ? 'Fast native scanner' : engine === 'zxing' ? 'Compatibility scanner' : 'Starting camera…'}{continuous ? ' · continuous mode' : ''}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')} className="p-2 rounded-full bg-white/10" aria-label="Switch camera"><SwitchCamera size={20} /></button>
          {torchOk && <button onClick={toggleTorch} className="p-2 rounded-full bg-white/10" aria-label="Torch">{torch ? <ZapOff size={20} /> : <Zap size={20} />}</button>}
          <button onClick={onClose} className="p-2 rounded-full bg-white/10" aria-label="Close"><X size={20} /></button>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[78%] max-w-sm aspect-[4/3] rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,.45)] relative overflow-hidden">
            <div className="absolute left-0 right-0 h-0.5 bg-brand-400 animate-[scan_2s_ease-in-out_infinite]" />
          </div>
        </div>
        {error && <div className="absolute inset-x-4 bottom-24 bg-red-600/90 rounded-xl p-3 text-sm">{error}</div>}
        {last && <div className="absolute inset-x-4 bottom-6 bg-brand-600 rounded-xl px-4 py-3 text-sm font-medium animate-fade-in">Scanned: <span className="font-mono">{last}</span></div>}
      </div>
      <style>{`@keyframes scan{0%{top:4%}50%{top:94%}100%{top:4%}}`}</style>
    </div>
  )
}
