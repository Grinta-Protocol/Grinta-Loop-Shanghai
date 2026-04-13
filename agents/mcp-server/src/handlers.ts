import {
  getConfig,
  getSafeManager,
  getSafeEngine,
  getGrintaHook,
  parseBtcAmount,
  parseGritAmount,
  formatWad,
  formatRay,
  formatWadPercent,
  formatUsd,
  formatAnnualRate,
  formatBtcFromWad,
  toBigInt,
  u256Calldata,
  type StarknetCall,
} from "./starknet.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Format a write tool response: human description + machine-readable calldata */
function callResult(description: string, calls: StarknetCall[]): ToolResult {
  const callsJson = JSON.stringify(calls, null, 2);
  return ok(
    `${description}\n\n` +
    `To execute, sign and submit this multicall:\n` +
    `\`\`\`json\n${callsJson}\n\`\`\``,
  );
}

// ---------------------------------------------------------------------------
// Handler dispatch
// ---------------------------------------------------------------------------

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      // ---- Write tools (return calldata) ----
      case "grinta_open_safe":
        return handleOpenSafe();
      case "grinta_open_and_borrow":
        return handleOpenAndBorrow(args);
      case "grinta_deposit":
        return handleDeposit(args);
      case "grinta_withdraw":
        return handleWithdraw(args);
      case "grinta_borrow":
        return handleBorrow(args);
      case "grinta_repay":
        return handleRepay(args);
      case "grinta_close_safe":
        return handleCloseSafe(args);
      case "grinta_authorize_agent":
        return handleAuthorizeAgent(args);
      case "grinta_revoke_agent":
        return handleRevokeAgent(args);
      case "grinta_update":
        return handleUpdate();
      case "grinta_set_market_price":
        return handleSetMarketPrice(args);

      // ---- Read tools (execute on-chain) ----
      case "grinta_get_market_price":
        return await handleGetMarketPrice();
      case "grinta_get_collateral_price_hook":
        return await handleGetCollateralPriceHook();
      case "grinta_get_position_health":
        return await handleGetPositionHealth(args);
      case "grinta_get_max_borrow":
        return await handleGetMaxBorrow(args);
      case "grinta_get_safe":
        return await handleGetSafe(args);
      case "grinta_get_rates":
        return await handleGetRates();
      case "grinta_get_system_health":
        return await handleGetSystemHealth();
      case "grinta_get_grit_balance":
        return await handleGetGritBalance(args);
      case "grinta_is_authorized":
        return await handleIsAuthorized(args);

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Error executing ${name}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Write handlers — return calldata, user signs externally
// ---------------------------------------------------------------------------

function handleOpenSafe(): ToolResult {
  const cfg = getConfig();
  return callResult("Open a new empty SAFE.", [
    {
      contractAddress: cfg.safeManagerAddress,
      entrypoint: "open_safe",
      calldata: [],
    },
  ]);
}

function handleOpenAndBorrow(args: Record<string, unknown>): ToolResult {
  const collateralAmount = parseBtcAmount(args.collateral_amount as string);
  const borrowAmount = parseGritAmount(args.borrow_amount as string);
  const cfg = getConfig();

  return callResult(
    `Open SAFE, deposit ${args.collateral_amount} BTC, borrow ${args.borrow_amount} GRIT.`,
    [
      {
        contractAddress: cfg.wbtcAddress,
        entrypoint: "approve",
        calldata: [cfg.collateralJoinAddress, ...u256Calldata(collateralAmount)],
      },
      {
        contractAddress: cfg.safeManagerAddress,
        entrypoint: "open_and_borrow",
        calldata: [...u256Calldata(collateralAmount), ...u256Calldata(borrowAmount)],
      },
    ],
  );
}

function handleDeposit(args: Record<string, unknown>): ToolResult {
  const safeId = args.safe_id as string;
  const amount = parseBtcAmount(args.amount as string);
  const cfg = getConfig();

  return callResult(
    `Deposit ${args.amount} BTC into SAFE #${safeId}.`,
    [
      {
        contractAddress: cfg.wbtcAddress,
        entrypoint: "approve",
        calldata: [cfg.collateralJoinAddress, ...u256Calldata(amount)],
      },
      {
        contractAddress: cfg.safeManagerAddress,
        entrypoint: "deposit",
        calldata: ["0x" + BigInt(safeId).toString(16), ...u256Calldata(amount)],
      },
    ],
  );
}

function handleWithdraw(args: Record<string, unknown>): ToolResult {
  const safeId = args.safe_id as string;
  const btcAmount = parseBtcAmount(args.amount as string);
  const wadAmount = btcAmount * 10n ** 10n; // 8 decimals → 18 decimals (internal WAD)
  const cfg = getConfig();

  return callResult(
    `Withdraw ${args.amount} BTC from SAFE #${safeId}.`,
    [
      {
        contractAddress: cfg.safeManagerAddress,
        entrypoint: "withdraw",
        calldata: ["0x" + BigInt(safeId).toString(16), ...u256Calldata(wadAmount)],
      },
    ],
  );
}

