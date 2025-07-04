require('dotenv').config();

const { OpenAI } = require('openai'); // ✅ Destructure here for v5+

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function extractText(imageUrl) {
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
You are an OCR extraction engine for pizza delivery labels. Read the image and extract exactly the following:

{
  "order_number": "<6-digit number or null>",
  "order_total": "<total in USD like 21.84 or null>",
  "customer_name": "<name like 'ABILLA' or null>"
}

Respond ONLY with a valid JSON object. Do not include any explanation or extra text.`,

            },
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content;

    try {
      console.log('🔍 Raw OpenAI response:', content);

      return JSON.parse(content);
    } catch (err) {
      console.warn('⚠️ Could not parse JSON, returning raw content');
      return content;
    }
  } catch (err) {
    console.error('❌ OpenAI Vision failed:', err);
    return '';
  }
}

module.exports = extractText;
