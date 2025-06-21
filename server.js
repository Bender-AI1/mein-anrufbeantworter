require('dotenv').config();                    // Lädt Umgebungsvariablen
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');          // Für E-Mail-Versand
const { twiml: { VoiceResponse } } = require('twilio');
const fetch = require('node-fetch');                // Für OpenRouter API-Aufrufe

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// In-Memory-Konversationen, keyed by CallSid
const conversations = {};
const SYSTEM_PROMPT = 'Du bist ein freundlicher Kundendienst für Mein Unternehmen. Antworte kurz und hilfreich.';

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

// 1. Webhook: Begrüßung & DSGVO-Hinweis, dann erste Gather-Anfrage
app.post('/voice', (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;

  // Initialisiere Konversation
  conversations[callSid] = [{ role: 'system', content: SYSTEM_PROMPT }];

  // DSGVO-Hinweis und Prompt
  response.say({ voice: 'Polly.Vicki', language: 'de-DE' },
    'Dieses Gespräch wird aufgezeichnet und verarbeitet. Ihre Daten werden vertraulich behandelt.'
  );
  response.pause({ length: 1 });
  response.say({ voice: 'Polly.Vicki', language: 'de-DE' },
    'Bitte stellen Sie Ihre Frage nach dem Signalton. Sagen Sie Auf Wiederhören, um das Gespräch zu beenden.'
  );

  // Gather für fortlaufende Sprachkonversation
  const gather = response.gather({
    input: 'speech',
    timeout: 60,
    speechTimeout: 'auto',
    action: '/gather'
  });
  gather.pause({ length: 1 });

  res.type('text/xml').send(response.toString());
});

// 2. Webhook: Verarbeitung des Gather-Ergebnisses & loop für weitere Fragen
app.post('/gather', async (req, res) => {
  const response = new VoiceResponse();
  const callSid = req.body.CallSid;
  const transcript = (req.body.SpeechResult || '').trim();
  const recordingUrl = req.body.RecordingUrl || 'keine Aufnahme-URL';

  console.log('📝 Transkribierter Text:', transcript);

  // E-Mail mit Transkript und Aufnahme versenden
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.EMAIL_TO,
      subject: 'Neue Sprachnachricht über Anrufbeantworter',
      text: `CallSid: ${callSid}\nAnrufer hat gesagt: ${transcript}\nAufnahme: ${recordingUrl}`
    });
    console.log('📧 E-Mail erfolgreich versendet');
  } catch (err) {
    console.error('❌ E-Mail-Versand fehlgeschlagen:', err.message);
  }

  // Ende-Befehl erkennen
  if (transcript.toLowerCase().includes('auf wiederhören')) {
    response.say({ voice: 'Polly.Vicki', language: 'de-DE' },
      'Auf Wiederhören und einen schönen Tag!'
    );
    response.hangup();
    delete conversations[callSid];
    return res.type('text/xml').send(response.toString());
  }

  // Fallback bei unverständlicher oder zu kurzer Sprache
  if (!transcript || transcript.split(/\s+/).length < 2) {
    response.say({ voice: 'Polly.Vicki', language: 'de-DE' },
      'Entschuldigung, das habe ich nicht verstanden. Bitte wiederholen Sie Ihre Frage.'
    );
  } else {
    // GPT-Konversation erweitern
    const convo = conversations[callSid] || [{ role: 'system', content: SYSTEM_PROMPT }];
    convo.push({ role: 'user', content: transcript });

    // OpenRouter-Antwort generieren
    let reply;
    try {
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`
        },
        body: JSON.stringify({ model: 'mistralai/mistral-small-3.2-24b-instruct:free', messages: convo })
      });
      const orJson = await orRes.json();
      if (!orRes.ok) throw new Error(orJson.error?.message || orRes.statusText);
      reply = orJson.choices[0].message.content.trim();
      console.log('🔹 OpenRouter-Antwort:', reply);
      convo.push({ role: 'assistant', content: reply });
    } catch (err) {
      console.error('❌ OpenRouter-Fehler:', err.message);
      reply = 'Unsere AI ist gerade nicht erreichbar. Bitte hinterlassen Sie eine Nachricht oder versuchen Sie es später.';
      convo.push({ role: 'assistant', content: reply });
    }

    // Antwort vorlesen
    response.say({ voice: 'Polly.Vicki', language: 'de-DE' }, reply);
  }

  // Erneut Gather für weitere Fragen
  const gather = response.gather({ input: 'speech', timeout: 60, speechTimeout: 'auto', action: '/gather' });
  gather.pause({ length: 1 });

  return res.type('text/xml').send(response.toString());
});

// 3. Health-Check-Route für Monitoring und Debug
app.get('/status', (req, res) => res.send('✅ Anrufbeantworter aktiv und bereit'));

// Server starten
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`📞 Server läuft auf Port ${PORT}`));