function handleBorrow(args: Record<string, unknown>): ToolResult {
  const safeId = args.safe_id as string;
  const amount = parseGritAmount(args.amount as string);
  const cfg = getConfig();

  return callResult(
    `Borrow ${args.amount} GRIT from SAFE #${safeId}.`,
    [
      {
        contractAddress: cfg.safeManagerAddress,
        entrypoint: "borrow",
        calldata: ["0x" + BigInt(safeId).toString(16), ...u256Calldata(amount)],
      },
    ],
  );
}

function handleRepay(args: Record<string, unknown>): ToolResult {
  const safeId = args.safe_id as string;
  const amount = parseGritAmount(args.amount as string);
  const cfg = getConfig();

  return callResult(
    `Repay ${args.amount} GRIT to SAFE #${safeId}.`,
    [
      {
        contractAddress: cfg.safeManagerAddress,
        entrypoint: "repay",
        calldata: ["0x" + BigInt(safeId).toString(16), ...u256Calldata(amount)],
      },
    ],
  );
}

function handleCloseSafe(args: Record<string, unknown>): ToolResult {
  const safeId = args.safe_id as string;
  const cfg = getConfig();

  return callResult(
    `Close SAFE #${safeId}. Must have zero debt. Returns remaining collateral.`,
    [
      {
        contractAddress: cfg.safeManagerAddress,
        entrypoint: "close_safe",
        calldata: ["0x" + BigInt(safeId).toString(16)],
      },
    ],
  );
}

function handleAuthorizeAgent(args: Record<string, unknown>): ToolResult {
  const safeId = args.safe_id as string;
  const agent = args.agent_address as string;
  const cfg = getConfig();

  return callResult(
    `Authorize agent ${agent} on SAFE #${safeId}.`,
    [
      {
        contractAddress: cfg.safeManagerAddress,
        entrypoint: "authorize_agent",
        calldata: ["0x" + BigInt(safeId).toString(16), agent],
      },
    ],
  );
}

function handleRevokeAgent(args: Record<string, unknown>): ToolResult {
  const safeId = args.safe_id as string;
  const agent = args.agent_address as string;
  const cfg = getConfig();

  return callResult(
    `Revoke agent ${agent} from SAFE #${safeId}.`,
    [
      {
        contractAddress: cfg.safeManagerAddress,
        entrypoint: "revoke_agent",
        calldata: ["0x" + BigInt(safeId).toString(16), agent],
      },
    ],
  );
}

function handleUpdate(): ToolResult {
  const cfg = getConfig();
  return callResult(
    "Trigger manual price/rate update via GrintaHook.",
    [
      {
        contractAddress: cfg.hookAddress,
        entrypoint: "update",
        calldata: [],
      },
    ],
  );
}

function handleSetMarketPrice(args: Record<string, unknown>): ToolResult {
  const price = parseGritAmount(args.price as string); // reuse WAD parser
  const cfg = getConfig();

  return callResult(
    `Set GRIT/USD market price to $${args.price}.`,
    [
      {
        contractAddress: cfg.hookAddress,
        entrypoint: "set_market_price",
        calldata: [...u256Calldata(price)],
      },
    ],
  );
}

// ---------------------------------------------------------------------------
// Read handlers — execute on-chain via provider (no key needed)
// ---------------------------------------------------------------------------

async function handleGetMarketPrice(): Promise<ToolResult> {
  const hook = getGrintaHook();
  const result = await hook.call("get_market_price", []);
  const price = toBigInt(result as unknown);

  return ok(
    `GRIT/USD Market Price: ${formatUsd(price)}\n` +
    `  (raw WAD: ${price})`,
  );
}

async function handleGetCollateralPriceHook(): Promise<ToolResult> {
  const hook = getGrintaHook();
  const result = await hook.call("get_collateral_price", []);
  const price = toBigInt(result as unknown);

  return ok(
    `BTC/USD Collateral Price (from Hook): ${formatUsd(price)}\n` +
    `  (raw WAD: ${price})`,
  );
}

async function handleGetPositionHealth(args: Record<string, unknown>): Promise<ToolResult> {
  const safeId = BigInt(args.safe_id as string);
  const mgr = getSafeManager();
  const result = await mgr.call("get_position_health", [safeId]);

  const health = result as Record<string, unknown>;
  const colValue = toBigInt(health.collateral_value);
  const debt = toBigInt(health.debt);
  const ltv = toBigInt(health.ltv);
  const liqPrice = toBigInt(health.liquidation_price);

  return ok(
    `SAFE #${args.safe_id} Health:\n` +
    `  Collateral Value: ${formatUsd(colValue)}\n` +
    `  Debt: ${formatWad(debt, "GRIT")}\n` +
    `  LTV: ${formatWadPercent(ltv)}\n` +
    `  Liquidation Price: ${formatUsd(liqPrice)}`,
  );
}

