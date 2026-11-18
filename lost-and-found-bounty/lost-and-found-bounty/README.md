# Lost & Found Bounty

Decentralized lost & found: the owner locks a reward (ETH) in a smart contract, the finder claims it with a 10% stake, an arbiter resolves disputes (2% fee). Money is paid out by pull-payment (`withdraw`).

## Structure
- `contracts/LostAndFoundBounty.sol` — contract `LostAndFoundBountyTest` (Solidity ^0.8.20)
- `frontend/` — `index.html`, `style.css`, `app.js` (ethers.js v6 + MetaMask)
- `tools/` — `hardhat.config.js` (empty config for a local node) and `warp.js` (moves chain time forward to test the 3-day / 14-day timeouts)

## How to run
1. Local chain (Node.js 18+): in `tools/` run `npm init -y`, `npm install --save-dev hardhat@2`, `npx hardhat node`. Keep it running (RPC `http://127.0.0.1:8545`, chain id `31337`).
2. MetaMask: add network Localhost 8545 (chain id 31337) and import 4 accounts from the node output (Owner, Finder, Arbiter, Outsider). These keys are public test keys, never use them for real funds.
3. Remix (https://remix.ethereum.org): paste the contract, compile (0.8.20+), Environment = Browser Extension (MetaMask), deploy `LostAndFoundBountyTest`, copy the contract address.
4. In `frontend/` run `npx serve .`, open the shown address (e.g. http://localhost:3000), set MetaMask network for this site to Localhost 8545, click Connect wallet, paste the contract address, click Load board.

## Notes
- The page calls 5 of 11 write functions (`postBounty`, `claimFound`, `confirmReturn`, `cancelBounty`, `withdraw`). `revealProof`, `rejectClaim`, `autoRelease`, `resolveDispute`, `escalateTimeout`, `reclaimExpired` are called from Remix.
- Time-based scenarios: `node tools/warp.js 259201` (3 days), `1209601` (14 days), `86401` (1 day).
