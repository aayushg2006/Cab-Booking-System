const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // Make sure file exists!

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

module.exports = admin;