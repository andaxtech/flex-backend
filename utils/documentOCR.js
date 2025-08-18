// utils/documentOCR.js
// Updated with AWS Textract for registration and insurance cards

require('dotenv').config();
const { OpenAI } = require('openai');
const AWS = require('aws-sdk');

// Initialize OpenAI (still used for license and face matching)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize AWS Textract
const textract = new AWS.Textract({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

// Add debug logging
const DEBUG = true; // Set to false in production

function debugLog(label, data) {
  if (DEBUG) {
    console.log(`\n[DEBUG - ${new Date().toISOString()}] ${label}:`);
    console.log(JSON.stringify(data, null, 2));
    console.log('-------------------\n');
  }
}

// Helper function to convert image URL to buffer for AWS
async function getImageBuffer(imageUrl) {
  const response = await fetch(imageUrl);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Extract key-value pairs from Textract response
function extractKeyValuePairs(textractResponse) {
  const keyValuePairs = {};
  const blocks = textractResponse.Blocks || [];
  
  // Create a map of block IDs to blocks for easy lookup
  const blockMap = {};
  blocks.forEach(block => {
    blockMap[block.Id] = block;
  });
  
  // Find KEY_VALUE_SET blocks
  blocks.forEach(block => {
    if (block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('KEY')) {
      // Get the key text
      let keyText = '';
      block.Relationships?.forEach(relationship => {
        if (relationship.Type === 'CHILD') {
          relationship.Ids?.forEach(childId => {
            const childBlock = blockMap[childId];
            if (childBlock?.BlockType === 'WORD') {
              keyText += (keyText ? ' ' : '') + childBlock.Text;
            }
          });
        }
      });
      
      // Get the value text
      let valueText = '';
      block.Relationships?.forEach(relationship => {
        if (relationship.Type === 'VALUE') {
          relationship.Ids?.forEach(valueId => {
            const valueBlock = blockMap[valueId];
            if (valueBlock?.BlockType === 'KEY_VALUE_SET') {
              valueBlock.Relationships?.forEach(valueRelationship => {
                if (valueRelationship.Type === 'CHILD') {
                  valueRelationship.Ids?.forEach(childId => {
                    const childBlock = blockMap[childId];
                    if (childBlock?.BlockType === 'WORD') {
                      valueText += (valueText ? ' ' : '') + childBlock.Text;
                    }
                  });
                }
              });
            }
          });
        }
      });
      
      if (keyText && valueText) {
        keyValuePairs[keyText.toLowerCase()] = valueText;
      }
    }
  });
  
  // Also extract all text for pattern matching
  let fullText = '';
  blocks.forEach(block => {
    if (block.BlockType === 'LINE') {
      fullText += block.Text + '\n';
    }
  });
  
  return { keyValuePairs, fullText };
}

// Extract VIN using pattern matching
function findVIN(text, keyValuePairs) {
  // Check common key names first
  const vinKeys = ['vin', 'vehicle identification number', 'vin number', 'vehicle id', 'vin#', 'vin no', 'vehicle identification'];
  
  for (const key of vinKeys) {
    for (const [k, v] of Object.entries(keyValuePairs)) {
      if (k.includes(key)) {
        // Validate VIN format (17 characters, alphanumeric)
        const cleanedVIN = v.replace(/[^A-Z0-9]/gi, '');
        if (cleanedVIN.length === 17) {
          debugLog('VIN found via key-value pair', { key: k, value: v, cleaned: cleanedVIN });
          return cleanedVIN;
        }
      }
    }
  }
  
  // If not found in key-value pairs, search in full text
  const vinPattern = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
  const matches = text.match(vinPattern);
  
  if (matches && matches.length > 0) {
    debugLog('VIN found via pattern matching', { matches });
    return matches[0];
  }
  
  return null;
}


// Extract vehicle registration using AWS Textract
async function extractVehicleRegistration(imageUrl) {
  try {
    console.log('Using AWS Textract for registration extraction...');
    
    // Convert image URL to buffer
    const imageBuffer = await getImageBuffer(imageUrl);
    
    // Call Textract
    const params = {
      Document: {
        Bytes: imageBuffer
      },
      FeatureTypes: ['FORMS'] // This enables key-value pair extraction
    };
    
    const textractResult = await textract.analyzeDocument(params).promise();
    debugLog('Textract raw response blocks count', textractResult.Blocks?.length || 0);
    
    // Extract key-value pairs and full text
    const { keyValuePairs, fullText } = extractKeyValuePairs(textractResult);
    debugLog('Extracted key-value pairs', keyValuePairs);
    
    // Find VIN first - this is most reliable
    const vin = findVIN(fullText, keyValuePairs);
    
    // Extract license plate with better pattern matching
    const extractLicensePlate = () => {
      // First try key-value pairs
      const plateFromKV = extractField(['license number', 'license plate', 'plate number', 'plate no', 'lic no']);
      if (plateFromKV) return plateFromKV;
      
      // Then try pattern matching for California plates (like 6SJL896)
      const platePattern = /\b[0-9][A-Z]{3}[0-9]{3}\b/g;
      const matches = fullText.match(platePattern);
      if (matches && matches.length > 0) {
        debugLog('License plate found via pattern', matches[0]);
        return matches[0];
      }
      
      return null;
    };
    
    // Extract other fields
    const extractField = (keys) => {
      for (const key of keys) {
        for (const [k, v] of Object.entries(keyValuePairs)) {
          if (k.includes(key) && v) {
            return v;
          }
        }
      }
      return null;
    };
    
    // Extract year more carefully
    const extractVehicleYear = () => {
      // Don't trust generic "year" field - it might be issue year
      // Look for more specific keys
      const yearValue = extractField(['model year', 'vehicle year', 'yr of vehicle', 'veh yr']);
      if (yearValue) {
        debugLog('Year found via specific vehicle year key', yearValue);
        return yearValue;
      }
      
      // If we have a VIN, we should decode it instead of trusting OCR
      // The VIN decoder in the frontend will override this anyway
      if (vin) {
        debugLog('Have VIN, will let frontend decode for accurate year');
        return null; // Let VIN decoder handle it
      }
      
      // Last resort - look for generic year but validate it's reasonable
      const genericYear = extractField(['year']);
      if (genericYear) {
        const yearNum = parseInt(genericYear);
        const currentYear = new Date().getFullYear();
        // Only accept years that make sense for vehicles (1990-current+1)
        if (yearNum >= 1990 && yearNum <= currentYear + 1) {
          debugLog('Using generic year field', genericYear);
          return genericYear;
        } else {
          debugLog('Ignoring invalid year', genericYear);
        }
      }
      
      return null;
    };
    
    // Build the data object
    const data = {
      vin: vin,
      license_plate: extractLicensePlate(),
      make: extractField(['make', 'vehicle make', 'manufacturer', 'mk']),
      model: extractField(['model', 'vehicle model', 'mdl']),
      year: extractVehicleYear(), // Use our improved year extraction
      color: extractField(['color', 'vehicle color', 'col']),
      registration_expiration: extractField(['expires', 'expiration', 'exp date', 'valid until', 'valid through']),
      registration_issued_date: extractField(['issued', 'issue date', 'issued on', 'registration date', 'first registered']),
      registered_owner: extractField(['registered owner', 'owner', 'registered to', 'name', 'registrant']),
      ca_title_number: extractField(['title number', 'title no', 'title #', 'ca title', 'california title']),
      body_type: extractField(['body type', 'body style', 'vehicle type', 'type'])
    };
    
    // Clean up the make field to handle abbreviations
    if (data.make) {
      const makeAbbreviations = {
        'VOLK': 'Volkswagen',
        'CHEV': 'Chevrolet',
        'MERC': 'Mercedes-Benz',
        'TOYT': 'Toyota',
        'HOND': 'Honda',
        'NISS': 'Nissan',
        'MAZD': 'Mazda',
        'HYUN': 'Hyundai',
        'MITS': 'Mitsubishi',
        'DODG': 'Dodge',
        'CHRY': 'Chrysler',
        'BUIC': 'Buick',
        'CADI': 'Cadillac',
        'LINC': 'Lincoln',
        'ACUR': 'Acura',
        'INFI': 'Infiniti',
        'LEXS': 'Lexus',
        'PORS': 'Porsche',
        'VOLV': 'Volvo',
        'JAGU': 'Jaguar',
        'SATU': 'Saturn',
        'PONT': 'Pontiac',
        'OLDS': 'Oldsmobile',
        'HUMM': 'Hummer',
        'SUZU': 'Suzuki',
        'ISUZ': 'Isuzu'
      };
      
      const upperMake = data.make.toUpperCase();
      if (makeAbbreviations[upperMake]) {
        data.make = makeAbbreviations[upperMake];
        debugLog('Converted make abbreviation', { from: upperMake, to: data.make });
      }
    }
    
    debugLog('Extracted registration data', data);
    
    // Check if this looks like a registration document
    const isRegistration = (vin || data.license_plate || 
                          (data.make && data.model) ||
                          fullText.toLowerCase().includes('registration') ||
                          fullText.toLowerCase().includes('vehicle registration'));
    
                          return {
                            document_type: isRegistration ? 'registration' : 'wrong_document',
                            data: data,
                            authenticity: {
                              appears_genuine: true,
                              confidence: vin ? 90 : 70
                            },
                            vin_valid: vin !== null,
                            has_vin_for_decoding: vin !== null, // Flag to indicate VIN decoder should be used
                            missing_required_fields: !data.registration_expiration ? ['registration_expiration'] : []
                          };
    
  } catch (err) {
    console.error('Textract registration extraction failed:', err);
    debugLog('Textract error', err);
    
    // Fallback to manual entry
    return {
      document_type: 'registration',
      data: {
        vin: null,
        license_plate: null,
        make: null,
        model: null,
        year: null
      },
      error: err.message
    };
  }
}

// Extract insurance card using AWS Textract
async function extractInsuranceCard(imageUrl) {
  try {
    console.log('Using AWS Textract for insurance extraction...');
    
    // Convert image URL to buffer
    const imageBuffer = await getImageBuffer(imageUrl);
    
    // Call Textract
    const params = {
      Document: {
        Bytes: imageBuffer
      },
      FeatureTypes: ['FORMS']
    };
    
    const textractResult = await textract.analyzeDocument(params).promise();
    
    // Extract key-value pairs and full text
    const { keyValuePairs, fullText } = extractKeyValuePairs(textractResult);
    debugLog('Insurance key-value pairs', keyValuePairs);
    
    // Extract fields
    const extractField = (keys) => {
      for (const key of keys) {
        for (const [k, v] of Object.entries(keyValuePairs)) {
          if (k.includes(key) && v) {
            return v;
          }
        }
      }
      return null;
    };
    
    // Extract insurance company from full text (often in header/logo area)
    const extractInsuranceCompany = () => {
      // First try key-value pairs
      const fromKV = extractField(['company', 'insurer', 'insurance company', 'underwritten by']);
      if (fromKV) return fromKV;
      
      // Common insurance company patterns in full text
      const insuranceCompanies = [
        'State Farm', 'GEICO', 'Progressive', 'Allstate', 'USAA', 
        'Liberty Mutual', 'Farmers', 'Nationwide', 'American Family',
        'Travelers', 'Mercury', 'MetLife', 'Hartford', 'Amica',
        'Erie Insurance', 'Auto-Owners', 'Country Financial',
        'The General', 'Esurance', 'Kemper', 'National General',
        'AAA', 'CSAA', 'Infinity', 'Safeco', 'Wawanesa',
        'Auto Club', 'Grange', 'Hanover', 'Horace Mann',
        'Plymouth Rock', 'Sentry', 'Westfield', 'QBE',
        'Bear River', 'Branch', 'Bristol West', 'California Casualty',
        'Clearcover', 'Chubb', 'Cincinnati', 'CNA', 'Colonial Penn'
      ];
      
      // Search for company names in full text
      const upperText = fullText.toUpperCase();
      for (const company of insuranceCompanies) {
        if (upperText.includes(company.toUpperCase())) {
          debugLog('Insurance company found in text', company);
          return company;
        }
      }
      
      // Look for "Insurance" in the text and try to extract company name
      const insuranceMatch = fullText.match(/([A-Za-z\s&]+)\s+Insurance/i);
      if (insuranceMatch) {
        debugLog('Insurance company found via pattern', insuranceMatch[1]);
        return insuranceMatch[1].trim() + ' Insurance';
      }
      
      return null;
    };
    
    // Extract dates
    const extractDate = (keys) => {
      const value = extractField(keys);
      if (value) {
        // Try to parse various date formats
        const datePattern = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
        const match = value.match(datePattern);
        if (match) {
          const month = match[1].padStart(2, '0');
          const day = match[2].padStart(2, '0');
          let year = match[3];
          if (year.length === 2) {
            year = '20' + year;
          }
          return `${month}/${day}/${year}`;
        }
      }
      return value;
    };
    
    // Find VIN in insurance card (sometimes included)
    const findInsuranceVIN = () => {
      // Check for VIN in key-value pairs
      const vin = findVIN(fullText, keyValuePairs);
      if (vin) return vin;
      
      // Sometimes VIN is prefixed with "No" or other text
      const vinPattern = /[A-HJ-NPR-Z0-9]{17}/g;
      const text = fullText.replace(/[^A-HJ-NPR-Z0-9]/g, '');
      const matches = text.match(vinPattern);
      if (matches && matches.length > 0) {
        debugLog('VIN found after cleanup', matches[0]);
        return matches[0];
      }
      
      return null;
    };
    
    // Extract insurance state
    const extractInsuranceState = () => {
      // First check key-value pairs for state
      const stateFromKV = extractField(['state', 'policy state', 'issued in', 'state of issue']);
      if (stateFromKV && stateFromKV.match(/^[A-Z]{2}$/)) {
        return stateFromKV;
      }
      
      // Look for state abbreviations in the full text
      const statePattern = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/g;
      const matches = fullText.match(statePattern);
      
      if (matches && matches.length > 0) {
        debugLog('Insurance state found via pattern', matches[0]);
        return matches[0];
      }
      
      // Try to find state near policy information
      const policyStatePattern = /(?:Policy|Coverage|State)[:\s]*([A-Z]{2})\b/i;
      const policyStateMatch = fullText.match(policyStatePattern);
      if (policyStateMatch) {
        return policyStateMatch[1].toUpperCase();
      }
      
      return null;
    };

    // Extract insurer contact info
    const extractInsurerContactInfo = () => {
      // Look for phone numbers
      const phonePattern = /(?:Phone|Call|Contact|Claims)[:\s]*(?:1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/gi;
      const phoneMatches = fullText.match(phonePattern);
      
      if (phoneMatches && phoneMatches.length > 0) {
        // Extract just the number portion
        const cleanPhone = phoneMatches[0].replace(/[^0-9]/g, '');
        return cleanPhone.length >= 10 ? cleanPhone : null;
      }
      
      // Try to find any 10-digit phone number
      const genericPhonePattern = /(?:1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
      const allPhones = fullText.match(genericPhonePattern);
      
      if (allPhones && allPhones.length > 0) {
        return allPhones[0].replace(/[^0-9]/g, '');
      }
      
      return null;
    };

    // Extract named drivers (including additional drivers)
    // Extract named drivers (including additional drivers)
const extractNamedDrivers = () => {
  const drivers = [];
  
  // Get primary insured
  const primaryInsured = extractField(['named insured', 'insured', 'policyholder', 'insured name']);
  if (primaryInsured && primaryInsured.length > 2) {
    drivers.push(primaryInsured);
  }
  
  // Get additional drivers - also check for "Additional Drivers" as a standalone section
const additionalDrivers = extractField(['additional drivers', 'additional insured', 'other drivers', 'drivers']);

// If not found in key-value pairs, look for section headers in full text
if (!additionalDrivers) {
  // Look for "Additional Drivers" section followed by names
  const additionalDriverPattern = /Additional\s+Drivers[:\s]*([^\n]+(?:\n[^\n]+)*?)(?=\n\n|\n[A-Z]|$)/gi;
  const match = fullText.match(additionalDriverPattern);
  if (match) {
    additionalDrivers = match[1].trim();
  }
}
  if (additionalDrivers && additionalDrivers.length > 2) {
    // Split by common delimiters
    const additionalList = additionalDrivers.split(/[,;&]|and/i).map(d => d.trim()).filter(d => d && d.length > 2);
    drivers.push(...additionalList);
  }
  
  // Look for driver patterns in full text
  const driverPatterns = [
    /named\s+insured[:\s]+([^\n]+)/gi,
    /additional\s+driver[:\s]+([^\n]+)/gi,
    /driver[:\s]+([^\n]+)/gi
  ];
  
  driverPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(fullText)) !== null) {
      const driver = match[1].trim();
      // Only add if it's a real name (more than 2 characters)
      if (driver && driver.length > 2 && !drivers.includes(driver)) {
        drivers.push(driver);
      }
    }
  });
  
  // Filter out any single characters or very short strings
  const uniqueDrivers = [...new Set(drivers)]
    .filter(driver => driver && driver.length > 2 && !driver.match(/^[a-z0-9,\s]+$/i));
  
  return uniqueDrivers; // Return as array, not string
};
    
    const data = {
      insurance_company: extractInsuranceCompany(),
      policy_number: extractField(['policy', 'policy number', 'policy no', 'pol#']),
      effective_date: extractDate(['effective', 'eff date', 'from', 'starts']),
      expiration_date: extractDate(['expires', 'expiration', 'exp date', 'to', 'ends']),
      insured_name: extractField(['named insured', 'insured', 'policyholder', 'insured name']),
      named_drivers: extractNamedDrivers(),
      insurance_state: extractInsuranceState(),
      insurer_contact_info: extractInsurerContactInfo(),
      vehicle_vin: findInsuranceVIN(),
      vehicle_year: extractField(['year', 'yr']),
      vehicle_make: extractField(['make']),
      vehicle_model: extractField(['model'])
    };
    
    debugLog('Extracted insurance data', data);
    
    // Check if dates are valid
    const isExpired = () => {
      if (data.expiration_date) {
        const parts = data.expiration_date.split('/');
        if (parts.length === 3) {
          const expDate = new Date(parts[2], parts[0] - 1, parts[1]);
          return expDate < new Date();
        }
      }
      return false;
    };
    
    // Check if this looks like an insurance card
    const isInsurance = (data.insurance_company || data.policy_number || 
                        fullText.toLowerCase().includes('insurance') ||
                        fullText.toLowerCase().includes('policy'));
    
    return {
      document_type: isInsurance ? 'insurance' : 'wrong_document',
      data: data,
      validity: {
        currently_active: !isExpired(),
        appears_genuine: true
      },
      driver_verification: {
        has_multiple_drivers: Array.isArray(data.named_drivers) ? data.named_drivers.length > 1 : false,
        drivers_listed: Array.isArray(data.named_drivers) ? data.named_drivers.join(', ') : data.named_drivers
      }
    };
    
  } catch (err) {
    console.error('Textract insurance extraction failed:', err);
    debugLog('Textract error', err);
    
    // Fallback to manual entry
    return {
      document_type: 'insurance',
      data: {
        insurance_company: null,
        policy_number: null,
        effective_date: null,
        expiration_date: null,
        insured_name: null
      },
      error: err.message
    };
  }
}

// Keep existing OpenAI functions for driver license and face matching
async function extractDriverLicense(imageUrl, side = 'front') {
  // ... keep existing OpenAI implementation ...
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

// Keep existing functions
async function extractLicensePlate(imageUrl) {
  // ... keep existing OpenAI implementation ...
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

async function validateVehiclePhoto(imageUrl, expectedSide) {
  return {
    is_vehicle: true,
    side_captured: expectedSide
  };
}

async function compareFaces(profilePhotoUrl, licensePhotoUrl) {
  // ... keep existing OpenAI implementation ...
  try {
    debugLog('Face Match - Input URLs', {
      profileLength: profilePhotoUrl?.length || 0,
      licenseLength: licensePhotoUrl?.length || 0,
      profilePreview: profilePhotoUrl?.substring(0, 100) + '...',
      licensePreview: licensePhotoUrl?.substring(0, 100) + '...'
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze these two photos and determine if they could reasonably be the same person based on general facial features.

DO NOT perform biometric identification. Instead, look for general similarities like:
- Overall face shape and proportions
- Hair color and style (if visible)
- Approximate age range
- General facial features

Consider that:
- Lighting may be different
- Angles may vary
- Time may have passed between photos
- One photo may be lower quality (ID photo)

Return a JSON response with your assessment:
{
  "is_real_person": true/false (is the first photo a direct photo of a person, not a photo of another image),
  "is_same_person": true/false (could these reasonably be the same person based on general appearance),
  "match_confidence": 0-100 (how confident are you in your assessment),
  "issues": [],
  "details": "brief explanation of your reasoning"
}

Be lenient - if unsure, err on the side of marking as same person.`
          },
          { type: 'image_url', image_url: { url: profilePhotoUrl } },
          { type: 'image_url', image_url: { url: licensePhotoUrl } }
        ]
      }],
      max_tokens: 300,
      temperature: 0.1
    });

    const content = response.choices[0]?.message?.content || '';
    debugLog('Face Match - OpenAI Raw Response', content);
    
    const result = JSON.parse(content.replace(/```json\s*/gi, '').replace(/```/g, '').trim());
    debugLog('Face Match - Parsed Result', result);
    
    return result;
  } catch (error) {
    debugLog('Face Match - Error', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    console.error('Face comparison error:', error);
    return null;
  }
}

// Updated main extraction function
async function extractDocument(imageUrl, documentType) {
  console.log(`Starting OCR extraction for document type: ${documentType}`);
  
  const extractors = {
    'license_front': () => extractDriverLicense(imageUrl, 'front'),
    'license_back': () => extractDriverLicense(imageUrl, 'back'),
    'registration': () => extractVehicleRegistration(imageUrl), // Now uses Textract
    'insurance': () => extractInsuranceCard(imageUrl), // Now uses Textract
    'plate': () => extractLicensePlate(imageUrl),
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

// Keep existing helper functions
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

function validateExtractedData(data, documentType) {
  if (!data) {
    return { isValid: false, errors: ['No data extracted'], data: {} };
  }

  if (data.document_type === 'wrong_document') {
    return { 
      isValid: false, 
      errors: ['Wrong document type'], 
      data: data.data || {} 
    };
  }

  if (documentType === 'license_front' && data.fraud_check?.risk_level === 'high') {
    return {
      isValid: false,
      errors: ['Document quality or authenticity issues: ' + (data.fraud_check.issues || []).join(', ')],
      data: data.data || {}
    };
  }

  if (documentType === 'registration' && data.authenticity?.appears_genuine === false) {
    return {
      isValid: false,
      errors: ['Document authenticity could not be verified'],
      data: data.data || {}
    };
  }

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
      required: ['registration_expiration'], // Make expiration required
      dateFields: ['registration_expiration', 'registration_issued_date'],
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

  for (const field of validation.required || []) {
    if (!cleanedData[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

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
  compareFaces,
};