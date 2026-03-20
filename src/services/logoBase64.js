// src/services/logoBase64.js
// Converts logo PNG → JPEG via canvas to avoid jsPDF PNG format issues
let cachedLogo   = null;
let cachedFormat = 'JPEG';

export const getLogoBase64 = async () => {
  if (cachedLogo) return { data: cachedLogo, format: cachedFormat };
  try {
    const response = await fetch('/et_logo.png');
    if (!response.ok) return null;
    const blob = await response.blob();

    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = img.naturalWidth  || 200;
          canvas.height = img.naturalHeight || 200;
          const ctx = canvas.getContext('2d');
          // White bg for transparency
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          URL.revokeObjectURL(url);
          if (dataUrl && dataUrl.startsWith('data:image/jpeg')) {
            cachedLogo = dataUrl;
            resolve({ data: dataUrl, format: 'JPEG' });
          } else {
            resolve(null);
          }
        } catch {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  } catch {
    return null;
  }
};