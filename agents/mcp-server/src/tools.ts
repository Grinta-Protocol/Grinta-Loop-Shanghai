import { z } from "zod";

// ---------------------------------------------------------------------------
// Input schemas (zod)
// ---------------------------------------------------------------------------

export const SafeIdInput = z.object({
  safe_id: z.string().describe("The numeric SAFE ID"),
});

export const AmountInput = z.object({
  safe_id: z.string().describe("The numeric SAFE ID"),
  amount: z.string().describe("Amount as a decimal string (e.g. '0.5' for BTC, '1000' for GRIT)"),
});

export const OpenAndBorrowInput = z.object({
  collateral_amount: z.string().describe("WBTC amount in BTC (e.g. '0.5' for 0.5 BTC)"),
  borrow_amount: z.string().describe("GRIT amount to borrow (e.g. '10000' for 10,000 GRIT)"),
});

export const AgentInput = z.object({
  safe_id: z.string().describe("The numeric SAFE ID"),
  agent_address: z.string().describe("Starknet address of the agent (hex string)"),
});

export const AddressInput = z.object({
  address: z.string().optional().describe("Starknet address (hex). Defaults to the configured account."),
});

// ---------------------------------------------------------------------------
// Tool definitions (MCP ListTools format)
// ---------------------------------------------------------------------------

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOLS: ToolDef[] = [
  // ---- Write tools ----
  {
    name: "grinta_open_safe",
    description: "Open a new empty SAFE. Returns the new safe_id. No collateral or debt.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "grinta_open_and_borrow",
    description:
      "Open a new SAFE, deposit WBTC collateral, and borrow GRIT in one transaction. " +
      "Handles ERC20 approval automatically. Returns the new safe_id.",
    inputSchema: {
      type: "object",
      properties: {
        collateral_amount: { type: "string", description: "WBTC amount in BTC (e.g. '0.5')" },
        borrow_amount: { type: "string", description: "GRIT amount to borrow (e.g. '10000')" },
      },
      required: ["collateral_amount", "borrow_amount"],
    },
  },
  {
    name: "grinta_deposit",
    description:
      "Deposit additional WBTC collateral into an existing SAFE. " +
      "Handles ERC20 approval automatically. Amount is in BTC (e.g. '0.25').",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
        amount: { type: "string", description: "WBTC amount in BTC (e.g. '0.25')" },
      },
      required: ["safe_id", "amount"],
    },
  },
  {
    name: "grinta_withdraw",
    description:
      "Withdraw WBTC collateral from a SAFE. Reverts if it would make the position unhealthy. " +
      "Amount is in BTC (e.g. '0.1').",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
        amount: { type: "string", description: "WBTC amount in BTC (e.g. '0.1')" },
      },
      required: ["safe_id", "amount"],
    },
  },
  {
    name: "grinta_borrow",
    description:
      "Borrow additional GRIT against existing collateral in a SAFE. " +
      "Reverts if it would make the position unhealthy. Amount is in GRIT (e.g. '5000').",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
        amount: { type: "string", description: "GRIT amount to borrow (e.g. '5000')" },
      },
      required: ["safe_id", "amount"],
    },
  },
  {
    name: "grinta_repay",
    description:
      "Repay GRIT debt in a SAFE. If amount exceeds debt, only repays what's owed. " +
      "Amount is in GRIT (e.g. '5000'). Use a very large number to repay all.",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
        amount: { type: "string", description: "GRIT amount to repay (e.g. '5000')" },
      },
      required: ["safe_id", "amount"],
    },
  },
  {
    name: "grinta_close_safe",
    description:
      "Close a SAFE. Must have zero debt. Returns any remaining collateral to the caller.",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
      },
      required: ["safe_id"],
    },
  },
  {
    name: "grinta_authorize_agent",
    description:
      "Authorize an agent address to operate on a SAFE (deposit, withdraw, borrow, repay, close). " +
      "Only the SAFE owner can call this.",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
        agent_address: { type: "string", description: "Agent's Starknet address (hex)" },
      },
      required: ["safe_id", "agent_address"],
    },
  },
  {
    name: "grinta_revoke_agent",
    description:
      "Revoke an agent's permission to operate on a SAFE. Only the SAFE owner can call this.",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
        agent_address: { type: "string", description: "Agent's Starknet address (hex)" },
      },
      required: ["safe_id", "agent_address"],
    },
  },

  // ---- Read tools ----
  {
    name: "grinta_get_position_health",
    description:
      "Get health metrics for a SAFE: collateral value (USD), debt (GRIT), LTV ratio, and liquidation price.",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
      },
      required: ["safe_id"],
    },
  },
  {
    name: "grinta_get_max_borrow",
    description:
      "Get the maximum additional GRIT that can be borrowed from a SAFE without breaching the liquidation ratio.",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
      },
      required: ["safe_id"],
    },
  },
  {
    name: "grinta_get_safe",
    description:
      "Get raw SAFE data: collateral (WAD), debt (WAD), and owner address.",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
      },
      required: ["safe_id"],
    },
  },
  {
    name: "grinta_get_rates",
    description:
      "Get current redemption price (target GRIT price in USD), redemption rate (per-second), " +
      "collateral price (BTC/USD), and liquidation ratio.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "grinta_get_system_health",
    description:
      "Get system-wide health: total collateral value (USD), total debt (GRIT), system LTV, " +
      "debt ceiling, and utilization.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "grinta_get_grit_balance",
    description:
      "Get the GRIT token balance for an address.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Starknet address (hex)" },
      },
      required: ["address"],
    },
  },
  {
    name: "grinta_is_authorized",
    description: "Check if an agent address is authorized to operate on a SAFE.",
    inputSchema: {
      type: "object",
      properties: {
        safe_id: { type: "string", description: "The numeric SAFE ID" },
        agent_address: { type: "string", description: "Agent's Starknet address (hex)" },
      },
      required: ["safe_id", "agent_address"],
    },
  },
];
