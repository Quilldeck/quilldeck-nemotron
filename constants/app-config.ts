export class AppConfig {
  static identity = { name: 'Quilldeck' }
  static networks = [
    { 
      endpoint: 'https://api.devnet.solana.com',
      label: 'Devnet',
      name: 'devnet'
    },
    { 
      endpoint: 'https://api.testnet.solana.com',
      label: 'Testnet', 
      name: 'testnet'
    }
  ]

  static FREE_BLURB_LIMIT = 3;
  static FREE_MARKETING_LIMIT = 1;
  static API_BASE_URL = 'https://quilldeck-api.vercel.app/api';
}