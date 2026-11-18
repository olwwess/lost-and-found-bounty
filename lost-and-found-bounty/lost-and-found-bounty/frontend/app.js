
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

const STATUS = ["OPEN", "CLAIMED", "DISPUTED", "PAID", "REFUNDED", "CANCELLED", "SPLIT"];

let provider, signer, me, contract;          
const $ = id => document.getElementById(id);  

function say(text, bad = false) {             
  const t = $("toast");
  t.textContent = text;                       
  t.className = bad ? "bad" : "";
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 5000);
}
const short = a => a.slice(0, 6) + "…" + a.slice(-4);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

$("connect").addEventListener("click", async () => {
  if (!window.ethereum) return say("Please install MetaMask", true);
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);   
    signer = await provider.getSigner();
    me = await signer.getAddress();
    $("who").textContent = short(me);
  } catch (e) {
    say(e.shortMessage || e.message, true);
  }
});

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
    board.replaceChildren();                          
    for (let id = count; id >= 1; id--) {              
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

function makeCard(id, b) {
  const status = STATUS[Number(b.status)];
  const card = document.createElement("article");
  card.className = "card " + status.toLowerCase();    

  const title = document.createElement("h3");
  title.textContent = b.title;                         
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = status;
  const reward = document.createElement("p");
  reward.className = "reward";
  reward.textContent = ethers.formatEther(b.reward) + " ETH";
  const owner = document.createElement("p");
  owner.textContent = "Owner: " + short(b.owner);
  card.append(title, badge, reward, owner);

  card.addEventListener("click", () => {
    document.querySelectorAll(".step").forEach(s =>
      s.classList.toggle("active", s.textContent === status));
  });

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
      const hash = ethers.solidityPackedKeccak256(
        ["bytes32", "address", "uint256", "bytes32"], [digest, me, id, salt]);
      localStorage.setItem("proof:" + id, JSON.stringify({ digest, salt })); 
      return contract.claimFound(id, hash, ethers.ZeroAddress, { value: stake });
    });
  }
  return card;
}

function addButton(card, text, extraClass, action) {
  const btn = document.createElement("button");
  btn.className = "btn " + extraClass;
  btn.textContent = text;
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();                               
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


$("postForm").addEventListener("submit", async (e) => {
  e.preventDefault();                                 
  if (!contract) return say("Load a contract first", true);
  try {
    const title = $("pTitle").value.trim();
    const block = await provider.getBlock("latest");
    const deadline = block.timestamp + Number($("pDays").value) * 86400;
    say("Posting bounty…");
    const tx = await contract.postBounty(
      title,
      ethers.keccak256(ethers.toUtf8Bytes(title)),     
      $("pArbiter").value.trim(),
      ethers.ZeroAddress,                              
      deadline,
      { value: ethers.parseEther($("pReward").value) } 
    );
    await tx.wait();
    say("Bounty posted");
    await refresh();
  } catch (err) {
    say(err.reason || err.shortMessage || err.message, true);
  }
});

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
