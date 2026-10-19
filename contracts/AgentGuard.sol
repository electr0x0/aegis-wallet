// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title AgentGuard
/// @notice Minimal guarded smart account for an AI agent. Funds live here. The agent holds only an
/// expiring session key that can move value to allow-listed recipients within per-tx and per-day
/// limits. Anything else needs a signature from the owner key. The limits hold even if the agent
/// server or its LLM is fully compromised.
/// @dev This is not an ERC-4337 account: no EntryPoint, no paymaster, no bundler. The session key
/// pays its own gas.
contract AgentGuard {
    struct Limit {
        uint128 perTx;
        uint128 perDay;
        uint128 spent;
        uint64 day;
    }

    /// @dev Native ETH is tracked under the zero address in `limits`.
    address private constant NATIVE = address(0);

    bytes4 private constant TRANSFER = 0xa9059cbb; // transfer(address,uint256)
    bytes4 private constant DEPOSIT = 0xd0e30db0; // deposit()
    bytes4 private constant WITHDRAW = 0x2e1a7d4d; // withdraw(uint256)

    /// @dev secp256k1 curve order / 2. Higher s values are malleable duplicates.
    uint256 private constant HALF_CURVE_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public immutable owner;
    address public sessionKey;
    uint64 public sessionExpiry;
    mapping(address => bool) public allowedTarget;
    mapping(address => bool) public allowedRecipient;
    mapping(address => Limit) public limits;
    mapping(uint256 => bool) public usedNonce;

    error NotSessionKey();
    error NotOwner();
    error SessionExpired();
    error TargetNotAllowed();
    error RecipientNotAllowed();
    error SelectorNotAllowed();
    error ValueNotAllowed();
    error PerTxLimitExceeded();
    error DailyLimitExceeded();
    error BadSignature();
    error ApprovalExpired();
    error NonceUsed();
    error TokenTransferFailed();
    error CallFailed(bytes reason);
    error LengthMismatch();

    event Executed(address indexed target, uint256 value, bytes4 selector, bool ownerApproved);
    event SessionSet(address sessionKey, uint64 expiry);
    event LimitSet(address asset, uint128 perTx, uint128 perDay);

    modifier onlySessionKey() {
        if (msg.sender != sessionKey) revert NotSessionKey();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev `self` lets the session key relay owner-signed admin calls through executeApproved.
    modifier onlyOwnerOrSelf() {
        if (msg.sender != owner && msg.sender != address(this)) revert NotOwner();
        _;
    }

    constructor(
        address owner_,
        address sessionKey_,
        uint64 sessionExpiry_,
        address[] memory targets,
        address[] memory recipients,
        address[] memory assets,
        uint128[] memory perTx,
        uint128[] memory perDay
    ) payable {
        if (owner_ == address(0)) revert NotOwner();
        if (assets.length != perTx.length || assets.length != perDay.length) {
            revert LengthMismatch();
        }
        owner = owner_;
        _setSession(sessionKey_, sessionExpiry_);
        for (uint256 i = 0; i < targets.length; i++) {
            allowedTarget[targets[i]] = true;
        }
        for (uint256 i = 0; i < recipients.length; i++) {
            allowedRecipient[recipients[i]] = true;
        }
        for (uint256 i = 0; i < assets.length; i++) {
            _setLimit(assets[i], perTx[i], perDay[i]);
        }
    }

    receive() external payable {}

    // ---------------------------------------------------------------- session key

    /// @notice Autonomous path. Only the allow-listed call shapes below pass, within limits.
    function execute(address target, uint256 value, bytes calldata data)
        external
        onlySessionKey
        returns (bytes memory result)
    {
        if (block.timestamp > sessionExpiry) revert SessionExpired();
        bytes4 selector = _enforcePolicy(target, value, data);
        result = _call(target, value, data);
        if (selector == TRANSFER && result.length > 0 && !abi.decode(result, (bool))) {
            revert TokenTransferFailed();
        }
        emit Executed(target, value, selector, false);
    }

    /// @notice Human-approved path. The owner signs one exact call off-chain; the session key
    /// submits it. Limits do not apply, the owner signature is the authority. The session may be
    /// expired, which is how an owner-signed setSession renews it.
    function executeApproved(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external onlySessionKey returns (bytes memory result) {
        if (block.timestamp > deadline) revert ApprovalExpired();
        if (usedNonce[nonce]) revert NonceUsed();
        bytes32 digest = approvalDigest(target, value, data, nonce, deadline);
        if (_recoverSigner(_toEthSignedMessageHash(digest), signature) != owner) {
            revert BadSignature();
        }
        usedNonce[nonce] = true;
        result = _call(target, value, data);
        emit Executed(target, value, _selector(data), true);
    }

    /// @notice The hash the owner signs (as an EIP-191 personal message) to approve one call.
    function approvalDigest(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(block.chainid, address(this), target, value, keccak256(data), nonce, deadline)
        );
    }

    // ---------------------------------------------------------------- owner

    function ownerExecute(address target, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (bytes memory result)
    {
        result = _call(target, value, data);
        emit Executed(target, value, _selector(data), true);
    }

    function setSession(address key, uint64 expiry) external onlyOwnerOrSelf {
        _setSession(key, expiry);
    }

    function revokeSession() external onlyOwnerOrSelf {
        _setSession(address(0), 0);
    }

    function setTarget(address target, bool allowed) external onlyOwnerOrSelf {
        allowedTarget[target] = allowed;
    }

    function setRecipient(address recipient, bool allowed) external onlyOwnerOrSelf {
        allowedRecipient[recipient] = allowed;
    }

    function setLimit(address asset, uint128 perTx, uint128 perDay) external onlyOwnerOrSelf {
        _setLimit(asset, perTx, perDay);
    }

    // ---------------------------------------------------------------- views

    /// @notice What the session key may still spend of `asset` today (UTC day bucket).
    function remaining(address asset) external view returns (uint256) {
        Limit memory limit = limits[asset];
        uint256 spent = limit.day == _today() ? limit.spent : 0;
        return limit.perDay > spent ? limit.perDay - spent : 0;
    }

    // ---------------------------------------------------------------- internals

    /// @dev Returns the selector (zero for a plain native transfer) and books the outflow.
    function _enforcePolicy(address target, uint256 value, bytes calldata data)
        private
        returns (bytes4 selector)
    {
        if (data.length == 0) {
            if (!allowedRecipient[target]) revert RecipientNotAllowed();
            _spend(NATIVE, value);
            return bytes4(0);
        }
        if (!allowedTarget[target]) revert TargetNotAllowed();
        selector = _selector(data);

        if (selector == TRANSFER) {
            if (limits[target].perDay == 0) revert TargetNotAllowed();
            if (value != 0) revert ValueNotAllowed();
            (address to, uint256 amount) = abi.decode(data[4:], (address, uint256));
            if (!allowedRecipient[to]) revert RecipientNotAllowed();
            _spend(target, amount);
        } else if (selector == DEPOSIT) {
            _spend(NATIVE, value);
        } else if (selector == WITHDRAW) {
            // Unwrapping returns ETH to this account, so there is no outflow to count.
            if (value != 0) revert ValueNotAllowed();
        } else {
            // Blocks approve / transferFrom / permit and every other drain primitive.
            revert SelectorNotAllowed();
        }
    }

    /// @dev Books the spend before the external call (checks-effects-interactions).
    function _spend(address asset, uint256 amount) private {
        Limit storage limit = limits[asset];
        if (amount > limit.perTx) revert PerTxLimitExceeded();
        uint64 today = _today();
        if (limit.day != today) {
            limit.day = today;
            limit.spent = 0;
        }
        uint256 spent = uint256(limit.spent) + amount;
        if (spent > limit.perDay) revert DailyLimitExceeded();
        limit.spent = uint128(spent);
    }

    function _call(address target, uint256 value, bytes calldata data)
        private
        returns (bytes memory result)
    {
        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) revert CallFailed(result);
    }

    function _setSession(address key, uint64 expiry) private {
        sessionKey = key;
        sessionExpiry = expiry;
        emit SessionSet(key, expiry);
    }

    function _setLimit(address asset, uint128 perTx, uint128 perDay) private {
        Limit storage limit = limits[asset];
        limit.perTx = perTx;
        limit.perDay = perDay;
        emit LimitSet(asset, perTx, perDay);
    }

    function _today() private view returns (uint64) {
        return uint64(block.timestamp / 1 days);
    }

    /// @dev Calldata shorter than a selector maps to zero, which no allow-list branch accepts.
    function _selector(bytes calldata data) private pure returns (bytes4) {
        return data.length < 4 ? bytes4(0) : bytes4(data[:4]);
    }

    function _toEthSignedMessageHash(bytes32 digest) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
    }

    function _recoverSigner(bytes32 hash, bytes calldata signature)
        private
        pure
        returns (address signer)
    {
        if (signature.length != 65) revert BadSignature();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > HALF_CURVE_ORDER) revert BadSignature();
        if (v != 27 && v != 28) revert BadSignature();
        signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }
}
