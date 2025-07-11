require('dotenv').config();                    // Lädt Umgebungsvariablen
const express = require('express');
const cors = require('cors');                  // Neu: für API-Zugriff vom React-Frontend
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');      // Für E-Mail-Versand
const { twiml: { VoiceResponse } } = require('twilio');
const { OpenAI } = require('openai');          // Für Whisper-Transkription und Chat
const axios = require('axios');                // Zum Herunterladen der Aufnahme

const app = express();
app.use(cors());                               // CORS global aktivieren
app.use(bodyParser.urlencoded({ extended: false }));
app.use('/assets', express.static('assets'));  // Statische Assets (z.B. MP3)

// In-Memory-Speicher
const conversations = {};  // { messages:[], topics:[], startTime:Date, caller:string }
const callRecords    = []; // Archiv aller abgeschlossenen Anrufe

const SYSTEM_PROMPT =
  'Du bist ein freundlicher Kundendienst für Mein Unternehmen. ' +
  'Antworte immer auf Deutsch, nutze deutsches 24-Stunden-Format und bleibe kurz und hilfreich.';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Hilfsfunktionen
function formatConversationLog(messages, topTopic) {
  return `Thema: ${topTopic}\n` +
    messages
      .filter(m => m.role !== 'system')
      .map(m => m.role === 'user' ? `Kunde: ${m.content}` : `KI: ${m.content}`)
      .join('\n');
}

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
  } catch {
    return 'Allgemeine Anfrage';
  }
}

function mostFrequent(arr) {
  return Object.entries(arr.reduce((acc, x) => {
    acc[x] = (acc[x]||0) + 1; return acc;
  }, {}))
    .sort(([,a],[,b]) => b - a)[0]?.[0] || 'Allgemeine Anfrage';
}

// ─── API für Dashboard ─────────────────────────────────────────────────────────
app.get('/api/calls', (req, res) => {
  const days = parseInt(req.query.days) || 1;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days + 1);
  const filtered = callRecords.filter(r => new Date(r.time) >= cutoff);
  res.json(filtered);
});

// ─── Twilio Voice-Routen ────────────────────────────────────────────────────────

// 1. /voice: Begrüßung + Piepton + Gather
app.post('/voice', (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  conversations[callSid] = {
    messages: [{ role:'system', content:SYSTEM_PROMPT }],
    topics: [],
    startTime: new Date(),
    caller: req.body.From
  };

  response.say({ voice:'Polly.Marlene', language:'de-DE' },
    'Dieses Gespräch wird aufgezeichnet und verarbeitet. Ihre Daten werden vertraulich behandelt.');
  response.pause({ length:1 });
  response.say({ voice:'Polly.Marlene', language:'de-DE' },
    'Bitte stellen Sie Ihre Frage nach dem Signalton. Sagen Sie Auf Wiederhören, um das Gespräch zu beenden.');
  response.play('/assets/beep-125033.mp3');
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
  const conv = conversations[callSid];
  if (!conv) {
    response.say({ voice:'Polly.Marlene', language:'de-DE' }, 'Interner Fehler. Auf Wiederhören!');
    response.hangup();
    return res.type('text/xml').send(response.toString());
  }

  const { messages, topics, startTime, caller } = conv;
  const transcript = (req.body.SpeechResult||'').trim();
  messages.push({ role:'user', content:transcript });

  const topic = await getTopicFromGPT(transcript);
  topics.push(topic);
  messages.push({ role:'system', content:`Thema: ${topic}` });

  // Auf Wiederhören → Abschluss
  if (/auf wiederhören/i.test(transcript)) {
    const topTopic = mostFrequent(topics);
    const durationMin = Math.round((new Date() - startTime) / 60000);

    callRecords.push({
      id: callSid,
      caller,
      time: startTime.toISOString(),
      duration: durationMin,
      topic: topTopic
    });

    transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.EMAIL_TO,
      subject:`Anrufprotokoll ${callSid} – Thema: ${topTopic}`,
      text: formatConversationLog(messages, topTopic)
    }).catch(console.error);

    response.say({ voice:'Polly.Marlene', language:'de-DE' }, 'Auf Wiederhören und einen schönen Tag!');
    response.hangup();
    delete conversations[callSid];
    return res.type('text/xml').send(response.toString());
  }

  // Kurznachricht → Whisper
  if (transcript.split(/\s+/).length < 2) {
    response.say({ voice:'Polly.Marlene', language:'de-DE' },
      'Entschuldigung, ich habe Sie nicht verstanden. Bitte erneut.');
    response.record({
      maxLength:60, playBeep:true, trim:'trim-silence',
      action:'/transcribe', method:'POST'
    });
    return res.type('text/xml').send(response.toString());
  }

  // GPT-Antwort
  let reply;
  try {
    const chatRes = await openai.chat.completions.create({
      model:'gpt-3.5-turbo',
      messages,
      max_tokens:500
    });
    reply = chatRes.choices[0].message.content.trim();
    messages.push({ role:'assistant', content:reply });
  } catch {
    reply = 'Unsere KI ist gerade nicht erreichbar.';
  }

  response.say({ voice:'Polly.Marlene', language:'de-DE' }, reply);
  response.gather({
    input:'speech', language:'de-DE', speechModel:'phone_call_v2',
    timeout:60, speechTimeout:2, confidenceThreshold:0.1,
    action:'/gather'
  });

  res.type('text/xml').send(response.toString());
});

// 3. /transcribe: Whisper + GPT-Antwort + Abschluss-Mail + Call-Log
app.post('/transcribe', async (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  const conv = conversations[callSid];
  if (!conv) {
    response.hangup();
    return res.type('text/xml').send(response.toString());
  }
  const { messages, topics, startTime, caller } = conv;

  // Whisper-Transkription
  let transcript = '';
  try {
    const url = req.body.RecordingUrl + '.mp3';
    const buff = Buffer.from((await axios.get(url, { responseType:'arraybuffer' })).data);
    transcript = await openai.audio.transcriptions.create({
      file: buff, model:'whisper-1', response_format:'text'
    });
    messages.push({ role:'user', content:transcript });
  } catch {
    /* Fehler ignorieren */
  }

  const topic = await getTopicFromGPT(transcript);
  topics.push(topic);
  messages.push({ role:'system', content:`Thema: ${topic}` });

  let reply = '';
  try {
    const chatRes = await openai.chat.completions.create({
      model:'gpt-3.5-turbo',
      messages,
      max_tokens:500
    });
    reply = chatRes.choices[0].message.content.trim();
  } catch {
    reply = 'Unsere KI ist gerade nicht erreichbar.';
  }

  const durationMin = Math.round((new Date() - startTime) / 60000);
  callRecords.push({ id: callSid, caller, time: startTime.toISOString(), duration: durationMin, topic });

  transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: process.env.EMAIL_TO,
    subject:`Anrufprotokoll ${callSid} – Thema: ${topic}`,
    text: formatConversationLog(messages, topic)
  }).catch(console.error);

  response.say({ voice:'Polly.Marlene', language:'de-DE' }, reply);
  response.hangup();
  delete conversations[callSid];
  res.type('text/xml').send(response.toString());
});

// 4. Health-Check
app.get('/status', (req, res) => res.send('✅ Anrufbeantworter aktiv und bereit'));

app.listen(process.env.PORT||5000,
  () => console.log('📞 Server läuft auf Port', process.env.PORT||5000));
