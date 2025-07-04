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
              text: `
You are an OCR extraction engine reading Domino's pizza labels. From the image, extract and return a valid JSON object with the following keys:

{
  "order_number": "<6-digit number or null>",
  "order_total": "<amount like 21.84 or null>",
  "customer_name": "<name like 'ABILLA' or null>",
  "slice_number": "<this order's number in the batch, e.g. 2>",
  "total_slices": "<total number of orders in this batch, e.g. 2>",
  "order_type": "<'Carry-Out' or 'Delivery'>",
  "payment_status": "<'PAID' or 'UNPAID'>",
  "order_time": "<formatted time like '05:38 PM' or null>",
  "order_date": "<formatted date like '06/08' or null>",
  "phone_number": "<if visible, formatted number like (123) 456-7890, else null>"
}

⚠️ Respond ONLY with a pure JSON object, no explanation or markdown.
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
