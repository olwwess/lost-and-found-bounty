// ===== 1. Contract function list (ABI): only what this page needs =====
const ABI = [
  "function bountyCount() view returns (uint256)",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function requiredStake(uint256) view returns (uint256)",
  "function getBounty(uint256) view returns (tuple(address owner,address finder,address arbiter,address refundTo,address payoutAddress,uint256 reward,uint256 finderStake,uint256 deadline,uint256 claimedAt,uint256 disputedAt,bytes32 descriptionHash,bytes32 proofHash,string title,string disputeReason,bool proofRevealed,uint8 status))",
  "function postBounty(string title,bytes32 descriptionHash,address arbiter,address refundTo,uint256 deadline) payable returns (uint256)",
  "function claimFound(uint256 id,bytes32 proofHash,address payoutAddress) payable",
  "function confirmReturn(uint256 id)",
  "function cancelBounty(uint256 id)",
  "function withdraw()"
];
// same order as the Status enum in the contract
const STATUS = ["OPEN", "CLAIMED", "DISPUTED", "PAID", "REFUNDED", "CANCELLED", "SPLIT"];

let provider, signer, me, contract;           // filled in when the wallet connects
const $ = id => document.getElementById(id);  // shorthand for getElementById

// ===== 2. Helper functions =====
function say(text, bad = false) {             // message at the bottom of the screen
  const t = $("toast");
  t.textContent = text;                       // textContent, not innerHTML!
  t.className = bad ? "bad" : "";
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 5000);
}
const short = a => a.slice(0, 6) + "…" + a.slice(-4);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// ===== 3. Connect the wallet =====
$("connect").addEventListener("click", async () => {
  if (!window.ethereum) return say("Please install MetaMask", true);
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);   // MetaMask popup
    signer = await provider.getSigner();
    me = await signer.getAddress();
    $("who").textContent = short(me);
  } catch (e) {
    say(e.shortMessage || e.message, true);
  }
});

// ===== 4. Load the contract and read data =====
$("load").addEventListener("click", async () => {
  if (!signer) return say("Connect your wallet first", true);
  const addr = $("addr").value.trim();
  if (!ethers.isAddress(addr)) return say("Invalid contract address", true);
  contract = new ethers.Contract(addr, ABI, signer);
  await refresh();
});

async function refresh() {
  try {
    const count = Number(await contract.bountyCount());
    const board = $("board");
    board.replaceChildren();                           // remove old cards
    for (let id = count; id >= 1; id--) {              // newest first
      const b = await contract.getBounty(id);
      board.append(makeCard(id, b));
    }
    if (count === 0) board.textContent = "No bounties yet. Post the first one above.";
    const pend = await contract.pendingWithdrawals(me);
    $("pending").textContent = "Ready to withdraw: " + ethers.formatEther(pend) + " ETH";
    $("withdraw").classList.toggle("hidden", pend === 0n);
  } catch (e) {
    say(e.reason || e.shortMessage || e.message, true);
  }
}

// ===== 5. Build a card from contract data =====
function makeCard(id, b) {
  const status = STATUS[Number(b.status)];
  const card = document.createElement("article");
  card.className = "card " + status.toLowerCase();    // class = status color

  const title = document.createElement("h3");
  title.textContent = b.title;                         // safe: not innerHTML
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = status;
  const reward = document.createElement("p");
  reward.className = "reward";
  reward.textContent = ethers.formatEther(b.reward) + " ETH";
  const owner = document.createElement("p");
  owner.textContent = "Owner: " + short(b.owner);
  card.append(title, badge, reward, owner);

  // clicking a card highlights its status in the diagram
  card.addEventListener("click", () => {
    document.querySelectorAll(".step").forEach(s =>
      s.classList.toggle("active", s.textContent === status));
  });

  // buttons depend on your role and the bounty status
  const isOwner = same(me, b.owner);
  const isArbiter = same(me, b.arbiter);
  const isHeir = same(me, b.refundTo);

  if (status === "OPEN" && isOwner)
    addButton(card, "Cancel", "btn-danger", () => contract.cancelBounty(id));

  if (status === "CLAIMED" && isOwner)
    addButton(card, "Confirm return", "", () => contract.confirmReturn(id));

  if (status === "OPEN" && !isOwner && !isArbiter && !isHeir) {
    const proof = document.createElement("input");
    proof.placeholder = "Your proof (text)";
    card.append(proof);
    addButton(card, "Claim item", "", async () => {
      if (!proof.value.trim()) throw new Error("Write your proof first");
      const stake = await contract.requiredStake(id);  // 10% stake
      const digest = ethers.keccak256(ethers.toUtf8Bytes(proof.value.trim()));
      const salt = ethers.hexlify(ethers.randomBytes(32));
      // same field order as computeProofHash in the contract: digest, finder, id, salt
      const hash = ethers.solidityPackedKeccak256(
        ["bytes32", "address", "uint256", "bytes32"], [digest, me, id, salt]);
      localStorage.setItem("proof:" + id, JSON.stringify({ digest, salt })); // keep the secret
      return contract.claimFound(id, hash, ethers.ZeroAddress, { value: stake });
    });
  }
  return card;
}

// one function for every button: send, wait, refresh the board
function addButton(card, text, extraClass, action) {
  const btn = document.createElement("button");
  btn.className = "btn " + extraClass;
  btn.textContent = text;
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();                               // do not trigger the card click
    try {
      say("Sending transaction…");
      const tx = await action();
      await tx.wait();
      say("Done");
      await refresh();
    } catch (err) {
      say(err.reason || err.shortMessage || err.message, true);
    }
  });
  card.append(btn);
}

// ===== 6. Post a bounty =====
$("postForm").addEventListener("submit", async (e) => {
  e.preventDefault();                                  // do not reload the page
  if (!contract) return say("Load a contract first", true);
  try {
    const title = $("pTitle").value.trim();
    const block = await provider.getBlock("latest");
    const deadline = block.timestamp + Number($("pDays").value) * 86400;
    say("Posting bounty…");
    const tx = await contract.postBounty(
      title,
      ethers.keccak256(ethers.toUtf8Bytes(title)),     // description hash
      $("pArbiter").value.trim(),
      ethers.ZeroAddress,                              // refundTo = the owner
      deadline,
      { value: ethers.parseEther($("pReward").value) } // the reward
    );
    await tx.wait();
    say("Bounty posted");
    await refresh();
  } catch (err) {
    say(err.reason || err.shortMessage || err.message, true);
  }
});

// ===== 7. Withdraw money =====
$("withdraw").addEventListener("click", async () => {
  try {
    const tx = await contract.withdraw();
    await tx.wait();
    say("Funds withdrawn");
    await refresh();
  } catch (err) {
    say(err.reason || err.shortMessage || err.message, true);
  }
});