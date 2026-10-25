import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { normalizePhone, formatDisplay } from './src/lib/phone.ts'

// Blog, Syarat & Ketentuan, dan Kebijakan Privasi di public/{blog,syarat,privasi}/
// itu HTML statis (tidak lewat React), jadi tidak bisa baca import.meta.env.
// Placeholder nomor WA di sana diganti saat build dengan
// VITE_SUPPORT_WHATSAPP_NUMBER yang sama dengan landing React — satu sumber
// nomor. Cuma jalan di `vite build`; di `vite dev` placeholder tetap.
const WA_LINK_PLACEHOLDER = '62xxxxxxxxxx'
const WA_DISPLAY_PLACEHOLDER = '+62 xxx-xxxx-xxxx'
const STATIC_PAGE_DIRS = ['dist/blog', 'dist/syarat', 'dist/privasi']

function blogWhatsAppNumber(raw: string | undefined): Plugin {
  return {
    name: 'blog-whatsapp-number',
    apply: 'build',
    closeBundle() {
      if (!raw) {
        this.warn('VITE_SUPPORT_WHATSAPP_NUMBER kosong — nomor WA di halaman statis tetap placeholder')
        return
      }
      const number = normalizePhone(raw)
      const display = formatDisplay(number)
      for (const dirName of STATIC_PAGE_DIRS) {
        const dir = resolve(__dirname, dirName)
        if (!existsSync(dir)) continue
        for (const file of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
          const path = resolve(dir, file)
          const html = readFileSync(path, 'utf8')
          writeFileSync(path, html.replaceAll(WA_LINK_PLACEHOLDER, number).replaceAll(WA_DISPLAY_PLACEHOLDER, display))
        }
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
