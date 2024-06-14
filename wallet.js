const crypto = require('crypto');
const { ec: EC } = require('elliptic');

const ec = new EC('secp256k1');

class Wallet {
  constructor(privateKey = null) {
    if (privateKey) {
      this.keyPair = ec.keyFromPrivate(privateKey);
    } else {
      this.keyPair = ec.genKeyPair();
    }
    this.publicKey = this.keyPair.getPublic('hex');
  }

  signTransaction(transaction) {
    if (this.keyPair.getPublic('hex') !== transaction.fromAddress) {
      throw new Error('You cannot sign transactions for other wallets!');
    }

    const hashTx = crypto.createHash('sha256').update(transaction.fromAddress + transaction.toAddress + transaction.amount).digest('hex');
    const sig = this.keyPair.sign(hashTx, 'base64');
    transaction.signature = sig.toDER('hex');
  }
}

module.exports = Wallet;
