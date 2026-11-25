let qrcodePkg = null;
try {
  qrcodePkg = require('qrcode');
} catch (e) {
  // qrcode package will be loaded when npm install completes
}

async function generateQrDataUrl(text) {
  if (qrcodePkg) {
    try {
      return await qrcodePkg.toDataURL(text, {
        errorCorrectionLevel: 'M',
        margin: 2,
        color: {
          dark: '#080808',
          light: '#FFFFFF'
        },
        width: 320
      });
    } catch (err) {
      console.error('QRCode generation error:', err);
    }
  }

  // Robust fallback: encode as SVG QR or standard image URL
  const encodedText = encodeURIComponent(text);
  return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodedText}`;
}

module.exports = {
  generateQrDataUrl
};
