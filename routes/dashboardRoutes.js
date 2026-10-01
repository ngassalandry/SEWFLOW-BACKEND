const express = require('express');
const pool = require('../config/db');
const verifyToken = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/stats
// Renvoie les statistiques de l'atelier de l'utilisateur connecté
router.get('/stats', verifyToken, async (req, res) => {
  const workshopId = req.user.workshopId;

  if (!workshopId) {
    return res.status(400).json({ message: 'Atelier introuvable pour cet utilisateur.' });
  }

  try {
    const connection = await pool.getConnection();

    // 1. Nombre total de commandes de l'atelier
    const [totalOrdersRows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM commande c
       JOIN user u ON c.id_user = u.id
       WHERE u.id_workshop = ?`,
      [workshopId]
    );

    // 2. Commandes en attente ou en cours
    const [pendingOrdersRows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM commande c
       JOIN user u ON c.id_user = u.id
       WHERE u.id_workshop = ?
         AND c.statuscom IN ('en_attente', 'en_cours')`,
      [workshopId]
    );

    // 3. Nombre total de clients de l'atelier
    const [totalCustomersRows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM customer c
       JOIN user u ON c.id_user = u.id
       WHERE u.id_workshop = ?`,
      [workshopId]
    );

    // 4. Nombre total de produits de l'atelier
    const [totalProductsRows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM product p
       JOIN user u ON p.id_user = u.id
       WHERE u.id_workshop = ?`,
      [workshopId]
    );

    // 5. Chiffre d'affaires : somme des commandes livrées
    const [revenueRows] = await connection.query(
      `SELECT COALESCE(SUM(c.amount), 0) AS total
       FROM commande c
       JOIN user u ON c.id_user = u.id
       WHERE u.id_workshop = ?
         AND c.statuscom = 'livrée'`,
      [workshopId]
    );

    // 6. Les 5 dernières commandes avec nom du client
    const [recentOrders] = await connection.query(
      `SELECT
         c.id,
         c.ref,
         COALESCE(cu.name, 'Client inconnu') AS customer,
         c.amount,
         c.statuscom AS status,
         DATE_FORMAT(c.filing_date, '%Y-%m-%d') AS date
       FROM commande c
       JOIN user u ON c.id_user = u.id
       LEFT JOIN customer cu ON cu.id = c.id_customer
       WHERE u.id_workshop = ?
       ORDER BY c.filing_date DESC, c.id DESC
       LIMIT 5`,
      [workshopId]
    );

    connection.release();

    // 7. Réponse finale
    res.json({
      totalOrders: totalOrdersRows[0].count,
      pendingOrders: pendingOrdersRows[0].count,
      totalCustomers: totalCustomersRows[0].count,
      totalProducts: totalProductsRows[0].count,
      revenue: parseFloat(revenueRows[0].total),
      recentOrders,
    });

  } catch (error) {
    console.error('❌ Erreur /dashboard/stats :', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
});

module.exports = router;