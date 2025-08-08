// controllers/ocrController.js (OPTIONAL - only if you want MVC pattern)

const { extractDocument, validateExtractedData } = require('../utils/documentOCR');

class OCRController {
  // Extract document method
  async extractDocument(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No image file provided'
        });
      }

      const documentType = req.body.documentType || 'license_front';
      console.log(`Processing ${documentType} document, size: ${req.file.size} bytes`);

      // Convert buffer to base64 data URL for OpenAI
      const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      
      // Extract text using GPT-4 Vision
      const extracted = await extractDocument(base64Image, documentType);
      
      if (!extracted) {
        return res.json({
          success: true,
          data: {},
          confidence: 0,
          requiresManualReview: true,
          message: 'Could not extract data. Please enter manually.'
        });
      }
      
      // Validate and format the data
      const { isValid, errors, data } = validateExtractedData(extracted, documentType);
      
      console.log(`Document OCR processed: ${documentType}, Valid: ${isValid}`);
      
      res.json({
        success: true,
        data: data || {},
        isValid,
        errors,
        confidence: isValid ? 95 : 75,
        requiresManualReview: !isValid || Object.keys(data || {}).length === 0
      });
      
    } catch (error) {
      console.error('OCR Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process document',
        message: error.message
      });
    }
  }
}

module.exports = new OCRController();