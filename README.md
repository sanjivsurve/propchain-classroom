# PropChain Classroom — Shared Blockchain Lab (Windows + macOS)

A classroom-only educational demo of fractional real-estate tokenization using:
- React + Vite
- MetaMask
- Solidity + OpenZeppelin ERC-20
- Hardhat local Ethereum network
- ethers.js v6

**No real property, investment, legal ownership, or real money is involved.** The demo tokens represent fictional educational interests only. Do not use Hardhat private keys or this software with real funds.

## Architecture

- Instructor laptop runs one shared Hardhat node and the Vite web app.
- Students connect from their browsers using MetaMask.
- Each student imports a different disposable Hardhat test account.
- All students transact against the same local chain (chain ID `31337`).
- Instructor deploys contracts and distributes demo USDC to student accounts.

This is a LAN classroom setup, not an internet-hosted production service.

## Prerequisites

Instructor laptop (Windows 10/11 **or** macOS):
- 16 GB RAM recommended (8 GB can work)
- Node.js LTS (Node 20 recommended; this repo's own Windows validation pass used Node 22.19.0 / npm 11.6.0 successfully)
- VS Code
- Chrome, Edge, Brave, or Firefox — **not Safari**, which MetaMask doesn't support
- MetaMask extension
- Firewall permission for Node.js to accept incoming connections (Windows Firewall on Windows; macOS's Application Firewall on a Mac — see [macOS instructor setup](#macos-instructor-setup))

Student laptops (either OS):
- Chrome, Edge, Brave, or Firefox + MetaMask
- Access to the same classroom LAN/Wi-Fi
- No Node.js installation required when using the shared instructor-hosted web app

## 1. Install and prepare (instructor laptop)

Windows instructions follow immediately below and are what this repo's
own end-to-end validation (section 8) actually ran against. **macOS
instructors:** every `npm`/`npx` command is identical on macOS — only the
shell, paths, and two OS-level steps (firewall prompt, finding your LAN
IP) differ. Skip ahead to [macOS instructor setup](#macos-instructor-setup)
for the Terminal equivalents, then come back to sections 5–9, which are
identical on both OSes.

Open PowerShell (Windows):

```powershell
cd C:\dev
# Extract this ZIP so the project folder is C:\dev\propchain-classroom
cd C:\dev\propchain-classroom
node --version
npm --version
```

Install dependencies:

```powershell
cd blockchain
npm install
```

If this is the first install and `package-lock.json` is absent, npm creates it.

## 2. Start the shared blockchain

In PowerShell window 1:

```powershell
cd C:\dev\propchain-classroom\blockchain
npm run node:shared
```

Keep this window open. It starts Hardhat on `0.0.0.0:8545` and prints disposable test accounts/private keys.

**Security:** These keys are public demo keys funded with worthless local test ETH. Never send real funds to them, never reuse them, and never use them on mainnet or a public testnet.

## 3. Deploy demo contracts

In PowerShell window 2:

```powershell
cd C:\dev\propchain-classroom\blockchain
npm run deploy:shared
```

The deployment script:
- Deploys MockUSDC
- Deploys the marketplace
- Deploys three fictional property ERC-20 tokens
- Lists them for primary purchase
- Funds ten demo student wallets with 5,000 demo USDC each
- Writes contract addresses and ABIs to `frontend/src/contracts/deployment.json`

Re-run deployment only when you intend to reset the classroom exercise. Restarting the Hardhat node resets its chain state; deploy again after restart.

## 4. Start the classroom web app

In PowerShell window 3:

```powershell
cd C:\dev\propchain-classroom\frontend
npm install
npm run dev -- --host 0.0.0.0
```

Vite prints a Network URL such as `http://192.168.1.25:5173`.
Find the instructor laptop LAN IP if needed:

```powershell
ipconfig
```

Share the Network URL with students. If Windows Firewall prompts, allow Node.js on **Private networks only**.

## 5. Configure MetaMask on every student laptop

Each student:
1. Install MetaMask from https://metamask.io/download/.
2. Create a **new classroom-only wallet**. Never use a personal wallet or share a seed phrase.
3. Add a custom network:
   - Network name: `PropChain Classroom`
   - RPC URL: `http://INSTRUCTOR-LAN-IP:8545`
   - Chain ID: `31337`
   - Currency symbol: `ETH`
4. Import one unique account from the Hardhat node output in PowerShell window 1. Assign a different account to each student. The node's private keys are disposable test credentials.
5. Open the instructor's Vite Network URL and click **Connect wallet**.
6. Confirm MetaMask shows `PropChain Classroom`.

For an instructor demo, use Hardhat account #0 (the deployer). Student accounts are #1 onward. Do not give the deployer key to students.

### Network troubleshooting
- Students and instructor must be on the same LAN; guest Wi-Fi/client isolation may block device-to-device traffic.
- Ensure Windows Firewall allows inbound Node.js traffic on TCP ports `5173` and `8545` for Private networks.
- Confirm the instructor IP has not changed.
- The MetaMask RPC URL must use the instructor LAN IP, not `localhost`.
- If your browser or MetaMask refuses an insecure HTTP RPC endpoint, use a trusted HTTPS reverse proxy on the LAN or run the exercise on each student's own laptop. Do not expose port 8545 to the public internet.
- Do not port-forward these ports on a home/router firewall.

## macOS instructor setup

Everything in sections 2–9 above (npm scripts, MetaMask config, student
workflow, reset, validate, project structure) is identical on macOS — only
the shell, file paths, and two OS-level steps (firewall prompt wording,
finding your LAN IP) differ from the Windows/PowerShell instructions in
section 1. This section has **not** been run end-to-end on an actual Mac
in this repo's own validation pass (section 8 was verified on Windows) —
treat it as a direct, faithful translation of the verified Windows steps
rather than independently re-verified.

**Prerequisites (instructor Mac):**
- macOS with Terminal (or iTerm2)
- Node.js LTS (Node 20+; this repo's Windows pass used Node 22.19.0/npm
  11.6.0 successfully, so a recent Node 20+ install is expected to work
  the same way)
- Chrome, Edge, Brave, or Firefox + the MetaMask extension — **MetaMask
  does not support Safari**, so Safari isn't an option for either the
  instructor or students
- VS Code (optional, same as Windows)

**1. Install and prepare**

```bash
cd ~/dev
# Extract this ZIP (or git clone) so the project folder is ~/dev/propchain-classroom
cd ~/dev/propchain-classroom
node --version
npm --version

cd blockchain
npm install
```

**2. Start the shared blockchain** (Terminal window 1)

```bash
cd ~/dev/propchain-classroom/blockchain
npm run node:shared
```

The first time this binds a port and accepts network connections, macOS's
Application Firewall may show a prompt like *"Do you want the application
'node' to accept incoming network connections?"* — click **Allow**. (If
you don't see a prompt and students can't reach you, check **System
Settings → Network → Firewall → Options** and allow incoming connections
for `node`.)

**3. Deploy demo contracts** (Terminal window 2)

```bash
cd ~/dev/propchain-classroom/blockchain
npm run deploy:shared
```

**4. Start the classroom web app** (Terminal window 3)

```bash
cd ~/dev/propchain-classroom/frontend
npm install
npm run dev -- --host 0.0.0.0
```

Find your Mac's LAN IP to share with students (pick whichever interface
you're actually connected through — Wi-Fi is usually `en0`):

```bash
ipconfig getifaddr en0   # Wi-Fi, on most Macs
ipconfig getifaddr en1   # try this if en0 returns nothing
# or, to see every interface at once:
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**5. Configure MetaMask on every student laptop** — identical to the
Windows instructions in section 5 above (the browser extension behaves
the same regardless of OS): same network name, RPC URL using *your* Mac's
LAN IP, chain ID `31337`, and the same disposable Hardhat test accounts.

**Network troubleshooting, macOS-specific:**
- The firewall prompt is macOS's Application Firewall, not Windows
  Firewall — see step 2 above if you missed the prompt.
- Still confirm everyone (instructor Mac + every student laptop,
  Mac or Windows) is on the same LAN/Wi-Fi, exactly as in the Windows
  troubleshooting notes in section 5.

## 6. Student workflow

1. Connect wallet.
2. Request demo USDC using the **Get demo USDC** button.
3. Browse three fictional Dallas-area property projects.
4. Buy tokens using demo USDC.
5. Transfer tokens to another student's wallet address.
6. Create a resale listing and buy from another student.
7. Instructor distributes simulated rental income to a list of token holders.
8. Students claim their allocated demo USDC.
9. Inspect transaction hashes and events in the app and in MetaMask.

The initial property inventory is held by the marketplace contract. The initial asking price is $100 demo USDC per token. Property details and valuations are fictional.

Every action above also lights up the **Live Teaching Console** at the top of the page — a real-time, step-by-step narration (click → wallet approval → submitted → mined into a block → confirmed → balances update → ownership % recalculates) using that transaction's own real data, not a canned animation. See `docs/guide/index.html` section 6 for a worked example.

### Try the Live Teaching Console yourself (single machine, quick test)

Section 5 above configures MetaMask for a *multi-machine* classroom LAN. If you're just testing solo on one machine — instructor and "student" both in the same browser — this is the fastest path, using `localhost` instead of a LAN IP:

1. **Install MetaMask** (if you haven't already) — Chrome, Edge, Brave, or Firefox. Not Safari.
2. **Add the custom network in MetaMask** — network dropdown → **Add network** → **Add a network manually**:
   - Network name: `PropChain Classroom`
   - RPC URL: `http://localhost:8545`
   - Chain ID: `31337`
   - Currency symbol: `ETH`
3. **Import a test account** — account icon → **Add account or hardware wallet** → **Import account**, then paste one of the disposable Hardhat private keys printed in the node terminal (section 2) when it started. These are the same public, zero-value test keys every Hardhat user gets:
   - Account #0 (instructor): `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
   - Account #1 (student): `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
4. **Open the app** — `http://localhost:5173`, in the same browser where MetaMask is installed.
5. **Connect** — click **Connect wallet** (top right), approve in the MetaMask popup. The network badge should flip to green **"● Local classroom chain"**. If it still says "Wrong/disconnected network," double-check MetaMask is switched to the `PropChain Classroom` network you just added.
6. **Trigger an action and watch** — click **"Get 1,000 demo pUSD"** first (cheapest/fastest, one signature), approve the MetaMask popup, then watch the dark-green **"00 / LIVE TEACHING CONSOLE"** panel near the top of the page light up its 7 steps one by one in real time.
7. **Try a richer one** — click **"Approve & buy tokens"** (two signatures: approve pUSD spend, then the purchase) to see the console handle a two-signature action, including real before/after numbers in steps 6 and 7 (token balance and ownership % actually changing).

Every button on the page re-triggers the console with that action's own real label and data — Transfer, List for resale, Claim, etc. each narrate differently.

## 7. Reset the classroom

Stop the Hardhat node (Ctrl+C), then start it again and rerun deployment. This creates a fresh chain and new test state. Student MetaMask accounts remain the same, but their balances on the fresh chain reset. Note: each `npm run deploy:shared` already creates brand-new, zero-state contract instances, so redeploying alone (without restarting the node) is also a valid reset for most purposes.

## 8. Validate (instructor dry-run) and the full guide

`testing/` is a separate, instructor-only tool — not part of the classroom app students use. It drives the real built frontend end-to-end (two students + the instructor, over the real Hardhat chain) using Playwright with a small injected test wallet standing in for MetaMask, and saves reference screenshots to `docs/screenshots/`.

```powershell
cd testing
npm install                      # first time only
npx playwright install chromium  # first time only
npm run validate
```

Run this once after any change to a contract or the frontend, and before trusting the app in front of a class. It checks real numbers end-to-end: primary purchase, peer-to-peer transfer, resale, pro-rata rental distribution and claim, and the Bitcoin UTXO lab's arithmetic.

**`docs/guide/index.html`** is the full build/deploy/run/test/validate/demo reference guide, with the real screenshots from a validation run and a grounded walkthrough of eight teachable concepts (blockchain fundamentals, cryptocurrency, smart contracts, tokenization, marketplace, secondary trading, income distribution, blockchain security). Open it directly in a browser, or publish `docs/` via GitHub Pages.

## 9. Project structure

```text
propchain-classroom/
  blockchain/
    contracts/
      MockUSDC.sol
      PropertyToken.sol
      PropertyMarketplace.sol
    scripts/
      deploy.js
    hardhat.config.js
    package.json
  frontend/
    src/
      contracts/deployment.json
      App.jsx
      main.jsx
      styles.css
    index.html
    package.json
  testing/
    validate.mjs       instructor-only end-to-end validation (see section 8)
    package.json
  docs/
    guide/index.html    build/deploy/run/test/validate/demo reference guide
    screenshots/        screenshots captured by testing/validate.mjs
```

## Learning modules

### Beginner track
- What is a blockchain? Why do multiple students share one ledger?
- What is a wallet address? What does signing a transaction mean?
- Why does a transaction need gas?
- Difference between ETH (native gas asset) and demo USDC (ERC-20 payment token).
- Difference between a token balance and legal ownership of a physical asset.
- Read a transaction hash and inspect emitted events.

### Advanced track
- Read the ERC-20 implementation and understand `decimals`, `totalSupply`, `balanceOf`, `transfer`, `approve`, and `transferFrom`.
- Trace primary purchase: approve MockUSDC → marketplace `buyPrimary` → payment transfer → property token transfer.
- Trace resale escrow: approve property token → `createResaleListing` → buyer `buyResale`.
- Explain why token approvals are a security-sensitive capability.
- Review access control on listing and rental distribution.
- Run the Solidity tests with `npm test`.
- Modify the contract and add tests for a new rule.
- Watch the Live Teaching Console after any action and match each of its 7 steps back to the exact line of frontend/contract code that produced it.

## Important design limitations (intentional for education)

- This is a classroom prototype, not an investment product.
- Tokens do not confer deed/title, beneficial ownership, voting rights, or enforceable claims against real estate.
- No KYC/AML, securities compliance, custody, valuation, tax, title verification, investor eligibility, or production-grade security is implemented.
- MockUSDC is not USDC and has no monetary value.
- The resale feature is a simple teaching example, not a regulated secondary trading venue.
- Rental distribution is instructor-triggered and allocates a supplied demo amount pro-rata among the wallet addresses supplied in that transaction. The instructor must include each eligible holder exactly once.
- Do not deploy these contracts with real assets or funds.

## Suggested classroom exercises

1. **Wallet identity:** Have two students compare public addresses. Explain why an address can be shared but a private key must never be shared.
2. **Gas:** Send a token transfer and compare ETH gas balance before/after.
3. **Primary sale:** Buy 5 tokens. Calculate your fraction of total supply.
4. **Transfer:** Transfer 2 tokens to a classmate. Verify both balances and the transaction hash.
5. **Resale:** List 2 tokens at a different price and have another student buy them.
6. **Rental distribution:** Instructor distributes 1,000 demo USDC to all current holders. Compare claim amounts with token balances.
7. **Failure analysis:** Try buying without enough demo USDC or without approving the marketplace. Read the revert/error.
8. **Contract change:** Change the max resale quantity or add a minimum purchase and write a test.
9. **Bitcoin UTXO simulator:** Use the in-app Bitcoin lab to vary the recipient amount and observe the change output. This is an arithmetic simulator, not a real Bitcoin transaction.
10. **Bitcoin Signet explorer:** Open https://mempool.space/signet/ and inspect a real Signet transaction supplied by the instructor. Signet coins have no monetary value; use a dedicated test wallet only.
11. **Threat modeling:** Discuss compromised private keys, malicious approvals, owner privileges, oracle/valuation manipulation, and fake asset documentation.

## Useful references
- Hardhat: https://hardhat.org/
- OpenZeppelin Contracts: https://docs.openzeppelin.com/contracts/
- MetaMask: https://metamask.io/
- Ethereum developer docs: https://ethereum.org/developers/
- ERC-20: https://eips.ethereum.org/EIPS/eip-20
- Bitcoin developer guide: https://developer.bitcoin.org/
