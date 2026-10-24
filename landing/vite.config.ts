import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { normalizePhone, formatDisplay } from './src/lib/phone.ts'

// Blog di public/blog/*.html itu HTML statis (tidak lewat React), jadi tidak
// bisa baca import.meta.env. Placeholder nomor WA di sana diganti saat build
// dengan VITE_SUPPORT_WHATSAPP_NUMBER yang sama dengan landing React — satu
// sumber nomor. Cuma jalan di `vite build`; di `vite dev` placeholder tetap.
const WA_LINK_PLACEHOLDER = '62xxxxxxxxxx'
const WA_DISPLAY_PLACEHOLDER = '+62 xxx-xxxx-xxxx'

function blogWhatsAppNumber(raw: string | undefined): Plugin {
  return {
    name: 'blog-whatsapp-number',
    apply: 'build',
    closeBundle() {
      const dir = resolve(__dirname, 'dist/blog')
      if (!existsSync(dir)) return
      if (!raw) {
        this.warn('VITE_SUPPORT_WHATSAPP_NUMBER kosong — nomor WA di dist/blog/*.html tetap placeholder')
        return
      }
      const number = normalizePhone(raw)
      const display = formatDisplay(number)
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
        const path = resolve(dir, file)
        const html = readFileSync(path, 'utf8')
        writeFileSync(path, html.replaceAll(WA_LINK_PLACEHOLDER, number).replaceAll(WA_DISPLAY_PLACEHOLDER, display))
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_')
  return {
    plugins: [react(), tailwindcss(), blogWhatsAppNumber(env.VITE_SUPPORT_WHATSAPP_NUMBER)],
  }
})
