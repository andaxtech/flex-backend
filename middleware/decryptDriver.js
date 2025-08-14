// middleware/decryptDriver.js
const { decrypt } = require('../utils/encryption');

const decryptDriverData = (driver) => {
  if (!driver) return null;
  
  // Take the encrypted driver data and decrypt sensitive fields
  return {
    ...driver, // Keep all non-encrypted fields as-is
    
    // Decrypt the encrypted fields
    residence_address: driver.residence_address_encrypted 
      ? decrypt(driver.residence_address_encrypted) 
      : null,
    
    // Remove the encrypted versions from the response
    residence_address_encrypted: undefined // Don't send encrypted data to frontend
  };
};

module.exports = { decryptDriverData };