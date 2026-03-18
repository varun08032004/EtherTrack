// src/services/logoBase64.js
let cachedLogo = null;

export const getLogoBase64 = async () => {
  if (cachedLogo) return cachedLogo;
  try {
    const response = await fetch('/et_logo_bg.png');
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader  = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        // ✅ Validate it's a real image before caching
        if (result && result.startsWith('data:image')) {
          cachedLogo = result;
          resolve(result);
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};