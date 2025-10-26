const { ethers } = require('ethers');
require('dotenv').config();

// PaymentVault ABI (chỉ include functions cần thiết)
const VAULT_ABI = [
  "function getBalance() external view returns (uint256)",
  "function withdrawUSDC(uint256 amount) external",
  "function withdrawAll() external",
  "function admin() external view returns (address)"
];

async function main() {
  console.log('💰 PaymentVault USDC Withdrawal Tool\n');

  // Setup
  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  // IMPORTANT: WALLET_ADDRESS should be the PaymentVault contract address
  const vaultAddress = process.env.WALLET_ADDRESS;

  console.log('📍 Vault Address:', vaultAddress);
  console.log('🔑 Admin Address:', wallet.address);

  // Connect to contract
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, wallet);

  try {
    // Check admin
    const admin = await vault.admin();
    console.log('👤 Current Admin:', admin);

    if (admin.toLowerCase() !== wallet.address.toLowerCase()) {
      console.error('❌ ERROR: You are not the admin of this vault!');
      process.exit(1);
    }

    // Check balance
    const balance = await vault.getBalance();
    const balanceFormatted = ethers.utils.formatUnits(balance, 6);
    console.log('💵 Vault Balance:', balanceFormatted, 'USDC\n');

    if (balance.eq(0)) {
      console.log('⚠️  No USDC to withdraw');
      process.exit(0);
    }

    // Get withdraw option from command line
    const args = process.argv.slice(2);
    const command = args[0];

    if (command === 'all') {
      // Withdraw all
      console.log('🔄 Withdrawing ALL USDC...');
      const tx = await vault.withdrawAll();
      console.log('📤 Transaction sent:', tx.hash);
      console.log('⏳ Waiting for confirmation...');
      await tx.wait();
      console.log('✅ Successfully withdrawn', balanceFormatted, 'USDC to', wallet.address);
    } else if (command && !isNaN(command)) {
      // Withdraw specific amount
      const amount = parseFloat(command);
      const amountWei = ethers.utils.parseUnits(amount.toString(), 6);

      if (amountWei.gt(balance)) {
        console.error('❌ ERROR: Amount exceeds vault balance');
        process.exit(1);
      }

      console.log('🔄 Withdrawing', amount, 'USDC...');
      const tx = await vault.withdrawUSDC(amountWei);
      console.log('📤 Transaction sent:', tx.hash);
      console.log('⏳ Waiting for confirmation...');
      await tx.wait();
      console.log('✅ Successfully withdrawn', amount, 'USDC to', wallet.address);
    } else {
      console.log('Usage:');
      console.log('  node scripts/withdrawUSDC.js all          - Withdraw all USDC');
      console.log('  node scripts/withdrawUSDC.js 100          - Withdraw 100 USDC');
      console.log('  node scripts/withdrawUSDC.js 2.5          - Withdraw 2.5 USDC');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
