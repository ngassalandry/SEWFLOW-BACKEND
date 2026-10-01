const express = require('express');
const cors = require('cors'); // Autorise les requêtes cross-origin
require('dotenv').config();
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');    
const userRoutes = require('./routes/userRoutes')
const customerRoutes = require('./routes/customerRoutes');
const productRoutes = require('./routes/productRoutes')
const orderRoutes = require('./routes/orderRoutes');
const notificationRoutes = require('./routes/notificationRoutes');


const app = express();

app.use(cors());
app.use(express.json());


app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/user', userRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes)
app.use('/api/orders',orderRoutes)
app.use('/api/notifications', notificationRoutes)


app.use((req, res) => {
  res.status(404).json({
    message: `Route introuvable : ${req.method} ${req.originalUrl}`,
  });
});

// Gestion d'erreur globale
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Une erreur est survenue' });
});

module.exports = app;