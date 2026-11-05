// Instructor dry-run / CI smoke test for PropChain Classroom.
//
// Drives the REAL frontend (built with the real contracts, over the real
// Hardhat JSON-RPC node) through the full student workflow described in the
// README, using a minimal injected wallet in place of MetaMask so the run is
// scriptable and repeatable. This is a TEST-ONLY shim -- it is never used by
// students and is not part of the classroom app. Real classroom sessions use
// real MetaMask, exactly as documented in README.md section 5.
//
// Usage (after the shared node is running, contracts are deployed, and the
// frontend dev server is up -- see README.md sections 2-4):
//   cd testing
//   npm install        (first time only)
//   npm run validate
//
// Screenshots land in ../docs/screenshots/ and double as student-facing
// reference images for the README.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const FRONTEND_URL = 'http://localhost:5173';
const RPC_URL = 'http://127.0.0.1:8545';

// Well-known default Hardhat local-node accounts (public, disposable, no
// real value -- see README.md security notes). Account #0 is the instructor
// (contract deployer / owner); #1 and #2 stand in for two students.
const INSTRUCTOR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const STUDENT_A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const STUDENT_B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

let shotCount = 0;
async function shot(page, name) {
  shotCount += 1;
  const file = path.join(SHOT_DIR, `${String(shotCount).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  screenshot -> ${path.relative(path.join(__dirname, '..'), file)}`);
}

function fakeWalletInitScript(address) {
  // Injected before any page script runs. Mimics just enough of the EIP-1193
  // provider interface (window.ethereum) for ethers.js BrowserProvider to
  // work, with every method other than account/chain bookkeeping forwarded
  // to the real Hardhat node via a Node-side binding (avoids any browser
  // CORS question entirely -- the actual HTTP call happens in Node).
  return `(() => {
    const ADDRESS = ${JSON.stringify(address)};
    const CHAIN_ID_HEX = "0x7a69";
    const listeners = {};
    window.ethereum = {
      isMetaMask: true,
      _isFakeTestProvider: true,
      selectedAddress: ADDRESS,
      chainId: CHAIN_ID_HEX,
      on(event, handler) { (listeners[event] = listeners[event] || []).push(handler); },
      removeListener(event, handler) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter((h) => h !== handler);
      },
      request: async function ({ method, params }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDRESS];
        if (method === 'eth_chainId') return CHAIN_ID_HEX;
        if (method === 'net_version') return '31337';
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
        return window.__ethRpcForward(method, params || []);
      }
    };
  })();`;
}

async function makeContext(browser, address) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.exposeBinding('__ethRpcForward', async (_source, method, params) => {
    const controller = new AbortController();
    const killer = setTimeout(() => controller.abort(), 15000);
    const tag = `${address.slice(0, 8)} ${method}`;
    const t0 = Date.now();
    if (process.env.RPC_DEBUG) console.log(`    [rpc >] ${tag}`);
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        signal: controller.signal
      });
      const json = await res.json();
      if (json.error) {
        const err = new Error(json.error.message || 'RPC error');
        err.code = json.error.code;
        throw err;
      }
      if (process.env.RPC_DEBUG) console.log(`    [rpc <] ${tag} (${Date.now() - t0}ms)`);
      return json.result;
    } catch (e) {
      if (process.env.RPC_DEBUG) console.log(`    [rpc X] ${tag} (${Date.now() - t0}ms) ${e.message}`);
      throw e;
    } finally {
      clearTimeout(killer);
    }
  });
  await context.addInitScript({ content: fakeWalletInitScript(address) });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => console.error('  [page error]', e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.error('  [console error]', msg.text()); });
  return page;
}

function panel(page, eyebrowText) {
  return page.locator('.panel').filter({ has: page.locator('.eyebrow', { hasText: eyebrowText }) });
}

async function waitForNotice(page, substring, timeout = 30000) {
  await page.locator('.notice', { hasText: substring }).waitFor({ timeout });
}

