// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;


contract LostAndFoundBountyTest {

    enum Status {OPEN, CLAIMED, DISPUTED, PAID, REFUNDED, CANCELLED, SPLIT}

    struct Bounty{
        address owner;
        address finder;
        address arbiter;
        address refundTo;
        address payoutAddress;
        uint256 reward;
        uint256 finderStake;
        uint256 deadline;
        uint256 claimedAt;
        uint256 disputedAt;
        bytes32 descriptionHash;
        bytes32 proofHash;
        string title;
        string disputeReason;
        bool proofRevealed;
        Status status;
    }


    uint256 public constant response_time = 3 days;
    uint256 public constant arbiter_time = 14 days;
    uint256 public constant bounty_time = 180 days;
    uint256 public constant min_reward = 0.001 ether;
    uint256 public constant arbiter_fee_bps = 200;
    uint256 public constant stake_bps = 1000;
    uint256 public constant max_title_length = 100;
    uint256 public constant max_reason_length = 300;
    uint256 private constant BPS = 10_000;

    
    uint256 public bountyCount;
    mapping(uint256 => Bounty) private bounties;
    mapping(address => uint256) public pendingWithdrawals;

    uint256 private _locked = 1;


    event BountyPosted(uint256 indexed id, address indexed owner, address indexed arbiter, uint256 reward, uint256 deadline);
    event ItemClaimed(uint256 indexed id, address indexed finder, address payoutAddress, bytes32 proofHash, uint256 stake);
    event ProofRevealed(uint256 indexed id, address indexed finder);
    event ReturnConfirmed(uint256 indexed id, address indexed finder, uint256 reward);
    event ClaimRejected(uint256 indexed id, address indexed owner, string reason);
    event DisputeResolved(uint256 indexed id, address indexed arbiter, bool paidFinder, uint256 arbiterFee);
    event DisputeTimedOut(uint256 indexed id, address indexed caller);
    event AutoReleased(uint256 indexed id, address indexed finder, uint256 reward);
    event BountyCancelled(uint256 indexed id);
    event BountyExpired(uint256 indexed id, address indexed caller);
    event Withdrawn(address indexed account, uint256 amount);


    modifier onlyOwner(uint256 id) {
        require(msg.sender == _get(id).owner, "Not bounty owner");
        _;
    }

    modifier onlyArbiter(uint256 id) {
        require(msg.sender == _get(id).arbiter, "Not bounty arbiter");
        _;
    }

    modifier onlyFinderSide(uint256 id) {
        Bounty storage b = _get(id);
        require(msg.sender == b.finder || msg.sender == b.payoutAddress, "Only finder");
        _;
    }

    modifier nonReentrant(){
        require(_locked == 1, "Reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }

    function getBounty(uint256 id) external view returns (Bounty memory) {
            return _get(id);
    }



    function postBounty(
        string calldata title,
        bytes32 descriptionHash,
        address arbiter,
        address refundTo,
        uint256 deadline
    ) external payable returns (uint256 id) {
        require(msg.value >= min_reward, "Reward too small");
        require(deadline > block.timestamp, "Deadline has expired");
        require(deadline <= block.timestamp + bounty_time, "Deadline too far in the future");
        require(arbiter != address(0), "Arbiter address cannot be zero");
        require(arbiter != msg.sender, "Owner cannot be an arbiter");
        uint256 len = bytes(title).length;
        require(len > 0 && len <= max_title_length, "Bad title length");
        require(refundTo != arbiter, "Arbiter address cannot be a refund address");
        if(refundTo == address(0) ) {
            refundTo = msg.sender;
    }

        id = ++bountyCount;
        Bounty storage b = bounties[id];
        b.owner = msg.sender;
        b.arbiter = arbiter;
        b.refundTo = refundTo;
        b.reward = msg.value;
        b.deadline = deadline;
        b.descriptionHash = descriptionHash;
        b.title = title;
        b.status = Status.OPEN;

        emit BountyPosted(id, msg.sender, arbiter, msg.value, deadline);
    }

    function claimFound(uint256 id, bytes32 proofHash, address payoutAddress) external payable {
        Bounty storage b = _get(id);
        require(b.status == Status.OPEN, "Bounty is not open");
        require(msg.sender != b.owner && msg.sender != b.arbiter && msg.sender != b.refundTo, 
        "Bounty owner or arbiter cannot claim");
        require(block.timestamp <= b.deadline, "Deadline has expired");
        require(proofHash != bytes32(0), "Proof hash cannot be zero");

        if(payoutAddress == address(0)) payoutAddress = msg.sender;

        require(payoutAddress != b.owner && payoutAddress != b.arbiter && payoutAddress != b.refundTo, 
        "Bad payout address");

        require(msg.value == _stake(b.reward), "Wrong stake!");

    

        b.status = Status.CLAIMED;
        b.finder = msg.sender;
        b.payoutAddress = payoutAddress;
        b.finderStake = msg.value;
        b.proofHash = proofHash;
        b.claimedAt = block.timestamp;

        emit ItemClaimed(id, msg.sender, payoutAddress, proofHash, msg.value);
    }


    function revealProof(uint256 id, bytes32 proofDigest, bytes32 salt) external {
        Bounty storage b = _get(id);
        require(msg.sender == b.finder, "Only finder");
        require(b.status == Status.CLAIMED || b.status == Status.DISPUTED, "Wrong status");
        require(computeProofHash(proofDigest, msg.sender, id, salt) == b.proofHash, "Proof mismatch");
        b.proofRevealed = true;
        emit ProofRevealed(id, msg.sender);
    }


    function confirmReturn(uint256 id) external onlyOwner(id) {
        Bounty storage b = bounties[id];
        require(b.status == Status.CLAIMED, "Not claimed!");

        b.status = Status.PAID;
        _credit(b.payoutAddress, b.reward);
        _credit(b.finder, b.finderStake);

        emit ReturnConfirmed(id, b.finder, b.reward);
    }

    function rejectClaim(uint256 id, string calldata reason) external onlyOwner(id) {
        Bounty storage b = bounties[id];
        require(b.status == Status.CLAIMED, "Not claimed");
        require(block.timestamp <= b.claimedAt + response_time, "Response window closed");
        uint256 len = bytes(reason).length;
        require(len > 0 && len <= max_reason_length, "Bad reason length");

        b.status = Status.DISPUTED;
        b.disputedAt = block.timestamp;
        b.disputeReason = reason;

        emit ClaimRejected(id, msg.sender, reason);
    }

    function autoRelease(uint256 id) external onlyFinderSide(id){
        Bounty storage b = bounties[id];
        require(b.status == Status.CLAIMED, "Not claimed");
        require(block.timestamp > b.claimedAt + response_time, "Response window still open");

        b.status = Status.PAID;
        _credit(b.payoutAddress, b.reward);
        _credit(b.finder, b.finderStake);

        emit AutoReleased(id, b.finder, b.reward);
    }


    function resolveDispute(uint256 id, bool payFinder) external onlyArbiter(id){
        Bounty storage b = bounties[id];
        require(b.status == Status.DISPUTED, "Not disputed");

        uint256 fee = (b.reward * arbiter_fee_bps) / BPS;
        uint256 net = b.reward - fee;
        _credit(b.arbiter, fee);

        if(payFinder){
            b.status = Status.PAID;
            _credit(b.payoutAddress, net);
            _credit(b.finder, b.finderStake);
        }
        else{
            b.status = Status.REFUNDED;
            _credit(b.refundTo, net + b.finderStake);
        }

        emit DisputeResolved(id, msg.sender, payFinder, fee);
    }

    function escalateTimeout(uint256 id) external {
        Bounty storage b = _get(id);
        require(b.status == Status.DISPUTED, "Not disputed");
        require(
            msg.sender == b.owner || msg.sender == b.refundTo ||
            msg.sender == b.finder || msg.sender == b.payoutAddress,
            "Not a party"
        );
        require(block.timestamp > b.disputedAt + arbiter_time, "Arbiter still has time");

        b.status = Status.SPLIT;
        uint256 half = b.reward / 2;
        _credit(b.payoutAddress, half);
        _credit(b.refundTo, b.reward - half);
        _credit(b.finder, b.finderStake);

        emit DisputeTimedOut(id, msg.sender);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    function cancelBounty(uint256 id) external onlyOwner(id) {
        Bounty storage b = bounties[id];
        require(b.status == Status.OPEN, "Bounty already closed");

        b.status = Status.CANCELLED;
        _credit(b.refundTo, b.reward);

        emit BountyCancelled(id);
    }

    function reclaimExpired(uint256 id) external {
        Bounty storage b = _get(id);
        require(b.status == Status.OPEN, "Bounty already closed");
        require(block.timestamp > b.deadline, "Bounty not expired");

        b.status = Status.REFUNDED;
        _credit(b.refundTo, b.reward);

        emit BountyExpired(id, msg.sender);

    }

    function _get(uint256 id) internal view returns (Bounty storage) {
        require(id != 0 && id <= bountyCount, "Bounty not found");
        return bounties[id];
    }

    function requiredStake(uint256 id) external view returns (uint256) {
        return _stake(_get(id).reward);
    }

    function computeProofHash(
        bytes32 proofDigest,
        address finder,
        uint256 id,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(proofDigest, finder, id, salt));
    }

    function _credit(address to, uint256 amount) internal  {
        if(amount > 0) {
            require(to != address(0), "Credit to zero address");
            pendingWithdrawals[to] += amount;
        }
    }

    function _stake(uint256 reward) internal pure returns (uint256){
        return reward * stake_bps / BPS;
    }
}