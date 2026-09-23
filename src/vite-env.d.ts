/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_SYSTEM_ADMIN_EMAIL: string
  readonly VITE_GCASH_NUMBER: string
  readonly VITE_GCASH_NAME: string
}

// Native barcode detector (Chrome / Android). Falls back to ZXing when absent.
declare class BarcodeDetector {
  constructor(options?: { formats?: string[] })
  static getSupportedFormats(): Promise<string[]>
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string; format: string }>>
}
