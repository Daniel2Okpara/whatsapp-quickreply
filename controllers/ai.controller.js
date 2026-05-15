const OpenAI = require('openai');
const fs = require('fs');

const enforceDailyLimit = async (user) => {
  if (!user) return true;
  const now = new Date();
  if (!user.lastUsageReset || user.lastUsageReset.getDate() !== now.getDate() || user.lastUsageReset.getMonth() !== now.getMonth() || user.lastUsageReset.getFullYear() !== now.getFullYear()) {
    user.dailyUsage = 0;
    user.lastUsageReset = now;
  }
  let limit = 10;
  if (user.plan === 'pro') limit = 200;
  else if (user.plan === 'trial') limit = 100;
  
  if (user.dailyUsage >= limit) return false;
  
  user.dailyUsage += 1;
  user.creditsUsed += 1;
  await user.save();
  return true;
};


exports.transcribeAudio = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file required' });
    }

    if (req.user) {
      const allowed = await enforceDailyLimit(req.user);
      if (!allowed) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Daily AI limit reached. Upgrade to Pro for more.', limitReached: true });
      }
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
  const { transcript, messages: incomingMessages, apiKey, personality, tone, replyStyle, emojiUsage } = req.body;
  const historyArray = transcript || incomingMessages;

  if (!historyArray || !Array.isArray(historyArray) || historyArray.length === 0) {
    return res.status(400).json({ error: 'Chat history is required.' });
  }

  const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!effectiveApiKey) return res.status(500).json({ error: 'AI service unavailable' });

  if (req.user) {
    const allowed = await enforceDailyLimit(req.user);
    if (!allowed) return res.status(403).json({ error: 'Limit reached', limitReached: true });
  }

  const openai = new OpenAI({ apiKey: effectiveApiKey });

  try {
    const pRules = {
      funny: "Witty, slightly sarcastic but charming. 1-2 relevant emojis.",
      friendly: "Warm, supportive, conversational. No robotic formalities.",
      professional: "Clear, respectful, polished. Expert tone.",
      casual: "Relaxed. Use common shorthand and frequent emojis."
    };
    const styleRule = pRules[personality?.toLowerCase()] || pRules.friendly;

    const messages = [
      {
        role: 'system',
        content: `You are replying as the owner of this account (ME). THEM is the other person. NEVER speak as them.
        Tone: ${tone || personality || 'Friendly'}. Style: ${styleRule}. Length: ${replyStyle || 'Balanced'}.
        CRITICAL: Return ONLY ONE (1) natural conversational response.`
      },
      ...historyArray.map(msg => ({
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
    return res.status(200).json({ replies: [content] });

  } catch (error) {
    console.error('[AI Error]:', error.message);
    return res.status(500).json({ error: 'Failed to generate AI replies' });
  }
};

exports.improveMessage = async (req, res) => {
  const { text, messages: convo = [], styleExamples, tone, timeContext, apiKey } = req.body;

  if (!text) return res.status(400).json({ error: 'Text to improve is required.' });

  const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!effectiveApiKey) return res.status(500).json({ error: 'AI service unavailable' });

  if (req.user) {
    const allowed = await enforceDailyLimit(req.user);
    if (!allowed) return res.status(403).json({ error: 'Limit reached', limitReached: true });
  }

  const openai = new OpenAI({ apiKey: effectiveApiKey });

  try {
    const system = `Improve the provided draft message written by ME while preserving original intent. Adapt tone and phrasing to match conversation context. Return ONLY improved text.`;
    const aiMessages = [ { role: 'system', content: system } ];

    if (styleExamples) aiMessages.push({ role: 'user', content: `Style examples:\n${styleExamples}` });
    if (tone) aiMessages.push({ role: 'user', content: `Tone: ${tone}` });

    if (Array.isArray(convo) && convo.length) {
      aiMessages.push({ role: 'user', content: 'Context:' });
      convo.slice(-10).forEach(m => {
        aiMessages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
      });
    }

    aiMessages.push({ role: 'user', content: `IMPROVE: ${text}` });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: aiMessages,
      temperature: 0.65,
      max_tokens: 300,
    });

    const improvedText = completion.choices?.[0]?.message?.content?.trim() || '';
    return res.status(200).json({ improvedText });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to improve message' });
  }
};

exports.aiReply = async (req, res) => {
  try {
    const { messages, voiceTranscript, styleExamples, tone, apiKey } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages required' });

    const effectiveApiKey = apiKey || process.env.OPENAI_API_KEY;
    if (!effectiveApiKey) return res.status(500).json({ error: 'AI service unavailable' });

    if (req.user) {
      const allowed = await enforceDailyLimit(req.user);
      if (!allowed) return res.status(403).json({ error: 'Limit reached', limitReached: true });
    }

    const openai = new OpenAI({ apiKey: effectiveApiKey });
    const aiMessages = [
      { role: 'system', content: `Reply as "ME". NEVER as them. Tone: ${tone || 'Friendly'}.` },
      { role: 'user', content: `Style:\n${styleExamples || ''}` }
    ];

    if (voiceTranscript) aiMessages.push({ role: 'user', content: `[VOICE TRANSCRIPT]: "${voiceTranscript}"` });
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
    return res.status(500).json({ error: 'AI reply failed' });
  }
};

exports.aiImprove = exports.improveMessage;

exports.submitFeedback = async (req, res) => {
  try {
    const { suggestion, feedback, context } = req.body;
    if (!suggestion || !feedback) return res.status(400).json({ error: 'Missing feedback data' });

    const AIFeedback = require('../models/feedback.model');
    await AIFeedback.create({
      userId: req.user?._id,
      email: req.user?.email || 'anonymous',
      suggestion,
      feedback: (feedback === 'up' || feedback === 'down') ? feedback : 'up',
      context
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to record feedback' });
  }
};
