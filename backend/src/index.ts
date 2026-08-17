import 'dotenv/config';
import { Agent, setGlobalDispatcher } from 'undici';
import express from 'express';
import cors from 'cors';
import availabilityRouter from './routes/availability.js';
import bookingsRouter from './routes/bookings.js';
import trackingsRouter from './routes/trackings.js';
import teamRouter from './routes/team.js';
import uploadsRouter from './routes/uploads.js';
import demoRouter from './routes/demo.js';

// Node global fetch (dipakai @supabase/supabase-js) nyimpen koneksi
// keep-alive lebih lama dari idle timeout sisi Supabase/Cloudflare — begitu
// dipakai lagi setelah nganggur sebentar, socket-nya sudah ditutup di
// ujung sana tapi undici masih coba pakai ("TypeError: fetch failed" /
// "other side closed"). Set keep-alive timeout lebih pendek dari idle
// timeout remote-nya supaya socket basi dibuang duluan, bukan dipakai ulang.
setGlobalDispatcher(new Agent({ keepAliveTimeout: 4_000, keepAliveMaxTimeout: 10_000 }));

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173' }));
// Default 100kb terlalu kecil buat foto ter-resize (base64 nambah ~33%
// ukurannya) — lihat routes/uploads.ts.
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', availabilityRouter);
app.use('/api', bookingsRouter);
app.use('/api', trackingsRouter);
app.use('/api', teamRouter);
app.use('/api', uploadsRouter);
app.use('/api', demoRouter);

app.listen(port, () => {
  console.log(`Backend jalan di http://localhost:${port}`);
});
