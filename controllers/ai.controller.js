const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.generateReplies = async (req, res) => {
  const { transcript } = req.body;

  // 1. Validation
  if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
    return res.status(400).json({ error: 'Transcript history is required.' });
  }

  console.log(`[AI Controller]: Generating context-aware replies for transcript of ${transcript.length} messages.`);

  try {
    // 2. Build History for OpenAI
    const messages = [
      {
        role: 'system',
        content: 'You are an expert WhatsApp assistant. Based on the chat history, provide 3 short, professional, and contextually relevant reply options. Each option must be a direct response to the last message, keeping the conversation flow natural. \nRules:\n- Max 2 sentences per reply.\n- No numbering, no bullets.\n- One reply per line.\n- Tone: Professional yet friendly.'
      },
      ...transcript.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }))
    ];

    // 2. OpenAI Integration (Latest SDK)
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.7,
      max_tokens: 150,
    });

    const content = completion.choices[0].message.content;

    // 3. Parse and Format Response
    const replies = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .slice(0, 3);

    if (replies.length === 0) {
      throw new Error('AI failed to generate valid replies');
    }

    console.log(`[AI Controller]: Success! Generated ${replies.length} replies.`);
    
    res.status(200).json({ replies });

  } catch (error) {
    console.error('[AI Controller Error]:', error.message);
    
    // Handle specific OpenAI errors
    if (error.status === 401) {
      return res.status(500).json({ error: 'Server configuration error (Invalid API Key)' });
    }
    
    if (error.status === 429) {
      return res.status(429).json({ error: 'AI service rate limit exceeded. Try again later.' });
    }

    res.status(500).json({ error: 'Failed to generate AI replies. Please try again.' });
  }
};
