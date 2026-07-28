import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import availabilityRouter from './routes/availability.js';
import bookingsRouter from './routes/bookings.js';
import trackingsRouter from './routes/trackings.js';

const app = express();
const port = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', availabilityRouter);
app.use('/api', bookingsRouter);
app.use('/api', trackingsRouter);

app.listen(port, () => {
  console.log(`Backend jalan di http://localhost:${port}`);
});
