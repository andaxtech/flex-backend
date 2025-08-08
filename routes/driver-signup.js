// routes/driver-signup.js
const { extractDocument, validateExtractedData } = require('../utils/documentOCR');

app.post('/extract-document', async (req, res) => {
  try {
    const { imageUrl, documentType } = req.body;
    
    // Extract text using GPT-4 Vision
    const extracted = await extractDocument(imageUrl, documentType);
    
    // Validate and format the data
    const { isValid, errors, data } = validateExtractedData(extracted, documentType);
    
    // Log for auditing (but don't store the image)
    console.log(`Document OCR processed: ${documentType}, Valid: ${isValid}`);
    
    res.json({
      success: true,
      data,
      isValid,
      errors,
      requiresManualReview: !isValid
    });
    
  } catch (error) {
    console.error('OCR Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process document'
    });
  }
});