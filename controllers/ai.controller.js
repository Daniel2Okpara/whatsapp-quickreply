const OpenAI = require('openai');

exports.generateReplies = async (req, res) => {
  const { transcript, apiKey, personality, timeOfDay } = req.body;

  // 1. Validation
  if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
    return res.status(400).json({ error: 'Transcript history is required.' });
  }

  const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!effectiveApiKey) {
    return res.status(500).json({ error: 'AI service unavailable (Missing API Key)' });
  }

  const openai = new OpenAI({ apiKey: effectiveApiKey });

  console.log(`[AI Controller]: Generating context-aware replies. Persona: ${personality || 'Friendly'}. Time: ${timeOfDay || 'Unknown'}`);

  try {
    // 2. Strong Personality Mapping
    const pRules = {
      funny: "Use light humor, a very casual tone, and 1-2 relevant emojis. Be witty but helpful.",
      friendly: "Be warm, relaxed, and conversational. Use friendly emojis if appropriate. Sound like a close acquaintance.",
      professional: "Be polite, structured, and formal. No emojis. Focus on clarity and professional courtesy.",
      short: "Be extremely concise and direct. Max 10-12 words. No fluff.",
      casual: "Unfiltered, relaxed language. Use common internet slang and emojis freely."
    };

    const styleRule = pRules[personality?.toLowerCase()] || pRules.friendly;

    // 3. Build History for OpenAI
    const messages = [
      {
        role: 'system',
        content: `You are an expert WhatsApp assistant. Generate exactly one human-like reply option.
        
        SITUATIONAL CONTEXT:
        - Current Time of Day: ${timeOfDay || 'Unknown'}
        - Target Persona: ${personality || 'Friendly'}
        
        PERSONALITY RULES (MANDATORY):
        ${styleRule}
        
        GENERAL RULES:
        - Mimicry: Match the sender's slang and language patterns.
        - Format: ONE reply only. Max 1-2 sentences.
        - No placeholders. Return final text only.`
      },
      ...transcript.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }))
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.8,
      max_tokens: 150,
    });

    const content = completion.choices[0].message.content.trim();

    // Clean up if the AI ignored "ONE reply only" rule
    const replies = [content.split('\n')[0]];

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

exports.improveMessage = async (req, res) => {
  const { text, apiKey } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text to improve is required.' });
  }

  const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!effectiveApiKey) {
    return res.status(500).json({ error: 'AI service unavailable (Missing API Key)' });
  }

  const openai = new OpenAI({ apiKey: effectiveApiKey });

  try {
    const messages = [
      {
        role: 'system',
        content: `You are a professional writing assistant. Improve the user's message to be clearer, more professional, and better articulated while keeping the exact same meaning.
        
        Rules:
        - Maintain the user's intent.
        - Fix grammar and flow.
        - If the message is short/informal, make it slightly more polite but NOT overly formal unless necessary.
        - Return ONLY the improved text. No explanations.`
      },
      {
        role: 'user',
        content: text
      }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.7,
      max_tokens: 300,
    });

    const improvedText = completion.choices[0].message.content.trim();
    
    console.log(`[AI Controller]: Successfully improved message. Length: ${improvedText.length}`);
    res.status(200).json({ improvedText });

  } catch (error) {
    console.error('[AI Controller Improve Error]:', error.message);
    res.status(500).json({ error: 'Failed to improve message. Please try again.' });
  }
};
