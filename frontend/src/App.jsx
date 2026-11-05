import React, { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, formatUnits, parseUnits } from "ethers";
import deployment from "./contracts/deployment.json";

const short = (s) => s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "—";
const usd = (v) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// Blockchain Teaching Console: narrates the real lifecycle of whichever
// action the student just triggered, using that transaction's own data
// (tx hash, block number, real before/after balances) -- not a canned
// animation. Step reveal is lightly paced (a few hundred ms) purely so a
// classroom audience can follow along; none of the underlying blockchain
// calls are artificially delayed.
const CONSOLE_STEP_DEFS = [
  { key: "click", title: "1 · Action clicked" },
  { key: "approve", title: "2 · Wallet approval requested" },
  { key: "submit", title: "3 · Transaction submitted to the network" },
  { key: "block", title: "4 · Transaction enters a block" },
  { key: "confirm", title: "5 · Blockchain confirms it" },
  { key: "balance", title: "6 · Token balances update" },
  { key: "ownership", title: "7 · Ownership percentage recalculates" }
];
const buildConsoleSteps = () => CONSOLE_STEP_DEFS.map((d) => ({ ...d, status: "pending", detail: "" }));
const pace = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Never let a "nice to have" console snapshot read block or slow down a
// real transaction -- cap each one short and fall back to "no detail".
const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("snapshot timed out")), ms))]);

