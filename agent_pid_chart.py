"""
Synthetic visualization: Agent-as-Governor vs Baseline PID
Shows how the agent's dynamic KP tuning produces stronger rate corrections
during a BTC crash, without needing on-chain simulation data.

Usage: python agent_pid_chart.py
Output: agent_pid_chart.png
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

# ── Synthetic timeline (minutes) ──────────────────────────────────────
t = np.linspace(0, 60, 300)  # 60 minutes, 300 points

# ── BTC price: crash at t=10, bottom at t=25, recovery by t=50 ───────
btc_base = 60000
crash_depth = 0.20  # 20% crash
btc_price = np.where(
    t < 10, btc_base,
    np.where(
        t < 25,
        btc_base * (1 - crash_depth * (t - 10) / 15),
        btc_base * (1 - crash_depth) + (btc_base * crash_depth) * np.minimum((t - 25) / 25, 1.0)
    )
)
# Add slight noise
rng = np.random.default_rng(42)
btc_price += rng.normal(0, 80, len(t))

# ── Market price of GRIT (pegged stablecoin) ─────────────────────────
# Tracks BTC crash with lag — drops below $1 peg during crash
market_price = np.where(
    t < 12, 1.0,
    np.where(
        t < 28,
        1.0 - 0.05 * (t - 12) / 16,  # drops to $0.95
        1.0 - 0.05 * np.maximum(1 - (t - 28) / 22, 0)  # recovers
    )
)
market_price += rng.normal(0, 0.002, len(t))

# ── Redemption price (target) — always $1 initially ──────────────────
redemption_price = np.ones_like(t) * 1.0

# ── Error = redemption_price - market_price ───────────────────────────
error = redemption_price - market_price

# ── KP profiles ───────────────────────────────────────────────────────
kp_baseline = np.ones_like(t) * 2.0  # Fixed

# Agent: detects crash ~t=15, raises KP; detects recovery ~t=40, lowers
kp_agent = np.where(
    t < 15, 2.0,
    np.where(
        t < 18, 2.0 + 0.5 * (t - 15) / 3,  # ramp up
        np.where(
            t < 38, 2.5,  # sustained higher KP
            np.where(
                t < 42, 2.5 - 0.5 * (t - 38) / 4,  # ramp down
                2.0
            )
        )
    )
)

# ── Redemption rate = KP * error ──────────────────────────────────────
rate_baseline = kp_baseline * error
rate_agent = kp_agent * error

# ── Rate difference (%) ──────────────────────────────────────────────
rate_diff_pct = np.where(
    np.abs(rate_baseline) > 0.001,
    (rate_agent - rate_baseline) / np.abs(rate_baseline) * 100,
    0
)

# ══════════════════════════════════════════════════════════════════════
# PLOT
# ══════════════════════════════════════════════════════════════════════
fig, axes = plt.subplots(3, 1, figsize=(14, 10), sharex=True)
fig.patch.set_facecolor('#0d1117')

colors = {
    'baseline': '#6e7681',
    'agent': '#58a6ff',
    'btc': '#f0883e',
    'market': '#d2a8ff',
    'crash_zone': '#da363330',
    'text': '#c9d1d9',
    'grid': '#21262d',
    'accent': '#3fb950',
}

for ax in axes:
    ax.set_facecolor('#0d1117')
    ax.tick_params(colors=colors['text'])
    ax.spines['bottom'].set_color(colors['grid'])
    ax.spines['left'].set_color(colors['grid'])
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(True, alpha=0.15, color=colors['grid'])

# Crash zone shading on all panels
for ax in axes:
    ax.axvspan(12, 38, alpha=0.08, color='#da3633', zorder=0)

# ── Panel 1: BTC Price + Market Price ─────────────────────────────────
ax1 = axes[0]
ax1_btc = ax1.twinx()
ax1_btc.set_facecolor('#0d1117')
ax1_btc.spines['top'].set_visible(False)
ax1_btc.spines['right'].set_color(colors['grid'])
ax1_btc.spines['left'].set_color(colors['grid'])
ax1_btc.spines['bottom'].set_color(colors['grid'])
ax1_btc.tick_params(colors=colors['text'])

ln1 = ax1.plot(t, market_price, color=colors['market'], linewidth=2, label='GRIT Market Price')
ax1.axhline(y=1.0, color=colors['accent'], linestyle='--', alpha=0.5, linewidth=1, label='$1.00 Peg')
ln2 = ax1_btc.plot(t, btc_price, color=colors['btc'], linewidth=1.5, alpha=0.6, label='BTC Price')

ax1.set_ylabel('GRIT Price ($)', color=colors['text'], fontsize=11)
ax1_btc.set_ylabel('BTC Price ($)', color=colors['btc'], fontsize=11)
ax1.set_title('Market Shock: BTC -20% Crash Scenario', color=colors['text'], fontsize=14, fontweight='bold', pad=12)

lns = ln1 + ln2 + [plt.Line2D([0], [0], color=colors['accent'], linestyle='--', alpha=0.5)]
labs = ['GRIT Market Price', 'BTC Price', '$1.00 Peg']
ax1.legend(lns, labs, loc='lower left', fontsize=9, facecolor='#161b22', edgecolor=colors['grid'], labelcolor=colors['text'])

# ── Panel 2: KP over time ────────────────────────────────────────────
ax2 = axes[1]
ax2.plot(t, kp_baseline, color=colors['baseline'], linewidth=2, linestyle='--', label='Baseline KP (fixed)')
ax2.plot(t, kp_agent, color=colors['agent'], linewidth=2.5, label='Agent KP (dynamic)')
ax2.set_ylabel('KP Value', color=colors['text'], fontsize=11)
ax2.set_title('Proportional Gain (KP) — Agent Adapts During Crisis', color=colors['text'], fontsize=14, fontweight='bold', pad=12)
ax2.legend(loc='upper right', fontsize=9, facecolor='#161b22', edgecolor=colors['grid'], labelcolor=colors['text'])
ax2.set_ylim(1.5, 3.0)

# Annotate
ax2.annotate('Agent detects crash\nraises KP → 2.5', xy=(18, 2.5), xytext=(25, 2.8),
             color=colors['agent'], fontsize=9, fontweight='bold',
             arrowprops=dict(arrowstyle='->', color=colors['agent'], lw=1.5))
ax2.annotate('Price stabilizes\nagent lowers KP', xy=(40, 2.0), xytext=(45, 2.6),
             color=colors['accent'], fontsize=9,
             arrowprops=dict(arrowstyle='->', color=colors['accent'], lw=1.5))

# ── Panel 3: Redemption Rate ─────────────────────────────────────────
ax3 = axes[2]
ax3.plot(t, rate_baseline, color=colors['baseline'], linewidth=2, linestyle='--', label='Baseline Rate (KP=2.0)')
ax3.plot(t, rate_agent, color=colors['agent'], linewidth=2.5, label='Agent Rate (dynamic KP)')
ax3.fill_between(t, rate_baseline, rate_agent,
                 where=(rate_agent > rate_baseline),
                 alpha=0.15, color=colors['agent'], label='+25% stronger correction')
ax3.set_ylabel('Redemption Rate', color=colors['text'], fontsize=11)
ax3.set_xlabel('Time (minutes)', color=colors['text'], fontsize=11)
ax3.set_title('Redemption Rate — Same Error, Stronger Response With Agent', color=colors['text'], fontsize=14, fontweight='bold', pad=12)
ax3.legend(loc='upper right', fontsize=9, facecolor='#161b22', edgecolor=colors['grid'], labelcolor=colors['text'])

plt.tight_layout(h_pad=2.0)
plt.savefig('agent_pid_chart.png', dpi=200, bbox_inches='tight', facecolor='#0d1117')
print("✅ Chart saved to agent_pid_chart.png")
plt.show()
