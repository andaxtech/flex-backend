// utils/validation.js - Create this new file for dat quality checks

const validator = require('validator'); // npm install validator

// Date validation and formatting
const validateDate = (dateString, fieldName) => {
  if (!dateString) return { isValid: false, error: `${fieldName} is required` };
  
  // Handle MM/DD/YYYY format
  const datePattern = /^(0[1-9]|1[0-2])\/(0[1-9]|[12][0-9]|3[01])\/\d{4}$/;
  if (!datePattern.test(dateString)) {
    return { isValid: false, error: `${fieldName} must be in MM/DD/YYYY format` };
  }
  
  // Parse and validate actual date
  const [month, day, year] = dateString.split('/').map(Number);
  const date = new Date(year, month - 1, day);
  
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { isValid: false, error: `${fieldName} is not a valid date` };
  }
  
  return { isValid: true, value: date };
};

// License validation
const validateDriverLicense = (data) => {
  const errors = [];
  
  // License number format validation (varies by state)
  const licenseFormats = {
    'CA': /^[A-Z]\d{7}$/,  // California: 1 letter + 7 digits
    'TX': /^\d{8}$/,       // Texas: 8 digits
    'NY': /^[A-Z]\d{7}$|^\d{9}$/,  // New York: various formats
    // Add more states as needed
  };
  
  if (!data.driver_license_number) {
    errors.push('Driver license number is required');
  } else if (data.driver_license_state_issued && licenseFormats[data.driver_license_state_issued]) {
    const format = licenseFormats[data.driver_license_state_issued];
    if (!format.test(data.driver_license_number)) {
      errors.push(`Invalid license number format for ${data.driver_license_state_issued}`);
    }
  }
  
  // Expiration date validation
  const expDate = validateDate(data.driver_license_expiration, 'License expiration');
  if (!expDate.isValid) {
    errors.push(expDate.error);
  } else if (expDate.value < new Date()) {
    errors.push('Driver license is expired');
  }
  
  // Birth date validation
  const birthDate = validateDate(data.birth_date, 'Birth date');
  if (!birthDate.isValid) {
    errors.push(birthDate.error);
  } else {
    const age = (new Date() - birthDate.value) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < 18) {
      errors.push('Driver must be at least 18 years old');
    } else if (age > 100) {
      errors.push('Invalid birth date - please check the year');
    }
  }
  
  return errors;
};

// Vehicle validation
const validateVehicle = (data) => {
  const errors = [];
  
  // VIN validation
  if (!data.vin_number) {
    errors.push('VIN number is required');
  } else if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(data.vin_number)) {
    errors.push('Invalid VIN format - must be 17 characters');
  }
  
  // License plate validation
  if (!data.license_plate) {
    errors.push('License plate is required');
  } else if (!/^[A-Z0-9]{1,8}$/.test(data.license_plate.replace(/\s/g, '').toUpperCase())) {
    errors.push('Invalid license plate format');
  }
  
  // Year validation
  const currentYear = new Date().getFullYear();
  const carYear = parseInt(data.car_year);
  if (!carYear) {
    errors.push('Vehicle year is required');
  } else if (carYear < 2000 || carYear > currentYear + 1) {
    errors.push('Vehicle year must be between 2000 and ' + (currentYear + 1));
  }
  
  // Make/Model validation
  if (!data.car_make || data.car_make.length < 2) {
    errors.push('Vehicle make is required');
  }
  if (!data.car_model || data.car_model.length < 1) {
    errors.push('Vehicle model is required');
  }
  
  // Registration expiration
  if (data.vehicle_registration_expiration) {
    const regExp = validateDate(data.vehicle_registration_expiration, 'Registration expiration');
    if (!regExp.isValid) {
      errors.push(regExp.error);
    } else if (regExp.value < new Date()) {
      errors.push('Vehicle registration is expired');
    }
  }
  
  return errors;
};

// Insurance validation
const validateInsurance = (data) => {
  const errors = [];
  
  // Required fields
  if (!data.insurance_provider) {
    errors.push('Insurance provider is required');
  }
  if (!data.insurance_policy_number) {
    errors.push('Policy number is required');
  }
  
  // Date validation
  const startDate = validateDate(data.policy_start_date, 'Policy start date');
  const endDate = validateDate(data.policy_end_date, 'Policy end date');
  
  if (!startDate.isValid) {
    errors.push(startDate.error);
  }
  if (!endDate.isValid) {
    errors.push(endDate.error);
  }
  
  if (startDate.isValid && endDate.isValid) {
    if (endDate.value <= startDate.value) {
      errors.push('Policy end date must be after start date');
    }
    if (endDate.value < new Date()) {
      errors.push('Insurance policy is expired');
    }
  }
  
  return errors;
};

