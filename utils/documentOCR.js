// utils/documentOCR.js
// Updated with better error handling and debugging

require('dotenv').config();
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Extract driver license information
async function extractDriverLicense(imageUrl, side = 'front') {
  try {
    const prompt = side === 'front' ? `
You are an OCR extraction engine. Extract text from this driver license front and return ONLY a valid JSON object.

Important: Return ONLY the JSON object, no markdown, no explanation, no code blocks.

{
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
}
    ` : `
You are an OCR extraction engine. Extract text from this driver license back and return ONLY a valid JSON object.

{
  "barcode_data": "extract any barcode data or null",
  "magnetic_stripe_data": "extract any magnetic stripe info or null",
  "additional_info": "extract any other relevant information or null"
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
      max_tokens: 500,
      temperature: 0.1, // Lower temperature for more consistent output
    });

    const content = response.choices[0]?.message?.content || '';
    console.log('Raw OpenAI response:', content.substring(0, 200) + '...');
    
    // More aggressive cleaning
    let cleaned = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .replace(/^[^{]*{/, '{')  // Remove everything before first {
      .replace(/}[^}]*$/, '}')  // Remove everything after last }
      .trim();
    
    console.log('Cleaned response:', cleaned.substring(0, 200) + '...');

    try {
      const parsed = JSON.parse(cleaned);
      console.log('Successfully parsed license data');
      return parsed;
    } catch (err) {
      console.error('JSON Parse Error:', err.message);
      console.error('Failed to parse:', cleaned);
      
      // Return empty structure instead of null
      return side === 'front' ? {
        first_name: null,
        last_name: null,
        license_number: null,
        date_of_birth: null,
        expiration_date: null,
        address: null,
        city: null,
        state: null,
        zip_code: null
      } : {
        barcode_data: null,
        magnetic_stripe_data: null,
        additional_info: null
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
              text: `Extract text from this vehicle registration and return ONLY a valid JSON object:

{
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
    
    // Clean response
    let cleaned = content
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .replace(/^[^{]*{/, '{')
      .replace(/}[^}]*$/, '}')
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      console.log('Successfully parsed registration data');
      console.log('Extracted VIN:', parsed.vin);
      return parsed;
    } catch (err) {
      console.error('JSON Parse Error:', err.message);
      return {
        vin: null,
        license_plate: null,
        make: null,
        model: null,
        year: null
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
              text: `Extract text from this auto insurance card and return ONLY a valid JSON object:

{
  "insurance_company": "extract company name or null",
  "policy_number": "extract policy number or null",
  "effective_date": "extract effective date in MM/DD/YYYY or null",
  "expiration_date": "extract expiration in MM/DD/YYYY or null",
  "insured_name": "extract primary insured name or null",
  "vehicle_year": "extract year or null",
  "vehicle_make": "extract make or null",
  "vehicle_model": "extract model or null"
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
        insurance_company: null,
        policy_number: null,
        effective_date: null,
        expiration_date: null
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
              text: `Extract the license plate number and return ONLY this JSON:
{"license_plate": "extracted plate number or null", "state": "state or null"}`
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
      return { license_plate: null, state: null };
    }
  } catch (err) {
    console.error('License plate OCR extraction failed:', err);
    return null;
  }
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
  
  // Handle various date formats
  const patterns = [
    /(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/, // MM/DD/YYYY or MM-DD-YYYY
    /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/, // YYYY-MM-DD
  ];
  
  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (match) {
      let month, day, year;
      if (match[1].length === 4) {
        // YYYY-MM-DD format
        year = match[1];
        month = match[2];
        day = match[3];
      } else {
        // MM-DD-YYYY format
        month = match[1];
        day = match[2];
        year = match[3];
      }
      
      // Convert 2-digit year to 4-digit
      if (year.length === 2) {
        year = parseInt(year) > 50 ? '19' + year : '20' + year;
      }
      
      return `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${year}`;
    }
  }
  
  return dateStr; // Return original if no pattern matches
}

// Validate extracted data
function validateExtractedData(data, documentType) {
  if (!data) {
    return { isValid: false, errors: ['No data extracted'], data: {} };
  }

  const validations = {
    license_front: {
      required: ['first_name', 'last_name', 'license_number'],
      dateFields: ['date_of_birth', 'expiration_date', 'issue_date'],
    },
    registration: {
      required: [],  // VIN is important but not always required
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
  if (!validation) return { isValid: true, data };

  const errors = [];
  const cleanedData = { ...data };

  // Check required fields
  for (const field of validation.required || []) {
    if (!data[field]) {
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
  };
}

module.exports = {
  extractDocument,
  extractDriverLicense,
  extractVehicleRegistration,
  extractInsuranceCard,
  extractLicensePlate,
  validateExtractedData,
};