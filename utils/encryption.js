// utils/encryption.js
const crypto = require('crypto');

// Encryption configuration
const algorithm = 'aes-256-cbc';
const keyLength = 32; // 256 bits
const ivLength = 16; // 128 bits

// Get encryption key from environment or generate one
const getEncryptionKey = () => {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not found in environment variables');
  }
  
  // Ensure key is 32 bytes (64 hex characters)
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  if (key.length !== keyLength) {
    throw new Error(`Encryption key must be ${keyLength} bytes (${keyLength * 2} hex characters)`);
  }
  
  return key;
};

// Encrypt function
const encrypt = (text) => {
  if (!text) return null;
  
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(ivLength);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV + encrypted data
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
};

// Decrypt function
const decrypt = (encryptedText) => {
  if (!encryptedText) return null;
  
  try {
    const key = getEncryptionKey();
    const parts = encryptedText.split(':');
    
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
};

// Generate a new encryption key (run once and save to .env)
const generateEncryptionKey = () => {
  return crypto.randomBytes(keyLength).toString('hex');
};

// Hash function for non-reversible data (like SSN for searching)
const hash = (text) => {
  if (!text) return null;
  
  const salt = process.env.HASH_SALT || 'default-salt';
  return crypto
    .createHash('sha256')
    .update(text + salt)
    .digest('hex');
};

module.exports = {
  encrypt,
  decrypt,
  generateEncryptionKey,
  hash
};