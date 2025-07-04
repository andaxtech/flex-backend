const Tesseract = require('tesseract.js');

async function extractTextFromImage(imageUrl) {
  const { data } = await Tesseract.recognize(imageUrl, 'eng');
  return data.text;
}

module.exports = extractTextFromImage;
