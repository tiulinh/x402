import dotenv from 'dotenv';
dotenv.config();

import express, { Express, Request, Response } from 'express';
import { paymentMiddleware, Network } from 'x402-express';
import { ethers } from 'ethers';

// ===== Env guards =====
const REQUIRED_ENVS = [
  'WALLET_ADDRESS',
  'RPC_URL',
  'USDC_ADDRESS',
  'CONTRACT_ADDRESS',
  'WETH_ADDRESS',
  'PERMIT2_ADDRESS',
  'V3_SWAP_ROUTER02_ADDRESS',
  'V4_ROUTER_ADDRESS',
  'PUBLIC_DOMAIN',
  'PRIVATE_KEY'
] as const;

for (const k of REQUIRED_ENVS) {
  if (!process.env[k]) throw new Error(`Missing env: ${k}`);
}

const app: Express = express();
const port = Number(process.env.PORT || 4021);

// Facilitator URL - self-hosted Mogami facilitator
const FACILITATOR_URL = (process.env.FACILITATOR_URL || 'http://localhost:8080') as `${string}://${string}`;

console.log('\n🔧 Facilitator Config:');
console.log('   Using self-hosted facilitator:', FACILITATOR_URL);
console.log('   No CDP credentials needed!');

// ===== Proxy/HTTPS & canonical host BEFORE x402 =====
app.set('trust proxy', true);
app.use((req, _res, next) => {
  const proto = req.get('x-forwarded-proto');
  if (proto) (req as any).protocol = proto;
  next();
});

const CANONICAL_HOST = process.env.PUBLIC_DOMAIN!.replace(/^https?:\/\//, '').toLowerCase();
app.use((req, res, next) => {
  // ⚠️ Không canonicalize /api/buy để tránh 301 làm fail scanner
  if (req.path === '/api/buy') return next();
  const host = (req.headers.host || '').toLowerCase();
  const proto = (req as any).protocol || req.get('x-forwarded-proto') || 'https';
  if (host !== CANONICAL_HOST) {
    return res.redirect(301, `${proto}://${CANONICAL_HOST}${req.url}`);
  }
  next();
});

// ===== CORS =====
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-payment, x-payer-address');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ===== Logger =====
app.use((req, _res, next) => {
  const ts = new Date().toLocaleTimeString('vi-VN');
  console.log(`[${ts}] ${req.method} ${req.originalUrl} - ip:${req.ip}`);
  next();
});

// ===== Public route =====
app.get('/', (_req, res) => {
  res.json({
    name: 'X402 Token Purchase API',
    version: '2.0.0',
    description:
      'Mint 10k $ZORRO tokens with x402 payment protocol. Pay 2 USDC on Base mainnet. 100% of proceeds go into LP. Pure meme token with no utility.',
    facilitator: 'Self-hosted Mogami',
    endpoints: [
      { path: '/buy', method: 'GET', price: '$2', network: 'base', info: 'UI page for users' },
      { path: '/api/buy', method: 'GET', price: '$2', network: 'base', info: 'Machine endpoint for x402 wallets/scanners' }
    ]
  });
});

// ===== /buy = UI (nếu có X-PAYMENT thì nhường cho middleware/handler) =====
app.get('/buy', (req, res, next) => {
  if (req.headers['x-payment']) return next();
  res.type('text/html').send(`
    <!doctype html>
    <html><head><meta charset="utf-8"><title>Buy $ZORRO</title></head>
    <body style="font-family: system-ui; line-height:1.5; max-width:700px; margin:40px auto;">
      <h1>Payment Required</h1>
      <p>Mint 10k $ZORRO tokens with x402 payment protocol. Pay 2 USDC on Base mainnet.</p>
      <p><b>Machine endpoint:</b> <code>https://www.zorro.team/api/buy</code></p>
      <p>This page is for humans. Wallets/bots should call the API endpoint above.</p>
    </body></html>
  `);
});

// ===== /api/buy = x402 SPEC =====
const RESOURCE = process.env.PUBLIC_DOMAIN!.replace(/\/$/, '') + '/api/buy';

const buildSpec = () => ({
  x402Version: 1,
  accepts: [
    {
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: '2000000', // 2 USDC (6 decimals)
      resource: RESOURCE,
      description:
        'Mint 10k $ZORRO tokens with x402 payment protocol. Pay 2 USDC on Base mainnet. 100% of proceeds go into LP. Pure meme token with no utility.',
      mimeType: 'application/json',
      payTo: process.env.WALLET_ADDRESS,
      maxTimeoutSeconds: 300,
      asset: process.env.USDC_ADDRESS,
      outputSchema: {
        input: {
          type: 'http',
          method: 'GET',
          queryParams: {},
          bodyFields: {},
          headerFields: {}
        },
        output: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          payer:   { type: 'string' }
        }
      },
      extra: { name: 'USD Coin', version: '2' }
    }
  ]
});

