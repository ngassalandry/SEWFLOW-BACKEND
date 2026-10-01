const app = require('./app');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const HOST = process.env.DB_HOST || 'localhost';
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://${HOST}:${PORT}`);
});