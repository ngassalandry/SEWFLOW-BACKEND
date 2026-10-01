const express = require('express');
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');

const router = express.Router();

// ============================================================
// GET /api/notifications — Liste (avec filtre unread)
// ============================================================
router.get('/', verifyToken, async (req, res) => {
  const { unread } = req.query;
  const userId = req.user.userId;
  const workshopId = req.user.workshopId;

  try {
    const connection = await pool.getConnection();

    let query = `
      SELECT n.id, n.ref, n.title, n.descrip, n.type, n.is_read,
             n.created_at, n.id_user, n.id_cli,
             cu.name AS customer_name,
             u.name AS user_name, u.surname AS user_surname
      FROM notification n
      LEFT JOIN customer cu ON cu.id = n.id_cli
      LEFT JOIN user u ON u.id = n.id_user
      WHERE (
        n.id_user = ?
        OR n.id_cli IN (
          SELECT c.id FROM customer c
          JOIN user us ON c.id_user = us.id
          WHERE us.id_workshop = ?
        )
        OR (n.id_user IS NULL AND n.id_cli IS NULL)
      )
    `;
    const params = [userId, workshopId];

    if (unread === 'true') {
      query += ` AND n.is_read = FALSE`;
    }

    query += ` ORDER BY n.is_read ASC, n.created_at DESC LIMIT 100`;

    const [rows] = await connection.query(query, params);
    connection.release();
    res.json(rows);
  } catch (error) {
    console.error('❌ GET /notifications :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// GET /api/notifications/unread-count — Compteur
// ============================================================
router.get('/unread-count', verifyToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count FROM notification n
       WHERE n.is_read = FALSE
         AND (
           n.id_user = ?
           OR n.id_cli IN (
             SELECT c.id FROM customer c
             JOIN user us ON c.id_user = us.id
             WHERE us.id_workshop = ?
           )
           OR (n.id_user IS NULL AND n.id_cli IS NULL)
         )`,
      [req.user.userId, req.user.workshopId]
    );
    connection.release();
    res.json({ count: rows[0].count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// GET /api/notifications/latest — 3 dernières non lues
// (pour pop-up dashboard)
// ============================================================
router.get('/latest', verifyToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      `SELECT n.id, n.ref, n.title, n.descrip, n.type, n.created_at
       FROM notification n
       WHERE n.is_read = FALSE
         AND (
           n.id_user = ?
           OR n.id_cli IN (
             SELECT c.id FROM customer c
             JOIN user us ON c.id_user = us.id
             WHERE us.id_workshop = ?
           )
           OR (n.id_user IS NULL AND n.id_cli IS NULL)
         )
       ORDER BY n.created_at DESC
       LIMIT 3`,
      [req.user.userId, req.user.workshopId]
    );
    connection.release();
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// POST /api/notifications — Créer
// ============================================================
router.post('/', verifyToken, async (req, res) => {
  const { ref, title, descrip, type, id_user, id_cli } = req.body;

  if (!ref?.trim() || !descrip?.trim()) {
    return res.status(400).json({ message: 'Référence et description obligatoires.' });
  }

  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO notification (ref, title, descrip, type, id_user, id_cli)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ref, title || null, descrip, type || 'info',
       id_user || null, id_cli || null]
    );
    const [created] = await connection.query(
      'SELECT * FROM notification WHERE id = ?', [result.insertId]
    );
    connection.release();
    res.status(201).json({ message: 'Notification créée.', notification: created[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// PUT /api/notifications/:id/read — Marquer une comme lue
// ============================================================
router.put('/:id/read', verifyToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.query(
      'UPDATE notification SET is_read = TRUE WHERE id = ?',
      [req.params.id]
    );
    connection.release();
    res.json({ message: 'Marquée comme lue.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// PUT /api/notifications/read-all — Tout marquer comme lu
// ============================================================
router.put('/read-all', verifyToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.query(
      `UPDATE notification SET is_read = TRUE
       WHERE is_read = FALSE
         AND (
           id_user = ?
           OR id_cli IN (
             SELECT c.id FROM customer c
             JOIN user us ON c.id_user = us.id
             WHERE us.id_workshop = ?
           )
           OR (id_user IS NULL AND id_cli IS NULL)
         )`,
      [req.user.userId, req.user.workshopId]
    );
    connection.release();
    res.json({ message: 'Toutes marquées comme lues.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// DELETE /api/notifications/:id
// ============================================================
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.query('DELETE FROM notification WHERE id = ?', [req.params.id]);
    connection.release();
    res.json({ message: 'Notification supprimée.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;