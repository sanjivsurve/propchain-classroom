const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PropChain classroom contracts", function () {
  async function setup() {
    const [owner, alice, bob] = await ethers.getSigners();
    const USD = await ethers.getContractFactory("MockUSDC");
    const usd = await USD.deploy();
    const Market = await ethers.getContractFactory("PropertyMarketplace");
    const market = await Market.deploy(await usd.getAddress(), owner.address);
    const Token = await ethers.getContractFactory("PropertyToken");
    const token = await Token.deploy(
      1, "Demo Dallas Property", "DDP", 10000, 1000000,
      await market.getAddress(), owner.address
    );
    await market.addProperty(await token.getAddress(), "Demo Dallas Property", "Dallas (fictional)", 100n * 10n ** 6n);
    await usd.transfer(alice.address, 1000n * 10n ** 6n);
    await usd.transfer(bob.address, 1000n * 10n ** 6n);
    return { owner, alice, bob, usd, market, token };
  }

  it("sells primary tokens after payment approval", async function () {
    const { alice, usd, market, token } = await setup();
    await usd.connect(alice).approve(await market.getAddress(), 200n * 10n ** 6n);
    await market.connect(alice).buyPrimary(await token.getAddress(), 2);
    expect(await token.balanceOf(alice.address)).to.equal(2n * 10n ** 18n);
  });

  it("transfers property tokens between students", async function () {
    const { alice, bob, usd, market, token } = await setup();
    await usd.connect(alice).approve(await market.getAddress(), 100n * 10n ** 6n);
    await market.connect(alice).buyPrimary(await token.getAddress(), 1);
    await token.connect(alice).transfer(bob.address, 1n * 10n ** 18n);
    expect(await token.balanceOf(bob.address)).to.equal(1n * 10n ** 18n);
  });

  it("creates and completes a resale", async function () {
    const { alice, bob, usd, market, token } = await setup();
    await usd.connect(alice).approve(await market.getAddress(), 100n * 10n ** 6n);
    await market.connect(alice).buyPrimary(await token.getAddress(), 1);
    await token.connect(alice).approve(await market.getAddress(), 1n * 10n ** 18n);
    await market.connect(alice).createResaleListing(await token.getAddress(), 1, 120n * 10n ** 6n);
    await usd.connect(bob).approve(await market.getAddress(), 120n * 10n ** 6n);
    await market.connect(bob).buyResale(1, 1);
    expect(await token.balanceOf(bob.address)).to.equal(1n * 10n ** 18n);
  });
});