async function handleGetMaxBorrow(args: Record<string, unknown>): Promise<ToolResult> {
  const safeId = BigInt(args.safe_id as string);
  const mgr = getSafeManager();
  const result = await mgr.call("get_max_borrow", [safeId]);
  const maxBorrow = toBigInt(result as unknown);

  return ok(
    `SAFE #${args.safe_id} Max Additional Borrow: ${formatWad(maxBorrow, "GRIT")}`,
  );
}

async function handleGetSafe(args: Record<string, unknown>): Promise<ToolResult> {
  const safeId = BigInt(args.safe_id as string);
  const engine = getSafeEngine();

  const [safe, owner] = await Promise.all([
    engine.call("get_safe", [safeId]),
    engine.call("get_safe_owner", [safeId]),
  ]);

  const safeData = safe as Record<string, unknown>;
  const collateral = toBigInt(safeData.collateral);
  const debt = toBigInt(safeData.debt);

  return ok(
    `SAFE #${args.safe_id}:\n` +
    `  Owner: ${String(owner)}\n` +
    `  Collateral: ${formatBtcFromWad(collateral)}\n` +
    `  Debt: ${formatWad(debt, "GRIT")}`,
  );
}

async function handleGetRates(): Promise<ToolResult> {
  const engine = getSafeEngine();
  const hook = getGrintaHook();

  const [rPrice, rRate, cPrice, liqRatio, mPrice] = await Promise.all([
    engine.call("get_redemption_price", []),
    engine.call("get_redemption_rate", []),
    engine.call("get_collateral_price", []),
    engine.call("get_liquidation_ratio", []),
    hook.call("get_market_price", []),
  ]);

  const redemptionPrice = toBigInt(rPrice as unknown);
  const redemptionRate = toBigInt(rRate as unknown);
  const collateralPrice = toBigInt(cPrice as unknown);
  const liquidationRatio = toBigInt(liqRatio as unknown);
  const marketPrice = toBigInt(mPrice as unknown);

  return ok(
    `Grinta Rates:\n` +
    `  GRIT Market Price: ${formatUsd(marketPrice)}\n` +
    `  Redemption Price (target): ${formatRay(redemptionPrice, "USD")}\n` +
    `  Redemption Rate: ${formatAnnualRate(redemptionRate)} annual\n` +
    `  BTC/USD Price: ${formatUsd(collateralPrice)}\n` +
    `  Liquidation Ratio: ${formatWadPercent(liquidationRatio)}`,
  );
}

async function handleGetSystemHealth(): Promise<ToolResult> {
  const engine = getSafeEngine();

  const [health, debtCeiling, totalDebt] = await Promise.all([
    engine.call("get_system_health", []),
    engine.call("get_debt_ceiling", []),
    engine.call("get_total_debt", []),
  ]);

  const h = health as Record<string, unknown>;
  const colValue = toBigInt(h.collateral_value);
  const debt = toBigInt(h.debt);
  const ltv = toBigInt(h.ltv);
  const ceiling = toBigInt(debtCeiling as unknown);
  const total = toBigInt(totalDebt as unknown);
  const utilization = ceiling > 0n ? (total * 10000n) / ceiling : 0n;
  const utilWhole = utilization / 100n;
  const utilFrac = utilization % 100n;

  return ok(
    `Grinta System Health:\n` +
    `  Total Collateral Value: ${formatUsd(colValue)}\n` +
    `  Total Debt: ${formatWad(debt, "GRIT")}\n` +
    `  System LTV: ${formatWadPercent(ltv)}\n` +
    `  Debt Ceiling: ${formatWad(ceiling, "GRIT")}\n` +
    `  Utilization: ${utilWhole}.${utilFrac.toString().padStart(2, "0")}%`,
  );
}

async function handleGetGritBalance(args: Record<string, unknown>): Promise<ToolResult> {
  const address = args.address as string;
  if (!address) {
    return err("Address is required. Pass the Starknet address to check.");
  }
  const engine = getSafeEngine();
  const result = await engine.call("get_grit_balance", [address]);
  const balance = toBigInt(result as unknown);

  return ok(
    `GRIT Balance for ${address}: ${formatWad(balance, "GRIT")}`,
  );
}

async function handleIsAuthorized(args: Record<string, unknown>): Promise<ToolResult> {
  const safeId = BigInt(args.safe_id as string);
  const agent = args.agent_address as string;
  const mgr = getSafeManager();
  const result = await mgr.call("is_authorized", [safeId, agent]);

  const authorized = Boolean(result);

  return ok(
    `Agent ${agent} on SAFE #${args.safe_id}: ${authorized ? "AUTHORIZED" : "NOT AUTHORIZED"}`,
  );
}
