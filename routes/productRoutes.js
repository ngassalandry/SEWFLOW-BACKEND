const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');

const router = express.Router();

// Dossier d'upload des images produits
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'products');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `product_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 Mo max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Seules les images sont autorisées.'));
  },
});

// ============================================================
// GET /api/products — Liste des produits de l'atelier
// ============================================================
router.get('/', verifyToken, async (req, res) => {
  const workshopId = req.user.workshopId;
  const { search } = req.query;

  try {
    const connection = await pool.getConnection();

    let query = `
      SELECT p.id, p.ref, p.descrip, p.unit_price, p.cost, p.img, p.delivery_date
      FROM product p
      JOIN user u ON p.id_user = u.id
      WHERE u.id_workshop = ?
    `;
    const params = [workshopId];

    if (search) {
      query += ` AND (p.ref LIKE ? OR p.descrip LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like);
    }

    query += ` ORDER BY p.id DESC`;

    const [rows] = await connection.query(query, params);
    connection.release();

    res.json(rows);
  } catch (error) {
    console.error('❌ GET /products :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// GET /api/products/:id — Détail produit
// ============================================================
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      `SELECT p.* FROM product p
       JOIN user u ON p.id_user = u.id
       WHERE p.id = ? AND u.id_workshop = ?`,
      [req.params.id, req.user.workshopId]
    );
    connection.release();

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Produit introuvable.' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('❌ GET /products/:id :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// POST /api/products — Créer un produit (avec image optionnelle)
// ============================================================
router.post('/', verifyToken, (req, res, next) => {
  upload.single('img')(req, res, (err) => {
    if (err) return res.status(500).json({ message: err.message });
    next();
  });
}, async (req, res) => {
  const { ref, descrip, unit_price, cost, delivery_date } = req.body;
  const userId = req.user.userId;

  if (!ref || !ref.trim()) {
    return res.status(400).json({ message: 'La référence est obligatoire.' });
  }

  try {
    const connection = await pool.getConnection();

    // Unicité de la ref dans l'atelier
    const [dup] = await connection.query(
      `SELECT p.id FROM product p
       JOIN user u ON p.id_user = u.id
       WHERE p.ref = ? AND u.id_workshop = ?`,
      [ref, req.user.workshopId]
    );
    if (dup.length > 0) {
      connection.release();
      return res.status(409).json({ message: 'Cette référence existe déjà.' });
    }

    const imgPath = req.file ? `/uploads/products/${req.file.filename}` : null;

    const [result] = await connection.query(
      `INSERT INTO product (ref, descrip, unit_price, cost, img, delivery_date, id_user)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ref,
        descrip || null,
        unit_price ? parseFloat(unit_price) : null,
        cost ? parseFloat(cost) : null,
        imgPath,
        delivery_date || null,
        userId,
      ]
    );

    const [created] = await connection.query(
      'SELECT * FROM product WHERE id = ?',
      [result.insertId]
    );

    connection.release();
    res.status(201).json({ message: 'Produit créé.', product: created[0] });
  } catch (error) {
    console.error('❌ POST /products :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// PUT /api/products/:id — Modifier un produit
// ============================================================
router.put('/:id', verifyToken, (req, res, next) => {
  upload.single('img')(req, res, (err) => {
    if (err) return res.status(500).json({ message: err.message });
    next();
  });
}, async (req, res) => {
  const productId = req.params.id;
  const { ref, descrip, unit_price, cost, delivery_date } = req.body;
  const workshopId = req.user.workshopId;

  if (!ref || !ref.trim()) {
    return res.status(400).json({ message: 'La référence est obligatoire.' });
  }

  try {
    const connection = await pool.getConnection();

    // Vérifier appartenance à l'atelier
    const [check] = await connection.query(
      `SELECT p.id, p.img FROM product p
       JOIN user u ON p.id_user = u.id
       WHERE p.id = ? AND u.id_workshop = ?`,
      [productId, workshopId]
    );
    if (check.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    // Unicité de la ref
    const [dup] = await connection.query(
      `SELECT p.id FROM product p
       JOIN user u ON p.id_user = u.id
       WHERE p.ref = ? AND u.id_workshop = ? AND p.id != ?`,
      [ref, workshopId, productId]
    );
    if (dup.length > 0) {
      connection.release();
      return res.status(409).json({ message: 'Cette référence existe déjà.' });
    }

    // Nouvelle image ou ancienne
    let imgPath = check[0].img;
    if (req.file) {
      // Supprimer l'ancienne image du disque
      if (imgPath) {
        const oldFile = path.join(__dirname, '..', imgPath);
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      }
      imgPath = `/uploads/products/${req.file.filename}`;
    }

    await connection.query(
      `UPDATE product
       SET ref = ?, descrip = ?, unit_price = ?, cost = ?, img = ?, delivery_date = ?
       WHERE id = ?`,
      [
        ref,
        descrip || null,
        unit_price ? parseFloat(unit_price) : null,
        cost ? parseFloat(cost) : null,
        imgPath,
        delivery_date || null,
        productId,
      ]
    );

    const [updated] = await connection.query(
      'SELECT * FROM product WHERE id = ?',
      [productId]
    );
    connection.release();

    res.json({ message: 'Produit mis à jour.', product: updated[0] });
  } catch (error) {
    console.error('❌ PUT /products/:id :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// DELETE /api/products/:id — Supprimer un produit
// ============================================================
router.delete('/:id', verifyToken, async (req, res) => {
  const productId = req.params.id;
  const workshopId = req.user.workshopId;

  try {
    const connection = await pool.getConnection();

    const [check] = await connection.query(
      `SELECT p.id, p.img FROM product p
       JOIN user u ON p.id_user = u.id
       WHERE p.id = ? AND u.id_workshop = ?`,
      [productId, workshopId]
    );
    if (check.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Produit introuvable.' });
    }

    // Supprimer l'image du disque
    if (check[0].img) {
      const filePath = path.join(__dirname, '..', check[0].img);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await connection.query('DELETE FROM product WHERE id = ?', [productId]);
    connection.release();

    res.json({ message: 'Produit supprimé.' });
  } catch (error) {
    console.error('❌ DELETE /products/:id :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;