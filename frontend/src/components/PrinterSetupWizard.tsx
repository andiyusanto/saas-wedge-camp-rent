import { useState } from 'react';
import { X, Smartphone, Laptop, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { ModalBackdrop, ModalPanel } from './ModalShell';
import type { PrinterConnection, PrinterSettings } from '../hooks/usePrinterSettings';
import type { PaperWidth } from '../utils/thermalReceipt';
import { buildThermalTestReceipt } from '../utils/thermalReceipt';
import { printThermalReceipt, isAndroidDevice, isIosDevice } from '../utils/thermalPrint';
import { ThermalPrintPreview } from './ThermalPrintPreview';
import { formatDateIndo, todayStr } from '../utils/formatters';

// Wizard "Siapkan Printer" -- 3 langkah, bahasa awam, TANPA istilah
// BLE/ESC-POS/SPP di UI (research/brief-cetak-printer-thermal-2026-11.md).
const RAWBT_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter';

type Step = 1 | 2 | 3;

export function PrinterSetupWizard({
  isOpen,
  onClose,
  businessName,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  businessName: string;
  onSaved: (settings: PrinterSettings) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [connection, setConnection] = useState<PrinterConnection | null>(null);
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(58);
  const [testOutcome, setTestOutcome] = useState<'idle' | 'printed' | 'confirmed_ok' | 'confirmed_fail'>('idle');

  if (!isOpen) return null;

  const android = isAndroidDevice();
  const ios = isIosDevice();

  function resetAndClose() {
    setStep(1);
    setConnection(null);
    setTestOutcome('idle');
    onClose();
  }

  function handleSelectConnection(c: PrinterConnection) {
    setConnection(c);
    if (c === 'none') {
      onSaved({ connection: 'none', paperWidth, configuredAt: new Date().toISOString() });
      resetAndClose();
      return;
    }
    setStep(2);
  }

  async function handleTestPrint() {
    if (!connection || connection === 'none') return;
    const doc = buildThermalTestReceipt(businessName, paperWidth, formatDateIndo(todayStr()));
    await printThermalReceipt(doc, paperWidth, connection === 'bluetooth' ? 'bluetooth' : 'usb');
    setTestOutcome('printed');
  }

  function handleConfirmSuccess() {
    if (!connection) return;
    onSaved({ connection, paperWidth, configuredAt: new Date().toISOString() });
    resetAndClose();
  }

  const helpWaText = `Halo tim Sewalog, saya butuh bantuan menyambungkan printer struk.\nKoneksi: ${
    connection === 'bluetooth' ? 'Bluetooth' : connection === 'usb' ? 'USB' : '-'
  }\nUkuran kertas: ${paperWidth}mm\nOS/Browser: ${navigator.userAgent}`;

  return (
    <ModalBackdrop>
      <ModalPanel className="bg-white w-full max-w-md rounded-2xl border border-[#DBD5C1] shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="bg-[#2B4739] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold">Siapkan Printer</h2>
          <button onClick={resetAndClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto text-sm text-[#26302B] space-y-4">
          {step === 1 && (
            <>
              <p className="font-bold text-base">Printer kakak tersambung pakai apa?</p>
              <div className="space-y-2.5">
                <button
                  onClick={() => handleSelectConnection('bluetooth')}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-[#DBD5C1] hover:border-[#2B4739] text-left transition"
                >
                  <Smartphone className="w-6 h-6 text-[#2B4739] shrink-0" />
                  <div className="flex-1">
                    <p className="font-bold">Bluetooth ke HP</p>
                    <p className="text-xs text-[#6E6853]">Paling umum{android ? ' — Disarankan untuk HP ini' : ''}</p>
                    {ios && (
                      <p className="text-xs text-sewa-rust mt-1">
                        Printer Bluetooth belum bisa dari iPhone. Pakai HP Android atau kirim struk lewat WA.
                      </p>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => handleSelectConnection('usb')}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-[#DBD5C1] hover:border-[#2B4739] text-left transition"
                >
                  <Laptop className="w-6 h-6 text-[#2B4739] shrink-0" />
                  <div className="flex-1">
                    <p className="font-bold">Kabel USB ke laptop</p>
                    <p className="text-xs text-[#6E6853]">{!android && !ios ? 'Disarankan untuk perangkat ini' : 'Printer tersambung lewat kabel ke komputer'}</p>
                  </div>
                </button>
                <button
                  onClick={() => handleSelectConnection('none')}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-[#DBD5C1] hover:border-[#2B4739] text-left transition"
                >
                  <FileText className="w-6 h-6 text-[#6E6853] shrink-0" />
                  <div className="flex-1">
                    <p className="font-bold">Tidak punya printer</p>
                    <p className="text-xs text-[#6E6853]">Kirim lewat WA / simpan PDF</p>
                  </div>
                </button>
              </div>

              {android && (
                <div className="mt-2 p-3.5 bg-[#F1EEE2] rounded-xl space-y-2.5 text-xs">
                  <p className="font-bold">Langkah persiapan Bluetooth (cukup sekali)</p>
                  <ol className="list-decimal list-inside space-y-1.5">
                    <li>
                      Pasang aplikasi bantu (RawBT), gratis.{' '}
                      <a
                        href={RAWBT_PLAY_STORE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-1 px-3 py-1.5 rounded-lg bg-[#2B4739] text-white font-bold"
                      >
                        Buka Play Store
                      </a>
                      <p className="text-[#6E6853] mt-1">
                        Aplikasi bantu RawBT meneruskan struk dari Sewalog ke printer Bluetooth. Cukup dipasang sekali.
                      </p>
                    </li>
                    <li>Sambungkan printer di HP: Pengaturan → Bluetooth → pilih nama printer → PIN biasanya 0000 atau 1234.</li>
                    <li>Buka RawBT → pilih printer kakak → kembali ke Sewalog.</li>
                  </ol>
                  <p className="text-[#6E6853]">
                    Untuk HP Huawei tanpa Google Play: belum ada kepastian RawBT tersedia di AppGallery — kalau tidak
                    ditemukan di sana, jalur Bluetooth ini belum didukung di HP tersebut, pakai kirim lewat WA / simpan PDF
                    dulu.
                  </p>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p className="font-bold text-base">Ukuran kertas</p>
              <p className="text-xs text-[#6E6853]">Ukur lebar gulungan kertas atau lihat kardus printer.</p>
              <div className="space-y-2.5">
                <button
                  onClick={() => setPaperWidth(58)}
                  className={`w-full p-3.5 rounded-xl border-2 text-left transition ${
                    paperWidth === 58 ? 'border-[#2B4739] bg-[#F1EEE2]' : 'border-[#DBD5C1]'
                  }`}
                >
                  <p className="font-bold">Kecil 58 mm</p>
                  <p className="text-xs text-[#6E6853]">Paling umum, lebar ±5,8 cm</p>
                </button>
                <button
                  onClick={() => setPaperWidth(80)}
                  className={`w-full p-3.5 rounded-xl border-2 text-left transition ${
                    paperWidth === 80 ? 'border-[#2B4739] bg-[#F1EEE2]' : 'border-[#DBD5C1]'
                  }`}
                >
                  <p className="font-bold">Besar 80 mm</p>
                </button>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setStep(1)} className="flex-1 px-4 py-2.5 rounded-xl border border-[#DBD5C1] font-bold text-sm">
                  Kembali
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[#2B4739] text-white font-bold text-sm"
                >
                  Lanjut
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="font-bold text-base">Coba cetak</p>
              {testOutcome === 'idle' && (
                <button
                  onClick={handleTestPrint}
                  className="w-full px-4 py-3 rounded-xl bg-[#2B4739] text-white font-bold text-sm"
                >
                  Cetak Tes
                </button>
              )}

              {testOutcome !== 'idle' && (
                <>
                  <ThermalPrintPreview
                    textLines={buildThermalTestReceipt(businessName, paperWidth, formatDateIndo(todayStr())).textLines}
                    widthMm={paperWidth}
                  />
                  {testOutcome === 'printed' && (
                    <div className="space-y-2">
                      <p className="font-bold text-center">Berhasil keluar kertas?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setTestOutcome('confirmed_ok')}
                          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#2B4739] text-white font-bold text-sm"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Ya
                        </button>
                        <button
                          onClick={() => setTestOutcome('confirmed_fail')}
                          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-[#A8412E] text-[#A8412E] font-bold text-sm"
                        >
                          <XCircle className="w-4 h-4" /> Tidak
                        </button>
                      </div>
                    </div>
                  )}

                  {testOutcome === 'confirmed_ok' && (
                    <button
                      onClick={handleConfirmSuccess}
                      className="w-full px-4 py-2.5 rounded-xl bg-[#2B4739] text-white font-bold text-sm"
                    >
                      Simpan
                    </button>
                  )}

                  {testOutcome === 'confirmed_fail' && (
                    <div className="p-3.5 bg-[#F1EEE2] rounded-xl text-xs space-y-2">
                      <p className="font-bold">Periksa dulu:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Printer menyala dan lampu biru menyala.</li>
                        <li>Sudah dipasangkan di Bluetooth HP (PIN 0000/1234).</li>
                        <li>RawBT terpasang dan printer dipilih di dalamnya.</li>
                        <li>Kertas tidak terbalik — gosok kertas dengan kuku, sisi yang menghitam adalah sisi cetak.</li>
                      </ol>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => setTestOutcome('idle')}
                          className="flex-1 px-3 py-2 rounded-lg border border-[#DBD5C1] font-bold"
                        >
                          Coba lagi
                        </button>
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(helpWaText)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 text-center px-3 py-2 rounded-lg bg-[#2B4739] text-white font-bold"
                        >
                          Tanya tim via WA
                        </a>
                      </div>
                    </div>
                  )}
                </>
              )}

              <button onClick={() => setStep(2)} className="w-full px-4 py-2 rounded-xl border border-[#DBD5C1] font-bold text-sm">
                Kembali
              </button>
            </>
          )}
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
