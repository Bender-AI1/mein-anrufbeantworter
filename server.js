require('dotenv').config();                    // Lädt Umgebungsvariablen
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');      // Für E-Mail-Versand
const { twiml: { VoiceResponse } } = require('twilio');
const { OpenAI } = require('openai');          // Für Whisper-Transkription und Chat
const axios = require('axios');                // Zum Herunterladen der Aufnahme

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use('/assets', express.static('assets'));  // Zugriff auf statische Assets wie MP3

// In-Memory-Konversationen: pro CallSid speichern wir { messages:[], topics:[] }
const conversations = {};
const SYSTEM_PROMPT =
  'Du bist ein freundlicher Kundendienst für Mein Unternehmen. ' +
  'Antworte immer auf Deutsch, nutze deutsches 24-Stunden-Format und bleibe kurz und hilfreich.';

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

// Hilfsfunktion: Gesprächsprotokoll als Text mit einmaligem Top-Topic
function formatConversationLog(messages, topTopic) {
  return `Thema: ${topTopic}\n` +
    messages
      .filter(m => m.role !== 'system')
      .map(m => m.role === 'user' ? `Kunde: ${m.content}` : `KI: ${m.content}`)
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

// Utility: häufigstes Thema in einem Array finden
function mostFrequent(arr) {
  return Object.entries(arr.reduce((acc, x) => {
    acc[x] = (acc[x]||0) + 1; return acc;
  }, {}))
    .sort(([,a],[,b]) => b - a)[0]?.[0] || 'Allgemeine Anfrage';
}

// 1. /voice: Begrüßung + Piepton + Gather
app.post('/voice', (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  // Session initialisieren
  conversations[callSid] = {
    messages: [{ role:'system', content:SYSTEM_PROMPT }],
    topics: []
  };

  response.say({ voice:'Polly.Marlene', language:'de-DE' },
    'Dieses Gespräch wird aufgezeichnet und verarbeitet. Ihre Daten werden vertraulich behandelt.');
  response.pause({ length:1 });
  response.say({ voice:'Polly.Marlene', language:'de-DE' },
    'Bitte stellen Sie Ihre Frage nach dem Signalton. Sagen Sie Auf Wiederhören, um das Gespräch zu beenden.');

  // Einmaliger Piepton
  response.play('/assets/beep-125033.mp3');

  // Gather
  response.gather({
    input:'speech', language:'de-DE', speechModel:'phone_call_v2',
    hints:'Öffnungszeiten, Preise, Termin, Support',
    timeout:60, speechTimeout:2, confidenceThreshold:0.1,
    action:'/gather'
  });

  res.type('text/xml').send(response.toString());
});

// 2. /gather: Auswertung & ggf. Whisper-Fallback
app.post('/gather', async (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  if (!callSid || !conversations[callSid]) {
    response.say({ voice:'Polly.Marlene', language:'de-DE' }, 'Ein interner Fehler ist aufgetreten. Auf Wiederhören!');
    response.hangup();
    return res.type('text/xml').send(response.toString());
  }

  const { messages, topics } = conversations[callSid];
  const transcript = (req.body.SpeechResult||'').trim();
  messages.push({ role:'user', content:transcript });
  console.log('📝 Gather SpeechResult:', transcript);

  // Thema ermitteln und sammeln
  const topic = await getTopicFromGPT(transcript);
  topics.push(topic);
  messages.push({ role:'system', content:`Thema: ${topic}` });
  console.log('🏷️ Erkanntes Thema:', topic);

  // Auf Wiederhören → Gespräch beenden und Mail mit häufigstem Thema
  if (/auf wiederhören/i.test(transcript)) {
    const topTopic = mostFrequent(topics);
    response.say({ voice:'Polly.Marlene', language:'de-DE' }, 'Auf Wiederhören und einen schönen Tag!');
    response.hangup();
    transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.EMAIL_TO,
      subject:`Anrufprotokoll ${callSid} – Thema: ${topTopic}`,
      text: formatConversationLog(messages, topTopic)
    }).catch(console.error);
    delete conversations[callSid];
    return res.type('text/xml').send(response.toString());
  }

  // Fallback bei Kurznachricht → Whisper-Fallback
  if (!transcript || transcript.split(/\s+/).length < 2) {
    response.say({ voice:'Polly.Marlene', language:'de-DE' },
      'Entschuldigung, ich habe Sie nicht verstanden. Bitte sprechen Sie nach dem Signalton.');
    response.record({
      maxLength:60, playBeep:true, trim:'trim-silence',
      action:'/transcribe', method:'POST'
    });
    return res.type('text/xml').send(response.toString());
  }

  // GPT-3.5-Turbo Chat-Antwort
  let reply;
  try {
    const chatRes = await openai.chat.completions.create({
      model:'gpt-3.5-turbo',
      messages,
      max_tokens:500
    });
    reply = chatRes.choices[0].message.content.trim();
    messages.push({ role:'assistant', content:reply });
    console.log('🔹 GPT-Antwort:', reply);
  } catch (err) {
    console.error('❌ GPT-Fehler:', err);
    reply = 'Unsere KI ist gerade nicht erreichbar. Bitte versuchen Sie es später.';
  }

  response.say({ voice:'Polly.Marlene', language:'de-DE' }, reply);
  response.gather({
    input:'speech', language:'de-DE', speechModel:'phone_call_v2',
    timeout:60, speechTimeout:2, confidenceThreshold:0.1,
    action:'/gather'
  });

  res.type('text/xml').send(response.toString());
});

