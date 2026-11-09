// Quick test script — run: node test-api.js YOUR_GEMINI_KEY
// Tests if the Gemini API key works correctly from this machine

const apiKey = process.argv[2];
if (!apiKey) {
  console.error('Usage: node test-api.js YOUR_GEMINI_KEY');
  process.exit(1);
}

const model = 'gemini-1.5-flash';
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

const body = {
  contents: [{ parts: [{ text: 'Say "ZOZO API TEST OK" and nothing else.' }] }],
  generationConfig: { maxOutputTokens: 20 }
};

console.log(`Testing Gemini API with model: ${model}`);
console.log(`Endpoint: ${endpoint.replace(apiKey, 'API_KEY_HIDDEN')}\n`);

fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
})
.then(async res => {
  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ API ERROR ${res.status}:`);
    console.error(text);
    process.exit(1);
  }
  const parsed = JSON.parse(text);
  const reply = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '(no text)';
  console.log(`✅ API Response: ${reply.trim()}`);
  console.log('\n🎉 Your Gemini API key works! ZOZO should respond.');
})
.catch(err => {
  console.error('❌ Network error:', err.message);
  process.exit(1);
});
