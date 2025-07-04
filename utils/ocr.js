const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function extractText(imageUrl) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `
You are analyzing a pizza delivery label. Extract the following fields:

- Order Number (a 6-digit number)
- Order Total (as a dollar amount)
- Customer Name (full name if possible)

Respond ONLY as a JSON object with these three fields: "order_number", "order_total", and "customer_name".`,
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
      return JSON.parse(content); // If it's valid JSON, great.
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
