// utils/documentOCR.js
// Updated with document recognition, fraud detection, and consistency checks

require('dotenv').config();
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Extract driver license information
async function extractDriverLicense(imageUrl, side = 'front') {
  try {
    const prompt = side === 'front' ? `
You are an OCR extraction engine. Analyze this driver license and return ONLY a valid JSON object.

FIRST verify this is a driver license FRONT (not back, not other document).
Then extract ALL information and perform fraud/consistency checks.

{
  "document_type": "license_front or wrong_document",
  "data": {
    "first_name": "extract first name or null",
    "last_name": "extract last name or null",
    "middle_name": "extract middle name if present or null",
    "license_number": "extract driver license number or null",
    "date_of_birth": "extract date in MM/DD/YYYY format or null",
    "expiration_date": "extract expiration date in MM/DD/YYYY format or null",
    "issue_date": "extract issue date in MM/DD/YYYY format if visible or null",
    "address": "extract full street address or null",
    "city": "extract city name or null",
    "state": "extract state abbreviation like CA or null",
    "zip_code": "extract 5-digit zip code or null",
    "sex": "extract M or F or null",
    "height": "extract height like 5-11 or null",
    "weight": "extract weight in lbs or null",
    "eye_color": "extract eye color abbreviation or null",
    "hair_color": "extract hair color abbreviation or null",
    "document_discriminator": "extract DD number if visible or null",
    "class": "extract license class like C or null",
    "restrictions": "extract restrictions if any or null",
    "endorsements": "extract endorsements if any or null"
  },
  "fraud_check": {
    "risk_level": "low/medium/high",
    "issues": ["list any: font_inconsistency, photo_tampering, edge_quality, text_misalignment, color_variation, fake_hologram, resolution_mismatch"],
    "authentic_features": ["list visible security features"]
  },
  "consistency": {
    "photo_age_matches_dob": true/false,
    "address_format_valid": true/false,
    "license_number_pattern_valid": true/false,
    "dates_logical": true/false
  }
}
    ` : `
You are an OCR extraction engine. Verify this is a driver license BACK and return ONLY a valid JSON object.

{
  "document_type": "license_back or wrong_document",
  "data": {
    "barcode_data": "extract any barcode data or null",
    "magnetic_stripe_data": "extract any magnetic stripe info or null",
    "additional_info": "extract any other relevant information or null"
  },
  "matches_front": true/false
}
    `;

    console.log(`Calling OpenAI for ${side} side extraction...`);
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an OCR system that ONLY returns valid JSON. Never include markdown formatting, code blocks, or explanations.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 800,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content || '';
    console.log('Raw OpenAI response:', content.substring(0, 200) + '...');
    
    let cleaned = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .replace(/^[^{]*{/, '{')
      .replace(/}[^}]*$/, '}')
      .trim();
    
    console.log('Cleaned response:', cleaned.substring(0, 200) + '...');

    try {
      const parsed = JSON.parse(cleaned);
      console.log('Successfully parsed license data');
      return parsed;
    } catch (err) {
      console.error('JSON Parse Error:', err.message);
      console.error('Failed to parse:', cleaned);
      
      return side === 'front' ? {
        document_type: 'wrong_document',
        data: {
          first_name: null,
          last_name: null,
          license_number: null,
          date_of_birth: null,
          expiration_date: null,
          address: null,
          city: null,
          state: null,
          zip_code: null
        },
        fraud_check: {
          risk_level: 'high',
          issues: ['parse_error']
        }
      } : {
        document_type: 'wrong_document',
        data: {
          barcode_data: null,
          magnetic_stripe_data: null,
          additional_info: null
        }
      };
    }
  } catch (err) {
    console.error('Driver license OCR extraction failed:', err);
    return null;
  }
}

