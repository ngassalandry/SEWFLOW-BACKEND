const express = require('express');
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');

const router = express.Router();

// ============================================================
// GET /api/customers — Liste de tous les clients de l'atelier
// ============================================================
router.get('/', verifyToken, async (req, res) => {
  const workshopId = req.user.workshopId;
  const { search } = req.query;

  try {
    const connection = await pool.getConnection();

    let query = `
      SELECT c.id, c.name, c.phone, c.adresse, c.email, c.id_user,
             u.name AS created_by_name, u.surname AS created_by_surname
      FROM customer c
      JOIN user u ON c.id_user = u.id
      WHERE u.id_workshop = ?
    `;
    const params = [workshopId];

    if (search) {
      query += ` AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    query += ` ORDER BY c.id DESC`;

    const [rows] = await connection.query(query, params);
    connection.release();

    res.json(rows);
  } catch (error) {
    console.error('❌ GET /customers :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// GET /api/customers/:id — Détail d'un client
// ============================================================
router.get('/:id', verifyToken, async (req, res) => {
  const workshopId = req.user.workshopId;
  const customerId = req.params.id;

  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      `SELECT c.*
       FROM customer c
       JOIN user u ON c.id_user = u.id
       WHERE c.id = ? AND u.id_workshop = ?`,
      [customerId, workshopId]
    );
    connection.release();

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Client introuvable.' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('❌ GET /customers/:id :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// POST /api/customers — Créer un client
// ============================================================
router.post('/', verifyToken, async (req, res) => {
  const { name, phone, adresse, email } = req.body;
  const userId = req.user.userId;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Le nom est obligatoire.' });
  }

  try {
    const connection = await pool.getConnection();

    // Vérifier si un client avec le même email existe déjà dans cet atelier
    if (email) {
      const [existing] = await connection.query(
        `SELECT c.id FROM customer c
         JOIN user u ON c.id_user = u.id
         WHERE c.email = ? AND u.id_workshop = ?`,
        [email, req.user.workshopId]
      );
      if (existing.length > 0) {
        connection.release();
        return res
          .status(409)
          .json({ message: 'Un client avec cet email existe déjà.' });
      }
    }

    const [result] = await connection.query(
      `INSERT INTO customer (name, phone, adresse, email, id_user)
       VALUES (?, ?, ?, ?, ?)`,
      [name, phone || null, adresse || null, email || null, userId]
    );

    const [newCustomer] = await connection.query(
      'SELECT * FROM customer WHERE id = ?',
      [result.insertId]
    );

    connection.release();
    res.status(201).json({
      message: 'Client créé avec succès.',
      customer: newCustomer[0],
    });
  } catch (error) {
    console.error('❌ POST /customers :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// PUT /api/customers/:id — Modifier un client
// ============================================================
router.put('/:id', verifyToken, async (req, res) => {
  const customerId = req.params.id;
  const { name, phone, adresse, email } = req.body;
  const workshopId = req.user.workshopId;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Le nom est obligatoire.' });
  }

  try {
    const connection = await pool.getConnection();

    // Vérifier que le client appartient bien à l'atelier
    const [check] = await connection.query(
      `SELECT c.id FROM customer c
       JOIN user u ON c.id_user = u.id
       WHERE c.id = ? AND u.id_workshop = ?`,
      [customerId, workshopId]
    );
    if (check.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Client introuvable.' });
    }

    // Vérifier l'unicité de l'email (hors ce client)
    if (email) {
      const [dup] = await connection.query(
        `SELECT c.id FROM customer c
         JOIN user u ON c.id_user = u.id
         WHERE c.email = ? AND u.id_workshop = ? AND c.id != ?`,
        [email, workshopId, customerId]
      );
      if (dup.length > 0) {
        connection.release();
        return res
          .status(409)
          .json({ message: 'Cet email est déjà utilisé par un autre client.' });
      }
    }

    await connection.query(
      `UPDATE customer
       SET name = ?, phone = ?, adresse = ?, email = ?
       WHERE id = ?`,
      [name, phone || null, adresse || null, email || null, customerId]
    );

    const [updated] = await connection.query(
      'SELECT * FROM customer WHERE id = ?',
      [customerId]
    );

    connection.release();
    res.json({ message: 'Client mis à jour.', customer: updated[0] });
  } catch (error) {
    console.error('❌ PUT /customers/:id :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// DELETE /api/customers/:id — Supprimer un client
// ============================================================
router.delete('/:id', verifyToken, async (req, res) => {
  const customerId = req.params.id;
  const workshopId = req.user.workshopId;

  try {
    const connection = await pool.getConnection();

    // Vérifier que le client appartient bien à l'atelier
    const [check] = await connection.query(
      `SELECT c.id FROM customer c
       JOIN user u ON c.id_user = u.id
       WHERE c.id = ? AND u.id_workshop = ?`,
      [customerId, workshopId]
    );
    if (check.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Client introuvable.' });
    }

    // ⚠️ Si vous avez ajouté id_customer dans commande, il faut gérer la FK :
    // Détacher les commandes ou refuser la suppression si des commandes existent.
    // Ici, on refuse la suppression si des commandes sont liées.
    const [orders] = await connection.query(
      'SELECT COUNT(*) AS count FROM commande WHERE id_customer = ?',
      [customerId]
    ).catch(() => [[{ count: 0 }]]); // tolérant si la colonne n'existe pas

    if (orders[0].count > 0) {
      connection.release();
      return res.status(409).json({
        message: `Impossible de supprimer : ${orders[0].count} commande(s) liée(s).`,
      });
    }

    await connection.query('DELETE FROM customer WHERE id = ?', [customerId]);
    connection.release();

    res.json({ message: 'Client supprimé.' });
  } catch (error) {
    console.error('❌ DELETE /customers/:id :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;