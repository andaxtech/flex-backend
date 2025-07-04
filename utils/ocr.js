require('dotenv').config();
const { OpenAI } = require('openai');

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
              text: `You are an OCR extraction engine for pizza delivery labels. Extract the following:

{
  "order_number": "<6-digit number or null>",
  "order_total": "<total in USD like 21.84 or null>",
  "customer_name": "<name like 'ABILLA' or null>"
}

Respond ONLY with valid JSON. No extra text or formatting.`,
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

    let content = response.choices?.[0]?.message?.content?.trim();

    // ✅ Strip markdown-style code block ```json ... ```
    if (content.startsWith('```')) {
      content = content.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, '$1').trim();
    }

    console.log('🔍 Cleaned OpenAI response:', content);

    try {
      return JSON.parse(content);
    } catch (err) {
      console.warn('⚠️ Still could not parse JSON, returning raw content');
      return { error: 'Unparsable JSON', raw: content };
    }

  } catch (err) {
    console.error('❌ OpenAI Vision failed:', err);
    return { error: 'OpenAI Vision failed', details: err.message };
  }
}

module.exports = extractText;
