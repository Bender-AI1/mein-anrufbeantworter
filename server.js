require('dotenv').config();                    // Lädt Umgebungsvariablen
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');          // Für E-Mail-Versand
const { twiml: { VoiceResponse } } = require('twilio');
const fetch = require('node-fetch');                // Für OpenRouter API-Aufrufe
const { OpenAI } = require('openai');              // Für Whisper-Transkription
const axios = require('axios');                    // Zum Herunterladen der Aufnahme

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// In-Memory-Konversationen, keyed by CallSid
const conversations = {};
const SYSTEM_PROMPT = 'Du bist ein freundlicher Kundendienst für Mein Unternehmen. Antworte immer auf Deutsch, kurz und hilfreich.';

// OpenAI-Client für Whisper
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Nodemailer-Transporter (SMTP) konfigurieren
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Hilfsfunktion: Conversation-Log als Text aufbereiten
function formatConversationLog(conv) {
  let lines = conv.map(msg => {
    if (msg.role === 'user') return `Kunde: ${msg.content}`;
    if (msg.role === 'assistant') return `KI: ${msg.content}`;
    return null;
  }).filter(Boolean);
  return lines.join('\n');
}

// 1. Webhook: Begrüßung & DSGVO-Hinweis, erster Gather
app.post('/voice', (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  conversations[callSid] = [{ role: 'system', content: SYSTEM_PROMPT }];

  response.say({ voice: 'Polly.Vicki', language: 'de-DE' },
    'Dieses Gespräch wird aufgezeichnet und verarbeitet. Ihre Daten werden vertraulich behandelt.'
  );
  response.pause({ length: 1 });
  response.say({ voice: 'Polly.Vicki', language: 'de-DE' },
    'Bitte stellen Sie Ihre Frage nach dem Signalton. Sagen Sie Auf Wiederhören, um das Gespräch zu beenden.'
  );
  response.gather({
    input: 'speech',
    language: 'de-DE',
    speechModel: 'phone_call_v2',
    hints: 'Öffnungszeiten, Preise, Termin, Support',
    timeout: 60,
    speechTimeout: 5,
    playBeep: true,
    confidenceThreshold: 0.1,
    action: '/gather'
  });

  res.type('text/xml').send(response.toString());
});

// 2. Webhook: Gather-Ergebnis verarbeiten und ggf. Whisper-Fallback
app.post('/gather', async (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  if (!callSid) {
    response.say({ voice: 'Polly.Vicki', language: 'de-DE' },
      'Ein interner Fehler ist aufgetreten. Auf Wiederhören!'
    );
    response.hangup();
    return res.type('text/xml').send(response.toString());
  }

  const transcript = (req.body.SpeechResult || '').trim();
  // Append user message
  const convo = conversations[callSid] || [{ role: 'system', content: SYSTEM_PROMPT }];
  convo.push({ role: 'user', content: transcript });
  conversations[callSid] = convo;

  // End-Catchphrase? Gespräch beenden und E-Mail senden
  if (/auf wiederhören/i.test(transcript)) {
    // KI-Antwort
    response.say({ voice: 'Polly.Vicki', language: 'de-DE' }, 'Auf Wiederhören und einen schönen Tag!');
    response.hangup();
    // Email with full conversation
    const logText = formatConversationLog(convo);
    transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.EMAIL_TO,
      subject: `Anrufprotokoll ${callSid}`,
      text: logText
    }).catch(err => console.error('❌ E-Mail-Protokoll fehlgeschlagen:', err.message));
    delete conversations[callSid];
    return res.type('text/xml').send(response.toString());
  }

  // Fallback: Whisper-Fallback bei kurzer/unverständlicher Eingabe
  if (!transcript || transcript.split(/\s+/).length < 2) {
    response.say({ voice: 'Polly.Vicki', language: 'de-DE' },
      'Entschuldigung, das habe ich nicht verstanden. Ich nehme Ihre Nachricht nun auf. Bitte sprechen Sie nach dem Signalton.'
    );
    response.record({
      maxLength: 60,
      playBeep: true,
      trim: 'trim-silence',
      action: '/transcribe',
      method: 'POST'
    });
    return res.type('text/xml').send(response.toString());
  }

  // Normale Konversation mit OpenRouter
  let reply;
  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      body: JSON.stringify({ model: 'mistralai/mistral-small-3.2-24b-instruct:free', messages: convo })
    });
    const orJson = await orRes.json();
    reply = orJson.choices[0].message.content.trim();
    convo.push({ role: 'assistant', content: reply });
  } catch (err) {
    console.error('❌ OpenRouter-Fehler:', err.message);
    reply = 'Unsere KI ist gerade nicht erreichbar. Bitte versuchen Sie es später.';
  }

  response.say({ voice: 'Polly.Vicki', language: 'de-DE' }, reply);
  response.gather({
    input: 'speech',
    language: 'de-DE',
    speechModel: 'phone_call_v2',
    timeout: 60,
    speechTimeout: 5,
    playBeep: true,
    confidenceThreshold: 0.1,
    action: '/gather'
  });

  return res.type('text/xml').send(response.toString());
});

// 3. New Route: Whisper-Transkript & OpenRouter-Antwort
app.post('/transcribe', async (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  const convo = conversations[callSid] || [{ role: 'system', content: SYSTEM_PROMPT }];

  let transcript = '';
  try {
    const recordingUrl = req.body.RecordingUrl + '.mp3';
    const resp = await axios.get(recordingUrl, { responseType: 'arraybuffer' });
    const audioBuffer = Buffer.from(resp.data, 'binary');
    transcript = await openai.audio.transcriptions.create({ file: audioBuffer, model: 'whisper-1', response_format: 'text' });
    convo.push({ role: 'user', content: transcript });
  } catch (err) {
    console.error('❌ Whisper-Fehler:', err.message);
  }

  // KI-Antwort generieren
  let reply = '';
  try {
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      body: JSON.stringify({ model: 'mistralai/mistral-small-3.2-24b-instruct:free', messages: convo })
    });
    const orJson = await orRes.json();
    reply = orJson.choices[0].message.content.trim();
    convo.push({ role: 'assistant', content: reply });
  } catch (err) {
    console.error('❌ Openrouter-Fehler:', err.message);
    reply = 'Unsere KI ist gerade nicht erreichbar. Bitte versuchen Sie es später.';
  }

  // Sende nach Whisper-Fallback das Protokoll
  response.say({ voice: 'Polly.Vicki', language: 'de-DE' }, reply);
  response.hangup();
  const logText = formatConversationLog(convo);
  transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: process.env.EMAIL_TO,
    subject: `Anrufprotokoll ${callSid}`,
    text: logText
  }).catch(err => console.error('❌ E-Mail-Protokoll fehlgeschlagen:', err.message));
  delete conversations[callSid];

  return res.type('text/xml').send(response.toString());
});

// 4. Health-Check
app.get('/status', (req, res) => res.send('✅ Anrufbeantworter aktiv und bereit'));

// Server starten
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`📞 Server läuft auf Port ${PORT}`));
