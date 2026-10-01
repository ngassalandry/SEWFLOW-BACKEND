const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const router = express.Router();

router.post('/signup', async (req, res) => {
  const { workshopName, workshopRef, lastName, firstName, email, phone, password } = req.body;

  // Validation basique
  if (!workshopName || !workshopRef || !lastName || !firstName || !email || !password) {
    return res.status(400).json({ message: 'Tous les champs obligatoires doivent être remplis.' });
  }

  try {
    const connection = await pool.getConnection();

    // 1. Vérifier si le workshopRef existe déjà
    const [existingWorkshop] = await connection.query(
      'SELECT id FROM workshop WHERE ref = ?',
      [workshopRef]
    );
    if (existingWorkshop.length > 0) {
      connection.release();
      return res.status(409).json({ message: 'Ce numéro de référence d\'atelier est déjà utilisé.' });
    }

    // 2. Vérifier si l'email existe déjà
    const [existingUser] = await connection.query(
      'SELECT id FROM user WHERE email = ?',
      [email]
    );
    if (existingUser.length > 0) {
      connection.release();
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }

    // 3. Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Démarrer une transaction
    await connection.beginTransaction();

    try {
      // 4a. Insérer l'atelier
      const [workshopResult] = await connection.query(
        'INSERT INTO workshop (name, ref, location) VALUES (?, ?, ?)',
        [workshopName, workshopRef, null] // location non fourni, on met NULL
      );
      const workshopId = workshopResult.insertId;

      // 4b. Insérer l'utilisateur (admin)
      const [userResult] = await connection.query(
        `INSERT INTO user (name, surname, email, phone, password, role, id_workshop)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [firstName, lastName, email, phone, hashedPassword, 'admin', workshopId]
      );

      // Commit de la transaction
      await connection.commit();
      connection.release();

      res.status(201).json({
        message: 'Compte créé avec succès',
        userId: userResult.insertId,
        workshopId: workshopId
      });

    } catch (error) {
      // Rollback en cas d'erreur
      await connection.rollback();
      connection.release();
      console.error('Erreur lors de l\'insertion :', error);
      res.status(500).json({ message: 'Erreur interne du serveur' });
    }

  } catch (error) {
    console.error('Erreur de base de données :', error);
    res.status(500).json({ message: 'Erreur de connexion à la base de données' });
  }
});
















router.post('/signin', async (req, res) => {
const { workshopRef, email, password } = req.body;

// Validation basique
if (!workshopRef || !email || !password) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
}

try {
    const connection = await pool.getConnection();

    // 1. Vérifier que l'atelier existe via sa ref
    const [workshopRows] = await connection.query(
    'SELECT id FROM workshop WHERE ref = ?',
    [workshopRef]
    );
    if (workshopRows.length === 0) {
    connection.release();
    return res.status(404).json({ message: 'Atelier non trouvé avec cette référence.' });
    }
    const workshopId = workshopRows[0].id;

    // 2. Vérifier que l'email existe dans cet atelier et récupérer l'utilisateur
    const [userRows] = await connection.query(
    'SELECT id, name, surname, email, password, role FROM user WHERE email = ? AND id_workshop = ?',
    [email, workshopId]
    );
    connection.release();

    if (userRows.length === 0) {
    return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    const user = userRows[0];

    // 3. Comparer le mot de passe hashé
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
    return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // 4. Générer un token JWT
    const token = jwt.sign(
    {
        userId: user.id,
        email: user.email,
        role: user.role,
        workshopId: workshopId
    },
    process.env.JWT_SECRET,
    { expiresIn: '1y' }
    );

    // 5. Répondre avec le token et quelques infos utilisateur
    res.status(200).json({
    message: 'Connexion réussie',
    token,
    user: {
        id: user.id,
        name: user.name,
        surname: user.surname,
        email: user.email,
        role: user.role,
        profile_picture: user.profile_picture || null,
    }
    });

} catch (error) {
    console.error('Erreur lors de la connexion :', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
}
});
  

module.exports = router;