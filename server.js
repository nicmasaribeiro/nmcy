const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const NodeRSA = require('node-rsa');
const { Blockchain, Transaction } = require('./blockchain');
const Wallet = require('./wallet');
const P2PServer = require('./p2pServer');
const { sequelize, User } = require('./models');

const HTTP_PORT = process.env.HTTP_PORT || 3001;

const app = express();
const blockchain = new Blockchain();
const p2pServer = new P2PServer(blockchain);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true,
}));

// Middleware to check if user is authenticated
function checkAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.status(401).send('Unauthorized');
  }
}

// User registration
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const existingUser = await User.findOne({ where: { username } });
  if (existingUser) {
    return res.status(400).send('User already exists');
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const key = new NodeRSA({ b: 512 });
  const rsaPublicKey = key.exportKey('public');
  const rsaPrivateKey = key.exportKey('private');
  await User.create({ username, password: hashedPassword, rsaPublicKey, rsaPrivateKey });
  res.send('User registered');
});

// User login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).send('Invalid credentials');
  }
  req.session.user = user;
  res.send('User logged in');
});

// User logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.send('User logged out');
});

// Create wallet
app.post('/create-wallet', checkAuth, async (req, res) => {
  const user = req.session.user;
  if (user.walletPublicKey) {
    return res.status(400).send('Wallet already exists');
  }
  const wallet = new Wallet();
  user.walletPublicKey = wallet.publicKey;
  user.walletPrivateKey = wallet.keyPair.getPrivate('hex');
  await User.update({ walletPublicKey: user.walletPublicKey, walletPrivateKey: user.walletPrivateKey }, { where: { username: user.username } });
  res.json({ publicKey: wallet.publicKey });
});

// Get wallet balance
app.get('/balance', checkAuth, async (req, res) => {
  const user = req.session.user;
  if (!user.walletPublicKey) {
    return res.status(400).send('No wallet found');
  }
  const balance = blockchain.getBalanceOfAddress(user.walletPublicKey);
  res.json({ balance });
});

// Get blockchain
app.get('/blocks', (req, res) => {
  res.json(blockchain.chain);
});

// Create transaction
app.post('/transactions', checkAuth, async (req, res) => {
  const { toAddress, amount } = req.body;
  const user = req.session.user;
  if (!user.walletPublicKey) {
    return res.status(400).send('No wallet found');
  }
  const wallet = new Wallet(user.walletPrivateKey);
  const transaction = new Transaction(user.walletPublicKey, toAddress, amount);
  wallet.signTransaction(transaction);
  try {
    blockchain.addTransaction(transaction);
    p2pServer.broadcast(transaction);
    res.send('Transaction created and broadcasted');
  } catch (error) {
    res.status(400).send(error.message);
  }
});

// Mine pending transactions
app.post('/mine', (req, res) => {
  const { minerAddress } = req.body;
  blockchain.minePendingTransactions(minerAddress);
  p2pServer.broadcast(blockchain.getLatestBlock());
  res.redirect('/blocks');
});

app.listen(HTTP_PORT, () => {
  console.log(`Listening for HTTP requests on port: ${HTTP_PORT}`);
});

// Get user details
app.get('/user-details', checkAuth, async (req, res) => {
  const username = req.session.user.username;
  const user = await User.findOne({ where: { username } });
  res.json({
    username: user.username,
    walletPublicKey: user.walletPublicKey,
    rsaPublicKey: user.rsaPublicKey,
    balance: user.balance,
  });
});

// Get user transactions
app.get('/transactions', checkAuth, async (req, res) => {
  const username = req.session.user.username;
  const user = await User.findOne({ where: { username } });
  const transactions = [];

  for (const block of blockchain.chain) {
    for (const trans of block.transactions) {
      if (trans.fromAddress === user.walletPublicKey || trans.toAddress === user.walletPublicKey) {
        transactions.push(trans);
      }
    }
  }

  res.json({ transactions });
});



p2pServer.listen();