// Personal info validation
const validatePersonalInfo = (data) => {
  const errors = [];
  
  // Name validation
  if (!data.first_name || data.first_name.length < 2) {
    errors.push('First name must be at least 2 characters');
  } else if (!/^[a-zA-Z\s'-]+$/.test(data.first_name)) {
    errors.push('First name contains invalid characters');
  }
  
  if (!data.last_name || data.last_name.length < 2) {
    errors.push('Last name must be at least 2 characters');
  } else if (!/^[a-zA-Z\s'-]+$/.test(data.last_name)) {
    errors.push('Last name contains invalid characters');
  }
  
  // Email validation
  if (!data.email || !validator.isEmail(data.email)) {
    errors.push('Valid email is required');
  }
  
  // Phone validation
  const cleanPhone = data.phone_number?.replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length !== 10) {
    errors.push('Valid 10-digit phone number is required');
  }
  
  // Address validation
  if (!data.city || data.city.length < 2) {
    errors.push('City is required');
  }
  
  if (!data.zip_code || !/^\d{5}$/.test(data.zip_code)) {
    errors.push('Valid 5-digit ZIP code is required');
  }
  
  // State validation
  const validStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
                      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS',
                      'MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
                      'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
                      'WI','WY'];
  
  if (!data.driver_license_state_issued || !validStates.includes(data.driver_license_state_issued)) {
    errors.push('Valid state is required');
  }
  
  return errors;
};

// SSN validation (if provided)
const validateSSN = (ssn) => {
  if (!ssn) return null; // SSN might be optional initially
  
  const cleanSSN = ssn.replace(/\D/g, '');
  if (cleanSSN.length !== 9) {
    return 'SSN must be 9 digits';
  }
  
  // Check for invalid SSNs (all zeros, sequential, etc.)
  if (cleanSSN === '000000000' || cleanSSN === '123456789') {
    return 'Invalid SSN';
  }
  
  return null;
};

// Photo validation
const validatePhotos = (data) => {
  const errors = [];
  const requiredPhotos = [
    { field: 'driver_license_photo_front_url', name: 'Driver license front' },
    { field: 'driver_license_photo_back_url', name: 'Driver license back' },
    { field: 'profile_photo_url', name: 'Profile photo' },
    { field: 'vehicle_registration_photo_url', name: 'Vehicle registration' },
    { field: 'insurance_card_photo_url', name: 'Insurance card' },
    { field: 'license_plate_photo_url', name: 'License plate' },
    { field: 'car_image_front', name: 'Vehicle front photo' },
    { field: 'car_image_back', name: 'Vehicle back photo' },
    { field: 'car_image_left', name: 'Vehicle left photo' },
    { field: 'car_image_right', name: 'Vehicle right photo' }
  ];
  
  requiredPhotos.forEach(photo => {
    if (!data[photo.field]) {
      errors.push(`${photo.name} is required`);
    }
  });
  
  return errors;
};

// Main validation function
const validateDriverSignup = (data) => {
  const allErrors = [];
  
  // Run all validations
  allErrors.push(...validatePersonalInfo(data));
  allErrors.push(...validateDriverLicense(data));
  allErrors.push(...validateVehicle(data));
  allErrors.push(...validateInsurance(data));
  allErrors.push(...validatePhotos(data));
  
  // SSN validation if provided
  const ssnError = validateSSN(data.ssn);
  if (ssnError) allErrors.push(ssnError);
  
  // Work authorization
  if (!data.work_authorization || !['citizen', 'permanent_resident', 'work_visa'].includes(data.work_authorization)) {
    allErrors.push('Valid work authorization status is required');
  }
  
  // Consent validation
  if (!data.criminal_consent) {
    allErrors.push('Criminal background check consent is required');
  }
  if (!data.driving_consent) {
    allErrors.push('Driving record check consent is required');
  }
  
  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: getWarnings(data)
  };
};

// Get warnings (non-blocking issues)
const getWarnings = (data) => {
  const warnings = [];
  
  // Check if names match between license and insurance
  if (data.first_name && data.insured_names_encrypted) {
    const insuredNames = data.insured_names_encrypted.toLowerCase();
    const driverName = `${data.first_name} ${data.last_name}`.toLowerCase();
    if (!insuredNames.includes(data.first_name.toLowerCase()) && 
        !insuredNames.includes(data.last_name.toLowerCase())) {
      warnings.push('Driver name may not match insurance policy');
    }
  }
  
  // Check face match confidence
  if (data.face_match_confidence && data.face_match_confidence < 80) {
    warnings.push('Face match confidence is low');
  }
  
  // Vehicle age warning
  const carYear = parseInt(data.car_year);
  if (carYear && carYear < 2010) {
    warnings.push('Vehicle is over 14 years old');
  }
  
  return warnings;
};

module.exports = {
  validateDriverSignup,
  validateDate,
  sanitizeDate: (dateString) => {
    if (!dateString || dateString.trim() === '') return null;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : dateString;
  }
};