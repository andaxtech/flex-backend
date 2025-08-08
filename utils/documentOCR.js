// utils/documentOCR.js
// Backend OCR service for driver documents using OpenAI Vision API

require('dotenv').config();
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Extract driver license information
async function extractDriverLicense(imageUrl, side = 'front') {
  try {
    const prompt = side === 'front' ? `
You are an OCR extraction engine reading driver licenses. From the front of the license, extract and return a valid JSON object with the following keys:

{
  "first_name": "<first name or null>",
  "last_name": "<last name or null>",
  "middle_name": "<middle name if present or null>",
  "license_number": "<driver license number or null>",
  "date_of_birth": "<date in MM/DD/YYYY format or null>",
  "expiration_date": "<expiration date in MM/DD/YYYY format or null>",
  "issue_date": "<issue date in MM/DD/YYYY format if visible or null>",
  "address": "<full street address or null>",
  "city": "<city or null>",
  "state": "<state abbreviation like CA or null>",
  "zip_code": "<zip code or null>",
  "sex": "<M/F or null>",
  "height": "<height like 5-11 or null>",
  "weight": "<weight in lbs or null>",
  "eye_color": "<eye color abbreviation like BRN or null>",
  "hair_color": "<hair color abbreviation or null>",
  "document_discriminator": "<DD number if visible or null>",
  "class": "<license class like C or null>",
  "restrictions": "<restrictions if any or null>",
  "endorsements": "<endorsements if any or null>"
}

Respond ONLY with a pure JSON object, no explanation or markdown.
    ` : `
You are an OCR extraction engine reading the back of driver licenses. Extract any visible information including:

{
  "barcode_data": "<any extracted barcode data or null>",
  "magnetic_stripe_data": "<any magnetic stripe info or null>",
  "additional_info": "<any other relevant information or null>"
}

Respond ONLY with a pure JSON object, no explanation or markdown.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || '';
    const cleaned = content.replace(/```(?:json)?/g, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      console.warn('Could not parse JSON, returning raw content');
      return null;
    }
  } catch (err) {
    console.error('Driver license OCR extraction failed:', err);
    return null;
  }
}

// Extract vehicle registration
async function extractVehicleRegistration(imageUrl) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `
You are an OCR extraction engine reading vehicle registration documents. Extract and return a valid JSON object with the following keys:

{
  "vin": "<Vehicle Identification Number or null>",
  "license_plate": "<license plate number or null>",
  "make": "<vehicle make like Toyota or null>",
  "model": "<vehicle model like Camry or null>",
  "year": "<vehicle year like 2020 or null>",
  "body_type": "<body type like 4D/SEDAN or null>",
  "color": "<vehicle color or null>",
  "registration_expiration": "<expiration date in MM/DD/YYYY format or null>",
  "issue_date": "<issue date in MM/DD/YYYY format or null>",
  "registered_owner": "<owner name(s) or null>",
  "owner_address": "<owner address or null>",
  "odometer": "<odometer reading if visible or null>",
  "weight": "<vehicle weight if shown or null>",
  "fuel_type": "<fuel type if shown or null>",
  "title_number": "<title number if visible or null>",
  "registration_number": "<registration number or null>",
  "fees_paid": "<registration fees if shown or null>"
}

Respond ONLY with a pure JSON object, no explanation or markdown.
              `,
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || '';
    const cleaned = content.replace(/```(?:json)?/g, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      console.warn('Could not parse JSON, returning raw content');
      return null;
    }
  } catch (err) {
    console.error('Registration OCR extraction failed:', err);
    return null;
  }
}

// Extract insurance card
async function extractInsuranceCard(imageUrl) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `
You are an OCR extraction engine reading auto insurance cards. Extract and return a valid JSON object with the following keys:

{
  "insurance_company": "<company name like State Farm or null>",
  "policy_number": "<policy number or null>",
  "naic_number": "<NAIC number if visible or null>",
  "effective_date": "<effective date in MM/DD/YYYY format or null>",
  "expiration_date": "<expiration date in MM/DD/YYYY format or null>",
  "insured_name": "<primary insured name or null>",
  "additional_insured": ["<additional insured names if any>"],
  "vehicle_year": "<vehicle year or null>",
  "vehicle_make": "<vehicle make or null>",
  "vehicle_model": "<vehicle model or null>",
  "vin": "<VIN if visible or null>",
  "agent_name": "<agent name if shown or null>",
  "agent_phone": "<agent phone if shown or null>",
  "company_phone": "<insurance company phone or null>",
  "company_website": "<company website if shown or null>",
  "coverage_types": ["<visible coverage types like LIABILITY, COLLISION>"]
}

Respond ONLY with a pure JSON object, no explanation or markdown.
              `,
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || '';
    const cleaned = content.replace(/```(?:json)?/g, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      console.warn('Could not parse JSON, returning raw content');
      return null;
    }
  } catch (err) {
    console.error('Insurance OCR extraction failed:', err);
    return null;
  }
}

// Extract license plate
async function extractLicensePlate(imageUrl) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `
You are an OCR extraction engine reading license plates. Extract ONLY the license plate number/text.

Return a JSON object:
{
  "license_plate": "<exact plate number/text like 7ABC123 or null>",
  "state": "<state if visible like CA or null>",
  "plate_type": "<type if visible like passenger, commercial, etc or null>"
}

Respond ONLY with a pure JSON object, no explanation or markdown.
              `,
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      max_tokens: 100,
    });

    const content = response.choices[0]?.message?.content || '';
    const cleaned = content.replace(/```(?:json)?/g, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      console.warn('Could not parse JSON, returning raw content');
      return null;
    }
  } catch (err) {
    console.error('License plate OCR extraction failed:', err);
    return null;
  }
}

// Main extraction function that handles all document types
async function extractDocument(imageUrl, documentType) {
  const extractors = {
    'license_front': () => extractDriverLicense(imageUrl, 'front'),
    'license_back': () => extractDriverLicense(imageUrl, 'back'),
    'registration': extractVehicleRegistration,
    'insurance': extractInsuranceCard,
    'plate': extractLicensePlate,
  };

  const extractor = extractors[documentType];
  if (!extractor) {
    throw new Error(`Unknown document type: ${documentType}`);
  }

  return await extractor(imageUrl);
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
  const validations = {
    license_front: {
      required: ['first_name', 'last_name', 'license_number', 'date_of_birth'],
      dateFields: ['date_of_birth', 'expiration_date', 'issue_date'],
    },
    registration: {
      required: ['vin'],
      dateFields: ['registration_expiration', 'issue_date'],
    },
    insurance: {
      required: ['insurance_company', 'policy_number'],
      dateFields: ['effective_date', 'expiration_date'],
    },
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