// Pratinjau struk thermal di layar (bukan buat dicetak -- window.print()
// ditangani terpisah di utils/thermalPrint.ts). Dipakai di wizard langkah 3
// dan bisa dipakai ulang di tempat lain yang butuh pratinjau 58/80mm.
export function ThermalPrintPreview({ textLines, widthMm }: { textLines: string[]; widthMm: 58 | 80 }) {
  return (
    <div
      className="mx-auto bg-white border border-[#DBD5C1] shadow-sm rounded-sm p-3 overflow-x-auto"
      style={{ maxWidth: widthMm === 58 ? '220px' : '300px' }}
    >
      <pre className="font-mono text-[10px] leading-snug whitespace-pre text-[#26302B]">{textLines.join('\n')}</pre>
    </div>
  );
}
