// Usage: node warp.js 259201  (moves the local chain time forward by N seconds)
const seconds = Number(process.argv[2]);
const rpc = (method, params) =>
  fetch("http://127.0.0.1:8545", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then(r => r.json());

(async () => {
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine", []);
  console.log("Time moved by", seconds, "seconds");
})();