app.head('/api/buy', (_req, res) => res.status(402).type('application/json; charset=utf-8').end());

app.get('/api/buy', (req, res, next) => {
  // 402 + spec nếu thiếu vé
  if (!req.headers['x-payment']) {
    return res.status(402).type('application/json; charset=utf-8').send(JSON.stringify(buildSpec()));
  }
  // Chốt cửa: vé phải đúng resource & payTo
  try {
    const decoded = JSON.parse(Buffer.from(String(req.headers['x-payment']), 'base64').toString('utf-8'));
    const ticketResource = decoded?.payload?.resource;
    const payTo = decoded?.payload?.conditions?.payTo;
    const wanted = String(process.env.WALLET_ADDRESS).toLowerCase();

    console.log('[X-PAYMENT] resource=', ticketResource, ' payTo=', payTo);

    if (!payTo || payTo.toLowerCase() !== wanted) {
      return res.status(403).json({ error: 'Forbidden: bad payTo' });
    }
    if (ticketResource !== 'https://www.zorro.team/api/buy') {
      return res.status(403).json({ error: 'Forbidden: bad resource' });
    }
  } catch {
    return res.status(400).json({ error: 'Bad X-PAYMENT' });
  }
  next(); // hợp lệ -> sang middleware verify
});

// ===== x402 middleware (CHỈ map /api/buy để tránh nhầm /buy) =====
app.use(
  paymentMiddleware(
    process.env.WALLET_ADDRESS as `0x${string}`,
    {
      'GET /api/buy': {
        price: '$2',
        network: 'base' as Network,
        config: {
          description:
            'Mint 10k $ZORRO tokens with x402 payment protocol. Pay 2 USDC on Base mainnet. 100% of proceeds go into LP. Pure meme token with no utility.',
          mimeType: 'application/json',
          maxTimeoutSeconds: 300,
          inputSchema: { queryParams: {}, bodyFields: {}, headerFields: {} },
          outputSchema: { success: 'boolean', message: 'string', payer: 'string' }
        }
      }
    },
    { url: FACILITATOR_URL }
  )
);

// ===== Buy handler (sau verify) =====
interface BuyRequest extends Request {
  query: { payer?: string; bypass?: string };
  headers: {
    'x-payer-address'?: string;
    'x-payment'?: string;
  } & Request['headers'];
}