// 3. /transcribe: Whisper + GPT-Antwort + Protokoll-Mail
app.post('/transcribe', async (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  if (!callSid || !conversations[callSid]) {
    response.hangup();
    return res.type('text/xml').send(response.toString());
  }
  const { messages, topics } = conversations[callSid];

  // Whisper-Transkription
  let transcript = '';
  try {
    const url = req.body.RecordingUrl + '.mp3';
    const buff = Buffer.from((await axios.get(url, { responseType:'arraybuffer' })).data);
    transcript = await openai.audio.transcriptions.create({
      file:buff, model:'whisper-1', response_format:'text'
    });
    messages.push({ role:'user', content:transcript });
    console.log('📝 Whisper-Transkript:', transcript);
  } catch(err) {
    console.error('❌ Whisper-Fehler:', err);
  }

  // Thema erneut taggen
  const topic = await getTopicFromGPT(transcript);
  topics.push(topic);
  messages.push({ role:'system', content:`Thema: ${topic}` });
  console.log('🏷️ Whisper-Thema:', topic);

  // GPT-Antwort
  let reply = '';
  try {
    const chatRes = await openai.chat.completions.create({
      model:'gpt-3.5-turbo',
      messages,
      max_tokens:500
    });
    reply = chatRes.choices[0].message.content.trim();
    messages.push({ role:'assistant', content:reply });
  } catch(err) {
    console.error('❌ GPT-Fehler:', err);
    reply = 'Unsere KI ist gerade nicht erreichbar.';
  }

  response.say({ voice:'Polly.Marlene', language:'de-DE' }, reply);
  response.hangup();

  // Abschließende Mail
  const topTopic = mostFrequent(topics);
  transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: process.env.EMAIL_TO,
    subject:`Anrufprotokoll ${callSid} – Thema: ${topTopic}`,
    text: formatConversationLog(messages, topTopic)
  }).catch(console.error);

  delete conversations[callSid];
  res.type('text/xml').send(response.toString());
});

// 4. Health-Check
app.get('/status', (req, res) => res.send('✅ Anrufbeantworter aktiv und bereit'));
app.listen(process.env.PORT||5000, () => console.log('📞 Server läuft auf Port', process.env.PORT||5000));
