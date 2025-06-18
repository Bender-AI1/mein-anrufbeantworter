const express = require('express');
const bodyParser = require('body-parser');
const { twiml: { VoiceResponse } } = require('twilio');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

app.post('/voice', (req, res) => {
  const response = new VoiceResponse();

  response.say(
    {
      voice: 'Polly.Vicki', // deutsche Stimme (z. B. Vicki, Hans)
      language: 'de-DE'
    },
    'Hallo! Sie sprechen mit dem intelligenten Anrufbeantworter von Mein Unternehmen. Bitte hinterlassen Sie nach dem Signalton Ihre Nachricht.'
  );

  response.record({
    maxLength: 20,
    action: '/thanks'
  });

  res.type('text/xml');
  res.send(response.toString());
});

app.post('/thanks', (req, res) => {
  const response = new VoiceResponse();
  response.say(
    {
      voice: 'Polly.Vicki',
      language: 'de-DE'
    },
    'Danke für Ihre Nachricht. Wir melden uns bald bei Ihnen. Auf Wiederhören!'
  );
  response.hangup();

  res.type('text/xml');
  res.send(response.toString());
});

app.listen(5000, () => console.log('📞 Server läuft auf Port 5000'));
