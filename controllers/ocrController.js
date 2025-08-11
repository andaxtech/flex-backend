// controllers/ocrController.js

const { extractDocument, validateExtractedData } = require('../utils/documentOCR');

class OCRController {
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
      const { isValid, errors, data, metadata } = validateExtractedData(extracted, documentType);
      
      // Check if wrong document type was captured
      if (extracted.document_type === 'wrong_document') {
        return res.json({
          success: false,
          documentType: 'wrong_document',
          expectedType: documentType,
          message: `This doesn't appear to be a ${documentType.replace('_', ' ')}. Please capture the correct document.`,
          requiresManualReview: false
        });
      }
      
      // Check fraud risk for driver's license
      if (documentType === 'license_front' && metadata?.fraud_check?.risk_level === 'high') {
        return res.json({
          success: false,
          fraudRisk: true,
          issues: metadata.fraud_check.issues,
          message: 'Document quality issue detected. Please ensure good lighting and capture again.',
          requiresManualReview: false
        });
      }
      
      // Check document validity
      if (documentType === 'insurance' && metadata?.validity?.currently_active === false) {
        return res.json({
          success: true,
          data: data || {},
          warning: 'Insurance policy appears to be expired',
          validity: metadata.validity,
          confidence: 75,
          requiresManualReview: true
        });
      }
      
      console.log(`Document OCR processed: ${documentType}, Valid: ${isValid}`);
      
      res.json({
        success: true,
        data: data || {},
        isValid,
        errors,
        confidence: isValid ? 95 : 75,
        requiresManualReview: !isValid || Object.keys(data || {}).length === 0,
        metadata: metadata || {},
        message: isValid ? 'Document processed successfully' : 'Please verify the extracted information'
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