async function connectAndFaucet(page, label) {
  await page.goto(FRONTEND_URL);
  await shot(page, `${label}-landing-disconnected`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await waitForNotice(page, 'Wallet connected');
  await page.getByRole('button', { name: /Get 1,000 demo pUSD/ }).click();
  await waitForNotice(page, 'Demo USDC faucet confirmed');
  await shot(page, `${label}-wallet-connected-and-funded`);
}

function usdToNumber(text) {
  const m = text.replace(/,/g, '').match(/\$([0-9.]+)/);
  return m ? Number(m[1]) : NaN;
}

function plainNumber(text) {
  const m = text.replace(/,/g, '').match(/([0-9]*\.?[0-9]+)/);
  return m ? Number(m[1]) : NaN;
}

// React state updates (e.g. after clicking "Refresh on-chain balances") land
// a tick after the click resolves, not synchronously -- poll instead of
// reading the DOM once immediately after a click.
async function pollLocatorText(locator, extract, predicate, timeoutMs = 10000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    last = await locator.innerText();
    const value = extract(last);
    if (predicate(value)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for condition; last text was "${last}"`);
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];
  const assertClose = (actual, expected, label) => {
    const ok = Math.abs(actual - expected) < 0.01;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: expected ~${expected}, got ${actual}`);
    if (!ok) failures.push(label);
  };

  try {
    console.log('== Student A: connect + faucet ==');
    const a = await makeContext(browser, STUDENT_A);
    await connectAndFaucet(a, 'student-a');

    console.log('== Student A: primary purchase (buy 5 tokens) ==');
    const buyPanel = panel(a, '02 / PRIMARY MARKET');
    await buyPanel.locator('label:has-text("Whole tokens to buy") + input').fill('5');
    await buyPanel.getByRole('button', { name: 'Approve & buy tokens' }).click();
    await waitForNotice(a, 'Primary purchase confirmed');
    await a.waitForTimeout(1000); // let the console's balance/ownership steps settle for this reference screenshot
    await shot(a, 'student-a-primary-purchase');

    console.log('== Student B: connect + faucet ==');
    const b = await makeContext(browser, STUDENT_B);
    await connectAndFaucet(b, 'student-b');

    console.log('== Student A: transfer 2 tokens to Student B ==');
    const transferPanel = panel(a, '03 / PEER-TO-PEER');
    await transferPanel.locator('input[placeholder="0x..."]').fill(STUDENT_B);
    await transferPanel.locator('label:has-text("Whole tokens to transfer") + input').fill('2');
    await transferPanel.getByRole('button', { name: 'Transfer tokens' }).click();
    await waitForNotice(a, 'Property token transfer confirmed');
    await shot(a, 'student-a-transfer-to-student-b');

    console.log('== Student A: create resale listing (2 tokens @ 110 pUSD) ==');
    const createResalePanel = panel(a, '04 / SECONDARY MARKET');
    await createResalePanel.locator('label:has-text("Quantity") + input').fill('2');
    await createResalePanel.locator('label:has-text("Resale price per token") + input').fill('110');
    await createResalePanel.getByRole('button', { name: 'Approve & create listing' }).click();
    await waitForNotice(a, 'Create resale listing confirmed');
    await shot(a, 'student-a-resale-listing-created');

    console.log('== Student B: buy resale listing #1 (2 tokens) ==');
    const buyResalePanel = panel(b, '05 / BUY FROM A STUDENT');
    await buyResalePanel.locator('label:has-text("Resale listing ID") + input').fill('1');
    await buyResalePanel.locator('label:has-text("Whole tokens to buy") + input').fill('2');
    await buyResalePanel.getByRole('button', { name: 'Approve & buy resale' }).click();
    await waitForNotice(b, 'Buy resale listing confirmed');
    await shot(b, 'student-b-resale-purchase');

    // Expected holdings on the Dallas Garden Apartments token:
    //   Student A: bought 5, sent 2 direct to B, listed 2 for resale -> 1 remaining
    //   Student B: received 2 direct from A, bought 2 via resale -> 4 total
    await a.getByRole('button', { name: 'Refresh on-chain balances' }).click();
    await b.getByRole('button', { name: 'Refresh on-chain balances' }).click();
    const ownedA = await a.locator('.property-card.chosen .property-values b').nth(3).innerText();
    const ownedB = await b.locator('.property-card.chosen .property-values b').nth(3).innerText();
    assertClose(Number(ownedA), 1, 'Student A final Dallas Garden Apartments balance');
    assertClose(Number(ownedB), 4, 'Student B final Dallas Garden Apartments balance');

    console.log('== Instructor: distribute 100 demo pUSD rental income pro-rata ==');
    const instructor = await makeContext(browser, INSTRUCTOR);
    await instructor.goto(FRONTEND_URL);
    await instructor.getByRole('button', { name: 'Connect wallet' }).click();
    await waitForNotice(instructor, 'Wallet connected');
    const distributePanel = panel(instructor, '06 / INSTRUCTOR MODE');
    await distributePanel.locator('textarea').fill(`${STUDENT_A}, ${STUDENT_B}`);
    await distributePanel.locator('input[type="number"]').fill('100');
    await distributePanel.getByRole('button', { name: 'Approve & distribute (owner only)' }).click();
    await waitForNotice(instructor, 'Distribute simulated rental income confirmed');
    await shot(instructor, 'instructor-distribute-rental');

    console.log('== Student A: claim rental allocation (expect 20 pUSD = 1/5 share) ==');
    await a.getByRole('button', { name: 'Refresh on-chain balances' }).click();
    const claimableABeforeText = await pollLocatorText(
      a.locator('.claim-amount'), usdToNumber, (v) => v > 0
    );
    assertClose(usdToNumber(claimableABeforeText), 20, 'Student A claimable before claim');
    const claimPanelA = panel(a, '07 / INVESTOR CLAIM');
    await claimPanelA.getByRole('button', { name: 'Claim demo pUSD' }).click();
    await waitForNotice(a, 'Claim simulated rental income confirmed');
    await shot(a, 'student-a-claim-rental');

    console.log('== Student B: claim rental allocation (expect 80 pUSD = 4/5 share) ==');
    await b.getByRole('button', { name: 'Refresh on-chain balances' }).click();
    const claimableBBeforeText = await pollLocatorText(
      b.locator('.claim-amount'), usdToNumber, (v) => v > 0
    );
    assertClose(usdToNumber(claimableBBeforeText), 80, 'Student B claimable before claim');
    const claimPanelB = panel(b, '07 / INVESTOR CLAIM');
    await claimPanelB.getByRole('button', { name: 'Claim demo pUSD' }).click();
    await waitForNotice(b, 'Claim simulated rental income confirmed');
    await shot(b, 'student-b-claim-rental');

    console.log('== Bitcoin UTXO lab (static arithmetic demo) ==');
    await a.locator('input[aria-label="Bitcoin amount"]').fill('0.02');
    await shot(a, 'bitcoin-utxo-lab');
    const changeText = await a.locator('.utxo-grid div').nth(3).locator('b').innerText();
    assertClose(plainNumber(changeText), 0.0299, 'Bitcoin UTXO change output (0.05 - 0.02 - 0.0001)');

  } finally {
    // Playwright's browser.close() has been observed to hang on this host
    // when custom exposeBinding wiring is in play; cap it so the script
    // always terminates rather than relying on close() to resolve cleanly.
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 8000))]);
  }

  console.log('\n--- Result ---');
  if (failures.length) {
    console.log(`FAIL: ${failures.length} assertion(s) failed:\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
  } else {
    console.log('PASS: full classroom workflow verified end-to-end against the live contracts.');
  }
}

main()
  .catch((e) => {
    console.error('VALIDATION SCRIPT CRASHED:', e);
    process.exitCode = 1;
  })
  .finally(() => {
    // Force termination -- don't rely on the event loop draining naturally,
    // since a closed-but-slow-to-unwind browser connection can otherwise
    // keep the process alive indefinitely.
    process.exit(process.exitCode || 0);
  });
