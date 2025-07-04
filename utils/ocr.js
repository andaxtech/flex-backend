// utils/ocr.js
const Tesseract = require('tesseract.js');

async function extractText(imageUrl) {
  const { data } = await Tesseract.recognize(imageUrl, 'eng');
  return data.text;
}

module.exports = extractText;
