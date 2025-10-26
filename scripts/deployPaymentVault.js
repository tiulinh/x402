const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function main() {
  console.log('🚀 Deploying PaymentVault Contract...\n');

  // Setup provider and wallet
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log('📍 Deploying from address:', wallet.address);
  console.log('⛓️  Network:', 'Base Mainnet');
  console.log('💰 USDC Address:', process.env.USDC_ADDRESS);

  // Get wallet balance
  const balance = await wallet.getBalance();
  console.log('💵 Deployer ETH balance:', ethers.utils.formatEther(balance), 'ETH\n');

  if (balance.eq(0)) {
    console.error('❌ ERROR: Deployer has no ETH for gas fees!');
    process.exit(1);
  }

  // Compile contract (simple approach - you can use Hardhat/Foundry for better approach)
  const contractSource = fs.readFileSync(
    path.join(__dirname, '../contracts/PaymentVault.sol'),
    'utf8'
  );

  console.log('⚠️  NOTE: You need to compile the contract first!');
  console.log('Options:');
  console.log('1. Use Remix IDE: https://remix.ethereum.org');
  console.log('2. Use Hardhat: npx hardhat compile');
  console.log('3. Use Foundry: forge build\n');

  console.log('📋 After compiling, you will get:');
  console.log('   - ABI (Application Binary Interface)');
  console.log('   - Bytecode\n');

  console.log('🔧 Manual Deploy Steps:');
  console.log('1. Copy PaymentVault.sol to Remix');
  console.log('2. Compile with Solidity 0.8.20+');
  console.log('3. Deploy with constructor parameter:');
  console.log('   _usdc =', process.env.USDC_ADDRESS);
  console.log('4. Copy deployed contract address');
  console.log('5. Update WALLET_ADDRESS in .env with contract address\n');

  // If you have ABI and bytecode, uncomment below:
  /*
  const abi = [...]; // Paste ABI here
  const bytecode = "0x..."; // Paste bytecode here

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  console.log('📤 Deploying contract...');
  const contract = await factory.deploy(process.env.USDC_ADDRESS);

  console.log('⏳ Waiting for deployment...');
  await contract.deployed();

  console.log('✅ PaymentVault deployed to:', contract.address);
  console.log('\n📝 Next steps:');
  console.log('1. Update .env:');
  console.log('   WALLET_ADDRESS=' + contract.address);
  console.log('2. Restart server');
  console.log('3. Test payment flow\n');

  // Verify contract balance
  const vaultBalance = await contract.getBalance();
  console.log('💰 Initial vault balance:', ethers.utils.formatUnits(vaultBalance, 6), 'USDC');
  */
}

main()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
