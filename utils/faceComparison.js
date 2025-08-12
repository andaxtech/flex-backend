// utils/faceComparison.js
const AWS = require('aws-sdk');
require('dotenv').config();

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-west-2'
});

const rekognition = new AWS.Rekognition();

// Convert base64 to buffer for Rekognition
function base64ToBuffer(base64String) {
  // Remove data URL prefix if present
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

// Compare faces using AWS Rekognition
async function compareFacesAWS(profilePhotoBase64, licensePhotoBase64) {
  try {
    console.log('[AWS Rekognition] Starting face comparison...');
    
    // Convert base64 to buffers
    const profileBuffer = base64ToBuffer(profilePhotoBase64);
    const licenseBuffer = base64ToBuffer(licensePhotoBase64);
    
    console.log('[AWS Rekognition] Profile buffer size:', profileBuffer.length);
    console.log('[AWS Rekognition] License buffer size:', licenseBuffer.length);
    
    // Call AWS Rekognition
    const params = {
      SourceImage: {
        Bytes: profileBuffer
      },
      TargetImage: {
        Bytes: licenseBuffer
      },
      SimilarityThreshold: 70 // Adjust as needed (0-100)
    };
    
    const startTime = Date.now();
    const response = await rekognition.compareFaces(params).promise();
    const endTime = Date.now();
    
    console.log('[AWS Rekognition] API call took:', endTime - startTime, 'ms');
    console.log('[AWS Rekognition] Response:', JSON.stringify(response, null, 2));
    
    // Check if faces were detected in both images
    if (!response.SourceImageFace) {
      return {
        is_real_person: false,
        is_same_person: false,
        match_confidence: 0,
        issues: ['no_face_in_profile_photo'],
        details: 'No face detected in profile photo'
      };
    }
    
    // Check if any matches were found
    const hasMatch = response.FaceMatches && response.FaceMatches.length > 0;
    const matchConfidence = hasMatch ? response.FaceMatches[0].Similarity : 0;
    
    // Detect if profile photo might be a photo of a photo
    const sourceQuality = response.SourceImageFace.Confidence;
    const isLikelyRealPhoto = sourceQuality > 85; // High confidence usually means direct photo
    
    return {
      is_real_person: isLikelyRealPhoto,
      is_same_person: hasMatch && matchConfidence > 80,
      match_confidence: Math.round(matchConfidence),
      issues: [],
      details: hasMatch 
        ? `Face match found with ${Math.round(matchConfidence)}% similarity`
        : 'No matching face found in driver license photo',
      aws_metadata: {
        source_face_confidence: sourceQuality,
        unmatched_faces: response.UnmatchedFaces?.length || 0,
        face_matches_count: response.FaceMatches?.length || 0
      }
    };
    
  } catch (error) {
    console.error('[AWS Rekognition] Error:', error);
    
    // Handle specific AWS errors
    if (error.code === 'InvalidImageFormatException') {
      return {
        is_real_person: false,
        is_same_person: false,
        match_confidence: 0,
        issues: ['invalid_image_format'],
        details: 'Invalid image format provided'
      };
    }
    
    if (error.code === 'ImageTooLargeException') {
      return {
        is_real_person: false,
        is_same_person: false,
        match_confidence: 0,
        issues: ['image_too_large'],
        details: 'Image size exceeds AWS Rekognition limits (5MB)'
      };
    }
    
    throw error;
  }
}

// Fallback to OpenAI (your existing function)
async function compareFacesOpenAI(profilePhotoUrl, licensePhotoUrl) {
  // Your existing OpenAI comparison code
  const { OpenAI } = require('openai');
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  
  try {
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

Return a JSON response:
{
  "is_real_person": true/false,
  "is_same_person": true/false,
  "match_confidence": 0-100,
  "issues": [],
  "details": "brief explanation"
}`
          },
          { type: 'image_url', image_url: { url: profilePhotoUrl } },
          { type: 'image_url', image_url: { url: licensePhotoUrl } }
        ]
      }],
      max_tokens: 300,
      temperature: 0.1
    });

    const content = response.choices[0]?.message?.content || '';
    return JSON.parse(content.replace(/```json\s*/gi, '').replace(/```/g, '').trim());
  } catch (error) {
    console.error('OpenAI face comparison error:', error);
    return null;
  }
}

// Main comparison function with fallback
async function compareFaces(profilePhoto, licensePhoto) {
    try {
      // Debug log to check AWS config
      console.log('[Face Comparison] AWS Config:', {
        hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
        hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'not set',
        accessKeyPreview: process.env.AWS_ACCESS_KEY_ID ? process.env.AWS_ACCESS_KEY_ID.substring(0, 4) + '...' : 'missing'
      });
      
      // Try AWS Rekognition first
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      console.log('[Face Comparison] Using AWS Rekognition');
      return await compareFacesAWS(profilePhoto, licensePhoto);
    }
    
    // Fallback to OpenAI if AWS not configured
    console.log('[Face Comparison] AWS not configured, falling back to OpenAI');
    return await compareFacesOpenAI(profilePhoto, licensePhoto);
    
  } catch (error) {
    console.error('[Face Comparison] Error:', error);
    
    // If AWS fails, try OpenAI as fallback
    if (error.code && error.code.startsWith('AWS')) {
      console.log('[Face Comparison] AWS failed, trying OpenAI fallback');
      return await compareFacesOpenAI(profilePhoto, licensePhoto);
    }
    
    return null;
  }
}

module.exports = {
  compareFaces,
  compareFacesAWS,
  compareFacesOpenAI
};