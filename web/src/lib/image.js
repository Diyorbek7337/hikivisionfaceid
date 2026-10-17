/**
 * Prepares a face photo for Hikvision terminals: JPEG, at most 640px, under ~150 KB.
 * Returns a base64 string without the data: prefix.
 */
export async function toFaceJpeg(source) {
  const img = await loadImage(source);
  const max = 640;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  let quality = 0.9;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length * 0.75 > 150 * 1024 && quality > 0.4) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

function loadImage(source) {
  if (source instanceof HTMLCanvasElement) return Promise.resolve(source);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Rasmni o\'qib bo\'lmadi')); };
    img.src = url;
  });
}
