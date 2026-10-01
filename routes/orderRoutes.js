const express = require('express');
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');

const router = express.Router();

const safeParse = (str) => {
  try { return JSON.parse(str); } catch { return []; }
};

const computeRemaining = (amount, advance, reduction) => {
  const a = parseFloat(amount) || 0;
  const adv = parseFloat(advance) || 0;
  const red = parseFloat(reduction) || 0;
  return Math.max(0, a - adv - red);
};

// ============================================================
// GET /api/orders — Liste des commandes
// ============================================================
router.get('/', verifyToken, async (req, res) => {
  const workshopId = req.user.workshopId;
  const { search, status } = req.query;

  try {
    const connection = await pool.getConnection();

    let query = `
      SELECT c.id, c.ref, c.descrip, c.amount, c.advance, c.remaining,
             c.reduction, c.filing_date, c.delivery_date, c.statuscom,
             c.id_customer, cu.name AS customer_name,
             COUNT(cl.id) AS cloth_count
      FROM commande c
      JOIN user u ON c.id_user = u.id
      LEFT JOIN customer cu ON cu.id = c.id_customer
      LEFT JOIN cloth cl ON cl.id_com = c.id
      WHERE u.id_workshop = ?
    `;
    const params = [workshopId];

    if (search) {
      query += ` AND (c.ref LIKE ? OR c.descrip LIKE ? OR cu.name LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    if (status) {
      query += ` AND c.statuscom = ?`;
      params.push(status);
    }

    query += ` GROUP BY c.id ORDER BY c.filing_date DESC, c.id DESC`;

    const [rows] = await connection.query(query, params);
    connection.release();
    res.json(rows);
  } catch (error) {
    console.error('❌ GET /orders :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// GET /api/orders/:id — Détail complet (avec vêtements + mesures)
// ============================================================
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const [rows] = await connection.query(
      `SELECT c.*, cu.name AS customer_name
       FROM commande c
       JOIN user u ON c.id_user = u.id
       LEFT JOIN customer cu ON cu.id = c.id_customer
       WHERE c.id = ? AND u.id_workshop = ?`,
      [req.params.id, req.user.workshopId]
    );

    if (rows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    const [clothes] = await connection.query(
      `SELECT cl.id, cl.ref, cl.descrip, cl.unit_price, cl.img, cl.id_mes,
              m.list AS measures_json
       FROM cloth cl
       LEFT JOIN mesure m ON m.id = cl.id_mes
       WHERE cl.id_com = ?`,
      [req.params.id]
    );

    const formattedClothes = clothes.map((c) => ({
      id: c.id,
      ref: c.ref,
      descrip: c.descrip,
      unit_price: c.unit_price,
      img: c.img,
      measures: c.measures_json ? safeParse(c.measures_json) : [],
    }));

    connection.release();
    res.json({ ...rows[0], clothes: formattedClothes });
  } catch (error) {
    console.error('❌ GET /orders/:id :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// POST /api/orders — Créer une commande avec ses vêtements
// ============================================================
router.post('/', verifyToken, async (req, res) => {
  const {
    ref, descrip, id_customer, amount, advance, reduction,
    filing_date, delivery_date, statuscom, clothes = [],
  } = req.body;

  if (!ref?.trim()) return res.status(400).json({ message: 'Référence obligatoire.' });
  if (!filing_date || !delivery_date) return res.status(400).json({ message: 'Dates obligatoires.' });
  if (!statuscom) return res.status(400).json({ message: 'Statut obligatoire.' });

  const remaining = computeRemaining(amount, advance, reduction);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Unicité de la ref dans l'atelier
    const [dup] = await connection.query(
      `SELECT c.id FROM commande c
       JOIN user u ON c.id_user = u.id
       WHERE c.ref = ? AND u.id_workshop = ?`,
      [ref, req.user.workshopId]
    );
    if (dup.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({ message: 'Cette référence existe déjà.' });
    }

    const [result] = await connection.query(
      `INSERT INTO commande
       (ref, descrip, amount, advance, remaining, filing_date, delivery_date,
        statuscom, reduction, id_user, id_customer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ref, descrip || null, amount || 0, advance || 0, remaining,
       filing_date, delivery_date, statuscom, reduction || 0,
       req.user.userId, id_customer || null]
    );
    const orderId = result.insertId;

    // Insérer chaque vêtement + sa mesure
    for (const cloth of clothes) {
      const [mesResult] = await connection.query(
        'INSERT INTO mesure (list) VALUES (?)',
        [JSON.stringify(cloth.measures || [])]
      );
      await connection.query(
        `INSERT INTO cloth (ref, descrip, unit_price, img, id_com, id_mes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [cloth.ref || '', cloth.descrip || null,
         cloth.unit_price ? parseFloat(cloth.unit_price) : null,
         null, orderId, mesResult.insertId]
      );
    }

    await connection.commit();
    connection.release();
    res.status(201).json({ message: 'Commande créée.', id: orderId });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('❌ POST /orders :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// PUT /api/orders/:id — Mettre à jour (avec remplacement des vêtements)
// ============================================================
router.put('/:id', verifyToken, async (req, res) => {
  const orderId = req.params.id;
  const {
    ref, descrip, id_customer, amount, advance, reduction,
    filing_date, delivery_date, statuscom, clothes = [],
  } = req.body;

  if (!ref?.trim() || !filing_date || !delivery_date || !statuscom) {
    return res.status(400).json({ message: 'Champs obligatoires manquants.' });
  }

  const remaining = computeRemaining(amount, advance, reduction);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [check] = await connection.query(
      `SELECT c.id FROM commande c
       JOIN user u ON c.id_user = u.id
       WHERE c.id = ? AND u.id_workshop = ?`,
      [orderId, req.user.workshopId]
    );
    if (check.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    const [dup] = await connection.query(
      `SELECT c.id FROM commande c
       JOIN user u ON c.id_user = u.id
       WHERE c.ref = ? AND u.id_workshop = ? AND c.id != ?`,
      [ref, req.user.workshopId, orderId]
    );
    if (dup.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(409).json({ message: 'Cette référence existe déjà.' });
    }

    await connection.query(
      `UPDATE commande
       SET ref=?, descrip=?, amount=?, advance=?, remaining=?, filing_date=?,
           delivery_date=?, statuscom=?, reduction=?, id_customer=?
       WHERE id=?`,
      [ref, descrip || null, amount || 0, advance || 0, remaining,
       filing_date, delivery_date, statuscom, reduction || 0,
       id_customer || null, orderId]
    );

    // Supprimer les anciens vêtements + mesures
    const [oldClothes] = await connection.query(
      'SELECT id_mes FROM cloth WHERE id_com = ?', [orderId]
    );
    await connection.query('DELETE FROM cloth WHERE id_com = ?', [orderId]);
    const oldMesIds = oldClothes.map((c) => c.id_mes).filter(Boolean);
    if (oldMesIds.length > 0) {
      await connection.query(
        `DELETE FROM mesure WHERE id IN (${oldMesIds.map(() => '?').join(',')})`,
        oldMesIds
      );
    }

    // Réinsérer
    for (const cloth of clothes) {
      const [mesResult] = await connection.query(
        'INSERT INTO mesure (list) VALUES (?)',
        [JSON.stringify(cloth.measures || [])]
      );
      await connection.query(
        `INSERT INTO cloth (ref, descrip, unit_price, img, id_com, id_mes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [cloth.ref || '', cloth.descrip || null,
         cloth.unit_price ? parseFloat(cloth.unit_price) : null,
         null, orderId, mesResult.insertId]
      );
    }

    await connection.commit();
    connection.release();
    res.json({ message: 'Commande mise à jour.' });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('❌ PUT /orders/:id :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ============================================================
// DELETE /api/orders/:id
// ============================================================
router.delete('/:id', verifyToken, async (req, res) => {
  const orderId = req.params.id;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [check] = await connection.query(
      `SELECT c.id FROM commande c
       JOIN user u ON c.id_user = u.id
       WHERE c.id = ? AND u.id_workshop = ?`,
      [orderId, req.user.workshopId]
    );
    if (check.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    const [clothes] = await connection.query(
      'SELECT id_mes FROM cloth WHERE id_com = ?', [orderId]
    );
    const mesIds = clothes.map((c) => c.id_mes).filter(Boolean);

    await connection.query('DELETE FROM cloth WHERE id_com = ?', [orderId]);
    if (mesIds.length > 0) {
      await connection.query(
        `DELETE FROM mesure WHERE id IN (${mesIds.map(() => '?').join(',')})`,
        mesIds
      );
    }
    await connection.query('DELETE FROM commande WHERE id = ?', [orderId]);

    await connection.commit();
    connection.release();
    res.json({ message: 'Commande supprimée.' });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('❌ DELETE /orders/:id :', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;