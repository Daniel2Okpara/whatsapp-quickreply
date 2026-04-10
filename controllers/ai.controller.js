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
      funny: "Be witty and slightly sarcastic but charming. Use 1-2 relevant emojis. Sound like a funny friend who doesn't take things too seriously.",
      friendly: "Warm, supportive, and conversational. Use 'Hey' or 'Hi' naturally. No robotic formalities. Sound like a helpful neighbor or a close colleague.",
      professional: "Clear, respectful, and polished. Avoid corporate jargon. Sound like a competent expert who values the recipient's time.",
      short: "Get to the point immediately. Casual and punchy. No greetings or fluff unless necessary.",
      casual: "Totally relaxed. Use common shorthand (e.g., 'u' instead of 'you' if appropriate) and frequent emojis. Sound like a gen-z or millennial texting a friend."
    };

    const styleRule = pRules[personality?.toLowerCase()] || pRules.friendly;

    // 3. Build History for OpenAI
    const messages = [
      {
        role: 'system',
        content: `You are a human chatting on WhatsApp. Your goal is to keep the conversation flowing naturally.
        
        HUMANITY RULES (CRITICAL):
        - NEVER say "As an AI" or "How can I assist you?".
        - NO bullet points. NO formal lists.
        - Use natural transitions: "Oh," "Anyway," "Actually," "Btw," "Just thinking...".
        - Match the sender's VIBE: If they are short, you be short. If they are expressive, you be expressive.
        
        SITUATIONAL CONTEXT:
        - Time: ${timeOfDay || 'Unknown'} (Use this for greetings like "Morning!" or "Still up?").
        - Mood: ${personality || 'Friendly'}.
        
        STYLE GUIDELINE:
        ${styleRule}
        
        TASK:
        Generate ONE (1) natural response. If the last message was from the user, suggest a proactive follow-up or a helpful clarification.`
      },
      ...transcript.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }))
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.85, // Slightly higher for more "human" variety
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
