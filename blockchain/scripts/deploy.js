const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [instructor, ...students] = await ethers.getSigners();
  console.log("Instructor/deployer:", instructor.address);

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usd = await MockUSDC.deploy();
  await usd.waitForDeployment();
  const usdAddress = await usd.getAddress();

  const Marketplace = await ethers.getContractFactory("PropertyMarketplace");
  const market = await Marketplace.deploy(usdAddress, instructor.address);
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();

  const definitions = [
    { id: 1, name: "Dallas Garden Apartments", symbol: "DGA", supply: 10000, value: 1000000, location: "Dallas, Texas (fictional)", price: 100 },
    { id: 2, name: "Frisco Townhomes", symbol: "FTH", supply: 5000, value: 750000, location: "Frisco, Texas (fictional)", price: 150 },
    { id: 3, name: "Plano Retail Center", symbol: "PRC", supply: 20000, value: 2000000, location: "Plano, Texas (fictional)", price: 100 }
  ];

  const deployedProperties = [];
  const Token = await ethers.getContractFactory("PropertyToken");

  for (const p of definitions) {
    const token = await Token.deploy(
      p.id, p.name, p.symbol, p.supply, p.value, marketAddress, instructor.address
    );
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    const priceBaseUnits = BigInt(p.price) * 10n ** 6n;
    await (await market.addProperty(tokenAddress, p.name, p.location, priceBaseUnits)).wait();

    deployedProperties.push({
      id: p.id,
      name: p.name,
      symbol: p.symbol,
      supply: p.supply,
      illustrativeValueUSD: p.value,
      location: p.location,
      pricePerTokenUSD: p.price,
      tokenAddress
    });
    console.log(`${p.name}: ${tokenAddress}`);
  }

  // Give the first ten student accounts demo dollars. The faucet is also available in-app.
  for (const student of students.slice(0, 10)) {
    await (await usd.transfer(student.address, 5000n * 10n ** 6n)).wait();
  }

  const artifact = (name) => JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`), "utf8")
  );

  const deployment = {
    chainId: 31337,
    networkName: "PropChain Classroom",
    rpcHint: "http://INSTRUCTOR-LAN-IP:8545",
    instructor: instructor.address,
    mockUSDC: usdAddress,
    marketplace: marketAddress,
    properties: deployedProperties,
    abis: {
      MockUSDC: artifact("MockUSDC").abi,
      PropertyMarketplace: artifact("PropertyMarketplace").abi,
      PropertyToken: artifact("PropertyToken").abi
    }
  };

  const out = path.join(__dirname, "..", "..", "frontend", "src", "contracts", "deployment.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(deployment, null, 2));
  console.log("Deployment written to:", out);
  console.log("Student demo wallets funded:", students.slice(0, 10).length);
  console.log("IMPORTANT: all keys and tokens are disposable local demo assets.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
