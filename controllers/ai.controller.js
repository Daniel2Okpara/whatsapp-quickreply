const OpenAI = require('openai');
const fs = require('fs');

exports.transcribeAudio = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file required' });
    }

    // 1b. Check User Limits (Free Tier = 15 calls)
    if (req.user && !req.user.isPro) {
      if (req.user.creditsUsed >= 15) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Monthly AI limit reached (15/15). Please upgrade to Professional.', limitReached: true });
      }
      req.user.creditsUsed += 1;
      await req.user.save();
    }

    const effectiveApiKey = req.body.apiKey || process.env.OPENAI_API_KEY;
    if (!effectiveApiKey) return res.status(500).json({ error: 'API Key missing' });

    const openai = new OpenAI({ apiKey: effectiveApiKey });
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-1",
    });

    // Cleanup
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    return res.json({ text: transcription.text });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Transcription Error:', err.message);
    return res.status(500).json({ error: 'Transcription failed' });
  }
};

exports.generateReplies = async (req, res) => {
  const { transcript, messages: incomingMessages, voiceTranscript, apiKey, personality, timeOfDay, styleProfile, tone, replyStyle, emojiUsage, mode } = req.body;
  const historyArray = transcript || incomingMessages;

  // 1. Validation
  if (!historyArray || !Array.isArray(historyArray) || historyArray.length === 0) {
    return res.status(400).json({ error: 'Chat history is required.' });
  }

  const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!effectiveApiKey) {
    return res.status(500).json({ error: 'AI service unavailable (Missing API Key)' });
  }

  // 1b. Check User Limits (Free Tier = 15 calls)
  if (req.user && !req.user.isPro) {
    if (req.user.creditsUsed >= 15) {
      return res.status(403).json({ error: 'Monthly AI limit reached (15/15). Please upgrade to Professional.', limitReached: true });
    }
    req.user.creditsUsed += 1;
    await req.user.save();
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
        ${mode === 'follow_up' 
          ? 'The user of this account sent the last message and has not received a reply. Your task is to generate ONE (1) natural, non-pushy follow-up or check-in message.' 
          : 'Generate ONE (1) natural, conversational response to the last message from the other person.'}
        `
      },
      ...historyArray.map(msg => ({
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
  // Legacy compatibility: accept either { text } or { text, messages, styleExamples, tone, timeContext }
  const { text, messages: convo = [], styleExamples, tone, timeContext, apiKey } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text to improve is required.' });
  }

  const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!effectiveApiKey) {
    return res.status(500).json({ error: 'AI service unavailable (Missing API Key)' });
  }

  // 1b. Check User Limits (Free Tier = 15 calls)
  if (req.user && !req.user.isPro) {
    if (req.user.creditsUsed >= 15) {
      return res.status(403).json({ error: 'Monthly AI limit reached (15/15). Please upgrade to Professional.', limitReached: true });
    }
    req.user.creditsUsed += 1;
    await req.user.save();
  }

  const openai = new OpenAI({ apiKey: effectiveApiKey });

  try {
    // System prompt: behave as an editor that improves the provided draft using conversation context
    const system = `You are an editor for WhatsApp messages. Your job is to IMPROVE the provided draft message written by ME (the owner of the account) while preserving the original intent.

Rules:
- Use the conversation context to adapt tone and content — do not invent new facts or change the intent.
- Keep the message concise and natural for WhatsApp.
- Match the sender's style when possible using provided examples.
- Fix grammar, punctuation, and flow.
- If the draft is informal, keep it informal but clearer.
- Return ONLY the improved message text with no explanations or extra tokens.`;

    const aiMessages = [ { role: 'system', content: system } ];

    // Attach style examples and metadata (if provided)
    if (styleExamples) aiMessages.push({ role: 'user', content: `Style examples:\n${styleExamples}` });
    if (tone) aiMessages.push({ role: 'user', content: `Preferred tone: ${tone}` });
    if (timeContext) aiMessages.push({ role: 'user', content: `Time of day: ${timeContext}` });

    // Attach recent conversation context (if any) to help the editor adapt
    if (Array.isArray(convo) && convo.length) {
      aiMessages.push({ role: 'user', content: 'Conversation context (most recent last):' });
      convo.slice(-10).forEach(m => {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        aiMessages.push({ role, content: m.content });
      });
    }

    // Finally provide the draft that should be improved
    aiMessages.push({ role: 'user', content: `IMPROVE THIS DRAFT (RETURN ONLY THE IMPROVED MESSAGE):\\n\\n${text}` });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: aiMessages,
      temperature: 0.65,
      max_tokens: 300,
    });

    const improvedText = completion.choices?.[0]?.message?.content?.trim() || '';
    console.log(`[AI Controller]: Improved message length ${improvedText.length}`);
    res.status(200).json({ improvedText });

  } catch (error) {
    console.error('[AI Controller Improve Error]:', error?.message || error);
    res.status(500).json({ error: 'Failed to improve message. Please try again.' });
  }
};

// Compatibility endpoint: POST /ai-reply
exports.aiReply = async (req, res) => {
  try {
    const { messages, voiceTranscript, styleExamples, tone, timeContext, apiKey } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages required' });
    }

    const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY;
    if (!effectiveApiKey) return res.status(500).json({ error: 'AI service unavailable (Missing API Key)' });

    const openai = new OpenAI({ apiKey: effectiveApiKey });

    // 1b. Check User Limits (Free Tier = 15 calls)
    if (req.user && !req.user.isPro) {
      if (req.user.creditsUsed >= 15) {
        return res.status(403).json({ error: 'Monthly AI limit reached (15/15). Please upgrade to Professional.', limitReached: true });
      }
      req.user.creditsUsed += 1;
      await req.user.save();
    }

    const systemPrompt = `You are replying as the owner of this WhatsApp account.

IDENTITY RULES:
- You are "ME" (the user of the extension).
- NEVER reply as the other person.
- Messages labeled "user" are from the OTHER PERSON.
- Messages labeled "assistant" are from ME.

PRIMARY TASK:
Generate a natural reply as ME based on the conversation and any provided voice transcript.

CONTEXT RULES:
- Read the full conversation carefully.
- If a [VOICE TRANSCRIPT] is provided, it is the most recent message from the other person. PRIORITIZE replying to it.
- Understand what the other person is saying.
- Match my writing style using the style examples provided.`;

    const aiMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Style examples:\n${styleExamples || ''}` },
    ];

    if (voiceTranscript) {
       aiMessages.push({ role: 'user', content: `[VOICE TRANSCRIPT FROM OTHER PERSON]: "${voiceTranscript}"` });
    }

    aiMessages.push(...messages);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: aiMessages,
      temperature: 0.7,
      max_tokens: 250
    });

    const reply = completion.choices?.[0]?.message?.content?.trim() || '';
    return res.json({ reply });
  } catch (err) {
    console.error('AI Reply Error:', err?.message || err);
    return res.status(500).json({ error: 'AI reply failed' });
  }
};

