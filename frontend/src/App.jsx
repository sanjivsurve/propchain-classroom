import React, { useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, Contract, ZeroAddress, formatUnits, parseUnits } from "ethers";
import deployment from "./contracts/deployment.json";
import { HARDHAT_TEST_ACCOUNTS } from "./hardhatTestAccounts";

const short = (s) => s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "—";
const usd = (v) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// A remote student reaching this app through a Cloudflare tunnel sees a
// *different* hostname for the frontend than for the Hardhat RPC node --
// each quick tunnel gets its own random subdomain, so the "same host,
// different port" trick that works on a LAN can't work here. Letting the
// instructor pass the RPC tunnel's URL as `?rpc=...` on the shared link
// means one URL gets a remote student fully set up; see the Student
// Quickstart panel, which builds this link for the instructor.
const rpcOverride = new URLSearchParams(window.location.search).get("rpc");

// Simple circle-packing for the ownership bubble map: place circles one
// at a time along an outward spiral from the center, skipping any angle
// that would overlap something already placed. No physics simulation and
// no extra dependency -- good enough for the handful of wallets a
// classroom chain actually has.
const packCircles = (items, size) => {
  const center = size / 2;
  const placed = [];
  for (const item of items) {
    let x = center, y = center;
    if (placed.length > 0) {
      let radius = item.r + 6;
      let found = false;
      for (let guard = 0; guard < 400 && !found; guard++) {
        const steps = Math.max(10, Math.floor(radius / 4));
        for (let i = 0; i < steps; i++) {
          const angle = (i / steps) * Math.PI * 2 + radius * 0.08;
          const tx = center + radius * Math.cos(angle);
          const ty = center + radius * Math.sin(angle);
          const overlaps = placed.some((p) => {
            const dx = p.x - tx, dy = p.y - ty;
            return Math.sqrt(dx * dx + dy * dy) < p.r + item.r + 5;
          });
          if (!overlaps) { x = tx; y = ty; found = true; break; }
        }
        radius += 5;
      }
    }
    // Clamp so a crowded spiral can never push a bubble visually outside
    // the canvas -- better to let dense bubbles touch than to overflow.
    x = Math.max(item.r, Math.min(size - item.r, x));
    y = Math.max(item.r, Math.min(size - item.r, y));
    placed.push({ ...item, x, y });
  }
  return placed;
};
const BUBBLE_COLORS = ["#172b42", "#6f9e1f", "#b8860b", "#8a4fdb", "#1e8f8f", "#c25b3c", "#4169a8", "#9a6fb0", "#2f8a5a", "#c2436b", "#5a6b7a"];

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
  const [ownershipHolders, setOwnershipHolders] = useState([]);
  const [ownershipSupply, setOwnershipSupply] = useState(0n);
  const [ownershipFocus, setOwnershipFocus] = useState("");
  const [copiedTag, setCopiedTag] = useState("");
  const [rpcInput, setRpcInput] = useState(rpcOverride || "");
  const permissionsRegrantedRef = useRef(false);

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

  // Builds the ownership bubble map the same way a real block explorer
  // would: scan the token's own Transfer events for every address that
  // has ever held a balance, then read each one's current balance --
  // not a hardcoded guest list of "the 10 known demo accounts," so it
  // stays correct even if an instructor funds extra wallets by hand.
  const loadOwnershipMap = async () => {
    if (!window.ethereum || !selected) return;
    try {
      const { s } = await getContracts();
      const token = await tokenContract(selected, s);
      const events = await token.queryFilter(token.filters.Transfer(), 0, "latest");
      const addrs = new Set();
      for (const ev of events) {
        if (ev.args.from !== ZeroAddress) addrs.add(ev.args.from);
        if (ev.args.to !== ZeroAddress) addrs.add(ev.args.to);
      }
      const supply = await token.totalSupply();
      const rows = await Promise.all([...addrs].map(async (address) => ({
        address, balance: await token.balanceOf(address)
      })));
      const nonZero = rows.filter((r) => r.balance > 0n).sort((a, b) => (a.balance > b.balance ? -1 : 1));
      setOwnershipHolders(nonZero);
      setOwnershipSupply(supply);
    } catch {
      // Ownership map is a bonus visualization -- never surface its
      // errors in the main status banner, which real actions use.
    }
  };

  useEffect(() => { loadOwnershipMap(); }, [selected, account, chainId]);

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
      // One click does both steps: request the account, then immediately
      // offer to add/switch to the classroom network too, instead of
      // leaving a student stuck on "Wrong / disconnected network" until
      // they happen to press an action button first.
      try { await ensureNetwork(); } catch { /* student can retry via any action button below */ }
      const p = new BrowserProvider(window.ethereum);
      const network = await p.getNetwork();
      setChainId(network.chainId.toString());
      setMessage(network.chainId.toString() === "31337"
        ? "Wallet connected to the PropChain Classroom network."
        : "Wallet connected, but MetaMask didn't switch networks -- try any action button below, or switch manually.");
    } catch (e) { setMessage(e.message); }
  };

  const ensureNetwork = async () => {
    if (!window.ethereum) throw new Error("MetaMask not found.");
    // A remote student's RPC endpoint is NOT "this same host, port 8545"
    // -- the frontend and the Hardhat node are two independent Cloudflare
    // tunnel hostnames. `?rpc=` (set by the instructor's shareable link,
    // see the Student Quickstart panel) overrides the LAN-style guess.
    const rpcUrl = rpcOverride || `http://${window.location.hostname}:8545`;
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
          rpcUrls: [rpcUrl],
          blockExplorerUrls: []
        }]
      });
    }

    // Workaround for a MetaMask regression (v13.55+): an account already
    // connected to this site doesn't get re-scoped to a chain that was
    // just added via wallet_addEthereumChain -- eth_accounts still returns
    // it, but eth_sendTransaction silently rejects with a 4100 "not
    // authorized" error (no popup at all). Re-requesting eth_accounts
    // permission re-grants the account across every permitted chain,
    // including this one. Only do it once per page load: MetaMask always
    // shows a confirmation for this request, and asking before every
    // single action would mean two approvals per transaction instead of one.
    if (!permissionsRegrantedRef.current) {
      permissionsRegrantedRef.current = true;
      try {
        await window.ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }]
        });
      } catch { /* older MetaMask without this bug just denies/no-ops here -- fine either way */ }
    }
  };

  const copyText = async (text, tag) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTag(tag);
      setTimeout(() => setCopiedTag(""), 1500);
    } catch {
      setMessage("Could not copy automatically -- select and copy the text manually.");
    }
  };

  // The link an instructor shares with remote students: this page's own
  // URL plus `?rpc=` pointing at whatever RPC endpoint reaches the
  // Hardhat node from wherever the student is -- the LAN IP for a LAN
  // classroom, or a second Cloudflare tunnel's URL for genuinely remote
  // students (that tunnel is a separate hostname from this one and has
  // to be started and shared separately; see README.md).
  const shareableLink = () => {
    const url = new URL(window.location.href);
    url.search = "";
    if (rpcInput.trim()) url.searchParams.set("rpc", rpcInput.trim());
    return url.toString();
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
      /* TEMP-DISABLED-FOR-DEBUG: loadOwnershipMap(); */
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

  // Bubble area (not radius) encodes ownership share, so a 2x bigger
  // holding looks 2x bigger, not 4x -- the same convention real bubble
  // maps use. A size floor keeps tiny/dust holders clickable.
  const bubbles = useMemo(() => {
    if (!ownershipHolders.length || ownershipSupply === 0n) return [];
    const sized = ownershipHolders.map((h) => {
      const bp = Number((h.balance * 10000n) / ownershipSupply) / 100;
      return { ...h, bp, r: Math.max(16, Math.min(60, 16 + Math.sqrt(bp) * 11)) };
    });
    return packCircles(sized, 320);
  }, [ownershipHolders, ownershipSupply]);

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

        <section className="panel quickstart-panel">
          <div className="eyebrow">STUDENT QUICKSTART</div>
          <h2>Get a wallet talking to this chain</h2>
          <p className="muted">
            Install MetaMask (Chrome, Edge, Brave, or Firefox -- not Safari), then import one of
            Hardhat's own public test accounts below. Pick a number nobody else in class is using.
            Once imported, click <b>Connect wallet</b> above -- it now also offers to add/switch
            MetaMask to the PropChain Classroom network for you, in the same click.
          </p>
          <div className="account-grid">
            {HARDHAT_TEST_ACCOUNTS.map((a) => (
              <div className={`account-chip ${account && account.toLowerCase() === a.address.toLowerCase() ? "active" : ""}`} key={a.index}>
                <div className="account-chip-head"><b>#{a.index}</b><span>{a.role}</span></div>
                <code>{short(a.address)}</code>
                <button className="secondary" onClick={() => copyText(a.privateKey, `key-${a.index}`)}>
                  {copiedTag === `key-${a.index}` ? "✅ Copied" : "Copy private key"}
                </button>
              </div>
            ))}
          </div>
          <details className="instructor-details">
            <summary>Instructor: build a one-click link for remote students (Cloudflare tunnel)</summary>
            <p className="muted">
              A remote student's MetaMask can't reach <code>localhost:8545</code> or your LAN IP --
              it needs its own publicly reachable RPC endpoint. Run a second Cloudflare tunnel for
              the Hardhat node (<code>cloudflared tunnel --url http://localhost:8545</code>, in a
              new terminal, alongside the one already tunneling the frontend) and paste the URL it
              prints below. Leave this blank for a same-LAN classroom -- students then use the LAN
              IP exactly as README.md section 5 describes.
            </p>
            <label>RPC tunnel URL (remote students only)</label>
            <input placeholder="https://random-words.trycloudflare.com" value={rpcInput} onChange={(e) => setRpcInput(e.target.value)} />
            <button className="primary full spaced" onClick={() => copyText(shareableLink(), "share-link")}>
              {copiedTag === "share-link" ? "✅ Copied" : "Copy shareable student link"}
            </button>
          </details>
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

        <section className="panel ownership-panel">
          <div className="eyebrow">🫧 TOKEN OWNERSHIP MAP</div>
          <h2>Who owns {selectedProperty?.name || "this property"}, visually</h2>
          <p className="muted">
            Every bubble is a real wallet, found the same way a block explorer finds holders --
            by scanning this token's on-chain Transfer events, not a hardcoded list. Bubble
            <b> area</b> (not radius) is proportional to ownership share, so it can't visually
            exaggerate who owns more. Click a bubble for its exact numbers.
          </p>
          {bubbles.length === 0 ? (
            <p className="muted console-empty">No tokens have been bought yet for this property -- buy some below, then come back.</p>
          ) : (
            <div className="bubble-layout">
              <div className="bubble-canvas" style={{ width: 320, height: 320 }}>
                {bubbles.map((b) => (
                  <button
                    key={b.address}
                    className={`bubble ${ownershipFocus === b.address ? "focused" : ""} ${account && account.toLowerCase() === b.address.toLowerCase() ? "you" : ""}`}
                    style={{
                      width: b.r * 2, height: b.r * 2,
                      left: b.x - b.r, top: b.y - b.r,
                      background: BUBBLE_COLORS[bubbles.indexOf(b) % BUBBLE_COLORS.length]
                    }}
                    onClick={() => setOwnershipFocus(b.address === ownershipFocus ? "" : b.address)}
                    title={`${short(b.address)} · ${b.bp.toFixed(2)}%`}
                  >
                    {b.bp >= 3 ? `${b.bp.toFixed(1)}%` : ""}
                  </button>
                ))}
              </div>
              <div className="bubble-detail">
                {(() => {
                  const focused = bubbles.find((b) => b.address === ownershipFocus) || bubbles[0];
                  if (!focused) return null;
                  return (
                    <>
                      <div className="bubble-detail-row"><span>Wallet</span><code>{focused.address}</code></div>
                      <div className="bubble-detail-row"><span>{focused.address.toLowerCase() === account?.toLowerCase() ? "You hold" : "Holds"}</span><b>{formatUnits(focused.balance, 18)} tokens</b></div>
                      <div className="bubble-detail-row"><span>Ownership share</span><b>{focused.bp.toFixed(2)}%</b></div>
                      <p className="muted">{bubbles.length} wallet{bubbles.length === 1 ? "" : "s"} hold a nonzero balance right now, out of {formatUnits(ownershipSupply, 18)} total tokens.</p>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
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
