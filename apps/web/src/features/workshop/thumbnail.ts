import type { ArtworkRenderer, Work } from '@shoushang/contracts';

export async function makeThumbnail(renderer: ArtworkRenderer, work: Work): Promise<Blob> {
  const output = renderer.render({ work, width: 480, height: 480, view: 'unfolded' });
  if (!output.ok) throw new Error(output.error.message);
  const svg = new Blob([output.value.svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 480;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 不可用');
    context.drawImage(image, 0, 0, 480, 480);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.size === 0) throw new Error('缩略图为空');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
