require('dotenv').config();                    // Lädt Umgebungsvariablen
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');          // Für E-Mail-Versand
const { twiml: { VoiceResponse } } = require('twilio');
const { OpenAI } = require('openai');              // Für Whisper-Transkription und Chat
const axios = require('axios');                    // Zum Herunterladen der Aufnahme

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use('/assets', express.static('assets'));  // Zugriff auf statische Assets wie MP3

// In-Memory-Konversationen
const conversations = {};
const SYSTEM_PROMPT =
  'Du bist ein freundlicher Kundendienst für Mein Unternehmen. ' +
  'Antworte **immer** auf Deutsch, nutze deutsche Datums- und Zeitangaben im 24-Stunden-Format, ' +
  'und bleibe kurz und hilfreich.';

// OpenAI-Client (Whisper + GPT-3.5-turbo)
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

// Hilfsfunktion: Gesprächsprotokoll als Text
function formatConversationLog(conv, topic) {
  return `Thema: ${topic}\n` + conv
    .filter(msg => msg.role !== 'system')
    .map(msg => msg.role === 'user'
      ? `Kunde: ${msg.content}`
      : `KI: ${msg.content}`
    )
    .join('\n');
}

// Hilfsfunktion: Thema per GPT erkennen
async function getTopicFromGPT(transcript) {
  const prompt = `Ordne die Nachricht einer Kategorie zu (Support, Reklamation, Verkauf, Allgemeine Anfrage): "${transcript}"`;
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 10,
      temperature: 0
    });
    return res.choices[0].message.content.trim();
  } catch (err) {
    console.error('❌ Themen-Tagging fehlgeschlagen:', err);
    return 'Allgemeine Anfrage';
  }
}

// 1. /voice: Begrüßung + Piepton + Gather
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

  // Einmaliger Piepton
  response.play('/assets/beep-125033.mp3');

  // Gather
  response.gather({
    input: 'speech',
    language: 'de-DE',
    speechModel: 'phone_call_v2',
    hints: 'Öffnungszeiten, Preise, Termin, Support',
    timeout: 60,
    speechTimeout: 2,
    confidenceThreshold: 0.1,
    action: '/gather'
  });

  res.type('text/xml').send(response.toString());
});

// 2. /gather: Auswertung & ggf. Whisper-Fallback
app.post('/gather', async (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  if (!callSid) {
    response.say({ voice: 'Polly.Vicki', language: 'de-DE' }, 'Ein interner Fehler ist aufgetreten. Auf Wiederhören!');
    response.hangup();
    return res.type('text/xml').send(response.toString());
  }

  const transcript = (req.body.SpeechResult || '').trim();
  const convo = conversations[callSid] || [{ role: 'system', content: SYSTEM_PROMPT }];
  convo.push({ role: 'user', content: transcript });

  // Thema erkennen
  const topic = await getTopicFromGPT(transcript);
  convo.push({ role: 'system', content: `Thema: ${topic}` });
  console.log(`🏷️ Thema erkannt: ${topic}`);

  // Auf Wiederhören → Protokoll-Mail
  if (/auf wiederhören/i.test(transcript)) {
    response.say({ voice: 'Polly.Vicki', language: 'de-DE' }, 'Auf Wiederhören und einen schönen Tag!');
    response.hangup();
    const logText = formatConversationLog(convo, topic);
    transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.EMAIL_TO,
      subject: `Anrufprotokoll ${callSid} – Thema: ${topic}`,
      text: logText
    }).catch(console.error);
    delete conversations[callSid];
    return res.type('text/xml').send(response.toString());
  }

  // Kurze oder unverständliche Eingabe → Whisper-Fallback
  if (!transcript || transcript.split(/\s+/).length < 2) {
    response.say({ voice: 'Polly.Vicki', language: 'de-DE' },
      'Entschuldigung, ich habe Sie nicht verstanden. Bitte sprechen Sie nach dem Signalton.');
    response.record({ maxLength: 60, playBeep: true, trim: 'trim-silence', action: '/transcribe' });
    return res.type('text/xml').send(response.toString());
  }

  // GPT-Chat-Antwort
  let reply;
  try {
    const chatRes = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: convo,
      max_tokens: 500
    });
    reply = chatRes.choices[0].message.content;
    convo.push({ role: 'assistant', content: reply });
  } catch (err) {
    console.error('❌ GPT-Fehler:', err);
    reply = 'Unsere KI ist gerade nicht erreichbar. Bitte versuchen Sie es später.';
  }

  response.say({ voice: 'Polly.Vicki', language: 'de-DE' }, reply);
  response.gather({
    input: 'speech', language: 'de-DE', speechModel: 'phone_call_v2',
    timeout: 60, speechTimeout: 2, confidenceThreshold: 0.1, action: '/gather'
  });

  res.type('text/xml').send(response.toString());
});

// 3. /transcribe: Whisper + GPT-Antwort + Protokoll-Mail
app.post('/transcribe', async (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  const convo = conversations[callSid] || [{ role: 'system', content: SYSTEM_PROMPT }];

  let transcript = '';
  try {
    const url = req.body.RecordingUrl + '.mp3';
    const buff = Buffer.from((await axios.get(url, { responseType: 'arraybuffer' })).data);
    transcript = await openai.audio.transcriptions.create({ file: buff, model: 'whisper-1', response_format: 'text' });
    convo.push({ role: 'user', content: transcript });
    console.log('📝 Whisper-Transkript:', transcript);
  } catch (err) {
    console.error('❌ Whisper-Fehler:', err);
  }

  let reply = '';
  try {
    const chatRes = await openai.chat.completions.create({ model: 'gpt-3.5-turbo', messages: convo, max_tokens: 500 });
    reply = chatRes.choices[0].message.content;
    convo.push({ role: 'assistant', content: reply });
  } catch (err) {
    console.error('❌ GPT-Fehler:', err);
    reply = 'Unsere KI ist gerade nicht erreichbar.';
  }

  response.say({ voice: 'Polly.Vicki', language: 'de-DE' }, reply);
  response.hangup();
  transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: process.env.EMAIL_TO,
    subject: `Anrufprotokoll ${callSid}`,
    text: formatConversationLog(convo, convo.find(m => m.role==='system' && m.content.startsWith('Thema:')).content.replace('Thema: ','') )
  }).catch(console.error);
  delete conversations[callSid];

  res.type('text/xml').send(response.toString());
});

// 4. Health-Check
app.get('/status', (req, res) => res.send('✅ Anrufbeantworter aktiv und bereit'));
app.listen(process.env.PORT || 5000, () => console.log('📞 Server läuft auf Port', process.env.PORT || 5000));
