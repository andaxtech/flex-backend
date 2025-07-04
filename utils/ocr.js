const Tesseract = require('tesseract.js');

async function extractText(imageUrl) {
  const { data } = await Tesseract.recognize(imageUrl, 'eng', {
    tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz:.#$/ ',
    preserve_interword_spaces: 1,
  });
  return data.text;
}

module.exports = extractText;