async function handleBuy(req: BuyRequest, res: Response) {
  console.log('\n🏁 BUY HANDLER: payment verified by self-hosted facilitator');

  try {
    let payerAddress: string | undefined = req.query.payer || req.headers['x-payer-address'];

    if (!payerAddress && req.headers['x-payment']) {
      try {
        const decoded = JSON.parse(Buffer.from(String(req.headers['x-payment']), 'base64').toString('utf-8'));
        payerAddress = decoded?.payload?.authorization?.from;
        console.log('👤 Payer (from x-payment):', payerAddress);
      } catch (e) {
        console.error('Failed to decode x-payment:', e);
      }
    }

    if (!payerAddress) return res.status(400).json({ error: 'Payer address required' });

    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY as string, provider);

    const toChecksum = (s: string) => ethers.utils.getAddress(s.toLowerCase());
    const usdcAddress = toChecksum(process.env.USDC_ADDRESS as string);
    const tokenAddress = toChecksum(process.env.CONTRACT_ADDRESS as string);
    const wethAddress = toChecksum(process.env.WETH_ADDRESS as string);
    const v3RouterAddress = toChecksum(process.env.V3_SWAP_ROUTER02_ADDRESS as string);

    if (!tokenAddress) return res.status(500).json({ error: 'Server configuration error: CONTRACT_ADDRESS missing' });

    const ERC20_ABI = [
      'function approve(address spender, uint256 amount) external returns (bool)',
      'function allowance(address owner, address spender) external view returns (uint256)',
      'function balanceOf(address account) external view returns (uint256)',
      'function transfer(address to, uint256 amount) external returns (bool)',
      'function mint(address to, uint256 amount) external'
    ];
    const V3_ROUTER_ABI = [
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)'
    ];

    const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, wallet);
    const weth = new ethers.Contract(wethAddress, ERC20_ABI, wallet);
    const zorro = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    // Trả response ngay để x402 settle nhanh
    res.json({ success: true, message: 'Payment accepted, delivering token...', payer: payerAddress });

    // Delivery async
    setImmediate(async () => {
      try {
        const walletBal = await zorro.balanceOf(wallet.address);
        const transferAmount = ethers.utils.parseUnits('2', 18);

        if (walletBal.gte(transferAmount)) {
          const tx = await zorro.transfer(payerAddress, transferAmount);
          await tx.wait();
          console.log('✅ Token transferred:', tx.hash);
          return;
        }

        console.log('⚠️ Not enough token, swap 2 USDC → WETH via V3...');
        const amountUSDC = ethers.utils.parseUnits('2', 6);
        const v3Allowance = await usdc.allowance(wallet.address, v3RouterAddress);
        if (v3Allowance.lt(amountUSDC)) {
          const approveTx = await usdc.approve(v3RouterAddress, ethers.constants.MaxUint256);
          await approveTx.wait();
          console.log('✅ Approved USDC to V3 Router');
        }

        const v3 = new ethers.Contract(v3RouterAddress, V3_ROUTER_ABI, wallet);
        const feeTiers = [500, 3000, 10000] as const;
        for (const fee of feeTiers) {
          try {
            const params = {
              tokenIn: usdcAddress,
              tokenOut: wethAddress,
              fee,
              recipient: wallet.address,
              deadline: Math.floor(Date.now() / 1000) + 300,
              amountIn: amountUSDC,
              amountOutMinimum: 0,
              sqrtPriceLimitX96: 0
            };
            const swapTx = await v3.exactInputSingle(params);
            await swapTx.wait();
            const wb = await weth.balanceOf(wallet.address);
            console.log(`💧 WETH received: ${ethers.utils.formatEther(wb)}`);
            if (wb.gt(0)) {
              const ttx = await weth.transfer(payerAddress, wb);
              await ttx.wait();
              console.log('✅ WETH transferred:', ttx.hash);
              return;
            }
          } catch (e: any) {
            console.log(`❌ Swap failed at fee ${fee / 10000}%: ${String(e?.message || e).slice(0, 160)}`);
          }
        }

        // Fallback: mint
        try {
          const mintAmount = ethers.utils.parseUnits('2', 18);
          const mintTx = await zorro.mint(payerAddress, mintAmount);
          await mintTx.wait();
          console.log('✅ Minted:', mintTx.hash);
          return;
        } catch (mintErr: any) {
          console.error('❌ Mint failed:', mintErr?.message || mintErr);
        }

        // Auto refund nếu bật
        if (process.env.AUTO_REFUND === 'true') {
          const refundAmount = ethers.utils.parseUnits('2', 6);
          const rtx = await usdc.transfer(payerAddress, refundAmount);
          await rtx.wait();
          console.log('✅ Refunded 2 USDC:', rtx.hash);
        } else {
          console.error('⚠️ AUTO_REFUND=false. Manual intervention may be required.');
        }
      } catch (deliveryErr) {
        console.error('❌ Delivery error:', deliveryErr);
      }
    });
  } catch (err) {
    console.error('❌ Handler error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed' });
  }
}

// Sau verify: chỉ bind handler cho /api/buy (thanh toán); /buy sẽ chỉ đi qua khi có X-PAYMENT và next()
app.get('/api/buy', handleBuy as any);
app.get('/buy', handleBuy as any);

// ===== Start server =====
app.listen(port, () => {
  console.log(`\n🚀 X402 Server running (Self-hosted Facilitator)`);
  console.log(`   Local : http://localhost:${port}`);
  console.log(`   Public: ${process.env.PUBLIC_DOMAIN}`);
  console.log(`\n⚙️ Config:`);
  console.log(`   Network     : base`);
  console.log(`   Facilitator : ${FACILITATOR_URL}`);
  console.log(`   Wallet      : ${process.env.WALLET_ADDRESS}`);
  console.log(`   Token       : ${process.env.CONTRACT_ADDRESS}`);
  console.log(`   Auto Refund : ${process.env.AUTO_REFUND === 'true' ? '✅ ENABLED' : '❌ DISABLED'}`);
  console.log(`\n💡 Tip: Make sure Mogami facilitator is running at ${FACILITATOR_URL}`);
});
