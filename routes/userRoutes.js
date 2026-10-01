const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');

const router = express.Router();

// Multer stocke le fichier en mémoire (aucune écriture disque)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 Mo max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont autorisées'));
  },
});

// --- GET /api/user/me ---
router.get('/me', verifyToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT id, name, surname, email, phone, role, profile_picture FROM user WHERE id = ?',
      [req.user.userId]
    );
    connection.release();

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --- PUT /api/user/me ---
router.put('/me', verifyToken, async (req, res) => {
  const { name, surname, email, phone } = req.body;

  if (!name || !email) {
    return res.status(400).json({ message: 'Nom et email requis.' });
  }

  try {
    const connection = await pool.getConnection();

    const [existing] = await connection.query(
      'SELECT id FROM user WHERE email = ? AND id != ?',
      [email, req.user.userId]
    );
    if (existing.length > 0) {
      connection.release();
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    await connection.query(
      'UPDATE user SET name = ?, surname = ?, email = ?, phone = ? WHERE id = ?',
      [name, surname, email, phone, req.user.userId]
    );

    const [updated] = await connection.query(
      'SELECT id, name, surname, email, phone, role, profile_picture FROM user WHERE id = ?',
      [req.user.userId]
    );
    connection.release();

    res.json({ message: 'Profil mis à jour', user: updated[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --- PUT /api/user/password ---
router.put('/password', verifyToken, async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Ancien et nouveau mot de passe requis.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 6 caractères.' });
  }

  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT password FROM user WHERE id = ?',
      [req.user.userId]
    );

    if (rows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Utilisateur introuvable' });
    }

    const isValid = await bcrypt.compare(oldPassword, rows[0].password);
    if (!isValid) {
      connection.release();
      return res.status(401).json({ message: 'Ancien mot de passe incorrect.' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await connection.query(
      'UPDATE user SET password = ? WHERE id = ?',
      [hashed, req.user.userId]
    );
    connection.release();

    res.json({ message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// --- POST /api/user/profile-picture : uploader une photo (stockée en base64) ---
router.post(
  '/profile-picture',
  verifyToken,
  (req, res, next) => {
    upload.single('picture')(req, res, (err) => {
      if (err) {
        console.error('❌ Erreur multer :', err);
        return res.status(500).json({ message: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier reçu.' });
    }

    // Convertir le buffer en chaîne base64 avec le bon préfixe MIME
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    try {
      const connection = await pool.getConnection();
      await connection.query(
        'UPDATE user SET profile_picture = ? WHERE id = ?',
        [base64Image, req.user.userId]
      );
      connection.release();

      res.json({ message: 'Photo mise à jour', profile_picture: base64Image });
    } catch (error) {
      console.error('❌ Erreur DB :', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
);

module.exports = router;