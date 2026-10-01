CREATE DATABASE IF NOT EXISTS sewflowdb;
USE sewflowdb;

CREATE TABLE workshop (
  id int PRIMARY KEY NOT NULL AUTO_INCREMENT,
  name varchar(20) NOT NULL,
  ref varchar(20) NOT NULL,
  location varchar(50)
);

CREATE TABLE user (
  id int PRIMARY KEY NOT NULL AUTO_INCREMENT,
  name varchar(20) NOT NULL,
  surname varchar(20),
  email varchar(50) NOT NULL UNIQUE,
  phone varchar(20),
  password varchar(255), 
  profile_picture varchar(255) DEFAULT NULL,
  role ENUM('admin', 'employee', 'manager') NOT NULL,
  id_workshop int,
  FOREIGN KEY (id_workshop) REFERENCES workshop(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE commande (
  id int PRIMARY KEY NOT NULL AUTO_INCREMENT,
  ref varchar(20) not null,
  descrip varchar(255),
  amount DECIMAL(10,2),
  advance DECIMAL(10,2) not null,
  remaining DECIMAL(10,2),
  filing_date date not null,
  delivery_date date not null,
  statuscom ENUM('en_attente', 'en_cours', 'livrée', 'annulée') NOT NULL,
  reduction DECIMAL(5,2),
  id_user int,
  id_customer int,
  FOREIGN KEY (id_user) REFERENCES user(id)
  FOREIGN KEY (id_customer) REFERENCES customer(id)
);

CREATE TABLE customer (
  id int PRIMARY KEY NOT NULL AUTO_INCREMENT,
  name varchar(20) not null,
  phone varchar(20),
  adresse varchar(50),
  email varchar(50),
  id_user int,
  FOREIGN KEY (id_user) REFERENCES user(id)
);

CREATE TABLE mesure (
  id int PRIMARY KEY NOT NULL AUTO_INCREMENT,
  list varchar(255) not null
);

CREATE TABLE cloth (
  id int PRIMARY KEY NOT NULL AUTO_INCREMENT,
  ref varchar(20) not null,
  descrip varchar(255),
  unit_price DECIMAL(10,2),
  img varchar(255),
  id_com int,
  id_mes int,
  FOREIGN KEY (id_com) REFERENCES commande(id),
  FOREIGN KEY (id_mes) REFERENCES mesure(id)
);

CREATE TABLE product (
  id int PRIMARY KEY NOT NULL AUTO_INCREMENT,
  ref varchar(20) NOT NULL,
  descrip varchar(255),
  unit_price DECIMAL(10,2),
  cost DECIMAL(10,2),
  img varchar(255),
  delivery_date date,
  id_user int,
  FOREIGN KEY (id_user) REFERENCES user(id)
);

CREATE TABLE notification (
  id int PRIMARY KEY NOT NULL AUTO_INCREMENT,
  ref varchar(20) not null,
  title VARCHAR(100) DEFAULT NULL,
  descrip varchar(255) not null,
  type ENUM('info','success','warning','error','reminder') DEFAULT 'info',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  id_cli int,
  id_user INT DEFAULT NULL,
  FOREIGN KEY (id_cli) REFERENCES customer(id),
  FOREIGN KEY (id_user) REFERENCES user(id)
);