export default function App() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState("");
  const [balance, setBalance] = useState("0");
  const [eth, setEth] = useState("0");
  const [properties, setProperties] = useState([]);
  const [selected, setSelected] = useState(deployment.properties[0]?.tokenAddress || "");
  const [quantity, setQuantity] = useState(1);
  const [recipient, setRecipient] = useState("");
  const [resaleId, setResaleId] = useState(1);
  const [resaleQuantity, setResaleQuantity] = useState(1);
  const [resalePrice, setResalePrice] = useState(110);
  const [holderList, setHolderList] = useState("");
  const [distribution, setDistribution] = useState(100);
  const [claimable, setClaimable] = useState("0");
  const [activity, setActivity] = useState([]);
  const [message, setMessage] = useState("Connect a classroom wallet to begin.");
  const [busy, setBusy] = useState(false);
  const [btcSpend, setBtcSpend] = useState("0.012");
  const [consoleSteps, setConsoleSteps] = useState([]);
  const [consoleLabel, setConsoleLabel] = useState("");

  const provider = useMemo(() => window.ethereum ? new BrowserProvider(window.ethereum) : null, [account, chainId]);
  const signerAddress = account;

  const getContracts = async () => {
    if (!window.ethereum) throw new Error("MetaMask was not detected. Install the browser extension.");
    const p = new BrowserProvider(window.ethereum);
    const s = await p.getSigner();
    const usdContract = new Contract(deployment.mockUSDC, deployment.abis.MockUSDC, s);
    const market = new Contract(deployment.marketplace, deployment.abis.PropertyMarketplace, s);
    return { p, s, usdContract, market };
  };

  const tokenContract = async (address, signer) =>
    new Contract(address, deployment.abis.PropertyToken, signer);

  const refresh = async () => {
    if (!window.ethereum || !account) return;
    try {
      const { p, s, usdContract, market } = await getContracts();
      const network = await p.getNetwork();
      setChainId(network.chainId.toString());
      setEth(formatUnits(await p.getBalance(account), 18));
      setBalance(formatUnits(await usdContract.balanceOf(account), 6));
      setClaimable(formatUnits(await market.rentalClaimable(account), 6));
      const rows = [];
      for (const item of deployment.properties) {
        const token = await tokenContract(item.tokenAddress, s);
        const [owned, supply, name] = await Promise.all([
          token.balanceOf(account), token.totalSupply(), token.name()
        ]);
        rows.push({ ...item, owned: formatUnits(owned, 18), totalSupply: formatUnits(supply, 18), chainName: name });
      }
      setProperties(rows);
    } catch (e) {
      setMessage(e.shortMessage || e.message || "Could not refresh blockchain data.");
    }
  };

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on?.("accountsChanged", (accounts) => {
        setAccount(accounts?.[0] || "");
        setMessage(accounts?.length ? "Wallet account changed." : "Wallet disconnected.");
      });
      window.ethereum.on?.("chainChanged", () => window.location.reload());
    }
  }, []);

  useEffect(() => { refresh(); }, [account, chainId]);

  const connect = async () => {
    try {
      if (!window.ethereum) throw new Error("Install MetaMask first.");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0]);
      const p = new BrowserProvider(window.ethereum);
      const network = await p.getNetwork();
      setChainId(network.chainId.toString());
      setMessage("Wallet connected. Check that MetaMask is on PropChain Classroom (chain 31337).");
    } catch (e) { setMessage(e.message); }
  };

  const ensureNetwork = async () => {
    if (!window.ethereum) throw new Error("MetaMask not found.");
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x7a69" }]
      });
    } catch (e) {
      if (e.code !== 4902) throw e;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x7a69",
          chainName: "PropChain Classroom",
          nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [`http://${window.location.hostname}:8545`],
          blockExplorerUrls: []
        }]
      });
    }
  };

  const run = async (label, fn) => {
    setBusy(true);
    setConsoleLabel(label);
    setConsoleSteps(buildConsoleSteps());
    const setStep = (key, patch) =>
      setConsoleSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

    try {
      setStep("click", { status: "done", detail: `Clicked ${new Date().toLocaleTimeString()}` });
      await pace(400);

      // "Before" snapshot for the console -- the selected property's token
      // plus demo pUSD, for the connected account. Best-effort and capped:
      // if nothing is selected/connected yet, or the read is slow, the
      // console simply skips the deltas rather than blocking the action.
      let before = null;
      let snap = null;
      try {
        const { s, usdContract } = await withTimeout(getContracts(), 4000);
        const token = await withTimeout(tokenContract(selected, s), 2000);
        const [bOwned, bSupply, bUsd] = await withTimeout(Promise.all([
          token.balanceOf(account), token.totalSupply(), usdContract.balanceOf(account)
        ]), 4000);
        before = { owned: bOwned, supply: bSupply, usd: bUsd };
        snap = { token, usdContract };
      } catch { /* no selected property/account yet, or snapshot too slow -- console skips deltas below */ }

      await ensureNetwork();
      setStep("approve", { status: "active" });
      const result = await fn();
      setStep("approve", { status: "done", detail: "Wallet signature(s) granted." });

      if (result?.wait) {
        setStep("submit", { status: "active" });
        const receipt = await result.wait();
        setStep("submit", { status: "done", detail: `Tx ${short(receipt.hash)}` });
        await pace(300);
        setStep("block", { status: "done", detail: `Mined into block #${receipt.blockNumber}` });
        await pace(300);
        setStep("confirm", { status: "done", detail: "Confirmed on the local classroom chain." });
        setActivity((old) => [{ label, hash: receipt.hash, block: receipt.blockNumber, status: "Confirmed" }, ...old].slice(0, 8));
        setMessage(`${label} confirmed in block ${receipt.blockNumber}.`);
      } else {
        setStep("submit", { status: "done" });
        setStep("block", { status: "done", detail: "No on-chain transaction for this step." });
        setStep("confirm", { status: "done" });
        setMessage(`${label} completed.`);
      }

      await refresh();
      await pace(250);

      if (before && snap) {
        try {
          const [aOwned, aSupply, aUsd] = await withTimeout(Promise.all([
            snap.token.balanceOf(account), snap.token.totalSupply(), snap.usdContract.balanceOf(account)
          ]), 4000);
          setStep("balance", {
            status: "done",
            detail: `Tokens ${formatUnits(before.owned, 18)} → ${formatUnits(aOwned, 18)} · Demo pUSD ${formatUnits(before.usd, 6)} → ${formatUnits(aUsd, 6)}`
          });
          await pace(250);
          const bpBefore = before.supply > 0n ? Number((before.owned * 10000n) / before.supply) / 100 : 0;
          const bpAfter = aSupply > 0n ? Number((aOwned * 10000n) / aSupply) / 100 : 0;
          const propName = deployment.properties.find((p) => p.tokenAddress === selected)?.name || "selected property";
          setStep("ownership", { status: "done", detail: `${bpBefore.toFixed(2)}% → ${bpAfter.toFixed(2)}% of ${propName}` });
        } catch {
          setStep("balance", { status: "done" });
          setStep("ownership", { status: "done" });
        }
      } else {
        setStep("balance", { status: "done", detail: "Connect a wallet and select a property to see deltas." });
        setStep("ownership", { status: "done" });
      }
    } catch (e) {
      setConsoleSteps((prev) =>
        prev.map((s) => (s.status === "active" ? { ...s, status: "error", detail: e.shortMessage || e.reason || e.message } : s))
      );
      setMessage(e.shortMessage || e.reason || e.message || `${label} failed.`);
    } finally { setBusy(false); }
  };

  const faucet = () => run("Demo USDC faucet", async () => {
    const { usdContract } = await getContracts();
    return usdContract.faucet(parseUnits("1000", 6));
  });

  const buy = () => run("Primary purchase", async () => {
    const item = deployment.properties.find(p => p.tokenAddress === selected);
    if (!item) throw new Error("Choose a property first.");
    if (!Number.isInteger(Number(quantity)) || Number(quantity) <= 0) throw new Error("Enter a positive whole-token quantity.");
    const { usdContract, market } = await getContracts();
    const cost = BigInt(quantity) * parseUnits(String(item.pricePerTokenUSD), 6);
    await (await usdContract.approve(deployment.marketplace, cost)).wait();
    return market.buyPrimary(item.tokenAddress, Number(quantity));
  });

  const transfer = () => run("Property token transfer", async () => {
    if (!recipient.match(/^0x[a-fA-F0-9]{40}$/)) throw new Error("Enter a valid 0x wallet address.");
    const { s } = await getContracts();
    const token = await tokenContract(selected, s);
    return token.transfer(recipient, parseUnits(String(quantity), 18));
  });

  const createResale = () => run("Create resale listing", async () => {
    const { s, market } = await getContracts();
    const token = await tokenContract(selected, s);
    await (await token.approve(deployment.marketplace, parseUnits(String(resaleQuantity), 18))).wait();
    return market.createResaleListing(selected, Number(resaleQuantity), parseUnits(String(resalePrice), 6));
  });

  const buyResale = () => run("Buy resale listing", async () => {
    const { usdContract, market } = await getContracts();
    const listing = await market.resaleListings(Number(resaleId));
    const cost = BigInt(resaleQuantity) * listing.pricePerToken;
    await (await usdContract.approve(deployment.marketplace, cost)).wait();
    return market.buyResale(Number(resaleId), Number(resaleQuantity));
  });

  const claim = () => run("Claim simulated rental income", async () => {
    const { market } = await getContracts();
    return market.claimRental();
  });

  const distribute = () => run("Distribute simulated rental income", async () => {
    const { usdContract, market } = await getContracts();
    const holders = holderList.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
    if (!holders.length) throw new Error("Enter comma-separated holder wallet addresses.");
    const amount = parseUnits(String(distribution), 6);
    await (await usdContract.approve(deployment.marketplace, amount)).wait();
    return market.distributeRental(selected, holders, amount);
  });

  const selectedProperty = deployment.properties.find(p => p.tokenAddress === selected) || deployment.properties[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">P</div><div><b>PropChain</b><small>CLASSROOM WEB3 LAB</small></div></div>
        <div className="top-actions">
          <span className={`network ${chainId === "31337" ? "good" : "warn"}`}>● {chainId === "31337" ? "Local classroom chain" : "Wrong / disconnected network"}</span>
          <button className="primary" onClick={connect}>{account ? short(account) : "Connect wallet"}</button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <div className="eyebrow">LEARN BLOCKCHAIN BY DOING</div>
            <h1>Own a fraction.<br/><em>Understand the chain.</em></h1>
            <p>Explore fictional real-estate projects, buy demo tokens, transfer ownership units and inspect on-chain transactions.</p>
            <div className="hero-note">EDUCATIONAL SIMULATION · NO REAL PROPERTY OR MONEY</div>
          </div>
          <div className="hero-stat"><span>CLASSROOM NETWORK</span><strong>31337</strong><small>Hardhat local Ethereum chain</small></div>
        </section>

        <section className="metrics">
          <div className="metric"><span>Connected wallet</span><b>{account ? short(account) : "Not connected"}</b></div>
          <div className="metric"><span>Demo dollar balance</span><b>{usd(balance)}</b></div>
          <div className="metric"><span>Test ETH for gas</span><b>{Number(eth).toFixed(4)} ETH</b></div>
          <div className="metric"><span>Rental claimable</span><b>{usd(claimable)}</b></div>
        </section>

        <div className="notice">{message}</div>

        <section className="panel console-panel">
          <div className="eyebrow">00 / LIVE TEACHING CONSOLE</div>
          <h2>Watch a transaction's full lifecycle</h2>
          <p className="muted">Trigger any action on this page — faucet, buy, transfer, list, distribute, claim — and this console narrates exactly what the blockchain just did, using that transaction's own real data. Nothing here is a staged animation.</p>
          {consoleSteps.length === 0 ? (
            <p className="muted console-empty">No action yet this session. Try “Get 1,000 demo pUSD” below to see the console light up.</p>
          ) : (
            <>
              <div className="console-action">{consoleLabel}</div>
              <ol className="console-steps">
                {consoleSteps.map((s) => (
                  <li key={s.key} className={`console-step ${s.status}`}>
                    <span className="console-dot" aria-hidden="true" />
                    <div>
                      <b>{s.title}</b>
                      {s.detail ? <small>{s.detail}</small> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <section className="section-head"><div><div className="eyebrow">01 / DISCOVER</div><h2>Classroom properties</h2></div><button className="secondary" disabled={!account || busy} onClick={faucet}>Get 1,000 demo pUSD</button></section>
        <section className="property-grid">
          {deployment.properties.map((p, i) => (
            <article className={`property-card ${selected === p.tokenAddress ? "chosen" : ""}`} key={p.id} onClick={() => setSelected(p.tokenAddress)}>
              <div className={`property-art art-${i+1}`}><span>PROPCHAIN / ASSET {String(p.id).padStart(2,"0")}</span><b>{["DALLAS","FRISCO","PLANO"][i]}</b></div>
              <div className="property-body">
                <div className="property-title"><h3>{p.name}</h3><span className="tag">DEMO</span></div>
                <p>{p.location}</p>
                <div className="property-values"><div><small>Illustrative value</small><b>{usd(p.illustrativeValueUSD)}</b></div><div><small>Price / token</small><b>{usd(p.pricePerTokenUSD)}</b></div></div>
                <div className="property-values"><div><small>Total token supply</small><b>{p.supply.toLocaleString()}</b></div><div><small>Your tokens</small><b>{properties.find(x => x.id === p.id)?.owned || "0"}</b></div></div>
                <button className={selected === p.tokenAddress ? "selected-button" : "secondary"} onClick={(e) => { e.stopPropagation(); setSelected(p.tokenAddress); }}>{selected === p.tokenAddress ? "Selected" : "Select property"}</button>
              </div>
            </article>
          ))}
        </section>

        <section className="two-col">
          <div className="panel">
            <div className="eyebrow">02 / PRIMARY MARKET</div><h2>Buy fractional tokens</h2>
            <p className="muted">Approve demo pUSD, then purchase tokens from the marketplace contract.</p>
            <label>Property</label>
            <select value={selected} onChange={e => setSelected(e.target.value)}>
              {deployment.properties.map(p => <option value={p.tokenAddress} key={p.id}>{p.name}</option>)}
            </select>
            <label>Whole tokens to buy</label>
            <input type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
            <div className="calculation">Estimated total <b>{usd(Number(quantity || 0) * (selectedProperty?.pricePerTokenUSD || 0))}</b></div>
            <button className="primary full" disabled={!account || busy} onClick={buy}>Approve & buy tokens</button>
          </div>

          <div className="panel">
            <div className="eyebrow">03 / PEER-TO-PEER</div><h2>Transfer tokens</h2>
            <p className="muted">Send selected property tokens directly to another student's wallet.</p>
            <label>Recipient wallet address</label>
            <input placeholder="0x..." value={recipient} onChange={e => setRecipient(e.target.value)} />
            <label>Whole tokens to transfer</label>
            <input type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
            <button className="primary full" disabled={!account || busy} onClick={transfer}>Transfer tokens</button>
          </div>
        </section>

        <section className="two-col">
          <div className="panel">
            <div className="eyebrow">04 / SECONDARY MARKET</div><h2>List your tokens for resale</h2>
            <p className="muted">Your tokens are escrowed in the marketplace until purchased or until a future cancellation feature is added.</p>
            <label>Quantity</label><input type="number" min="1" value={resaleQuantity} onChange={e => setResaleQuantity(e.target.value)} />
            <label>Resale price per token (demo pUSD)</label><input type="number" min="1" value={resalePrice} onChange={e => setResalePrice(e.target.value)} />
            <button className="primary full" disabled={!account || busy} onClick={createResale}>Approve & create listing</button>
          </div>
          <div className="panel">
            <div className="eyebrow">05 / BUY FROM A STUDENT</div><h2>Purchase resale listing</h2>
            <p className="muted">Ask the seller or instructor for the listing ID emitted by the create-listing transaction.</p>
            <label>Resale listing ID</label><input type="number" min="1" value={resaleId} onChange={e => setResaleId(e.target.value)} />
            <label>Whole tokens to buy</label><input type="number" min="1" value={resaleQuantity} onChange={e => setResaleQuantity(e.target.value)} />
            <button className="primary full" disabled={!account || busy} onClick={buyResale}>Approve & buy resale</button>
          </div>
        </section>

        <section className="two-col">
          <div className="panel">
            <div className="eyebrow">06 / INSTRUCTOR MODE</div><h2>Distribute demo rental income</h2>
            <p className="muted">Instructor connects the deployer wallet. Enter every eligible holder exactly once. The contract allocates the supplied demo pUSD pro-rata using current balances.</p>
            <label>Eligible holder addresses (comma or newline separated)</label>
            <textarea rows="4" placeholder="0xStudentWallet1, 0xStudentWallet2..." value={holderList} onChange={e => setHolderList(e.target.value)} />
            <label>Total demo distribution (pUSD)</label><input type="number" min="1" value={distribution} onChange={e => setDistribution(e.target.value)} />
            <button className="primary full" disabled={!account || busy} onClick={distribute}>Approve & distribute (owner only)</button>
          </div>
          <div className="panel">
            <div className="eyebrow">07 / INVESTOR CLAIM</div><h2>Claim rental allocation</h2>
            <p className="muted">A student claims the amount allocated to their wallet by the instructor.</p>
            <div className="claim-amount">{usd(claimable)}</div>
            <button className="primary full" disabled={!account || busy || Number(claimable) <= 0} onClick={claim}>Claim demo pUSD</button>
            <button className="secondary full spaced" disabled={!account} onClick={refresh}>Refresh on-chain balances</button>
          </div>
        </section>

        <section className="panel activity-panel">
          <div className="section-head compact"><div><div className="eyebrow">08 / AUDIT TRAIL</div><h2>Recent transactions this session</h2></div></div>
          {activity.length === 0 ? <p className="muted">Your confirmed transactions will appear here. This is a browser-session list; the blockchain itself remains the source of truth.</p> :
            activity.map((a, i) => <div className="activity-row" key={`${a.hash}-${i}`}><div><b>{a.label}</b><small>Block {a.block} · {short(a.hash)}</small></div><span className="confirmed">{a.status}</span><span>Local chain</span></div>)}
          <div className="contract-info">
            <span>Mock pUSD: {short(deployment.mockUSDC)}</span>
            <span>Marketplace: {short(deployment.marketplace)}</span>
          </div>
        </section>

        <section className="panel bitcoin-panel">
          <div className="eyebrow">09 / BITCOIN VS ETHEREUM LAB</div>
          <h2>Understand the UTXO model</h2>
          <p className="muted">Bitcoin does not use ERC-20 tokens or Ethereum-style account balances. A Bitcoin transaction spends previous transaction outputs (UTXOs) and creates new outputs.</p>
          <div className="utxo-grid">
            <div><small>Example input UTXO</small><b>0.05000000 BTC</b></div>
            <div><small>Amount to recipient</small><input aria-label="Bitcoin amount" type="number" min="0.00000001" max="0.04999999" step="0.00000001" value={btcSpend} onChange={e => setBtcSpend(e.target.value)} /></div>
            <div><small>Illustrative network fee</small><b>0.00010000 BTC</b></div>
            <div><small>Change returned to sender</small><b>{Math.max(0, 0.05 - Number(btcSpend || 0) - 0.0001).toFixed(8)} BTC</b></div>
          </div>
          <p className="muted">This is a UTXO arithmetic simulator, not a signed Bitcoin transaction. Try changing the recipient amount and observe how the change output is calculated. For a real test transaction exercise, use Bitcoin Signet with a dedicated test wallet and test coins only.</p>
          <a className="resource-link" href="https://mempool.space/signet/" target="_blank" rel="noreferrer">Open Bitcoin Signet block explorer ↗</a>
          <div className="compare-grid">
            <div><b>Bitcoin</b><span>UTXO model · BTC · transaction scripts · no native ERC-20</span></div>
            <div><b>Ethereum</b><span>Account model · ETH gas · smart contracts · ERC-20 tokens</span></div>
          </div>
        </section>

        <section className="learning">
          <div><div className="eyebrow">LEARNING NOTE</div><h2>A token is not a deed.</h2></div>
          <p>This prototype teaches blockchain mechanics. The fictional ERC-20 balance does not create legal title, beneficial ownership, rental rights, or a claim against a real property. Real-world tokenization requires legal structuring, compliance, custody, disclosures and independent asset verification.</p>
        </section>
      </main>
      <footer>PROPCHAIN CLASSROOM · BUILT FOR LEARNING · LOCAL TEST NETWORK ONLY</footer>
    </div>
  );
}