// Compatibility endpoint: POST /ai-improve
// Accepts: { text, messages, styleExamples, tone, timeContext, apiKey }
exports.aiImprove = async (req, res) => {
  try {
    const { text, messages: convo = [], styleExamples, tone, timeContext, apiKey } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY;
    if (!effectiveApiKey) return res.status(500).json({ error: 'AI service unavailable (Missing API Key)' });

    const openai = new OpenAI({ apiKey: effectiveApiKey });

    const system = `You are an editor for WhatsApp messages. Improve the provided draft message written by ME while preserving intent. Use the conversation context and style examples to adapt tone and phrasing. Do NOT invent facts or add new content beyond improving wording. Return ONLY the improved message text.`;

    const aiMessages = [ { role: 'system', content: system } ];
    if (styleExamples) aiMessages.push({ role: 'user', content: `Style examples:\n${styleExamples}` });
    if (tone) aiMessages.push({ role: 'user', content: `Preferred tone: ${tone}` });
    if (timeContext) aiMessages.push({ role: 'user', content: `Time of day: ${timeContext}` });

    if (Array.isArray(convo) && convo.length) {
      aiMessages.push({ role: 'user', content: 'Conversation context (most recent last):' });
      convo.slice(-10).forEach(m => {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        aiMessages.push({ role, content: m.content });
      });
    }

    aiMessages.push({ role: 'user', content: `IMPROVE THIS DRAFT (RETURN ONLY THE IMPROVED MESSAGE):\\n\\n${text}` });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: aiMessages,
      temperature: 0.65,
      max_tokens: 300
    });

    const improved = completion.choices?.[0]?.message?.content?.trim() || '';
    return res.json({ improved });
  } catch (err) {
    console.error('Improve Error:', err?.message || err);
    return res.status(500).json({ error: 'Improve failed' });
  }
};