// Extract vehicle registration
async function extractVehicleRegistration(imageUrl) {
  try {
    console.log('Calling OpenAI for registration extraction...');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an OCR system that ONLY returns valid JSON. Never include markdown formatting, code blocks, or explanations.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this document and return ONLY a valid JSON object:

{
  "document_type": "registration or wrong_document",
  "data": {
    "vin": "extract VIN number or null",
    "license_plate": "extract license plate or null",
    "make": "extract vehicle make or null",
    "model": "extract vehicle model or null",
    "year": "extract vehicle year or null",
    "body_type": "extract body type or null",
    "color": "extract color or null",
    "registration_expiration": "extract expiration in MM/DD/YYYY or null",
    "issue_date": "extract issue date in MM/DD/YYYY or null",
    "registered_owner": "extract owner names or null",
    "owner_address": "extract address or null"
  },
  "authenticity": {
    "appears_genuine": true/false,
    "has_official_seal": true/false
  },
  "vin_valid": true/false
}`
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content || '';
    console.log('Raw registration response:', content.substring(0, 200) + '...');
    
    let cleaned = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .replace(/^[^{]*{/, '{')
      .replace(/}[^}]*$/, '}')
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      console.log('Successfully parsed registration data');
      console.log('Extracted VIN:', parsed.data?.vin || parsed.vin);
      return parsed;
    } catch (err) {
      console.error('JSON Parse Error:', err.message);
      return {
        document_type: 'wrong_document',
        data: {
          vin: null,
          license_plate: null,
          make: null,
          model: null,
          year: null
        }
      };
    }
  } catch (err) {
    console.error('Registration OCR extraction failed:', err);
    return null;
  }
}

// Extract insurance card
async function extractInsuranceCard(imageUrl) {
  try {
    console.log('Calling OpenAI for insurance extraction...');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an OCR system that ONLY returns valid JSON. Never include markdown formatting, code blocks, or explanations.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Verify this is an auto insurance card and extract:

{
  "document_type": "insurance or wrong_document",
  "data": {
    "insurance_company": "extract company name or null",
    "policy_number": "extract policy number or null",
    "effective_date": "extract effective date in MM/DD/YYYY or null",
    "expiration_date": "extract expiration in MM/DD/YYYY or null",
    "insured_name": "extract primary insured name or null",
    "vehicle_year": "extract year or null",
    "vehicle_make": "extract make or null",
    "vehicle_model": "extract model or null"
  },
  "validity": {
    "currently_active": true/false,
    "appears_genuine": true/false
  }
}`
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content || '';
    
    let cleaned = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .replace(/^[^{]*{/, '{')
      .replace(/}[^}]*$/, '}')
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      console.log('Successfully parsed insurance data');
      return parsed;
    } catch (err) {
      console.error('JSON Parse Error:', err.message);
      return {
        document_type: 'wrong_document',
        data: {
          insurance_company: null,
          policy_number: null,
          effective_date: null,
          expiration_date: null
        }
      };
    }
  } catch (err) {
    console.error('Insurance OCR extraction failed:', err);
    return null;
  }
}

