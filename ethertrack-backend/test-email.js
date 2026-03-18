require('dotenv').config();
const { Resend } = require('resend');
const r = new Resend(process.env.RESEND_API_KEY);

console.log('API KEY:', process.env.RESEND_API_KEY?.slice(0,15) + '...');
console.log('FROM:', process.env.EMAIL_FROM);

r.emails.send({
  from: process.env.EMAIL_FROM,
  to: 'deshmukhvarun2004@gmail.com',
  subject: 'EtherTrack Test',
  html: '<p>EtherTrack email is working!</p>'
}).then(d => console.log('SUCCESS:', JSON.stringify(d)))
  .catch(e => console.log('ERROR:', e.message));