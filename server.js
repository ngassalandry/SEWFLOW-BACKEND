const app = require('./app');
require('dotenv').config();

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});