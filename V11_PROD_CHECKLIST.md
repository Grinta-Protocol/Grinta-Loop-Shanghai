# V11 Production Checklist

V11 deploy bakes **demo-friendly** values into the constructor so the demo runs
out of the box. Before mainnet hand-off, flip the items in this checklist.

## Source of truth for demo constants

- `tests/test_common.cairo` — `KP`, `KI`, `NOISE_BARRIER`, `INTEGRAL_PERIOD_SIZE`,
  `FEEDBACK_UPPER_BOUND`, `FEEDBACK_LOWER_BOUND`, `PER_SECOND_LEAK`
- `scripts/deploy_sepolia_v11.sh` — constructor args
- `app/scripts/demo_mode.ts` — runtime overrides applied after deploy

## PID Controller — what to change for prod

| Parameter | Demo (V11 deploy) | Prod target | Setter |
|---|---|---|---|
| `kp` | `1_000_000_000_000` (1e-6 WAD) | `150_000_000_000` (1.5e-7 WAD, HAI mainnet) | agent propose via Guard |
| `ki` | `1_000_000` (1e-12 WAD) | `24_000` (2.4e-14 WAD, HAI mainnet) | agent propose via Guard |
| `noise_barrier` | `1_000_000_000_000_000_000` (1.0 WAD — disabled) | `995_000_000_000_000_000` (0.995 WAD — 0.5% dead band) | `proxy_set_noise_barrier` via Guard |
| `integral_period_size` | `5` seconds | `3600` seconds (1 hour) | add setter proxy if needed, or redeploy |
| `feedback_output_upper_bound` | `1e27` RAY | `1e27` RAY (no change) | — |
| `feedback_output_lower_bound` | `-1e27` | `-1e27` (no change) | — |
| `per_second_cumulative_leak` | `999_999_732_582_142_021_614_955_959` (30d half-life) | same (no change) | `proxy_set_per_second_cumulative_leak` via Guard |

## GrintaHook — throttle intervals

| Parameter | Demo | Prod target |
|---|---|---|
| `price_update_interval` | `1` s | `60` s |
| `rate_update_interval` | `1` s | `3600` s |

Setters: `hook.set_price_update_interval(n)`, `hook.set_rate_update_interval(n)` (admin only).

## ParameterGuard policy

| Field | Demo | Prod target |
|---|---|---|
| `kp_min` | `100_000_000_000` (1e-7 WAD) | `50_000_000_000` (5e-8 WAD) |
| `kp_max` | `10_000_000_000_000` (1e-5 WAD) | `500_000_000_000` (5e-7 WAD) |
| `ki_min` | `100_000` | `10_000` |
| `ki_max` | `100_000_000` | `500_000` |
| `max_kp_delta` | `5_000_000_000_000` | `15_000_000_000` (~10% of kp_max) |
| `max_ki_delta` | `50_000_000` | `50_000` |
| `cooldown_seconds` | `5` | `3600` |
| `emergency_cooldown_seconds` | `3` | `300` |
| `max_updates` | `1000` | `50` |

Apply with `guard.set_policy({...})` (admin only).

## Hand-off sequence (demo → prod)

1. `pid.reset_deviation()` — clear integrator windup from demo sessions
2. `safe_engine.reset_redemption_price(1e27, 1e27)` — re-peg to $1 with 1.0 rate
3. Guard: `set_policy(prod_policy)` — tighten bounds and cooldowns
4. Agent proposes prod Kp/Ki via `propose_parameters`
5. `proxy_set_noise_barrier(0.995e18)` — enable dead band
6. `proxy_set_per_second_cumulative_leak(30d_half_life)` — verify no drift from demo
7. `hook.set_price_update_interval(60)`, `hook.set_rate_update_interval(3600)`
8. `pid.set_integral_period_size(3600)` — requires admin (Guard), so need `guard.proxy_set_integral_period_size` (add if missing)

## Gaps to close before prod

- [ ] ParameterGuard: add `proxy_set_integral_period_size` (currently only `proxy_set_seed_proposer`, `proxy_set_noise_barrier`, `proxy_set_per_second_cumulative_leak`)
- [ ] PID: add `set_feedback_output_upper_bound` / `set_feedback_output_lower_bound` setters (currently only settable at construction)
- [ ] PID: add `replace_class` for upgradability (SAFEEngine already has it)
- [ ] Audit: get external review of the RAY migration before mainnet
- [ ] Invariant tests: add property tests that verify rate magnitude scales linearly with deviation across Kp/Ki ranges
- [ ] Monitoring: on-chain dashboard for integral value, noise barrier hit rate, feedback bound clips