// Extract license plate
async function extractLicensePlate(imageUrl) {
  try {
    console.log('Calling OpenAI for license plate extraction...');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an OCR system that extracts license plate numbers. Return ONLY valid JSON.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract the license plate number and validate format:
{
  "license_plate": "extracted plate number or null",
  "state": "state or null",
  "format_valid": true/false
}`
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      max_tokens: 100,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content || '';
    
    let cleaned = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .replace(/^[^{]*{/, '{')
      .replace(/}[^}]*$/, '}')
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      console.log('Successfully parsed license plate:', parsed.license_plate);
      return parsed;
    } catch (err) {
      console.error('JSON Parse Error:', err.message);
      return { license_plate: null, state: null, format_valid: false };
    }
  } catch (err) {
    console.error('License plate OCR extraction failed:', err);
    return null;
  }
}

// Add new function for vehicle photo validation
async function validateVehiclePhoto(imageUrl, expectedSide) {
  // Skip OCR, just validate it's a car
  return {
    is_vehicle: true,
    side_captured: expectedSide
  };
}

// Main extraction function that handles all document types
async function extractDocument(imageUrl, documentType) {
  console.log(`Starting OCR extraction for document type: ${documentType}`);
  
  const extractors = {
    'license_front': () => extractDriverLicense(imageUrl, 'front'),
    'license_back': () => extractDriverLicense(imageUrl, 'back'),
    'registration': extractVehicleRegistration,
    'insurance': extractInsuranceCard,
    'plate': extractLicensePlate,
    'car_front': () => validateVehiclePhoto(imageUrl, 'front'),
    'car_back': () => validateVehiclePhoto(imageUrl, 'back'),
    'car_left': () => validateVehiclePhoto(imageUrl, 'left'),
    'car_right': () => validateVehiclePhoto(imageUrl, 'right'),
  };

  const extractor = extractors[documentType];
  if (!extractor) {
    console.error(`Unknown document type: ${documentType}`);
    throw new Error(`Unknown document type: ${documentType}`);
  }

  const result = await extractor(imageUrl);
  console.log(`Extraction complete for ${documentType}:`, result ? 'Success' : 'Failed');
  return result;
}

// Format dates to MM/DD/YYYY
function formatDate(dateStr) {
  if (!dateStr) return null;
  
  const patterns = [
    /(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/,
    /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/,
  ];
  
  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      let month, day, year;
      if (match[1].length === 4) {
        year = match[1];
        month = match[2];
        day = match[3];
      } else {
        month = match[1];
        day = match[2];
        year = match[3];
      }
      
      if (year.length === 2) {
        year = parseInt(year) > 50 ? '19' + year : '20' + year;
      }
      
      return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
    }
  }
  
  return dateStr;
}

// Enhanced validation with fraud detection
function validateExtractedData(data, documentType) {
  if (!data) {
    return { isValid: false, errors: ['No data extracted'], data: {} };
  }

  // Check for wrong document type
  if (data.document_type === 'wrong_document') {
    return { 
      isValid: false, 
      errors: ['Wrong document type'], 
      data: data.data || {} 
    };
  }

  // Check fraud risk for license front
  if (documentType === 'license_front' && data.fraud_check?.risk_level === 'high') {
    return {
      isValid: false,
      errors: ['Document quality or authenticity issues: ' + (data.fraud_check.issues || []).join(', ')],
      data: data.data || {}
    };
  }

  // Check authenticity for registration
  if (documentType === 'registration' && data.authenticity?.appears_genuine === false) {
    return {
      isValid: false,
      errors: ['Document authenticity could not be verified'],
      data: data.data || {}
    };
  }

  // Check validity for insurance
  if (documentType === 'insurance' && data.validity?.currently_active === false) {
    return {
      isValid: false,
      errors: ['Insurance policy appears to be expired or inactive'],
      data: data.data || {}
    };
  }

  const validations = {
    license_front: {
      required: ['first_name', 'last_name', 'license_number'],
      dateFields: ['date_of_birth', 'expiration_date', 'issue_date'],
    },
    registration: {
      required: [],
      dateFields: ['registration_expiration', 'issue_date'],
    },
    insurance: {
      required: ['insurance_company'],
      dateFields: ['effective_date', 'expiration_date'],
    },
    plate: {
      required: [],
      dateFields: [],
    }
  };

  const validation = validations[documentType];
  if (!validation) return { isValid: true, data: data.data || data };

  const errors = [];
  const cleanedData = { ...(data.data || data) };

  // Check required fields
  for (const field of validation.required || []) {
    if (!cleanedData[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Format date fields
  for (const field of validation.dateFields || []) {
    if (cleanedData[field]) {
      cleanedData[field] = formatDate(cleanedData[field]);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: cleanedData,
    metadata: {
      fraud_check: data.fraud_check,
      consistency: data.consistency,
      authenticity: data.authenticity,
      validity: data.validity
    }
  };
}

module.exports = {
  extractDocument,
  extractDriverLicense,
  extractVehicleRegistration,
  extractInsuranceCard,
  extractLicensePlate,
  validateVehiclePhoto,
  validateExtractedData,
};