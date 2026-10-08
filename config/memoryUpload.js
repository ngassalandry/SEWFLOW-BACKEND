const multer = require('multer');

/**
 * Upload en mémoire — aucun fichier écrit sur le disque.
 * Compatible avec les environnements serverless (Vercel, AWS Lambda...).
 */
const productUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 }, // 500 Ko max pour limiter la taille de la DB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont autorisées.'));
  },
});

module.exports = { productUpload };